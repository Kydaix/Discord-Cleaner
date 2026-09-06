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

Prerequisites: [Rust](https://rustup.rs), Node 20+, and the Visual Studio C++ Build Tools (Tauri's [Windows prerequisites](https://tauri.app/start/prerequisites/)).

```
npm install
npm run tauri dev      # run from an elevated terminal: the app requires admin
npm run tauri build    # -> src-tauri/target/release/discord-cleaner.exe (portable, single file)
```

Rust unit tests: `cd src-tauri && cargo test --lib` (`--lib` because the main binary's manifest requires elevation).

## Releases

Every push to `main` builds the exe and publishes a GitHub Release. The version comes from the commit messages since the last tag ([Conventional Commits](https://www.conventionalcommits.org)):

| Commit message | Bump |
| --- | --- |
| `feat!: ...` or a `BREAKING CHANGE` footer | major |
| `feat: ...` | minor |
| anything else (`fix:`, `docs:`, `chore:`...) | patch |

Add `[skip ci]` to a commit message to push without releasing. The version is injected at build time, `tauri.conf.json` stays at `0.0.0` in the repo.

## How it works

- `src-tauri/src/cleaner.rs`: scans `%LOCALAPPDATA%\Discord`, the service (`sc.exe`), the `Run` keys (`winreg`) and applies the plan. Deletions are resolved from a fresh scan at apply time, never from stale paths.
- `src/catalog.ts`: the catalog of modules and files with their EN/FR explanations and risk level. Adding a newly discovered Discord module is a one-entry change there.
- `src/main.ts`: the UI, vanilla TypeScript, no framework.

Based on the original `Discord Debloater` batch script by Kydaix.

## License

MIT
