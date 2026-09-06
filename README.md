# Discord Cleaner

<img src="public/logo.png" width="96" align="right" alt="" />

Remove what Discord installs behind your back on Windows, keep what you use. A small GUI (Tauri, ~8 MB) that explains every option before touching anything.

*Français : l'application est bilingue (EN/FR), la langue suit celle de Windows et se change d'un clic dans l'en-tête.*

## What it can do

| Area | What is removed | Why you might want that |
| --- | --- | --- |
| **Background service** | `DiscordSystemHelper` service and its executable under `Program Files\Common Files\Discord` | Runs as SYSTEM at boot even when Discord is closed |
| **Startup entries** | Registry `Run` values that launch Discord through `Update.exe` | Discord starts with Windows whether you asked or not |
| **Updater** *(optional)* | `Update.exe`, `SquirrelSetup`, `download/`, `packages/` | Auto-updates and module re-downloads stop. Reinstall Discord to update. |
| **Optional modules** | Krisp, overlay, game detection, Rich Presence, spell check, cloud sync… each one individually | Every module is a feature you may never use, some are hundreds of MB |
| **Languages** | Translation packs other than the ones you keep | Discord ships every language |
| **Loose files** | `swiftshader/`, `chrome_*.pak`, `app.ico`, `debug.log` | Nothing depends on them |

Three profiles (Minimal, Balanced, Aggressive) give sane defaults; every switch has an expandable explanation of what the thing is, what happens without it, and a risk chip (safe / moderate / risky). Modules are grouped by purpose (overlay, games, voice, connection, other) with a switch per group and quick actions (none / safe only / everything). Any manual change becomes the **Custom** profile, remembered for the next launch; the Settings page picks which profile is applied after each scan. A review screen lists the exact actions before anything runs, then a live progress log shows what happened.

Core modules (`discord_desktop_core`, `discord_voice`, `discord_utils`) and the `en-US` locale are never offered for removal.

## Install

No installer. Download `DiscordCleaner.exe` from the [Releases](../../releases) page and run it. Windows 10/11, 64-bit, ~4 MB, nothing is written outside Discord's own folders. The app asks for administrator rights at launch (needed for the service and `HKLM`).

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
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
```

The UI check uses installed Microsoft Edge and simulated IPC, so it never cleans the real Discord installation. `--lib` keeps Rust tests separate from the main binary's administrator manifest.

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
- `src/catalog.ts`: the catalog of modules and files with their EN/FR explanations and risk level. Adding a newly discovered Discord module is a one-entry change there.
- `src/main.ts`: the UI, vanilla TypeScript, no framework.

Based on the original `Discord Debloater` batch script by Kydaix.

## License

MIT
