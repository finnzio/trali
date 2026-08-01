use std::{
    collections::BTreeMap,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, State};
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

use crate::{
    error::{AppError, AppResult},
    generation::{GenerationEvent, GenerationRequest},
    glossary::{GlossaryData, GlossaryStore},
    prompt_optimizer::{PromptOptimizationRequest, PromptOptimizationResponse},
    providers,
    settings::{AppSettings, SettingsStore},
    speech::{SpeechCapabilities, SpeechManager, SpeechRequest},
};

pub struct BackendState {
    pub settings_store: SettingsStore,
    pub glossary_store: GlossaryStore,
    pub settings: RwLock<AppSettings>,
    pub glossary: RwLock<GlossaryData>,
    pub client: reqwest::Client,
    pub cancellations: Mutex<BTreeMap<String, CancellationToken>>,
    pub needs_migration: AtomicBool,
    pub speech: SpeechManager,
}

impl BackendState {
    pub fn initialize(app: &AppHandle) -> AppResult<Self> {
        let settings_store = SettingsStore::new(app)?;
        let needs_migration = !settings_store.exists();
        let settings = settings_store.load()?;
        let glossary_store = GlossaryStore::new(app)?;
        let glossary = glossary_store.load()?;
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(180))
            .user_agent("AI-Translator/0.1")
            .build()
            .map_err(|error| AppError::new("http_client_failed", error.to_string()))?;
        Ok(Self {
            settings_store,
            glossary_store,
            settings: RwLock::new(settings),
            glossary: RwLock::new(glossary),
            client,
            cancellations: Mutex::new(BTreeMap::new()),
            needs_migration: AtomicBool::new(needs_migration),
            speech: SpeechManager::new(app.clone()),
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendSnapshot {
    settings: AppSettings,
    glossary: GlossaryData,
    provider_key_statuses: BTreeMap<String, bool>,
    needs_migration: bool,
}

#[tauri::command]
pub async fn load_backend_snapshot(state: State<'_, BackendState>) -> AppResult<BackendSnapshot> {
    let settings = state.settings.read().await.clone();
    let provider_ids = settings
        .providers
        .iter()
        .map(|provider| provider.id.clone())
        .collect::<Vec<_>>();
    let provider_key_statuses = tokio::task::spawn_blocking(move || {
        provider_ids
            .into_iter()
            .map(|id| {
                let has_key = crate::secrets::has_api_key(&id);
                (id, has_key)
            })
            .collect()
    })
    .await
    .map_err(|error| AppError::new("secure_storage_failed", error.to_string()))?;
    Ok(BackendSnapshot {
        settings,
        glossary: state.glossary.read().await.clone(),
        provider_key_statuses,
        needs_migration: state.needs_migration.load(Ordering::Relaxed),
    })
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, BackendState>,
    mut settings: AppSettings,
) -> AppResult<()> {
    settings.repair();
    state.settings_store.save(&settings)?;
    *state.settings.write().await = settings;
    state.needs_migration.store(false, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn migrate_legacy_data(
    state: State<'_, BackendState>,
    settings: AppSettings,
    glossary: GlossaryData,
) -> AppResult<()> {
    if !state.needs_migration.load(Ordering::Relaxed) {
        return Ok(());
    }
    let mut settings = settings;
    settings.repair();
    state.settings_store.save(&settings)?;
    *state.settings.write().await = settings;
    state.glossary_store.save(&glossary)?;
    *state.glossary.write().await = glossary;
    state.needs_migration.store(false, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn save_glossary(
    state: State<'_, BackendState>,
    glossary: GlossaryData,
) -> AppResult<()> {
    state.glossary_store.save(&glossary)?;
    *state.glossary.write().await = glossary;
    Ok(())
}

#[tauri::command]
pub async fn export_glossary(state: State<'_, BackendState>) -> AppResult<String> {
    let glossary = state.glossary.read().await;
    GlossaryStore::export(&glossary)
}

#[tauri::command]
pub async fn import_glossary(
    state: State<'_, BackendState>,
    text: String,
) -> AppResult<GlossaryData> {
    let glossary = GlossaryStore::parse(&text)?;
    state.glossary_store.save(&glossary)?;
    *state.glossary.write().await = glossary.clone();
    Ok(glossary)
}

#[tauri::command]
pub async fn export_settings(state: State<'_, BackendState>) -> AppResult<String> {
    let settings = state.settings.read().await;
    state.settings_store.export(&settings)
}

#[tauri::command]
pub async fn import_settings(
    state: State<'_, BackendState>,
    text: String,
) -> AppResult<AppSettings> {
    let imported = state.settings_store.parse_import(&text)?;
    state.settings_store.save(&imported)?;
    *state.settings.write().await = imported.clone();
    Ok(imported)
}

#[tauri::command]
pub async fn set_provider_api_key(provider_id: String, api_key: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || crate::secrets::set_api_key(&provider_id, &api_key))
        .await
        .map_err(|error| AppError::new("secure_storage_failed", error.to_string()))?
}

#[tauri::command]
pub async fn delete_provider_api_key(provider_id: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || crate::secrets::delete_api_key(&provider_id))
        .await
        .map_err(|error| AppError::new("secure_storage_failed", error.to_string()))?
}

fn provider_from_settings(
    settings: &AppSettings,
    provider_id: &str,
) -> AppResult<crate::settings::ProviderConfig> {
    settings
        .providers
        .iter()
        .find(|provider| provider.id == provider_id)
        .cloned()
        .ok_or_else(|| AppError::invalid("provider is unavailable"))
}

#[tauri::command]
pub async fn fetch_provider_models(
    state: State<'_, BackendState>,
    provider_id: String,
) -> AppResult<Vec<String>> {
    let settings = state.settings.read().await;
    let provider = provider_from_settings(&settings, &provider_id)?;
    drop(settings);
    let key_id = provider.id.clone();
    let api_key = tokio::task::spawn_blocking(move || crate::secrets::get_api_key(&key_id).ok())
        .await
        .ok()
        .flatten();
    providers::fetch_models(&state.client, &provider, api_key.as_deref()).await
}

#[tauri::command]
pub async fn test_provider_connection(
    state: State<'_, BackendState>,
    provider_id: String,
) -> AppResult<()> {
    let settings = state.settings.read().await;
    let provider = provider_from_settings(&settings, &provider_id)?;
    drop(settings);
    let key_id = provider.id.clone();
    let api_key = tokio::task::spawn_blocking(move || crate::secrets::get_api_key(&key_id).ok())
        .await
        .ok()
        .flatten();
    providers::test_connection(&state.client, &provider, api_key.as_deref()).await
}

#[tauri::command]
pub async fn generate(
    state: State<'_, BackendState>,
    request: GenerationRequest,
    on_event: Channel<GenerationEvent>,
) -> AppResult<()> {
    crate::generation::generate(&state, request, on_event).await
}

#[tauri::command]
pub async fn cancel_generation(
    state: State<'_, BackendState>,
    request_id: String,
) -> AppResult<()> {
    crate::generation::cancel(&state, &request_id).await;
    Ok(())
}

#[tauri::command]
pub async fn optimize_style_prompt(
    state: State<'_, BackendState>,
    request: PromptOptimizationRequest,
) -> AppResult<PromptOptimizationResponse> {
    crate::prompt_optimizer::optimize(&state, request).await
}

#[tauri::command]
pub fn speech_capabilities(state: State<'_, BackendState>) -> SpeechCapabilities {
    state.speech.capabilities()
}

#[tauri::command]
pub fn speak_text(state: State<'_, BackendState>, request: SpeechRequest) -> AppResult<()> {
    state.speech.speak(request)
}

#[tauri::command]
pub fn stop_speech(state: State<'_, BackendState>) -> AppResult<()> {
    state.speech.stop()
}
