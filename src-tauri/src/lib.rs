mod cleaner;
mod updates;

use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

// ponytail: process-local lock; use a named Windows mutex if multiple cleaner instances must coordinate.
static BUSY: AtomicBool = AtomicBool::new(false);
struct Operation;
impl Operation {
    fn start() -> Result<Self, String> {
        BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| Self).map_err(|_| "An operation is already running.".into())
    }
}
impl Drop for Operation {
    fn drop(&mut self) { BUSY.store(false, Ordering::SeqCst); }
}

#[tauri::command]
async fn scan() -> Result<cleaner::Scan, String> {
    tauri::async_runtime::spawn_blocking(cleaner::scan).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_discord_update() -> Result<updates::Release, String> {
    tauri::async_runtime::spawn_blocking(updates::check).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn install_discord(app: tauri::AppHandle, expected_version: String, plan: cleaner::Plan) -> Result<cleaner::Report, String> {
    let operation = Operation::start()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        updates::install(&expected_version, &plan, |p| { let _ = app.emit("progress", p); })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn apply(app: tauri::AppHandle, plan: cleaner::Plan) -> Result<cleaner::Report, String> {
    let operation = Operation::start()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        cleaner::apply(&plan, |p| {
            let _ = app.emit("progress", p);
        })
    })
    .await
    .map_err(|e| e.to_string())
}

/// Launches Discord un-elevated: going through explorer.exe drops our admin token.
#[tauri::command]
fn launch(exe: String) -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(exe)
        .creation_flags(0x0800_0000)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|_, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if BUSY.load(Ordering::SeqCst) { api.prevent_close(); }
            }
        })
        .invoke_handler(tauri::generate_handler![scan, apply, launch, check_discord_update, install_discord])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overlapping_operations_are_rejected_and_lock_is_released() {
        let first = Operation::start().unwrap();
        assert!(Operation::start().is_err());
        drop(first);
        assert!(Operation::start().is_ok());
        assert!(!BUSY.load(Ordering::SeqCst));
    }
}
