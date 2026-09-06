<div align="center">

<img src="public/logo.png" width="96" alt="Discord Cleaner logo" />

# Discord Cleaner

**Keep the Discord features you use. Remove the rest.**

A portable Windows app to clean, install and update Discord with your own optimization profile.

[![Build](https://github.com/Kydaix/Discord-Cleaner/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/Kydaix/Discord-Cleaner/actions/workflows/release.yml)
[![Release](https://img.shields.io/github/v/release/Kydaix/Discord-Cleaner?color=5865F2)](https://github.com/Kydaix/Discord-Cleaner/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**English** · [Français](README.fr.md)

[Download for Windows](https://github.com/Kydaix/Discord-Cleaner/releases/latest/download/DiscordCleaner.exe) · [Release notes](https://github.com/Kydaix/Discord-Cleaner/releases/latest) · [Report an issue](https://github.com/Kydaix/Discord-Cleaner/issues)

</div>

---

## Get started

1. Download **[DiscordCleaner.exe](https://github.com/Kydaix/Discord-Cleaner/releases/latest/download/DiscordCleaner.exe)** and run it. The cleaner needs no installation.
2. Open **Optimizations**, choose a profile and review the features you want to keep.
3. Review your selection, then confirm cleanup. To install or update Discord, use the **Dashboard** to apply your profile after installation.

**Requirements:** Windows 10 or 11, 64-bit. Administrator access is requested at launch for the Windows service and system startup entries. Installation and update checks require an internet connection.

The interface is available in **English and French**. It follows your system language initially; you can switch languages in the header.

<details>
<summary>Verify the download</summary>

Download `DiscordCleaner.exe.sha256` from the same release. In PowerShell, compute the executable's hash and compare it with the value in that file:

```powershell
Get-FileHash .\DiscordCleaner.exe -Algorithm SHA256
```

</details>

## Two tabs, one workflow

| Tab | What you can do |
| --- | --- |
| **Dashboard** | See the installed Discord version, installation state, estimated reclaimable space and selected profile. Check for updates, then install, update or reinstall Discord with your profile. |
| **Optimizations** | Choose a profile and adjust background services, startup behavior, optional modules, language packs and files. Each option explains its purpose, removal effects and risk level. |

Your profile and custom choices are remembered across scans and restarts. You can configure them before installing Discord, even when the corresponding files are absent. A confirmation screen lists the planned actions before execution; a live log tracks progress.

## Choose a profile

| Profile | Behavior |
| --- | --- |
| **Minimal** | Removes the background helper, replaces startup entries and rebuilds the shortcut. Keeps modules, languages and the updater. |
| **Balanced** | Also removes optional features such as Krisp and the overlay, plus unused languages. Keeps the updater. Review which features you need before applying. |
| **Aggressive** | Removes known optional modules, including those marked risky, and the updater. Calls, video or screen sharing may stop working. |
| **Custom** | Your individual selections, saved for next time. Changing an option switches to this profile. |

Balanced and Aggressive keep English and the system language by default. Core modules (`discord_desktop_core`, `discord_voice`, `discord_utils`) and the `en-US` language pack are protected from removal. Unknown modules are never selected by a preset.

## What you can remove

| Area | Components | Effect to consider |
| --- | --- | --- |
| **Background helper** | `DiscordSystemHelper` and its executable | Disables and removes Discord's Windows helper service. |
| **Startup entries** | Registry entries that launch Discord through `Update.exe` | Stops that startup path. You can optionally register a direct launch of `Discord.exe`. |
| **Automatic updater** | `Update.exe`, `SquirrelSetup`, `download/`, `packages/` | Automatic updates stop. Use the Dashboard to update Discord with your profile. |
| **Optional modules** | Krisp, overlays, game detection, Rich Presence, spell check and more | The associated features may disappear or stop working. Modules can be selected individually or by group. |
| **Languages** | Translation packs you do not keep | Removes those interface languages. |
| **Additional files** | `swiftshader/`, `chrome_*.pak`, `app.ico`, `debug.log` | Effects depend on the file. Keep the software renderer if your graphics setup needs it. |

## Install and update Discord

The Dashboard checks Discord's official **Stable / Windows x64** feed at launch and on request, including when `Update.exe` has been removed. It compares application versions; individual module revisions are not tracked. A newer local application version is not downgraded.

When you confirm **Install / Update / Reinstall with my profile**, the app:

1. Downloads the official installer for the checked version.
2. Verifies its Windows Authenticode signature and Discord publisher.
3. Runs the installer and waits for Discord to finish initializing.
4. Scans the resulting installation and applies your selected optimizations.

Discord may open during initialization and is closed for cleanup. Signature failures, installation errors and timeouts prevent the cleanup step. The temporary installer download is removed after the operation. No resident service is added by the cleaner.

Keep the cleaner open until completion. Closing the window and starting overlapping operations in the same instance are disabled while an operation runs.

## Restore components

**There is no backup or one-click undo.** Completed changes are not rolled back if a later step fails. Cleanup does not delete your existing account data.

To restore removed components, reinstall Discord from [discord.com](https://discord.com/download). Reinstalling through the cleaner also reapplies your profile, so it will remove selected components again. Discord's own updates may restore components later; review and reapply your selection when needed.

## Build from source

Use Windows with Node.js **22.23.2** (the CI version), [rustup](https://rustup.rs), and the C++ Build Tools and WebView2 requirements listed in the [Tauri Windows prerequisites](https://tauri.app/start/prerequisites/). The Rust version is pinned in [rust-toolchain.toml](rust-toolchain.toml).

From the repository root:

```powershell
rustup toolchain install --no-self-update
npm ci
```

Start development from an **elevated terminal**:

```powershell
npm run tauri dev
```

Build the portable executable:

```powershell
npm run tauri build -- --no-bundle -- --locked
```

Output: `src-tauri/target/release/discord-cleaner.exe`.

### Checks

```powershell
npm run test:release
npm run build
npm run test:ux
npm run test:updates
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
```

UI checks use installed Microsoft Edge and simulated Discord data. Installer checks simulate network, signatures and processes in temporary fixtures. These checks do not clean your Discord installation or run a real installer. Rust's `--lib` keeps tests separate from the main executable's administrator manifest.

### Project layout

| File | Responsibility |
| --- | --- |
| [src/main.ts](src/main.ts) | Interface, saved selections and operation flow; vanilla TypeScript. |
| [src/catalog.ts](src/catalog.ts) | Module and file descriptions, removal effects and risk levels in both languages. |
| [src/i18n.ts](src/i18n.ts) | English and French interface text. |
| [src-tauri/src/cleaner.rs](src-tauri/src/cleaner.rs) | Scans Discord and applies the plan using freshly resolved paths. |
| [src-tauri/src/updates.rs](src-tauri/src/updates.rs) | Coordinates update checks, installation and subsequent cleanup. |
| [src-tauri/src/discord-update.ps1](src-tauri/src/discord-update.ps1) | Embedded Windows PowerShell for downloads, signature checks and installer execution. |

### Automated releases

Pull requests to `main` run checks and build without publishing. Pushes and manual workflow runs on `main` publish after successful checks. Versioning follows commit messages since the highest reachable stable tag:

| Commit | Version bump |
| --- | --- |
| `feat!: ...` or a `BREAKING CHANGE` footer | Major |
| `feat: ...` | Minor |
| Other messages, including `fix:`, `docs:` and `chore:` | Patch |

Add `[skip ci]` to a commit message to skip CI and publication. Release versions are injected at build time; `tauri.conf.json` remains at `0.0.0` in the repository.

The workflow verifies the executable's version and publishes it with a SHA-256 file. Interrupted publication can resume; an already published commit with its executable does not need rebuilding.

After publication, cleanup removes older published releases and older completed workflow runs, including their logs and artifacts. It preserves the latest release, the current run, active or newer runs, drafts and all Git tags. Build diagnostics and UI screenshots are retained for up to seven days, or until the next release deletes their run.

See the [release workflow](.github/workflows/release.yml) and [release script](.github/scripts/release.mjs) for the implementation.

## Credits and license

Based on the original **Discord Debloater** batch script by **Kydaix**. Built with Tauri, Rust and TypeScript.

Released under the [MIT License](LICENSE).
