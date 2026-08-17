# Single Instance Tray Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a second Windows-installed Trali process from creating another tray icon and focus the existing hidden window when its shortcut is launched again.

**Architecture:** Add Tauri's official single-instance plugin as the first desktop plugin. Extract the existing “show/unminimize/focus” behavior into one `show_main_window` helper and call it from the tray menu and the plugin's second-instance callback. Keep the plugin desktop-only and preserve the mobile entry point.

**Tech Stack:** Rust, Tauri 2.11.5, `tauri-plugin-single-instance` 2, Tauri mock runtime tests, Cargo.

## Global Constraints

- Use `tauri-plugin-single-instance` rather than a custom Windows mutex or IPC channel.
- Register the single-instance plugin before all other plugins.
- Do not change close-to-tray behavior, tray menu labels, global shortcut behavior, or mobile entry points.
- Keep privileged startup and window operations in `src-tauri/src/lib.rs`.
- Update `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` together.
- Do not commit, push, create branches, or open pull requests unless explicitly requested.

---

### Task 1: Add the failing window-restore regression test

**Files:**
- Modify: `src-tauri/src/lib.rs` by adding the window restore seam and test module after the command handler or at the end of the file.

**Interfaces:**
- Consumes: the existing `AppHandle`-based window helper boundary.
- Produces: a failing test named `second_instance_restores_hidden_main_window` that defines the required restore order before the production seam exists.

- [x] **Step 1: Define the test seam without adding a runtime-specific test dependency**

Add a private `WindowRestoreTarget` trait, a `WebviewWindow` implementation, and a `restore_window` helper. The test uses a `RefCell<Vec<&'static str>>` recorder so it does not instantiate WebView2 or depend on Tauri's unstable mock runtime.

- [x] **Step 2: Write the failing test before adding the restore helper**

Append this test module to `src-tauri/src/lib.rs`:

```rust
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
```

The test must reference `show_main_window` before that production function is added so the test represents the missing restore path.

- [x] **Step 3: Run the focused Rust test and verify the expected red state**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml second_instance_restores_hidden_main_window
```

Expected: compilation fails because `WindowRestoreTarget`, `restore_window`, or the test seam is not yet defined. This confirms the regression test is exercising the new restore path rather than passing against the current implementation.

### Task 2: Implement single-instance startup and shared window restoration

**Files:**
- Modify: `src-tauri/Cargo.toml:54-57` to add the desktop-only `tauri-plugin-single-instance` dependency.
- Modify: `src-tauri/Cargo.lock` through Cargo dependency resolution.
- Modify: `src-tauri/src/lib.rs:22-36` to extract `show_main_window` and reuse it from toggle and tray actions.
- Modify: `src-tauri/src/lib.rs:49-65` to register the single-instance plugin first and handle second launches.
- Modify: `src-tauri/src/lib.rs:89-96` to route the tray “show” menu through the shared helper.

**Interfaces:**
- Consumes: `tauri_plugin_single_instance::init`, `AppHandle`, and the existing main window label `"main"`.
- Produces: `WindowRestoreTarget`, `restore_window`, `show_main_window<R: Runtime>(&AppHandle<R>) -> Result<(), String>`, and a desktop startup callback that restores the existing instance.

- [x] **Step 1: Add the desktop-only plugin dependency**

Extend the existing target dependency table to include:

```toml
[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]
tauri-plugin-autostart = "2.5.1"
tauri-plugin-process = "2"
tauri-plugin-single-instance = "2"
tauri-plugin-updater = "2"
```

- [x] **Step 2: Add the shared restore helper**

Immediately before `show_main_window`, add the private trait and generic helper, then use it from `show_main_window`:

```rust
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
```

Update the non-hide branch of `toggle_main_window` to call `show_main_window(app)` instead of repeating the three operations.

- [x] **Step 3: Register the single-instance plugin before the existing plugins**

Replace the start of `run` with a builder variable and a desktop-only first plugin:

```rust
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
```

Keep the current `setup`, `on_window_event`, `invoke_handler`, and `run` calls chained from `builder` unchanged apart from this insertion.

- [x] **Step 4: Reuse the helper from the tray “show” menu**

Replace the three direct window calls in the `"show"` menu branch with:

```rust
"show" => {
    let _ = show_main_window(app);
}
```

- [x] **Step 5: Run the focused test and verify the green state**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml second_instance_restores_hidden_main_window
```

Expected: the focused test passes with zero failures.

### Task 3: Run cross-boundary verification and inspect the final change

**Files:**
- Read: `docs/superpowers/specs/2026-08-04-single-instance-tray-design.md`.
- Read: `docs/superpowers/plans/2026-08-04-single-instance-tray.md`.
- Inspect: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/src/lib.rs`.

**Interfaces:**
- Consumes: the plugin registration, shared restore helper, and regression test from Tasks 1–2.
- Produces: fresh verification evidence and a concise handoff with any remaining manual Windows installer check.

- [x] **Step 1: Run Rust formatting verification**

Run:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: exit code 0 with no formatting differences.

- [x] **Step 2: Run all Rust tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: exit code 0 and zero failed tests.

- [x] **Step 3: Run the frontend build**

Run:

```powershell
pnpm build
```

Expected: TypeScript and Vite both complete successfully.

- [x] **Step 4: Inspect the final diff and status**

Run:

```powershell
git diff -- src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git status -sb
```

Confirm the diff contains only the design/plan documents and the single-instance implementation, with no generated build output or unrelated edits.

- [ ] **Step 5: Perform the Windows installer acceptance check**

Using the installed Windows application:

1. Launch Trali from the desktop or Start-menu shortcut.
2. Close the window with close-to-tray enabled and confirm the existing tray icon remains.
3. Launch the same shortcut again and confirm the tray icon count remains one, while the original window becomes visible and focused.
4. Launch the shortcut once more while the window is visible and confirm no second icon or window appears.
5. Choose tray “退出 / Quit”, then launch the shortcut and confirm the application starts normally.
