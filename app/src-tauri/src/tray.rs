use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone)]
pub struct TrayTimer {
    pub active: bool,
    pub running: bool,
}

pub fn setup(app: &AppHandle) {
    app.manage(Mutex::new(TrayTimer { active: false, running: false }));
    let icon = match tauri::image::Image::from_bytes(include_bytes!("../icons/tray-32.png")) {
        Ok(icon) => icon,
        Err(err) => {
            log::error!("tray icon missing: {err}");
            return;
        }
    };
    let menu = match build_menu(app, &TrayTimer { active: false, running: false }) {
        Ok(menu) => menu,
        Err(err) => {
            log::error!("tray menu failed: {err}");
            return;
        }
    };
    let built = TrayIconBuilder::with_id("layp")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quick-add" => quick_add(app),
            "toggle-timer" => {
                let _ = app.emit("toggle-timer", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app);
    if let Err(err) = built {
        log::error!("tray setup failed: {err}");
    }
}

pub fn set_timer(app: &AppHandle, timer: TrayTimer) -> Result<(), String> {
    if let Some(state) = app.try_state::<Mutex<TrayTimer>>() {
        *state.lock().map_err(|_| "tray timer failed".to_string())? = timer.clone();
    }
    let menu = build_menu(app, &timer).map_err(|err| err.to_string())?;
    if let Some(icon) = app.tray_by_id("layp") {
        icon.set_menu(Some(menu)).map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn quick_add(app: &AppHandle) {
    show_main(app);
    let _ = app.emit("quick-add", ());
}

fn build_menu(app: &AppHandle, timer: &TrayTimer) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", "Show Layp", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick-add", "Quick add", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    if timer.active {
        let label = if timer.running { "Pause timer" } else { "Resume timer" };
        let toggle = MenuItem::with_id(app, "toggle-timer", label, true, None::<&str>)?;
        Menu::with_items(app, &[&show, &quick, &toggle, &quit])
    } else {
        Menu::with_items(app, &[&show, &quick, &quit])
    }
}
