# Discord Cleaner

<img src="public/logo.png" width="96" align="right" alt="" />

Remove what Discord installs behind your back on Windows, keep what you use. A small GUI (Tauri, ~8 MB) that explains every option before touching anything.

*Français : l'application est bilingue (EN/FR), la langue suit celle de Windows et se change d'un clic dans l'en-tête.*

## What it can do

| Area | What is removed | Why you might want that |
| --- | --- | --- |
| **Background service** | `DiscordSystemHelper` service and its executable under `Program Files\Common Files\Discord` | Runs as SYSTEM at boot even when Discord is closed |
| **Startup entries** | Registry `Run` values that launch Discord through `Update.exe` | Discord starts with Windows whether you asked or not |
| **Updater** *(optional)* | `Update.exe`, `SquirrelSetup`, `download/`, `packages/` | Removes the automatic updater. Use the dashboard to update Discord and reapply your profile. |
| **Optional modules** | Krisp, overlay, game detection, Rich Presence, spell check, cloud sync… each one individually | Every module is a feature you may never use, some are hundreds of MB |
| **Languages** | Translation packs other than the ones you keep | Discord ships every language |
| **Loose files** | `swiftshader/`, `chrome_*.pak`, `app.ico`, `debug.log` | Nothing depends on them |

Three profiles (Minimal, Balanced, Aggressive) give sane defaults; every switch has an expandable explanation of what the thing is, what happens without it, and a risk chip (safe / moderate / risky). Modules are grouped by purpose (overlay, games, voice, connection, other) with a switch per group and quick actions (none / safe only / everything). Any manual change becomes the **Custom** profile, remembered for the next launch; the Settings page picks which profile is applied after each scan. A review screen lists the exact actions before anything runs, then a live progress log shows what happened.

Core modules (`discord_desktop_core`, `discord_voice`, `discord_utils`) and the `en-US` locale are never offered for removal.

## Dashboard and optimizations

The **Dashboard** shows the installed version, installation state, estimated reclaimable space and selected profile. It checks Discord's official Stable / Windows x64 feed at launch and on demand, even if `Update.exe` was removed. The check compares application versions numerically; it does not track individual module revisions. Offline or invalid responses show an error, and a newer local version cannot be downgraded.

**Install / Update / Reinstall with my profile** downloads the official installer for the checked version, verifies its Windows Authenticode signature and Discord publisher, runs the normal installer, waits for initialization, then scans and cleans with the selected profile. Discord may open during initialization and is closed for cleanup. Signature failures, installation errors or timeouts stop cleanup. Keep the cleaner open until completion; closing and overlapping operations in the same instance are disabled. No resident service is added, and existing account data is not deleted. Already completed changes are not rolled back after an error.

The **Optimizations** tab contains the profiles, background/startup options, modules, languages and files. Options remain configurable when their files are absent, including before a first installation. Custom choices and the selected profile survive subsequent scans and restarts. Balanced and Aggressive retain English and the system language on a fresh installation; custom language selections also apply to newly installed language packs. Only components actually found are removed. Discord's own updates may restore components later.

The installer deliberately uses its normal initialization: the [WinGet maintainers document why `--silent` can leave Discord's version database uninitialized](https://github.com/microsoft/winget-pkgs/discussions/216652).

## Install

No installer for the cleaner itself. Download `DiscordCleaner.exe` from the [Releases](../../releases) page and run it. Windows 10/11, 64-bit, ~4 MB. The app asks for administrator rights at launch (needed for the service and `HKLM`). Discord installation uses a temporary download, removed after the operation; cleanup can also update Windows startup entries and shortcuts.

## Undo

Nothing is backed up: reinstalling Discord from [discord.com](https://discord.com/download) puts everything back and keeps your account and settings. A Discord update may also silently reinstall some items; just run the tool again.

## Build from source

Prerequisites: [rustup](https://rustup.rs), Node 22.23.2 (the CI version) or a compatible newer version, and the Visual Studio C++ Build Tools (Tauri's [Windows prerequisites](https://tauri.app/start/prerequisites/)). Rust is pinned in `rust-toolchain.toml`.

```
rustup toolchain install --no-self-update
npm ci
npm run tauri dev      # run from an elevated terminal: the app requires admin
npm run tauri build -- --no-bundle -- --locked
# -> src-tauri/target/release/discord-cleaner.exe (portable, single file)
```

Checks:

```
npm run test:release
npm run build
npm run test:ux
npm run test:updates
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
```

The UI check uses installed Microsoft Edge and simulated IPC, so it never cleans the real Discord installation. Installer checks mock network, signature and process operations in a temporary fixture; they never run a real installer. `--lib` keeps Rust tests separate from the main binary's administrator manifest.

## Releases

Pull requests to `main` run the checks and build a Windows executable without publishing. Pushes to `main` and manual runs on `main` publish only after all checks pass. The version comes from the commit messages since the highest reachable stable version tag ([Conventional Commits](https://www.conventionalcommits.org)):

| Commit message | Bump |
| --- | --- |
| `feat!: ...` or a `BREAKING CHANGE` footer | major |
| `feat: ...` | minor |
| anything else (`fix:`, `docs:`, `chore:`...) | patch |

Add `[skip ci]` to a commit message to push without releasing. The version is injected at build time, `tauri.conf.json` stays at `0.0.0` in the repo.

The build job has read-only repository access. Publication uploads the executable and its SHA-256 file to a draft before publishing it. A rerun resumes an incomplete release, and skips rebuilding when the commit already has a published release with its executable.

After successful publication, a separate cleanup job deletes older published releases and older completed workflow runs across the repository, including their logs and artifacts. It keeps the latest release, the current run, active or newer runs, draft releases, and all Git tags (needed for versioning). Only publishing and cleanup can write releases; only cleanup can delete runs. Rerunning the workflow retries cleanup without rebuilding an already published version; rerunning an older version skips cleanup if a newer release exists.

Rust dependencies are cached between builds; only `main` saves the cache. The pinned toolchain is installed in an isolated Rust home so the runner's other toolchains do not invalidate the cache. CI omits test debug symbols while keeping assertions, and keeps release LTO off. Changing Rust or build settings can require rebuilding the cache once. Each build stores the verified executable, compiler timing report and UI screenshots as workflow artifacts for up to seven days, or until its run is deleted by the next release. Use the timing report and separate cache-hit/cache-miss runs when comparing build speed.

## How it works

- `src-tauri/src/cleaner.rs`: scans `%LOCALAPPDATA%\Discord`, the service (`sc.exe`), the `Run` keys (`winreg`) and applies the plan. Deletions are resolved from a fresh scan at apply time, never from stale paths.
- `src-tauri/src/updates.rs` and embedded `discord-update.ps1`: check the official feed, download and verify the official installer, wait for initialization, and reuse the cleaner. Windows PowerShell supplies HTTP and Authenticode support; no extra dependency or external script file is needed at runtime.
- `src/catalog.ts`: the catalog of modules and files with their EN/FR explanations and risk level. Adding a newly discovered Discord module is a one-entry change there.
- `src/main.ts`: the UI, vanilla TypeScript, no framework.

Based on the original `Discord Debloater` batch script by Kydaix.

## License

MIT
