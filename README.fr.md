<div align="center">

<img src="public/logo.png" width="96" alt="Logo de Discord Cleaner" />

# Discord Cleaner

**Gardez les fonctionnalités Discord que vous utilisez. Supprimez le reste.**

Une application Windows portable pour nettoyer, installer et mettre à jour Discord avec votre propre profil d’optimisation.

[![Compilation](https://github.com/Kydaix/Discord-Cleaner/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/Kydaix/Discord-Cleaner/actions/workflows/release.yml)
[![Version](https://img.shields.io/github/v/release/Kydaix/Discord-Cleaner?color=5865F2)](https://github.com/Kydaix/Discord-Cleaner/releases/latest)
[![Licence : MIT](https://img.shields.io/badge/Licence-MIT-blue.svg)](LICENSE)

[English](README.md) · **Français**

[Télécharger pour Windows](https://github.com/Kydaix/Discord-Cleaner/releases/latest/download/DiscordCleaner.exe) · [Notes de version](https://github.com/Kydaix/Discord-Cleaner/releases/latest) · [Signaler un problème](https://github.com/Kydaix/Discord-Cleaner/issues)

</div>

---

## Premiers pas

1. Téléchargez **[DiscordCleaner.exe](https://github.com/Kydaix/Discord-Cleaner/releases/latest/download/DiscordCleaner.exe)** et lancez-le. Le nettoyeur ne nécessite aucune installation.
2. Ouvrez **Optimisations**, choisissez un profil et vérifiez les fonctionnalités à conserver.
3. Consultez le récapitulatif, puis confirmez le nettoyage. Pour installer ou mettre à jour Discord, passez par le **Dashboard** afin d’appliquer votre profil après l’installation.

**Prérequis :** Windows 10 ou 11, 64 bits. Les droits administrateur sont demandés au lancement pour gérer le service Windows et les entrées de démarrage système. L’installation et la recherche de mises à jour nécessitent une connexion internet.

L’interface est disponible en **français et en anglais**. Elle utilise initialement la langue du système ; vous pouvez la changer dans l’en-tête.

<details>
<summary>Vérifier le téléchargement</summary>

Téléchargez `DiscordCleaner.exe.sha256` depuis la même version. Dans PowerShell, calculez l’empreinte de l’exécutable et comparez-la à la valeur de ce fichier :

```powershell
Get-FileHash .\DiscordCleaner.exe -Algorithm SHA256
```

</details>

## Deux onglets, un parcours simple

| Onglet | Fonctionnalités |
| --- | --- |
| **Dashboard** | Consultez la version de Discord installée, son état, l’espace récupérable estimé et le profil sélectionné. Recherchez les mises à jour, puis installez, mettez à jour ou réinstallez Discord avec votre profil. |
| **Optimisations** | Choisissez un profil et ajustez les services en arrière-plan, le démarrage, les modules optionnels, les langues et les fichiers. Chaque option décrit son rôle, les effets de sa suppression et son niveau de risque. |

Votre profil et vos choix personnalisés sont conservés entre les analyses et les redémarrages. Vous pouvez les configurer avant d’installer Discord, même si les fichiers concernés sont absents. Un écran de confirmation présente les actions prévues ; un journal affiche ensuite leur progression.

## Choisir un profil

| Profil | Comportement |
| --- | --- |
| **Minimal** | Supprime le service auxiliaire, remplace les entrées de démarrage et recrée le raccourci. Conserve les modules, les langues et le programme de mise à jour. |
| **Équilibré** | Supprime aussi des fonctionnalités optionnelles comme Krisp et l’overlay, ainsi que les langues inutilisées. Conserve le programme de mise à jour. Vérifiez les fonctionnalités dont vous avez besoin avant de l’appliquer. |
| **Agressif** | Supprime les modules optionnels connus, y compris ceux signalés comme risqués, et le programme de mise à jour. Les appels, la vidéo ou le partage d’écran peuvent ne plus fonctionner. |
| **Personnalisé** | Vos choix individuels, mémorisés pour la prochaine utilisation. Modifier une option active ce profil. |

Les profils Équilibré et Agressif conservent par défaut l’anglais et la langue du système. Les modules essentiels (`discord_desktop_core`, `discord_voice`, `discord_utils`) et le pack de langue `en-US` sont protégés contre la suppression. Aucun profil prédéfini ne sélectionne les modules inconnus.

## Ce que vous pouvez supprimer

| Catégorie | Composants | Conséquence à connaître |
| --- | --- | --- |
| **Service auxiliaire** | `DiscordSystemHelper` et son exécutable | Désactive et supprime le service auxiliaire Windows de Discord. |
| **Entrées de démarrage** | Entrées du registre lançant Discord via `Update.exe` | Supprime ce mode de démarrage. Vous pouvez créer une entrée lançant directement `Discord.exe`. |
| **Mises à jour automatiques** | `Update.exe`, `SquirrelSetup`, `download/`, `packages/` | Les mises à jour automatiques s’arrêtent. Utilisez le Dashboard pour mettre à jour Discord avec votre profil. |
| **Modules optionnels** | Krisp, overlays, détection des jeux, Rich Presence, correcteur orthographique, etc. | Les fonctionnalités associées peuvent disparaître ou ne plus fonctionner. Les modules se sélectionnent individuellement ou par groupe. |
| **Langues** | Packs de traduction que vous ne conservez pas | Supprime ces langues de l’interface. |
| **Fichiers supplémentaires** | `swiftshader/`, `chrome_*.pak`, `app.ico`, `debug.log` | Les effets varient selon le fichier. Conservez le rendu logiciel si votre configuration graphique en dépend. |

## Installer et mettre à jour Discord

Le Dashboard consulte le flux officiel Discord **Stable / Windows x64** au lancement et à la demande, même si `Update.exe` a été supprimé. Il compare les versions de l’application, sans suivre les révisions de chaque module. Une version locale plus récente n’est pas remplacée par une version antérieure.

Lorsque vous confirmez **Installer / Mettre à jour / Réinstaller avec mon profil**, l’application :

1. Télécharge l’installateur officiel correspondant à la version vérifiée.
2. Vérifie sa signature Windows Authenticode et l’identité de l’éditeur Discord.
3. Lance l’installateur et attend la fin de l’initialisation de Discord.
4. Analyse l’installation obtenue et applique les optimisations sélectionnées.

Discord peut s’ouvrir pendant l’initialisation ; il est fermé pour le nettoyage. Une signature invalide, une erreur d’installation ou un délai dépassé empêche l’étape de nettoyage. Le téléchargement temporaire de l’installateur est supprimé après l’opération. Le nettoyeur n’ajoute aucun service permanent.

Gardez le nettoyeur ouvert jusqu’à la fin. La fermeture de la fenêtre et le lancement d’opérations simultanées dans la même instance sont désactivés pendant une opération.

## Restaurer les composants

**Il n’y a ni sauvegarde ni annulation en un clic.** Les modifications déjà effectuées ne sont pas annulées si une étape suivante échoue. Le nettoyage ne supprime pas vos données de compte existantes.

Pour restaurer les composants supprimés, réinstallez Discord depuis [discord.com](https://discord.com/download). Une réinstallation depuis le nettoyeur réapplique aussi votre profil et supprime donc à nouveau les composants sélectionnés. Les mises à jour de Discord peuvent rétablir certains composants ultérieurement ; vérifiez et réappliquez vos choix si nécessaire.

## Compiler depuis les sources

Utilisez Windows avec Node.js **22.23.2** (version utilisée en CI), [rustup](https://rustup.rs), ainsi que les outils de compilation C++ et WebView2 indiqués dans les [prérequis Windows de Tauri](https://tauri.app/start/prerequisites/). La version de Rust est fixée dans [rust-toolchain.toml](rust-toolchain.toml).

Depuis la racine du dépôt :

```powershell
rustup toolchain install --no-self-update
npm ci
```

Lancez le développement depuis un **terminal administrateur** :

```powershell
npm run tauri dev
```

Compilez l’exécutable portable :

```powershell
npm run tauri build -- --no-bundle -- --locked
```

Fichier produit : `src-tauri/target/release/discord-cleaner.exe`.

### Vérifications

```powershell
npm run test:release
npm run build
npm run test:ux
npm run test:updates
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
```

Les tests d’interface utilisent Microsoft Edge installé et des données Discord simulées. Les tests de l’installateur simulent le réseau, les signatures et les processus dans des dossiers temporaires. Ces vérifications ne nettoient pas votre installation Discord et ne lancent aucun véritable installateur. L’option Rust `--lib` sépare les tests du manifeste administrateur de l’exécutable principal.

### Organisation du projet

| Fichier | Rôle |
| --- | --- |
| [src/main.ts](src/main.ts) | Interface, choix enregistrés et déroulement des opérations ; TypeScript sans framework. |
| [src/catalog.ts](src/catalog.ts) | Descriptions des modules et fichiers, effets de suppression et niveaux de risque dans les deux langues. |
| [src/i18n.ts](src/i18n.ts) | Textes de l’interface en anglais et en français. |
| [src-tauri/src/cleaner.rs](src-tauri/src/cleaner.rs) | Analyse Discord et applique le plan à partir de chemins recalculés au moment de l’exécution. |
| [src-tauri/src/updates.rs](src-tauri/src/updates.rs) | Coordonne la recherche de mises à jour, l’installation et le nettoyage qui suit. |
| [src-tauri/src/discord-update.ps1](src-tauri/src/discord-update.ps1) | Script Windows PowerShell embarqué pour les téléchargements, la vérification des signatures et l’exécution de l’installateur. |

### Publication automatique

Les pull requests vers `main` exécutent les vérifications et compilent sans publier. Les push et les lancements manuels du workflow sur `main` publient après validation. La version dépend des messages de commit depuis le plus grand tag de version stable accessible :

| Commit | Incrément |
| --- | --- |
| `feat!: ...` ou mention `BREAKING CHANGE` en pied de message | Majeur |
| `feat: ...` | Mineur |
| Autres messages, dont `fix:`, `docs:` et `chore:` | Correctif |

Ajoutez `[skip ci]` au message d’un commit pour éviter la CI et la publication. La version publiée est injectée à la compilation ; `tauri.conf.json` reste à `0.0.0` dans le dépôt.

Le workflow vérifie la version de l’exécutable et le publie avec un fichier SHA-256. Une publication interrompue peut reprendre ; un commit déjà publié avec son exécutable ne nécessite pas de nouvelle compilation.

Après publication, le nettoyage supprime les anciennes versions publiées sur GitHub et les anciennes exécutions terminées des workflows, journaux et artefacts compris. Il conserve la dernière version, l’exécution courante, les exécutions actives ou plus récentes, les brouillons et tous les tags Git. Les diagnostics de compilation et les captures des tests d’interface sont conservés jusqu’à sept jours, ou jusqu’à la suppression de leur exécution lors de la prochaine publication.

Consultez le [workflow de publication](.github/workflows/release.yml) et le [script associé](.github/scripts/release.mjs) pour leur implémentation.

## Crédits et licence

Basé sur le script batch original **Discord Debloater** de **Kydaix**. Développé avec Tauri, Rust et TypeScript.

Distribué sous [licence MIT](LICENSE).
