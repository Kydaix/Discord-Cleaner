import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { EXTRAS, GROUPS, groupOf, MODULES, PRESETS, PROTECTED, UNKNOWN, type Entry, type GroupId, type PresetId } from "./catalog";
import { getLang, setLang, t, type Key, type Lang } from "./i18n";

export const REPO = "https://github.com/Kydaix/Discord-Cleaner";

interface Item {
  id: string;
  bytes: number;
  paths: string[];
}
interface Scan {
  root: string | null;
  running: boolean;
  versions: string[];
  latest_exe: string | null;
  service: "absent" | "running" | "stopped" | "disabled";
  helper_exes: string[];
  run_entries: { hive: string; name: string; value: string }[];
  updater: Item;
  modules: Item[];
  locales: Item[];
  extras: Item[];
}
interface Plan {
  helper: boolean;
  run_entries: boolean;
  updater: boolean;
  modules: string[];
  locales: string[];
  extras: string[];
  autostart: boolean;
  shortcut: boolean;
}
interface Progress {
  step: string;
  status: "ok" | "warn" | "skip";
  detail: string;
}
interface Report {
  freed: number;
  warnings: string[];
}

type Page = "cleaner" | "settings" | "about";
type View = "loading" | "notfound" | "options" | "running" | "done";
type Preset = PresetId | "custom";
const PRESET_IDS: Preset[] = ["minimal", "balanced", "aggressive", "custom"];

let page: Page = "cleaner";
let view: View = "loading";
let scan: Scan;
let plan: Plan;
let preset: Preset = "balanced";
let steps: { id: string; label: string; status?: Progress["status"]; detail?: string }[] = [];
let report: Report | null = null;
let version = "";

const app = document.getElementById("app")!;
const bar = document.getElementById("bar")!;
const title = document.getElementById("title")!;
const subtitle = document.getElementById("subtitle")!;
const dialog = document.getElementById("review") as HTMLDialogElement;

// ---------------------------------------------------------------- helpers

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const info = (entry: Entry) => entry[getLang()];
const moduleEntry = (id: string) => MODULES[id] ?? UNKNOWN;
const sum = (items: Item[]) => items.reduce((s, i) => s + i.bytes, 0);
/** Modules the user may remove: everything the scan found minus the protected core. */
const removable = () => scan.modules.filter((m) => !PROTECTED.includes(m.id));

/** Everything the app remembers between launches goes through here. */
const store = {
  get<T>(key: string): T | null {
    try {
      const v = localStorage.getItem(key);
      return v === null ? null : (JSON.parse(v) as T);
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

/** Locales worth keeping by default: Electron's fallback plus the system language. */
function defaultKeep(): Set<string> {
  const nav = navigator.language.toLowerCase();
  const primary = nav.split("-")[0];
  return new Set(scan.locales.map((l) => l.id).filter((id) => id === "en-US" || id.toLowerCase() === nav || id.toLowerCase().split("-")[0] === primary));
}

function applyPreset(p: Preset) {
  if (p === "custom") {
    if (applySaved()) return;
    p = "balanced";
  }
  const def = PRESETS[p];
  const keep = defaultKeep();
  preset = p;
  plan = {
    helper: true,
    run_entries: true,
    updater: def.updater && scan.updater.paths.length > 0,
    modules: removable()
      .filter((m) => MODULES[m.id] && def.risks.includes(MODULES[m.id].risk))
      .map((m) => m.id),
    locales: def.trimLocales ? scan.locales.filter((l) => !keep.has(l.id)).map((l) => l.id) : [],
    extras: scan.extras.filter((x) => def.risks.includes(EXTRAS[x.id].risk)).map((x) => x.id),
    autostart: scan.run_entries.length > 0,
    shortcut: true,
  };
}

/** Restores the last hand-made selection, dropping whatever the current scan no longer has. */
function applySaved(): boolean {
  const s = store.get<Partial<Plan>>("custom");
  if (!s) return false;
  const ids = (items: Item[]) => new Set(items.map((i) => i.id));
  const mods = ids(removable());
  const locs = ids(scan.locales);
  const exts = ids(scan.extras);
  plan = {
    helper: !!s.helper,
    run_entries: !!s.run_entries,
    updater: !!s.updater && scan.updater.paths.length > 0,
    modules: (s.modules ?? []).filter((id) => mods.has(id)),
    locales: (s.locales ?? []).filter((id) => locs.has(id) && id !== "en-US"),
    extras: (s.extras ?? []).filter((id) => exts.has(id)),
    autostart: !!s.autostart && !!scan.latest_exe,
    shortcut: !!s.shortcut || !!s.updater,
  };
  preset = "custom";
  return true;
}

/** Any manual change turns the profile into "custom" and remembers it for next time. */
function customize() {
  preset = "custom";
  store.set("custom", plan);
}

function reclaimable(): number {
  const pick = (items: Item[], ids: string[]) => sum(items.filter((i) => ids.includes(i.id)));
  return (plan.updater ? scan.updater.bytes : 0) + pick(scan.modules, plan.modules) + pick(scan.locales, plan.locales) + pick(scan.extras, plan.extras);
}

function actionCount(): number {
  return [plan.helper, plan.run_entries, plan.updater, plan.autostart, plan.shortcut].filter(Boolean).length + plan.modules.length + plan.locales.length + plan.extras.length;
}

function buildSteps() {
  const label = (k: Key, name?: string) => (name ? `${t(k)} · ${name}` : t(k));
  steps = [{ id: "kill", label: t("step_kill") }];
  if (plan.helper) steps.push({ id: "helper", label: t("step_helper") });
  if (plan.run_entries) steps.push({ id: "run", label: t("step_run") });
  if (plan.updater) steps.push({ id: "updater", label: t("step_updater") });
  for (const id of plan.modules) steps.push({ id: `module:${id}`, label: label("step_module", info(moduleEntry(id)).title) });
  for (const id of plan.locales) steps.push({ id: `locale:${id}`, label: label("step_locale", id) });
  for (const id of plan.extras) steps.push({ id: `extra:${id}`, label: label("step_extra", info(EXTRAS[id]).title) });
  if (plan.shortcut) steps.push({ id: "shortcut", label: t("step_shortcut") });
  if (plan.autostart) steps.push({ id: "autostart", label: t("step_autostart") });
}

// ---------------------------------------------------------------- rendering

const ICONS = {
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  sliders: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="14" cy="18" r="2"/>',
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c2.5-1.5 6-1 6-1s.5 3.5-1 6c-1.5 3-5 6.5-8 8.5L8 14.5c2-3 3.5-7 6-10.5z"/><circle cx="15" cy="9" r="1.5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
  puzzle: '<path d="M9 4a2 2 0 1 1 4 0h5v5a2 2 0 1 1 0 4v5h-5a2 2 0 1 1-4 0H4v-5a2 2 0 1 1 0-4V4z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
  alert: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/>',
  db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
type Icon = keyof typeof ICONS;
const icon = (name: Icon, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

function card(ico: Icon, heading: string, hint: string, body: string): string {
  return `<section class="card"><div class="card-head"><span class="tile">${icon(ico)}</span><div><h2>${esc(heading)}</h2><p class="hint">${esc(hint)}</p></div></div><div class="card-body">${body}</div></section>`;
}

const risk = (r: Entry["risk"]) => `<span class="chip risk-${r}">${t(`risk_${r}` as Key)}</span>`;
const note = (kind: "note" | "info", text: string) => `<p class="${kind}">${icon(kind === "note" ? "alert" : "info", 18)}<span>${esc(text)}</span></p>`;

/** Which <details> are open survives re-renders (every switch change rebuilds the DOM). */
const opened = new Set<string>();
const details = (key: string, cls = "") => `<details class="${cls}" data-key="${esc(key)}"${opened.has(key) ? " open" : ""}>`;

function seg(items: [string, string][], attr: string, on: string, disabled: string[] = []): string {
  return `<div class="seg">${items
    .map(([v, label]) => `<button type="button" id="${attr}-${v}" aria-pressed="${v === on}" class="${v === on ? "on" : ""}" ${attr}="${v}" ${disabled.includes(v) ? "disabled" : ""}>${esc(label)}</button>`)
    .join("")}</div>`;
}

interface Row {
  attr: string;
  checked: boolean;
  title: string;
  what: string;
  effect: string;
  bytes?: number;
  risk?: Entry["risk"];
  meta?: string;
  disabled?: boolean;
}

function row(r: Row): string {
  // The switch sits outside <details> so toggling it never opens/closes the explanation (no inline JS: CSP).
  return `
  <div class="row${r.disabled ? " disabled" : ""}">
    <label class="switch">
      <input type="checkbox" id="${esc(`option-${r.attr}`)}" aria-label="${esc(r.title)}" ${r.attr} ${r.checked ? "checked" : ""} ${r.disabled ? "disabled" : ""}>
      <span></span>
    </label>
    ${details(r.attr)}
      <summary>
        <span class="row-title">${esc(r.title)}</span>
        ${r.risk ? risk(r.risk) : ""}
        ${r.bytes !== undefined ? `<span class="size">${fmt(r.bytes)}</span>` : ""}
        <span class="caret" aria-hidden="true"></span>
      </summary>
      <div class="row-body">
        ${r.meta ? `<p class="meta">${esc(r.meta)}</p>` : ""}
        <p><b>${t("details_what")}</b> ${esc(r.what)}</p>
        <p><b>${t("details_effect")}</b> ${esc(r.effect)}</p>
      </div>
    </details>
  </div>`;
}

function renderStatus(): string {
  const dot = (ok: boolean) => `<span class="dot ${ok ? "dot-ok" : "dot-warn"}"></span>`;
  const autostart = scan.run_entries.length > 0;
  return card(
    "monitor",
    t("status_title"),
    t("status_hint"),
    `<dl class="kv">
      <dt>${t("status_path")}</dt><dd><span class="path">${esc(scan.root ?? "")}</span></dd>
      <dt>${t("status_versions")}</dt><dd>${scan.versions.map((v, i) => `<span class="chip${i === 0 ? " chip-accent" : ""}">${esc(v)}${i === 0 ? ` · ${t("status_latest")}` : ""}</span>`).join("") || "—"}</dd>
      <dt>Discord</dt><dd>${dot(!scan.running)}${scan.running ? `${t("status_running")} <span class="hint">(${t("status_running_hint")})</span>` : t("status_closed")}</dd>
      <dt>${t("status_service")}</dt><dd>${dot(scan.service !== "running")}${t(`service_${scan.service}` as Key)}</dd>
      <dt>${t("status_autostart")}</dt><dd>${dot(!autostart)}${autostart ? t("yes") : t("no")}</dd>
    </dl>`,
  );
}

function renderPresets(): string {
  const items = PRESET_IDS.map((p): [string, string] => [p, t(`preset_${p}` as Key)]);
  return card("sliders", t("presets"), t("presets_hint"), seg(items, "data-preset", preset, store.get("custom") ? [] : ["custom"]) + `<p class="preset-description">${t(`preset_${preset}_hint` as Key)}</p>`);
}

function renderBackground(): string {
  const helperMeta = scan.service === "absent" && scan.helper_exes.length === 0 ? t("service_absent") : t("helper_found", { n: scan.helper_exes.length });
  const rows = [
    row({ attr: 'data-opt="helper"', checked: plan.helper, title: t("helper_title"), what: t("helper_what"), effect: t("helper_effect"), risk: "safe", meta: helperMeta }),
    row({ attr: 'data-opt="run_entries"', checked: plan.run_entries, title: t("run_title"), what: t("run_what"), effect: t("run_effect"), risk: "safe", meta: t("run_found", { n: scan.run_entries.length }) }),
    row({ attr: 'data-opt="autostart"', checked: plan.autostart, title: t("autostart_title"), what: t("autostart_what"), effect: t("autostart_effect"), disabled: !scan.latest_exe }),
  ].join("");
  return card("rocket", t("sec_background"), t("sec_background_hint"), `<div class="rows">${rows}</div>`);
}

function renderUpdates(): string {
  const rows = [
    row({ attr: 'data-opt="updater"', checked: plan.updater, title: t("updater_title"), what: t("updater_what"), effect: t("updater_effect"), risk: "moderate", bytes: scan.updater.bytes, disabled: scan.updater.paths.length === 0 }),
    row({ attr: 'data-opt="shortcut"', checked: plan.shortcut || plan.updater, title: t("shortcut_title"), what: t("shortcut_what"), effect: t("shortcut_effect"), disabled: plan.updater || !scan.latest_exe }),
  ].join("");
  return card("refresh", t("sec_updates"), t("sec_updates_hint"), `<div class="rows">${rows}</div>` + (plan.updater ? note("note", t("updater_warning")) : ""));
}

function renderModules(): string {
  const items = removable();
  const selected = items.filter((m) => plan.modules.includes(m.id));
  const groups = (Object.keys(GROUPS) as GroupId[])
    .map((g) => ({ g, items: items.filter((m) => groupOf(m.id) === g).sort((a, b) => b.bytes - a.bytes) }))
    .filter((x) => x.items.length > 0);
  const rows = groups
    .map(({ g, items }) => {
      const on = items.filter((m) => plan.modules.includes(m.id)).length;
      const header = `<div class="group">
        <label class="switch"><input type="checkbox" id="group-${g}" aria-label="${esc(t(`group_${g}` as Key))}" data-group="${g}" ${on === items.length ? "checked" : ""} ${on > 0 && on < items.length ? 'data-mixed="1"' : ""}><span></span></label>
        <span>${t(`group_${g}` as Key)}</span><span class="size">${fmt(sum(items))}</span>
      </div>`;
      return header + items.map((m) => row({ attr: `data-module="${esc(m.id)}"`, checked: plan.modules.includes(m.id), title: info(moduleEntry(m.id)).title, what: info(moduleEntry(m.id)).what, effect: info(moduleEntry(m.id)).effect, risk: moduleEntry(m.id).risk, bytes: m.bytes, meta: m.id })).join("");
    })
    .join("");
  const toolbar = `<div class="toolbar"><span class="hint">${t("modules_selected", { n: selected.length, total: items.length, size: fmt(sum(selected)) })}</span>
    <div class="btns">${(["none", "safe", "all"] as const).map((m) => `<button type="button" class="small" data-modules="${m}">${t(`modules_${m}`)}</button>`).join("")}</div></div>`;
  const kept = scan.modules.filter((m) => PROTECTED.includes(m.id)).map((m) => m.id);
  const notes = (plan.updater || plan.modules.length === 0 ? "" : note("note", t("modules_comeback"))) + (kept.length ? note("info", t("modules_protected", { list: kept.join(", ") })) : "");
  return card("puzzle", t("sec_modules"), t("sec_modules_hint"), `${details("modules", "module-options")}<summary><span>${t("modules_selected", { n: selected.length, total: items.length, size: fmt(sum(selected)) })}</span><span class="caret" aria-hidden="true"></span></summary>${toolbar}<div class="rows">${rows}</div>${notes}</details>`);
}

function renderLocales(): string {
  const locs = scan.locales.slice().sort((a, b) => a.id.localeCompare(b.id));
  const isKept = (l: Item) => l.id === "en-US" || !plan.locales.includes(l.id);
  const kept = locs.filter(isKept);
  const removed = locs.length - kept.length;
  const chip = (l: Item) => {
    const req = l.id === "en-US";
    return `<label class="loc${isKept(l) ? " on" : ""}"><input type="checkbox" id="locale-${esc(l.id)}" data-locale="${esc(l.id)}" ${isKept(l) ? "checked" : ""} ${req ? "disabled" : ""}><span>${esc(l.id)}</span><small>${req ? t("locales_required") : fmt(l.bytes)}</small></label>`;
  };
  const body = `${details("locales", "locales-wrap")}
    <summary>
      <span class="kept">${kept.map((l) => `<span class="chip chip-accent">${esc(l.id)}${l.id === "en-US" ? ` · ${t("locales_required")}` : ""}</span>`).join("")}</span>
      <span class="chip more">${t("locales_more", { n: removed })}</span><span class="chip more less">${t("locales_less")}</span>
    </summary>
    <p class="hint">${t("locales_summary", { kept: kept.length, removed })}</p>
    <div class="locales">${locs.map(chip).join("")}</div>
  </details>`;
  return card("globe", t("sec_locales"), t("sec_locales_hint"), body);
}

function renderExtras(): string {
  const rows = scan.extras.map((x) => row({ attr: `data-extra="${esc(x.id)}"`, checked: plan.extras.includes(x.id), title: info(EXTRAS[x.id]).title, what: info(EXTRAS[x.id]).what, effect: info(EXTRAS[x.id]).effect, risk: EXTRAS[x.id].risk, bytes: x.bytes })).join("");
  return card("file", t("sec_extras"), t("sec_extras_hint"), `<div class="rows">${rows}</div>`);
}

function renderOptions() {
  app.innerHTML = renderStatus() + renderPresets() + `<div class="options-grid">${renderBackground()}${renderUpdates()}</div>` + (scan.modules.length ? renderModules() : "") + (scan.locales.length ? renderLocales() : "") + (scan.extras.length ? renderExtras() : "");
  app.querySelectorAll<HTMLInputElement>("[data-mixed]").forEach((el) => (el.indeterminate = true));
  bar.hidden = false;
  bar.innerHTML = `<div><div class="bar-left" role="status">${icon("db", 18)}<strong>${t("bar_reclaim", { size: fmt(reclaimable()) })}</strong><span>·</span><span>${t("bar_actions", { n: actionCount() })}</span></div><p class="hint">${t("bar_hint")}</p></div>
    <button type="button" id="review-button" class="primary" data-action="clean" ${actionCount() === 0 ? "disabled" : ""}>${icon("sparkle", 16)}${t("clean")}</button>`;
}

function renderReview() {
  const lines: string[] = [t("review_kill")];
  if (plan.helper) lines.push(t("review_helper"));
  if (plan.run_entries) lines.push(t("review_run"));
  if (plan.updater) lines.push(t("review_updater"));
  if (plan.modules.length) lines.push(t("review_modules", { n: plan.modules.length }));
  if (plan.locales.length) lines.push(t("review_locales", { n: plan.locales.length }));
  if (plan.extras.length) lines.push(t("review_extras", { n: plan.extras.length }));
  if (plan.shortcut) lines.push(t("review_shortcut"));
  if (plan.autostart) lines.push(t("review_autostart"));
  dialog.setAttribute("aria-labelledby", "review-title");
  dialog.innerHTML = `<h2 id="review-title">${t("review_title")}</h2>
    <p class="hint">${t("review_body")}</p>
    ${plan.updater ? note("note", t("updater_warning")) : ""}
    <ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    <p><strong>${t("bar_reclaim", { size: fmt(reclaimable()) })}</strong></p>
    <div class="actions"><button type="button" data-action="cancel">${t("cancel")}</button><button type="button" class="primary" data-action="confirm">${icon("sparkle", 16)}${t("confirm")}</button></div>`;
  dialog.showModal();
}

function renderRunning(): string {
  const list = steps.map((s) => `<li class="${s.status ?? "pending"}"><span class="dot"></span><span>${esc(s.label)}</span>${s.detail ? `<small class="mono">${esc(s.detail)}</small>` : ""}</li>`).join("");
  return card("rocket", t("running_title"), "", `<ul class="steps">${list}</ul>`);
}

function renderDone(): string {
  const r = report!;
  return card(
    "check",
    t("done_title"),
    t("done_note"),
    `<p class="big">${t("done_freed", { size: fmt(r.freed) })}</p>
    ${r.warnings.length ? note("note", t("done_warnings")) + `<ul class="warnings mono">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
    <div class="actions">
      <button type="button" data-action="rescan">${t("rescan")}</button>
      ${scan.latest_exe ? `<button type="button" class="primary" data-action="launch">${t("launch")}</button>` : ""}
    </div>`,
  );
}

function renderSettings(): string {
  const langs: [string, string][] = [
    ["en", "English"],
    ["fr", "Français"],
  ];
  const presets = PRESET_IDS.map((p): [string, string] => [p, t(`preset_${p}` as Key)]);
  const hasCustom = store.get("custom") !== null;
  return (
    card("globe", t("settings_lang"), t("settings_lang_hint"), seg(langs, "data-lang", getLang())) +
    card("sliders", t("settings_default"), t("settings_default_hint"), seg(presets, "data-default", defaultPreset()) + `<p class="hint">${t(hasCustom ? "settings_custom_saved" : "settings_custom_none")}</p>`)
  );
}

function renderAbout(): string {
  return card(
    "info",
    "Discord Cleaner",
    t("about_desc"),
    `<dl class="kv">
      <dt>${t("about_version")}</dt><dd>${esc(version ? `v${version}` : "—")}</dd>
      <dt>${t("about_license")}</dt><dd>MIT</dd>
      <dt>${t("about_source")}</dt><dd><button type="button" class="small" data-action="github">${t("github")}</button></dd>
    </dl>
    <p class="hint">${t("about_based")}</p>
    ${note("info", t("about_undo"))}`,
  );
}

function defaultPreset(): Preset {
  const p = store.get<Preset>("profile");
  return p && PRESET_IDS.includes(p) ? p : "balanced";
}

function render() {
  const focused = document.activeElement?.id;
  // Read the DOM synchronously: native toggle events can arrive after an option changes.
  app.querySelectorAll<HTMLDetailsElement>("details[data-key]").forEach((d) => {
    d.open ? opened.add(d.dataset.key!) : opened.delete(d.dataset.key!);
  });
  renderPage();
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
}

function renderPage() {
  document.querySelectorAll<HTMLElement>("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t as Key)));
  document.querySelectorAll<HTMLElement>("[data-page]").forEach((el) => {
    el.classList.toggle("on", el.dataset.page === page);
    if (el.dataset.page === page) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  const head: Record<Page, [string, string]> = {
    cleaner: ["Discord Cleaner", t("subtitle")],
    settings: [t("nav_settings"), t("nav_settings_sub")],
    about: [t("nav_about"), t("nav_about_sub")],
  };
  title.textContent = head[page][0];
  subtitle.textContent = head[page][1];
  bar.hidden = true;
  if (page === "settings") {
    app.innerHTML = renderSettings();
    return;
  }
  if (page === "about") {
    app.innerHTML = renderAbout();
    return;
  }
  switch (view) {
    case "loading":
      app.innerHTML = `<div class="center"><div class="spinner"></div><p>${t("scanning")}</p></div>`;
      break;
    case "notfound":
      app.innerHTML = `<div class="center"><h2>${t("notfound_title")}</h2><p class="hint">${t("notfound_body", { path: "%LOCALAPPDATA%\\Discord" })}</p><button type="button" class="primary" data-action="rescan">${t("rescan")}</button></div>`;
      break;
    case "options":
      renderOptions();
      break;
    case "running":
      app.innerHTML = renderRunning();
      break;
    case "done":
      app.innerHTML = renderDone();
      break;
  }
}

// ---------------------------------------------------------------- actions

async function load() {
  view = "loading";
  render();
  scan = await invoke<Scan>("scan");
  if (!scan.root) {
    view = "notfound";
  } else {
    applyPreset(defaultPreset());
    view = "options";
  }
  render();
}

async function runPlan() {
  buildSteps();
  view = "running";
  render();
  const un = await listen<Progress>("progress", (ev) => {
    const s = steps.find((x) => x.id === ev.payload.step);
    if (s) {
      s.status = ev.payload.status;
      s.detail = ev.payload.status === "ok" ? "" : ev.payload.detail;
    }
    render();
  });
  try {
    report = await invoke<Report>("apply", { plan });
  } catch (e) {
    report = { freed: 0, warnings: [String(e)] };
  }
  un();
  scan = await invoke<Scan>("scan");
  view = "done";
  render();
}

const toggle = (list: string[], id: string, on: boolean) => (on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id));

document.addEventListener("change", (ev) => {
  const el = ev.target as HTMLInputElement;
  if (!(el instanceof HTMLInputElement) || view !== "options") return;
  const d = el.dataset;
  if (d.opt) (plan as unknown as Record<string, boolean>)[d.opt] = el.checked;
  else if (d.module) plan.modules = toggle(plan.modules, d.module, el.checked);
  else if (d.group) {
    const ids = removable()
      .filter((m) => groupOf(m.id) === d.group)
      .map((m) => m.id);
    plan.modules = el.checked ? [...new Set([...plan.modules, ...ids])] : plan.modules.filter((id) => !ids.includes(id));
  } else if (d.extra) plan.extras = toggle(plan.extras, d.extra, el.checked);
  else if (d.locale) plan.locales = toggle(plan.locales, d.locale, !el.checked);
  else return;
  if (d.opt === "updater" && el.checked) plan.shortcut = true;
  customize();
  render();
});

document.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-action],[data-preset],[data-page],[data-lang],[data-default],[data-modules]");
  if (!btn) return;
  const d = btn.dataset;
  if (d.page) {
    page = d.page as Page;
  } else if (d.lang) {
    setLang(d.lang as Lang);
  } else if (d.default) {
    store.set("profile", d.default);
  } else if (d.preset) {
    applyPreset(d.preset as Preset);
  } else if (d.modules) {
    plan.modules = removable()
      .filter((m) => d.modules === "all" || (d.modules === "safe" && MODULES[m.id]?.risk === "safe"))
      .map((m) => m.id);
    customize();
  } else {
    switch (d.action) {
      case "clean":
        renderReview();
        return;
      case "cancel":
        dialog.close();
        return;
      case "confirm":
        dialog.close();
        void runPlan();
        return;
      case "rescan":
        void load();
        return;
      case "launch":
        void invoke("launch", { exe: scan.latest_exe });
        return;
      case "github":
        void openUrl(REPO);
        return;
    }
  }
  render();
});

setLang(getLang());
void getVersion().then((v) => (version = v)).catch(() => {});
void load();
