//! Everything that touches the system: scanning a Discord install and applying a cleanup plan.
//! Windows only. Shells out to `sc.exe` / `taskkill` / `tasklist` (hidden windows) where the
//! stdlib has no equivalent; registry via `winreg`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use winreg::enums::*;
use winreg::RegKey;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const HELPER: &str = "DiscordSystemHelper";
const RUN_KEYS: [(&str, &str, &str); 4] = [
    ("HKLM", r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run", "Discord"),
    ("HKLM", r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", "Discord"),
    ("HKCU", r"Software\Microsoft\Windows\CurrentVersion\Run", "Discord"),
    ("HKCU", r"Software\Microsoft\Windows\CurrentVersion\Run", "DiscordRun"),
];

#[derive(Serialize, Clone, Default)]
pub struct Item {
    pub id: String,
    pub bytes: u64,
    pub paths: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct RunEntry {
    pub hive: String,
    pub name: String,
    pub value: String,
}

#[derive(Serialize)]
pub struct Scan {
    pub root: Option<String>,
    pub running: bool,
    pub versions: Vec<String>,
    pub latest_exe: Option<String>,
    /// absent | running | stopped | disabled
    pub service: String,
    pub helper_exes: Vec<String>,
    pub run_entries: Vec<RunEntry>,
    pub updater: Item,
    pub modules: Vec<Item>,
    pub locales: Vec<Item>,
    pub extras: Vec<Item>,
}

#[derive(Deserialize)]
pub struct Plan {
    pub helper: bool,
    pub run_entries: bool,
    pub updater: bool,
    pub modules: Vec<String>,
    pub locales: Vec<String>,
    /// When set, trim newly installed locales too. en-US is always protected.
    #[serde(default)]
    pub keep_locales: Option<Vec<String>>,
    pub extras: Vec<String>,
    pub autostart: bool,
    pub shortcut: bool,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Progress {
    pub step: String,
    /// ok | warn | skip
    pub status: String,
    pub detail: String,
}

#[derive(Serialize)]
pub struct Report {
    pub freed: u64,
    pub warnings: Vec<String>,
}

// ---------------------------------------------------------------- helpers

fn run(cmd: &str, args: &[&str]) -> (bool, String) {
    match Command::new(cmd).args(args).creation_flags(CREATE_NO_WINDOW).output() {
        Ok(o) => (o.status.success(), String::from_utf8_lossy(&o.stdout).into_owned()),
        Err(e) => (false, e.to_string()),
    }
}

fn root() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(|p| PathBuf::from(p).join("Discord"))
        .filter(|p| p.is_dir())
}

fn size(p: &Path) -> u64 {
    if p.is_dir() {
        fs::read_dir(p)
            .map(|rd| rd.flatten().map(|e| size(&e.path())).sum())
            .unwrap_or(0)
    } else {
        p.metadata().map(|m| m.len()).unwrap_or(0)
    }
}

fn find(dir: &Path, name: &str, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            find(&p, name, out);
        } else if p.file_name().is_some_and(|n| n.eq_ignore_ascii_case(name)) {
            out.push(p);
        }
    }
}

/// Deletes a file or directory, clearing the read-only attribute on failure and retrying once.
fn remove(p: &Path) -> std::io::Result<()> {
    let del = || if p.is_dir() { fs::remove_dir_all(p) } else { fs::remove_file(p) };
    if !p.exists() {
        return Ok(());
    }
    del().or_else(|_| {
        if let Ok(meta) = p.metadata() {
            let mut perm = meta.permissions();
            perm.set_readonly(false);
            let _ = fs::set_permissions(p, perm);
        }
        del()
    })
}

fn version_key(name: &str) -> Vec<u64> {
    name.trim_start_matches("app-")
        .split('.')
        .map(|s| s.parse().unwrap_or(0))
        .collect()
}

/// `app-*` directories, newest version first.
fn app_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(root)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir() && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("app-")))
                .collect()
        })
        .unwrap_or_default();
    dirs.sort_by_key(|p| std::cmp::Reverse(version_key(&p.file_name().unwrap().to_string_lossy())));
    dirs
}

fn name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// `discord_krisp-1` -> `discord_krisp`
fn module_id(dir: &str) -> String {
    match dir.rsplit_once('-') {
        Some((id, n)) if !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()) => id.to_string(),
        _ => dir.to_string(),
    }
}

fn push(map: &mut BTreeMap<String, Item>, id: &str, p: &Path) {
    let it = map.entry(id.to_string()).or_insert_with(|| Item { id: id.to_string(), ..Default::default() });
    it.bytes += size(p);
    it.paths.push(p.to_string_lossy().into_owned());
}

fn helper_dirs() -> Vec<PathBuf> {
    ["CommonProgramFiles", "CommonProgramFiles(x86)"]
        .iter()
        .filter_map(|v| std::env::var_os(v))
        .map(|p| PathBuf::from(p).join("Discord"))
        .collect()
}

fn helper_exes() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for d in helper_dirs() {
        find(&d, &format!("{HELPER}.exe"), &mut out);
    }
    out
}

fn hive(h: &str) -> RegKey {
    RegKey::predef(if h == "HKLM" { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER })
}

fn service_state() -> String {
    let (exists, q) = run("sc.exe", &["query", HELPER]);
    if !exists {
        return "absent".into();
    }
    if q.contains("RUNNING") {
        return "running".into();
    }
    let (_, qc) = run("sc.exe", &["qc", HELPER]);
    if qc.contains("DISABLED") { "disabled" } else { "stopped" }.into()
}

// ---------------------------------------------------------------- scan

pub fn scan() -> Scan {
    let root = root();
    let running = run("tasklist", &["/FI", "IMAGENAME eq Discord.exe", "/NH"]).1.contains("Discord.exe");

    let run_entries = RUN_KEYS
        .iter()
        .filter_map(|(h, key, val)| {
            let v: String = hive(h).open_subkey_with_flags(key, KEY_READ).ok()?.get_value(val).ok()?;
            Some(RunEntry { hive: h.to_string(), name: val.to_string(), value: v })
        })
        .collect();

    let mut scan = Scan {
        root: root.as_ref().map(|p| p.to_string_lossy().into_owned()),
        running,
        versions: vec![],
        latest_exe: None,
        service: service_state(),
        helper_exes: helper_exes().iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        run_entries,
        updater: Item { id: "updater".into(), ..Default::default() },
        modules: vec![],
        locales: vec![],
        extras: vec![],
    };
    let Some(root) = root else { return scan };

    let mut updater = BTreeMap::new();
    for e in fs::read_dir(&root).into_iter().flatten().flatten() {
        let p = e.path();
        let n = name(&p);
        if n.starts_with("Update") || n.starts_with("SquirrelSetup") || n == "download" || n == "packages" {
            push(&mut updater, "updater", &p);
        }
    }
    scan.updater = updater.remove("updater").unwrap_or(scan.updater);

    let (mut modules, mut locales, mut extras) = (BTreeMap::new(), BTreeMap::new(), BTreeMap::new());
    for app in app_dirs(&root) {
        scan.versions.push(name(&app));
        if scan.latest_exe.is_none() && app.join("Discord.exe").is_file() {
            scan.latest_exe = Some(app.join("Discord.exe").to_string_lossy().into_owned());
        }
        for e in fs::read_dir(app.join("modules")).into_iter().flatten().flatten() {
            if e.path().is_dir() {
                push(&mut modules, &module_id(&name(&e.path())), &e.path());
            }
        }
        for e in fs::read_dir(app.join("locales")).into_iter().flatten().flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "pak") {
                push(&mut locales, &p.file_stem().unwrap().to_string_lossy(), &p);
            }
        }
        for e in fs::read_dir(&app).into_iter().flatten().flatten() {
            let p = e.path();
            let n = name(&p);
            let id = if n.starts_with("chrome_") && p.is_file() {
                "chrome_pak"
            } else if n == "app.ico" {
                "app_ico"
            } else if n == "debug.log" {
                "debug_log"
            } else if n == "swiftshader" && p.is_dir() {
                "swiftshader"
            } else {
                continue;
            };
            push(&mut extras, id, &p);
        }
    }
    scan.modules = modules.into_values().collect();
    scan.locales = locales.into_values().collect();
    scan.extras = extras.into_values().collect();
    scan
}

// ---------------------------------------------------------------- apply

pub fn apply(plan: &Plan, emit: impl Fn(Progress)) -> Report {
    let mut rep = Report { freed: 0, warnings: vec![] };
    let mut done = |step: &str, status: &str, detail: String| {
        if status == "warn" {
            rep.warnings.push(format!("{step}: {detail}"));
        }
        emit(Progress { step: step.into(), status: status.into(), detail });
    };
    let delete_all = |paths: &[String], freed: &mut u64| -> Vec<String> {
        let mut failed = vec![];
        for p in paths {
            let p = Path::new(p);
            let b = size(p);
            match remove(p) {
                Ok(()) => *freed += b,
                Err(e) => failed.push(format!("{} ({e})", p.display())),
            }
        }
        failed
    };

    // 1. Close Discord (always: files are locked otherwise).
    for exe in ["Discord.exe", &format!("{HELPER}.exe")] {
        run("taskkill", &["/T", "/F", "/IM", exe]);
    }
    done("kill", "ok", String::new());

    // 2. Background helper service + executable.
    if plan.helper {
        let mut msg = vec![];
        if service_state() != "absent" {
            run("sc.exe", &["stop", HELPER]);
            std::thread::sleep(std::time::Duration::from_secs(2));
            if !run("sc.exe", &["config", HELPER, "start=", "disabled"]).0 {
                msg.push("service".to_string());
            }
        }
        let exes: Vec<String> = helper_exes().iter().map(|p| p.to_string_lossy().into_owned()).collect();
        msg.extend(delete_all(&exes, &mut rep.freed));
        done("helper", if msg.is_empty() { "ok" } else { "warn" }, msg.join(", "));
    }

    // 3. Startup entries.
    if plan.run_entries {
        for (h, key, val) in RUN_KEYS {
            if let Ok(k) = hive(h).open_subkey_with_flags(key, KEY_SET_VALUE) {
                let _ = k.delete_value(val);
            }
        }
        done("run", "ok", String::new());
    }

    // 4. Updater (Squirrel).
    if plan.updater {
        let mut paths = vec![];
        if let Some(root) = root() {
            for e in fs::read_dir(&root).into_iter().flatten().flatten() {
                let n = name(&e.path());
                if n.starts_with("Update") || n.starts_with("SquirrelSetup") || n == "download" || n == "packages" {
                    paths.push(e.path().to_string_lossy().into_owned());
                }
            }
        }
        let failed = delete_all(&paths, &mut rep.freed);
        done("updater", if failed.is_empty() { "ok" } else { "warn" }, failed.join(", "));
    }

    // 5-7. Modules, locales, extras: resolved from a fresh scan so stale paths are never trusted.
    let current = scan();
    let groups: [(&str, &[Item], &[String]); 3] = [
        ("module", &current.modules, &plan.modules),
        ("locale", &current.locales, &plan.locales),
        ("extra", &current.extras, &plan.extras),
    ];
    for (kind, items, wanted) in groups {
        for it in items.iter().filter(|it| {
            if kind == "locale" {
                if let Some(keep) = &plan.keep_locales { return !keep.contains(&it.id); }
            }
            wanted.contains(&it.id)
        }) {
            if kind == "module" && ["discord_desktop_core", "discord_utils", "discord_voice"].contains(&it.id.as_str()) {
                continue;
            }
            if kind == "locale" && it.id == "en-US" {
                continue; // Electron's fallback locale; never removable.
            }
            let failed = delete_all(&it.paths, &mut rep.freed);
            done(&format!("{kind}:{}", it.id), if failed.is_empty() { "ok" } else { "warn" }, failed.join(", "));
        }
    }

    // 8. Start-menu shortcut pointing straight at Discord.exe (Update.exe may be gone).
    let exe = current.latest_exe.clone();
    if plan.shortcut {
        match &exe {
            Some(exe) => {
                let lnk = std::env::var("APPDATA").unwrap_or_default()
                    + r"\Microsoft\Windows\Start Menu\Programs\Discord.lnk";
                let ps = format!(
                    "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.WorkingDirectory='{}';$s.Description='Discord';$s.Save()",
                    lnk.replace('\'', "''"),
                    exe.replace('\'', "''"),
                    Path::new(exe).parent().unwrap().display().to_string().replace('\'', "''")
                );
                let (ok, out) = run("powershell.exe", &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps]);
                done("shortcut", if ok { "ok" } else { "warn" }, if ok { exe.clone() } else { out });
            }
            None => done("shortcut", "skip", "Discord.exe not found".into()),
        }
    }

    // 9. Direct autostart (no updater in the loop).
    if plan.autostart {
        match &exe {
            Some(exe) => {
                let r = hive("HKCU")
                    .open_subkey_with_flags(RUN_KEYS[3].1, KEY_SET_VALUE)
                    .and_then(|k| k.set_value("DiscordRun", &format!("\"{exe}\"")));
                done("autostart", if r.is_ok() { "ok" } else { "warn" }, r.err().map(|e| e.to_string()).unwrap_or_default());
            }
            None => done("autostart", "skip", "Discord.exe not found".into()),
        }
    }

    rep
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_ids_and_versions() {
        assert_eq!(module_id("discord_krisp-1"), "discord_krisp");
        assert_eq!(module_id("discord_overlay2-12"), "discord_overlay2");
        assert_eq!(module_id("weird-name"), "weird-name");
        assert!(version_key("app-1.0.9200") > version_key("app-1.0.9199"));
        assert!(version_key("app-1.0.10000") > version_key("app-1.0.9999"));
    }
}
