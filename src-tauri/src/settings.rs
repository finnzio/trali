use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderType {
    OpenaiCompatible,
    AnthropicCompatible,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub provider_type: ProviderType,
    pub endpoint: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleConfig {
    pub id: String,
    pub name: String,
    pub prompt: String,
    #[serde(default)]
    pub provider_id: Option<String>,
}

fn default_version() -> u32 {
    2
}

fn default_interface_language() -> String {
    "zh-CN".into()
}

fn default_theme() -> String {
    "auto".into()
}

fn default_theme_color() -> String {
    "green".into()
}

fn default_radius() -> String {
    "default".into()
}

fn default_shortcut() -> String {
    "CommandOrControl+Shift+Space".into()
}

fn default_target_language() -> String {
    "en".into()
}

fn default_close_behavior() -> String {
    "tray".into()
}

fn default_work_mode() -> String {
    "translate".into()
}

fn default_selected_styles() -> Vec<String> {
    vec!["default".into()]
}

const SUPPORTED_LANGUAGES: &[&str] = &[
    "en", "zh-CN", "zh-TW", "ja", "ko", "es", "de", "fr", "pt-BR", "ru", "hi", "id", "vi", "th",
    "tr", "it", "pl", "uk", "nl", "ms",
];

fn is_supported_language(code: &str) -> bool {
    SUPPORTED_LANGUAGES.contains(&code)
}

fn default_language_pairs() -> Vec<LanguagePair> {
    vec![
        LanguagePair {
            id: "pair-zh-cn-en".into(),
            source: "zh-CN".into(),
            target: "en".into(),
        },
        LanguagePair {
            id: "pair-en-ja".into(),
            source: "en".into(),
            target: "ja".into(),
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanguagePair {
    pub id: String,
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default = "default_interface_language")]
    pub interface_language: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_theme_color")]
    pub theme_color: String,
    #[serde(default = "default_radius")]
    pub radius: String,
    #[serde(default = "default_shortcut")]
    pub shortcut: String,
    #[serde(default = "default_target_language")]
    pub default_target_language: String,
    #[serde(default = "default_close_behavior")]
    pub close_behavior: String,
    #[serde(default)]
    pub always_on_top: bool,
    #[serde(default = "default_work_mode")]
    pub work_mode: String,
    #[serde(default = "default_selected_styles")]
    pub selected_style_ids: Vec<String>,
    #[serde(default)]
    pub default_provider_id: Option<String>,
    #[serde(default)]
    pub providers: Vec<ProviderConfig>,
    #[serde(default)]
    pub styles: Vec<StyleConfig>,
    /// Quick-select language pairs for the main UI (source and target stay separate dropdowns).
    #[serde(default = "default_language_pairs")]
    pub language_pairs: Vec<LanguagePair>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: default_version(),
            interface_language: default_interface_language(),
            theme: default_theme(),
            theme_color: default_theme_color(),
            radius: default_radius(),
            shortcut: default_shortcut(),
            default_target_language: default_target_language(),
            close_behavior: default_close_behavior(),
            always_on_top: false,
            work_mode: default_work_mode(),
            selected_style_ids: default_selected_styles(),
            default_provider_id: None,
            providers: Vec::new(),
            styles: Vec::new(),
            language_pairs: default_language_pairs(),
        }
    }
}

impl AppSettings {
    pub fn repair(&mut self) {
        self.version = 2;
        if self.selected_style_ids.is_empty() {
            self.selected_style_ids.push("default".into());
        }
        self.selected_style_ids
            .retain(|id| id == "default" || self.styles.iter().any(|style| style.id == *id));
        if self.selected_style_ids.is_empty() {
            self.selected_style_ids.push("default".into());
        }
        let provider_ids = self
            .providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        if self
            .default_provider_id
            .as_deref()
            .is_none_or(|id| !provider_ids.contains(id))
        {
            self.default_provider_id = self.providers.first().map(|item| item.id.clone());
        }
        for style in &mut self.styles {
            if style
                .provider_id
                .as_deref()
                .is_some_and(|id| !provider_ids.contains(id))
            {
                style.provider_id = None;
            }
        }

        let mut seen = std::collections::HashSet::<(String, String)>::new();
        self.language_pairs.retain(|pair| {
            if pair.id.trim().is_empty()
                || !is_supported_language(&pair.source)
                || !is_supported_language(&pair.target)
                || pair.source == pair.target
            {
                return false;
            }
            seen.insert((pair.source.clone(), pair.target.clone()))
        });
        if self.language_pairs.len() > 8 {
            self.language_pairs.truncate(8);
        }
    }
}

#[derive(Clone)]
pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(app: &AppHandle) -> AppResult<Self> {
        let directory = app
            .path()
            .app_config_dir()
            .map_err(|error| AppError::new("config_directory_unavailable", error.to_string()))?;
        fs::create_dir_all(&directory).map_err(AppError::io)?;
        Ok(Self {
            path: directory.join("settings.toml"),
        })
    }

    pub fn exists(&self) -> bool {
        self.path.exists()
    }

    pub fn load(&self) -> AppResult<AppSettings> {
        if !self.path.exists() {
            return Ok(AppSettings::default());
        }
        let text = fs::read_to_string(&self.path).map_err(AppError::io)?;
        let mut settings: AppSettings = toml::from_str(&text)
            .map_err(|error| AppError::new("invalid_settings", error.to_string()))?;
        settings.repair();
        Ok(settings)
    }

    pub fn save(&self, settings: &AppSettings) -> AppResult<()> {
        let mut value = settings.clone();
        value.repair();
        let text = toml::to_string_pretty(&value)
            .map_err(|error| AppError::new("serialize_settings_failed", error.to_string()))?;
        crate::storage::atomic_write(&self.path, text.as_bytes(), "settings")
    }

    pub fn export(&self, settings: &AppSettings) -> AppResult<String> {
        toml::to_string_pretty(settings)
            .map_err(|error| AppError::new("serialize_settings_failed", error.to_string()))
    }

    pub fn parse_import(&self, text: &str) -> AppResult<AppSettings> {
        let mut settings: AppSettings = toml::from_str(text)
            .map_err(|error| AppError::new("invalid_settings", error.to_string()))?;
        settings.repair();
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repair_provider_references() {
        let mut settings = AppSettings {
            default_provider_id: Some("missing".into()),
            styles: vec![StyleConfig {
                id: "style".into(),
                name: "Style".into(),
                prompt: String::new(),
                provider_id: Some("missing".into()),
            }],
            ..Default::default()
        };
        settings.repair();
        assert_eq!(settings.default_provider_id, None);
        assert_eq!(settings.styles[0].provider_id, None);
    }

    #[test]
    fn version_two_toml_round_trip_has_no_secret_field() {
        let mut settings = AppSettings {
            providers: vec![ProviderConfig {
                id: "provider".into(),
                name: "Provider".into(),
                provider_type: ProviderType::OpenaiCompatible,
                endpoint: "https://example.com/v1".into(),
                model: "model".into(),
            }],
            ..Default::default()
        };
        settings.repair();
        let encoded = toml::to_string(&settings).unwrap();
        let decoded: AppSettings = toml::from_str(&encoded).unwrap();
        assert_eq!(decoded.version, 2);
        assert_eq!(decoded.default_provider_id.as_deref(), Some("provider"));
        assert!(!encoded.to_ascii_lowercase().contains("api_key"));
        assert!(!encoded.to_ascii_lowercase().contains("apikey"));
    }
}
