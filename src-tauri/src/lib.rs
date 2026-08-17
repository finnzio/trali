use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, WebviewWindow,
};

mod commands;
mod error;
mod generation;
mod glossary;
mod prompt_optimizer;
mod prompts;
mod providers;
mod secrets;
mod settings;
mod speech;
mod storage;

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

trait WindowRestoreTarget {
    fn unminimize_window(&self) -> Result<(), String>;
    fn show_window(&self) -> Result<(), String>;
    fn focus_window(&self) -> Result<(), String>;
}

impl<R: Runtime> WindowRestoreTarget for WebviewWindow<R> {
    fn unminimize_window(&self) -> Result<(), String> {
        self.unminimize().map_err(|error| error.to_string())
    }

    fn show_window(&self) -> Result<(), String> {
        self.show().map_err(|error| error.to_string())
    }

    fn focus_window(&self) -> Result<(), String> {
        self.set_focus().map_err(|error| error.to_string())
    }
}

fn restore_window<W: WindowRestoreTarget>(window: &W) -> Result<(), String> {
    window.unminimize_window()?;
    window.show_window()?;
    window.focus_window()
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;

    restore_window(&window)
}

fn quit_application<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<commands::BackendState>() {
        let _ = state.speech.stop();
    }
    app.exit(0);
}

/// Headless CI hook: when `TRALI_CI_ACCEPTANCE` is set, watch for
/// `%TEMP%/trali-ci-exit` and take the same path as tray "Quit".
/// Production launches never set the env var, so this is inert.
#[cfg(desktop)]
fn start_ci_acceptance_hooks<R: Runtime>(app: &AppHandle<R>) {
    if !std::env::var_os("TRALI_CI_ACCEPTANCE").is_some_and(|value| !value.is_empty()) {
        return;
    }

    let handle = app.clone();
    std::thread::Builder::new()
        .name("trali-ci-exit".into())
        .spawn(move || {
            let signal = std::env::temp_dir().join("trali-ci-exit");
            let _ = std::fs::remove_file(&signal);
            loop {
                if signal.is_file() {
                    let _ = std::fs::remove_file(&signal);
                    quit_application(&handle);
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
        })
        .expect("failed to start CI exit hook");
}

fn toggle_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;
    let visible = window.is_visible().map_err(|error| error.to_string())?;
    let minimized = window.is_minimized().map_err(|error| error.to_string())?;

    if visible && !minimized {
        window.hide().map_err(|error| error.to_string())
    } else {
        show_main_window(app)
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
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = show_main_window(app);
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_process::init())?;

            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

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

            #[cfg(desktop)]
            start_ci_acceptance_hooks(app.handle());

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
                        let _ = show_main_window(app);
                    }
                    "quit" => {
                        quit_application(app);
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
            commands::export_glossary_to_file,
            commands::import_glossary,
            commands::export_settings,
            commands::import_settings,
            commands::set_provider_api_key,
            commands::delete_provider_api_key,
            commands::fetch_provider_models,
            commands::test_provider_connection,
            commands::generate,
            commands::cancel_generation,
            commands::optimize_style_prompt,
            commands::speech_capabilities,
            commands::speak_text,
            commands::stop_speech
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct FakeWindow {
        operations: RefCell<Vec<&'static str>>,
    }

    impl WindowRestoreTarget for FakeWindow {
        fn unminimize_window(&self) -> Result<(), String> {
            self.operations.borrow_mut().push("unminimize");
            Ok(())
        }

        fn show_window(&self) -> Result<(), String> {
            self.operations.borrow_mut().push("show");
            Ok(())
        }

        fn focus_window(&self) -> Result<(), String> {
            self.operations.borrow_mut().push("focus");
            Ok(())
        }
    }

    #[test]
    fn second_instance_restores_hidden_main_window() {
        let window = FakeWindow::default();

        restore_window(&window).expect("failed to restore main window");

        assert_eq!(
            window.operations.into_inner(),
            vec!["unminimize", "show", "focus"]
        );
    }
}
