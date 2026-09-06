# Discord Cleaner

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

Three profiles (Minimal, Balanced, Aggressive) give sane defaults; every switch has an expandable explanation of what the thing is, what happens without it, and a risk chip (safe / moderate / risky). A review screen lists the exact actions before anything runs, then a live progress log shows what happened.

Core modules (`discord_desktop_core`, `discord_voice`, `discord_utils`) and the `en-US` locale are never offered for removal.

## Install

Download `Discord Cleaner_x.y.z_x64-setup.exe` or the portable `discord-cleaner.exe` from the [Releases](../../releases) page. Windows 10/11, 64-bit. The app asks for administrator rights at launch (needed for the service and `HKLM`).

## Undo

Nothing is backed up: reinstalling Discord from [discord.com](https://discord.com/download) puts everything back and keeps your account and settings. A Discord update may also silently reinstall some items; just run the tool again.

## Build from source

Prerequisites: [Rust](https://rustup.rs), Node 20+, and the Visual Studio C++ Build Tools (Tauri's [Windows prerequisites](https://tauri.app/start/prerequisites/)).

```
npm install
npm run tauri dev      # run from an elevated terminal: the app requires admin
npm run tauri build    # -> src-tauri/target/release/discord-cleaner.exe + bundle/nsis/*-setup.exe
```

Rust unit tests: `cd src-tauri && cargo test --lib` (`--lib` because the main binary's manifest requires elevation).

## How it works

- `src-tauri/src/cleaner.rs`: scans `%LOCALAPPDATA%\Discord`, the service (`sc.exe`), the `Run` keys (`winreg`) and applies the plan. Deletions are resolved from a fresh scan at apply time, never from stale paths.
- `src/catalog.ts`: the catalog of modules and files with their EN/FR explanations and risk level. Adding a newly discovered Discord module is a one-entry change there.
- `src/main.ts`: the UI, vanilla TypeScript, no framework.

Based on the original `Discord Debloater` batch script by Kydaix.

## License

MIT
