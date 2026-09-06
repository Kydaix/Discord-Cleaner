// What each removable thing is, what it does, and what happens without it. EN + FR.
// Risk: safe = no visible loss for most people · moderate = a feature may degrade · risky = a core feature may break.

export type Risk = "safe" | "moderate" | "risky";
export interface Info {
  title: string;
  what: string;
  effect: string;
}
export interface Entry {
  risk: Risk;
  en: Info;
  fr: Info;
}

const e = (risk: Risk, en: [string, string, string], fr: [string, string, string]): Entry => ({
  risk,
  en: { title: en[0], what: en[1], effect: en[2] },
  fr: { title: fr[0], what: fr[1], effect: fr[2] },
});

/** Native modules found in the `modules` folder of each version. Anything not listed here is shown as "unknown" and never preselected. */
export const MODULES: Record<string, Entry> = {
  discord_krisp: e(
    "safe",
    ["Krisp noise suppression", "Krisp's AI model that filters background noise from your microphone.", "The Krisp option disappears from voice settings. Discord's standard noise suppression still works."],
    ["Suppression de bruit Krisp", "Modèle IA de Krisp qui filtre les bruits de fond de votre micro.", "L'option Krisp disparaît des réglages vocaux. La suppression de bruit standard de Discord continue de fonctionner."],
  ),
  discord_overlay2: e(
    "safe",
    ["In-game overlay", "Draws voice indicators and chat on top of your games.", "No more overlay in games. Voice and chat keep working in the Discord window."],
    ["Overlay en jeu", "Affiche les indicateurs vocaux et le chat par-dessus vos jeux.", "Plus d'overlay dans les jeux. La voix et le chat fonctionnent toujours dans la fenêtre Discord."],
  ),
  discord_overlay: e(
    "safe",
    ["In-game overlay (legacy)", "Older version of the overlay, kept around by Discord.", "Same as the overlay: nothing else depends on it."],
    ["Overlay en jeu (ancien)", "Ancienne version de l'overlay, conservée par Discord.", "Comme l'overlay : rien d'autre n'en dépend."],
  ),
  discord_desktop_overlay: e(
    "safe",
    ["Desktop overlay", "Overlay variant used outside of games.", "Same as the overlay."],
    ["Overlay bureau", "Variante de l'overlay utilisée hors des jeux.", "Comme l'overlay."],
  ),
  discord_hook: e(
    "safe",
    ["Overlay hook", "Injects Discord into game processes so the overlay can draw.", "Only the overlay needs it. Removing it also avoids anti-cheat false positives caused by the injection."],
    ["Hook de l'overlay", "Injecte Discord dans les processus des jeux pour que l'overlay puisse s'afficher.", "Seul l'overlay en a besoin. Le retirer évite aussi les faux positifs d'anti-cheat liés à l'injection."],
  ),
  discord_game_utils: e(
    "safe",
    ["Game detection", "Detects running games to show “Playing …” in your status.", "Your status no longer shows the game you are playing. You can still set a status by hand."],
    ["Détection des jeux", "Détecte les jeux lancés pour afficher « Joue à … » dans votre statut.", "Votre statut n'affiche plus le jeu en cours. Vous pouvez toujours définir un statut à la main."],
  ),
  discord_rpc: e(
    "safe",
    ["Rich Presence", "Local server that lets other apps publish an activity (game details, music) to your profile.", "Apps using Rich Presence can no longer show details in your status."],
    ["Rich Presence", "Serveur local qui permet à d'autres applications de publier une activité (détails de jeu, musique) sur votre profil.", "Les applications utilisant Rich Presence ne peuvent plus afficher de détails dans votre statut."],
  ),
  discord_spellcheck: e(
    "safe",
    ["Spell checker", "Underlines misspelled words in the message box.", "No more spelling suggestions."],
    ["Correcteur orthographique", "Souligne les fautes dans la zone de message.", "Plus de suggestions orthographiques."],
  ),
  discord_cloudsync: e(
    "safe",
    ["Cloud sync", "Synchronizes some client settings to Discord's servers.", "Those settings stay local to this computer."],
    ["Synchronisation cloud", "Synchronise certains réglages du client avec les serveurs de Discord.", "Ces réglages restent locaux à cet ordinateur."],
  ),
  discord_dispatch: e(
    "safe",
    ["Game distribution", "Leftover from Discord's discontinued game store: downloads and installs games.", "Nothing visible, the store no longer exists."],
    ["Distribution de jeux", "Vestige de la boutique de jeux abandonnée par Discord : télécharge et installe des jeux.", "Rien de visible, la boutique n'existe plus."],
  ),
  discord_notifications: e(
    "moderate",
    ["Native notifications", "Bridges Discord notifications to the Windows notification center.", "Desktop notifications may stop appearing. Sounds and in-app badges still work."],
    ["Notifications natives", "Relie les notifications Discord au centre de notifications Windows.", "Les notifications bureau peuvent cesser d'apparaître. Les sons et badges dans l'application fonctionnent toujours."],
  ),
  discord_erlpack: e(
    "moderate",
    ["ETF encoding", "Binary encoding of the connection to Discord's gateway, faster than JSON.", "Discord silently falls back to JSON: slightly more CPU and bandwidth, no visible change."],
    ["Encodage ETF", "Encodage binaire de la connexion à la passerelle Discord, plus rapide que JSON.", "Discord repasse silencieusement en JSON : un peu plus de CPU et de bande passante, rien de visible."],
  ),
  discord_zstd: e(
    "moderate",
    ["zstd compression", "Compresses gateway traffic.", "Falls back to zlib compression. No visible change."],
    ["Compression zstd", "Compresse le trafic de la passerelle.", "Repasse en compression zlib. Rien de visible."],
  ),
  discord_modules: e(
    "moderate",
    ["Module manager", "Downloads and updates the other native modules.", "Discord can no longer reinstall removed modules on its own. Pointless unless you also remove the updater."],
    ["Gestionnaire de modules", "Télécharge et met à jour les autres modules natifs.", "Discord ne peut plus réinstaller seul les modules supprimés. Inutile sans suppression de l'updater."],
  ),
  discord_media: e(
    "risky",
    ["Media engine", "Audio/video pipeline used for calls, camera and screen sharing.", "Video calls and screen sharing may break. Keep it unless you never use them."],
    ["Moteur média", "Pipeline audio/vidéo utilisé pour les appels, la caméra et le partage d'écran.", "Les appels vidéo et le partage d'écran peuvent casser. Gardez-le sauf si vous ne les utilisez jamais."],
  ),
};

/** Never offered for removal. */
export const PROTECTED = ["discord_desktop_core", "discord_utils", "discord_voice"];

/** Loose files inside each app-* folder. */
export const EXTRAS: Record<string, Entry> = {
  swiftshader: e(
    "moderate",
    ["Software renderer", "Fallback GPU emulation used when no working graphics driver is available.", "Fine on a normal PC. Keep it on virtual machines or if Discord shows a black window."],
    ["Rendu logiciel", "Émulation GPU de secours utilisée quand aucun pilote graphique ne fonctionne.", "Sans risque sur un PC normal. À garder sur machine virtuelle ou si Discord affiche une fenêtre noire."],
  ),
  chrome_pak: e(
    "moderate",
    ["Chromium resource packs", "Chromium UI resource files (chrome_100_percent.pak, chrome_200_percent.pak) that Discord's own interface does not use.", "Removed by the original script without side effects. Keep them for a strictly stock install."],
    ["Ressources Chromium", "Fichiers de ressources de l'interface Chromium (chrome_100_percent.pak, chrome_200_percent.pak) que l'interface de Discord n'utilise pas.", "Supprimés par le script d'origine sans effet secondaire. À garder pour une installation strictement d'origine."],
  ),
  app_ico: e(
    "safe",
    ["Icon file", "Copy of the Discord icon used by the installer.", "None."],
    ["Fichier icône", "Copie de l'icône Discord utilisée par l'installateur.", "Aucun."],
  ),
  debug_log: e(
    "safe",
    ["Debug log", "Chromium debug log.", "None."],
    ["Journal de débogage", "Journal de débogage de Chromium.", "Aucun."],
  ),
};

export const UNKNOWN: Entry = e(
  "moderate",
  ["Unknown module", "Not in our catalog yet: Discord added it after this version of the app was released.", "Unknown. Left alone unless you tick it."],
  ["Module inconnu", "Pas encore dans notre catalogue : Discord l'a ajouté après la sortie de cette version de l'application.", "Inconnu. Laissé en place sauf si vous le cochez."],
);

export type PresetId = "minimal" | "balanced" | "aggressive";

/** Which risk levels each preset removes. Minimal touches no file inside app-*. */
export const PRESETS: Record<PresetId, { updater: boolean; risks: Risk[]; trimLocales: boolean }> = {
  minimal: { updater: false, risks: [], trimLocales: false },
  balanced: { updater: false, risks: ["safe"], trimLocales: true },
  aggressive: { updater: true, risks: ["safe", "moderate", "risky"], trimLocales: true },
};
