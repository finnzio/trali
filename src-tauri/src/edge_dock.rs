use std::sync::atomic::{AtomicBool, Ordering};

static ENABLED: AtomicBool = AtomicBool::new(!cfg!(target_os = "linux"));

pub fn is_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        return !linux_edge_dock::is_wayland_session();
    }

    #[cfg(not(target_os = "linux"))]
    {
        cfg!(any(windows, target_os = "macos"))
    }
}

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled && is_supported(), Ordering::Relaxed);
}

fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

#[cfg(windows)]
mod windows_edge_dock {
    use std::{
        thread,
        time::{Duration, Instant},
    };

    use tauri::WebviewWindow;
    use windows::Win32::{
        Foundation::{HWND, POINT, RECT},
        Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        },
        UI::WindowsAndMessaging::{
            GetCursorPos, GetWindowRect, IsIconic, IsWindowVisible, SetWindowPos, SWP_NOACTIVATE,
            SWP_NOSIZE, SWP_NOZORDER,
        },
    };

    const POLL_INTERVAL: Duration = Duration::from_millis(40);
    const MOVE_SETTLE_DELAY: Duration = Duration::from_millis(280);
    const COLLAPSE_DELAY: Duration = Duration::from_millis(650);
    const SNAP_THRESHOLD: i32 = 18;
    const VISIBLE_STRIP: i32 = 4;

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum DockEdge {
        Left,
        Right,
        Top,
        Bottom,
    }

    struct DockState {
        edge: Option<DockEdge>,
        collapsed: bool,
        last_rect: RECT,
        last_move: Instant,
        cursor_left_at: Option<Instant>,
    }

    fn window_rect(hwnd: HWND) -> Option<RECT> {
        let mut rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
        Some(rect)
    }

    fn cursor_position() -> Option<POINT> {
        let mut point = POINT::default();
        unsafe { GetCursorPos(&mut point) }.ok()?;
        Some(point)
    }

    fn monitor_work_area(hwnd: HWND) -> Option<RECT> {
        let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        unsafe { GetMonitorInfoW(monitor, &mut info) }
            .as_bool()
            .then_some(info.rcWork)
    }

    fn contains(rect: RECT, point: POINT) -> bool {
        point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom
    }

    fn same_rect(left: RECT, right: RECT) -> bool {
        left.left == right.left
            && left.top == right.top
            && left.right == right.right
            && left.bottom == right.bottom
    }

    fn nearest_edge(rect: RECT, work: RECT) -> Option<DockEdge> {
        let distances = [
            (DockEdge::Left, (rect.left - work.left).abs()),
            (DockEdge::Right, (work.right - rect.right).abs()),
            (DockEdge::Top, (rect.top - work.top).abs()),
            (DockEdge::Bottom, (work.bottom - rect.bottom).abs()),
        ];
        distances
            .into_iter()
            .min_by_key(|(_, distance)| *distance)
            .filter(|(_, distance)| *distance <= SNAP_THRESHOLD)
            .map(|(edge, _)| edge)
    }

    fn edge_position(edge: DockEdge, rect: RECT, work: RECT, collapsed: bool) -> (i32, i32) {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        match (edge, collapsed) {
            (DockEdge::Left, false) => (work.left, rect.top),
            (DockEdge::Right, false) => (work.right - width, rect.top),
            (DockEdge::Top, false) => (rect.left, work.top),
            (DockEdge::Bottom, false) => (rect.left, work.bottom - height),
            (DockEdge::Left, true) => (work.left - width + VISIBLE_STRIP, rect.top),
            (DockEdge::Right, true) => (work.right - VISIBLE_STRIP, rect.top),
            (DockEdge::Top, true) => (rect.left, work.top - height + VISIBLE_STRIP),
            (DockEdge::Bottom, true) => (rect.left, work.bottom - VISIBLE_STRIP),
        }
    }

    fn move_window(hwnd: HWND, x: i32, y: i32) {
        let _ = unsafe {
            SetWindowPos(
                hwnd,
                None,
                x,
                y,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            )
        };
    }

    pub fn start(window: WebviewWindow) {
        let Ok(raw_hwnd) = window.hwnd().map(|handle| handle.0 as isize) else {
            return;
        };

        thread::spawn(move || {
            let hwnd = HWND(raw_hwnd as *mut _);
            let Some(initial_rect) = window_rect(hwnd) else {
                return;
            };
            let mut state = DockState {
                edge: None,
                collapsed: false,
                last_rect: initial_rect,
                last_move: Instant::now(),
                cursor_left_at: None,
            };

            loop {
                thread::sleep(POLL_INTERVAL);
                if !super::enabled() {
                    if state.collapsed {
                        if let (Some(edge), Some(rect), Some(work)) =
                            (state.edge, window_rect(hwnd), monitor_work_area(hwnd))
                        {
                            let (x, y) = edge_position(edge, rect, work, false);
                            move_window(hwnd, x, y);
                        }
                    }
                    state.edge = None;
                    state.collapsed = false;
                    state.cursor_left_at = None;
                    continue;
                }
                if !unsafe { IsWindowVisible(hwnd) }.as_bool()
                    || unsafe { IsIconic(hwnd) }.as_bool()
                {
                    state.cursor_left_at = None;
                    continue;
                }

                let (Some(rect), Some(work), Some(cursor)) = (
                    window_rect(hwnd),
                    monitor_work_area(hwnd),
                    cursor_position(),
                ) else {
                    continue;
                };

                if !same_rect(rect, state.last_rect) {
                    state.last_rect = rect;
                    state.last_move = Instant::now();
                    state.cursor_left_at = None;

                    if state.edge.is_some() && !state.collapsed {
                        let aligned = nearest_edge(rect, work) == state.edge;
                        if !aligned {
                            state.edge = None;
                        }
                    }
                }

                if state.edge.is_none() && state.last_move.elapsed() >= MOVE_SETTLE_DELAY {
                    if let Some(edge) = nearest_edge(rect, work) {
                        let (x, y) = edge_position(edge, rect, work, false);
                        move_window(hwnd, x, y);
                        state.edge = Some(edge);
                        state.collapsed = false;
                        state.last_rect = window_rect(hwnd).unwrap_or(rect);
                    }
                    continue;
                }

                let Some(edge) = state.edge else {
                    continue;
                };

                if state.collapsed {
                    if contains(rect, cursor) {
                        let (x, y) = edge_position(edge, rect, work, false);
                        move_window(hwnd, x, y);
                        state.collapsed = false;
                        state.cursor_left_at = None;
                        state.last_rect = window_rect(hwnd).unwrap_or(rect);
                    }
                } else if contains(rect, cursor) {
                    state.cursor_left_at = None;
                } else {
                    let left_at = state.cursor_left_at.get_or_insert_with(Instant::now);
                    if left_at.elapsed() >= COLLAPSE_DELAY {
                        let (x, y) = edge_position(edge, rect, work, true);
                        move_window(hwnd, x, y);
                        state.collapsed = true;
                        state.cursor_left_at = None;
                        state.last_rect = window_rect(hwnd).unwrap_or(rect);
                    }
                }
            }
        });
    }
}

#[cfg(windows)]
pub use windows_edge_dock::start;

#[cfg(target_os = "macos")]
mod macos_edge_dock {
    use std::{
        ffi::{c_char, c_void},
        thread,
        time::{Duration, Instant},
    };

    use tauri::WebviewWindow;

    const POLL_INTERVAL: Duration = Duration::from_millis(40);
    const MOVE_SETTLE_DELAY: Duration = Duration::from_millis(280);
    const COLLAPSE_DELAY: Duration = Duration::from_millis(650);
    const SNAP_THRESHOLD: f64 = 18.0;
    const VISIBLE_STRIP: f64 = 4.0;

    type Id = *mut c_void;
    type Sel = *mut c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Point {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Size {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Rect {
        origin: Point,
        size: Size,
    }

    #[link(name = "AppKit", kind = "framework")]
    extern "C" {}

    #[link(name = "objc")]
    extern "C" {
        fn sel_registerName(name: *const c_char) -> Sel;
        fn objc_getClass(name: *const c_char) -> Id;
        fn objc_msgSend();
        #[cfg(target_arch = "x86_64")]
        fn objc_msgSend_stret();
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum DockEdge {
        Left,
        Right,
        Top,
        Bottom,
    }

    unsafe fn selector(name: &'static [u8]) -> Sel {
        sel_registerName(name.as_ptr().cast())
    }

    unsafe fn send_bool(target: Id, name: &'static [u8]) -> bool {
        let call: unsafe extern "C" fn(Id, Sel) -> bool =
            std::mem::transmute(objc_msgSend as *const ());
        call(target, selector(name))
    }

    unsafe fn send_id(target: Id, name: &'static [u8]) -> Id {
        let call: unsafe extern "C" fn(Id, Sel) -> Id =
            std::mem::transmute(objc_msgSend as *const ());
        call(target, selector(name))
    }

    unsafe fn send_rect(target: Id, name: &'static [u8]) -> Rect {
        #[cfg(target_arch = "x86_64")]
        {
            let mut result = Rect::default();
            let call: unsafe extern "C" fn(*mut Rect, Id, Sel) =
                std::mem::transmute(objc_msgSend_stret as *const ());
            call(&mut result, target, selector(name));
            return result;
        }

        #[cfg(not(target_arch = "x86_64"))]
        {
            let call: unsafe extern "C" fn(Id, Sel) -> Rect =
                std::mem::transmute(objc_msgSend as *const ());
            call(target, selector(name))
        }
    }

    unsafe fn send_point(target: Id, name: &'static [u8]) -> Point {
        let call: unsafe extern "C" fn(Id, Sel) -> Point =
            std::mem::transmute(objc_msgSend as *const ());
        call(target, selector(name))
    }

    unsafe fn set_frame_origin(window: Id, point: Point) {
        let call: unsafe extern "C" fn(Id, Sel, Point) =
            std::mem::transmute(objc_msgSend as *const ());
        call(window, selector(b"setFrameOrigin:\0"), point);
    }

    fn contains(rect: Rect, point: Point) -> bool {
        point.x >= rect.origin.x
            && point.x < rect.origin.x + rect.size.width
            && point.y >= rect.origin.y
            && point.y < rect.origin.y + rect.size.height
    }

    fn same_rect(left: Rect, right: Rect) -> bool {
        (left.origin.x - right.origin.x).abs() < 0.5
            && (left.origin.y - right.origin.y).abs() < 0.5
            && (left.size.width - right.size.width).abs() < 0.5
            && (left.size.height - right.size.height).abs() < 0.5
    }

    fn nearest_edge(rect: Rect, work: Rect) -> Option<DockEdge> {
        let distances = [
            (DockEdge::Left, (rect.origin.x - work.origin.x).abs()),
            (
                DockEdge::Right,
                (work.origin.x + work.size.width - rect.origin.x - rect.size.width).abs(),
            ),
            (
                DockEdge::Top,
                (work.origin.y + work.size.height - rect.origin.y - rect.size.height).abs(),
            ),
            (DockEdge::Bottom, (rect.origin.y - work.origin.y).abs()),
        ];
        distances
            .into_iter()
            .min_by(|left, right| left.1.total_cmp(&right.1))
            .filter(|(_, distance)| *distance <= SNAP_THRESHOLD)
            .map(|(edge, _)| edge)
    }

    fn edge_position(edge: DockEdge, rect: Rect, work: Rect, collapsed: bool) -> Point {
        match (edge, collapsed) {
            (DockEdge::Left, false) => Point {
                x: work.origin.x,
                y: rect.origin.y,
            },
            (DockEdge::Right, false) => Point {
                x: work.origin.x + work.size.width - rect.size.width,
                y: rect.origin.y,
            },
            (DockEdge::Top, false) => Point {
                x: rect.origin.x,
                y: work.origin.y + work.size.height - rect.size.height,
            },
            (DockEdge::Bottom, false) => Point {
                x: rect.origin.x,
                y: work.origin.y,
            },
            (DockEdge::Left, true) => Point {
                x: work.origin.x - rect.size.width + VISIBLE_STRIP,
                y: rect.origin.y,
            },
            (DockEdge::Right, true) => Point {
                x: work.origin.x + work.size.width - VISIBLE_STRIP,
                y: rect.origin.y,
            },
            (DockEdge::Top, true) => Point {
                x: rect.origin.x,
                y: work.origin.y + work.size.height - VISIBLE_STRIP,
            },
            (DockEdge::Bottom, true) => Point {
                x: rect.origin.x,
                y: work.origin.y - rect.size.height + VISIBLE_STRIP,
            },
        }
    }

    pub fn start(window: WebviewWindow) {
        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        let raw_window = ns_window as usize;

        thread::spawn(move || unsafe {
            let ns_window = raw_window as Id;
            let mut last_rect = send_rect(ns_window, b"frame\0");
            let mut edge = None;
            let mut collapsed = false;
            let mut last_move = Instant::now();
            let mut cursor_left_at: Option<Instant> = None;

            loop {
                thread::sleep(POLL_INTERVAL);
                if !super::enabled() {
                    if collapsed {
                        if let Some(current_edge) = edge {
                            let rect = send_rect(ns_window, b"frame\0");
                            let screen = send_id(ns_window, b"screen\0");
                            if !screen.is_null() {
                                let work = send_rect(screen, b"visibleFrame\0");
                                set_frame_origin(
                                    ns_window,
                                    edge_position(current_edge, rect, work, false),
                                );
                            }
                        }
                    }
                    edge = None;
                    collapsed = false;
                    cursor_left_at = None;
                    continue;
                }
                if !send_bool(ns_window, b"isVisible\0")
                    || send_bool(ns_window, b"isMiniaturized\0")
                {
                    cursor_left_at = None;
                    continue;
                }

                let rect = send_rect(ns_window, b"frame\0");
                let screen = send_id(ns_window, b"screen\0");
                if screen.is_null() {
                    continue;
                }
                let work = send_rect(screen, b"visibleFrame\0");
                let event_class = objc_getClass(b"NSEvent\0".as_ptr().cast());
                let cursor = send_point(event_class, b"mouseLocation\0");

                if !same_rect(rect, last_rect) {
                    last_rect = rect;
                    last_move = Instant::now();
                    cursor_left_at = None;
                    if edge.is_some() && !collapsed && nearest_edge(rect, work) != edge {
                        edge = None;
                    }
                }

                if edge.is_none() && last_move.elapsed() >= MOVE_SETTLE_DELAY {
                    if let Some(candidate) = nearest_edge(rect, work) {
                        set_frame_origin(ns_window, edge_position(candidate, rect, work, false));
                        edge = Some(candidate);
                        collapsed = false;
                        last_rect = send_rect(ns_window, b"frame\0");
                    }
                    continue;
                }

                let Some(current_edge) = edge else { continue };
                if collapsed {
                    if contains(rect, cursor) {
                        set_frame_origin(ns_window, edge_position(current_edge, rect, work, false));
                        collapsed = false;
                        cursor_left_at = None;
                        last_rect = send_rect(ns_window, b"frame\0");
                    }
                } else if contains(rect, cursor) {
                    cursor_left_at = None;
                } else {
                    let left_at = cursor_left_at.get_or_insert_with(Instant::now);
                    if left_at.elapsed() >= COLLAPSE_DELAY {
                        set_frame_origin(ns_window, edge_position(current_edge, rect, work, true));
                        collapsed = true;
                        cursor_left_at = None;
                        last_rect = send_rect(ns_window, b"frame\0");
                    }
                }
            }
        });
    }
}

#[cfg(target_os = "macos")]
pub use macos_edge_dock::start;

#[cfg(target_os = "linux")]
mod linux_edge_dock {
    use std::{
        env,
        ffi::{c_char, c_int, c_uint, c_ulong, c_void},
        thread,
        time::{Duration, Instant},
    };

    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use tauri::WebviewWindow;

    const POLL_INTERVAL: Duration = Duration::from_millis(40);
    const MOVE_SETTLE_DELAY: Duration = Duration::from_millis(280);
    const COLLAPSE_DELAY: Duration = Duration::from_millis(650);
    const SNAP_THRESHOLD: i32 = 18;
    const VISIBLE_STRIP: i32 = 4;

    type Display = c_void;
    type Window = c_ulong;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct WindowAttributes {
        x: c_int,
        y: c_int,
        width: c_int,
        height: c_int,
        border_width: c_int,
        depth: c_int,
        visual: *mut c_void,
        root: Window,
        class: c_int,
        bit_gravity: c_int,
        win_gravity: c_int,
        backing_store: c_int,
        backing_planes: c_ulong,
        backing_pixel: c_ulong,
        save_under: c_int,
        colormap: c_ulong,
        map_installed: c_int,
        map_state: c_int,
        all_event_masks: c_long,
        your_event_mask: c_long,
        do_not_propagate_mask: c_long,
        override_redirect: c_int,
        screen: *mut c_void,
    }

    use std::ffi::c_long;

    #[link(name = "X11")]
    extern "C" {
        fn XOpenDisplay(name: *const c_char) -> *mut Display;
        fn XCloseDisplay(display: *mut Display) -> c_int;
        fn XDefaultRootWindow(display: *mut Display) -> Window;
        fn XGetWindowAttributes(
            display: *mut Display,
            window: Window,
            attributes: *mut WindowAttributes,
        ) -> c_int;
        fn XTranslateCoordinates(
            display: *mut Display,
            source: Window,
            destination: Window,
            source_x: c_int,
            source_y: c_int,
            destination_x: *mut c_int,
            destination_y: *mut c_int,
            child: *mut Window,
        ) -> c_int;
        fn XQueryPointer(
            display: *mut Display,
            window: Window,
            root_return: *mut Window,
            child_return: *mut Window,
            root_x: *mut c_int,
            root_y: *mut c_int,
            win_x: *mut c_int,
            win_y: *mut c_int,
            mask_return: *mut c_uint,
        ) -> c_int;
        fn XMoveWindow(display: *mut Display, window: Window, x: c_int, y: c_int) -> c_int;
        fn XFlush(display: *mut Display) -> c_int;
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum DockEdge {
        Left,
        Right,
        Top,
        Bottom,
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    unsafe fn window_rect(display: *mut Display, window: Window, root: Window) -> Option<Rect> {
        let mut attrs = WindowAttributes::default();
        if XGetWindowAttributes(display, window, &mut attrs) == 0 || attrs.map_state == 0 {
            return None;
        }
        let (mut x, mut y, mut child) = (0, 0, 0);
        if XTranslateCoordinates(display, window, root, 0, 0, &mut x, &mut y, &mut child) == 0 {
            return None;
        }
        Some(Rect {
            left: x,
            top: y,
            right: x + attrs.width,
            bottom: y + attrs.height,
        })
    }

    unsafe fn pointer(display: *mut Display, root: Window) -> Option<(i32, i32)> {
        let (mut root_return, mut child, mut root_x, mut root_y, mut win_x, mut win_y, mut mask) =
            (0, 0, 0, 0, 0, 0, 0);
        (XQueryPointer(
            display,
            root,
            &mut root_return,
            &mut child,
            &mut root_x,
            &mut root_y,
            &mut win_x,
            &mut win_y,
            &mut mask,
        ) != 0)
            .then_some((root_x, root_y))
    }

    fn nearest_edge(rect: Rect, work: Rect) -> Option<DockEdge> {
        [
            (DockEdge::Left, (rect.left - work.left).abs()),
            (DockEdge::Right, (work.right - rect.right).abs()),
            (DockEdge::Top, (rect.top - work.top).abs()),
            (DockEdge::Bottom, (work.bottom - rect.bottom).abs()),
        ]
        .into_iter()
        .min_by_key(|(_, distance)| *distance)
        .filter(|(_, distance)| *distance <= SNAP_THRESHOLD)
        .map(|(edge, _)| edge)
    }

    fn edge_position(edge: DockEdge, rect: Rect, work: Rect, collapsed: bool) -> (i32, i32) {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        match (edge, collapsed) {
            (DockEdge::Left, false) => (work.left, rect.top),
            (DockEdge::Right, false) => (work.right - width, rect.top),
            (DockEdge::Top, false) => (rect.left, work.top),
            (DockEdge::Bottom, false) => (rect.left, work.bottom - height),
            (DockEdge::Left, true) => (work.left - width + VISIBLE_STRIP, rect.top),
            (DockEdge::Right, true) => (work.right - VISIBLE_STRIP, rect.top),
            (DockEdge::Top, true) => (rect.left, work.top - height + VISIBLE_STRIP),
            (DockEdge::Bottom, true) => (rect.left, work.bottom - VISIBLE_STRIP),
        }
    }

    pub(super) fn is_wayland_session() -> bool {
        env::var_os("WAYLAND_DISPLAY").is_some()
            || env::var("XDG_SESSION_TYPE")
                .map(|value| value.eq_ignore_ascii_case("wayland"))
                .unwrap_or(false)
    }

    pub fn start(window: WebviewWindow) {
        if is_wayland_session() {
            return;
        }
        let Ok(handle) = window.window_handle() else {
            return;
        };
        let RawWindowHandle::Xlib(handle) = handle.as_raw() else {
            return;
        };
        let xid = handle.window;

        thread::spawn(move || unsafe {
            let display = XOpenDisplay(std::ptr::null());
            if display.is_null() {
                return;
            }
            let root = XDefaultRootWindow(display);
            let Some(mut last_rect) = window_rect(display, xid, root) else {
                XCloseDisplay(display);
                return;
            };
            let mut edge = None;
            let mut collapsed = false;
            let mut last_move = Instant::now();
            let mut cursor_left_at: Option<Instant> = None;

            loop {
                thread::sleep(POLL_INTERVAL);
                if !super::enabled() {
                    if collapsed {
                        if let Some(current_edge) = edge {
                            if let Some(rect) = window_rect(display, xid, root) {
                                let mut root_attrs = WindowAttributes::default();
                                if XGetWindowAttributes(display, root, &mut root_attrs) != 0 {
                                    let work = Rect {
                                        left: 0,
                                        top: 0,
                                        right: root_attrs.width,
                                        bottom: root_attrs.height,
                                    };
                                    let (x, y) = edge_position(current_edge, rect, work, false);
                                    XMoveWindow(display, xid, x, y);
                                    XFlush(display);
                                }
                            }
                        }
                    }
                    edge = None;
                    collapsed = false;
                    cursor_left_at = None;
                    continue;
                }
                let (Some(rect), Some(cursor)) =
                    (window_rect(display, xid, root), pointer(display, root))
                else {
                    cursor_left_at = None;
                    continue;
                };
                let mut root_attrs = WindowAttributes::default();
                if XGetWindowAttributes(display, root, &mut root_attrs) == 0 {
                    continue;
                }
                let work = Rect {
                    left: 0,
                    top: 0,
                    right: root_attrs.width,
                    bottom: root_attrs.height,
                };

                if rect != last_rect {
                    last_rect = rect;
                    last_move = Instant::now();
                    cursor_left_at = None;
                    if edge.is_some() && !collapsed && nearest_edge(rect, work) != edge {
                        edge = None;
                    }
                }

                if edge.is_none() && last_move.elapsed() >= MOVE_SETTLE_DELAY {
                    if let Some(candidate) = nearest_edge(rect, work) {
                        let (x, y) = edge_position(candidate, rect, work, false);
                        XMoveWindow(display, xid, x, y);
                        XFlush(display);
                        edge = Some(candidate);
                        collapsed = false;
                    }
                    continue;
                }

                let Some(current_edge) = edge else { continue };
                let cursor_inside = cursor.0 >= rect.left
                    && cursor.0 < rect.right
                    && cursor.1 >= rect.top
                    && cursor.1 < rect.bottom;
                if collapsed {
                    if cursor_inside {
                        let (x, y) = edge_position(current_edge, rect, work, false);
                        XMoveWindow(display, xid, x, y);
                        XFlush(display);
                        collapsed = false;
                        cursor_left_at = None;
                    }
                } else if cursor_inside {
                    cursor_left_at = None;
                } else {
                    let left_at = cursor_left_at.get_or_insert_with(Instant::now);
                    if left_at.elapsed() >= COLLAPSE_DELAY {
                        let (x, y) = edge_position(current_edge, rect, work, true);
                        XMoveWindow(display, xid, x, y);
                        XFlush(display);
                        collapsed = true;
                        cursor_left_at = None;
                    }
                }
            }
        });
    }
}

#[cfg(target_os = "linux")]
pub use linux_edge_dock::start;

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
pub fn start(_window: tauri::WebviewWindow) {}
