//! Official installer orchestration, using Windows' HTTP and Authenticode support.
use crate::cleaner::{self, Plan, Progress, Report};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};

#[derive(Deserialize, Serialize)]
pub struct Release {
    pub latest: String,
}

fn powershell(operation: &str) -> Command {
    let system = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
    let mut command = Command::new(std::path::PathBuf::from(system).join(r"System32\WindowsPowerShell\v1.0\powershell.exe"));
    command.args(["-NoProfile", "-NonInteractive", "-Command", include_str!("discord-update.ps1")])
        .env("DISCORD_CLEANER_OPERATION", operation)
        .creation_flags(0x0800_0000);
    command
}

pub fn check() -> Result<Release, String> {
    let output = powershell("check").output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let event: Progress = serde_json::from_slice(&output.stdout).map_err(|_| "Discord update check failed.".to_string())?;
        return Err(event.detail);
    }
    let release: Release = serde_json::from_slice(&output.stdout).map_err(|_| "Invalid Discord update response.".to_string())?;
    version(&release.latest)?;
    Ok(release)
}

fn version(value: &str) -> Result<[u32; 3], String> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|p| p.is_empty() || p.len() > 9 || !p.bytes().all(|b| b.is_ascii_digit())) {
        return Err("Invalid Discord version.".into());
    }
    Ok([parts[0].parse().unwrap(), parts[1].parse().unwrap(), parts[2].parse().unwrap()])
}

pub fn install(expected: &str, plan: &Plan, emit: impl Fn(Progress)) -> Result<Report, String> {
    let wanted = version(expected)?;
    // Never downgrade a newer local installation based on a stale dashboard.
    let before = cleaner::scan();
    for installed in &before.versions {
        if version(installed.trim_start_matches("app-")).is_ok_and(|v| v > wanted) {
            return Err("A newer Discord version is already installed. Check for updates again.".into());
        }
    }
    let mut child = powershell("install")
        .env("DISCORD_CLEANER_VERSION", expected)
        .stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|e| e.to_string())?;
    let mut error = None;
    let mut installed = false;
    for line in BufReader::new(child.stdout.take().unwrap()).lines() {
        match line.ok().and_then(|l| serde_json::from_str::<Progress>(&l).ok()) {
            Some(event) => {
                if event.step == "error" { error = Some(event.detail.clone()); }
                if event.step == "install" && event.status == "ok" { installed = true; }
                emit(event);
            }
            None => error = Some("Unexpected installer response. No cleanup was performed.".into()),
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if let Some(error) = error { return Err(error); }
    if !status.success() || !installed { return Err("Discord installation failed. No cleanup was performed.".into()); }
    Ok(cleaner::apply(plan, emit))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "contacts the official Discord update feed; does not install anything"]
    fn live_update_check() {
        let release = check().expect("official Discord feed");
        assert!(version(&release.latest).is_ok());
    }

    #[test]
    fn strict_versions_and_numeric_order() {
        assert!(version("1.0.10000").unwrap() > version("1.0.9999").unwrap());
        for invalid in ["", "1.2", "1.2.3.4", "1.2.-1", "1.2.3/evil", "1.2.9999999999", "1.2.3;exit"] {
            assert!(version(invalid).is_err(), "{invalid}");
        }
    }
}
