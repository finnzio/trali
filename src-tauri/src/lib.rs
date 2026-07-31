use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

mod commands;
mod error;
mod generation;
mod glossary;
mod prompts;
mod providers;
mod secrets;
mod settings;
mod speech;
mod storage;

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

fn toggle_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;
    let visible = window.is_visible().map_err(|error| error.to_string())?;
    let minimized = window.is_minimized().map_err(|error| error.to_string())?;

    if visible && !minimized {
        window.hide().map_err(|error| error.to_string())
    } else {
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn toggle_window(app: AppHandle) -> Result<(), String> {
    toggle_main_window(&app)
}

#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))?;

            let backend = commands::BackendState::initialize(app.handle())?;
            let initial_settings = backend.settings.blocking_read().clone();
            CLOSE_TO_TRAY.store(initial_settings.close_behavior == "tray", Ordering::Relaxed);

            if let Some(window) = app.get_webview_window("main") {
                window.set_always_on_top(initial_settings.always_on_top)?;
            }
            app.manage(backend);

            let show_item = MenuItem::with_id(app, "show", "显示 / Show", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 / Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .ok_or("default window icon is unavailable")?
                        .clone(),
                )
                .tooltip("Trali")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        if let Some(state) = app.try_state::<commands::BackendState>() {
                            let _ = state.speech.stop();
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if CLOSE_TO_TRAY.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                } else if let Some(state) = window.try_state::<commands::BackendState>() {
                    let _ = state.speech.stop();
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            toggle_window,
            set_close_to_tray,
            commands::load_backend_snapshot,
            commands::save_settings,
            commands::migrate_legacy_data,
            commands::save_glossary,
            commands::export_glossary,
            commands::import_glossary,
            commands::export_settings,
            commands::import_settings,
            commands::set_provider_api_key,
            commands::delete_provider_api_key,
            commands::fetch_provider_models,
            commands::test_provider_connection,
            commands::generate,
            commands::cancel_generation,
            commands::speech_capabilities,
            commands::speak_text,
            commands::stop_speech
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
