mod cleaner;

use std::os::windows::process::CommandExt;
use tauri::Emitter;

#[tauri::command]
fn scan() -> cleaner::Scan {
    cleaner::scan()
}

#[tauri::command]
async fn apply(app: tauri::AppHandle, plan: cleaner::Plan) -> Result<cleaner::Report, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
        .invoke_handler(tauri::generate_handler![scan, apply, launch])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
