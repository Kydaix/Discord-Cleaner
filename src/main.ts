import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { EXTRAS, MODULES, PRESETS, PROTECTED, UNKNOWN, type Entry, type PresetId } from "./catalog";
import { getLang, setLang, t, type Key } from "./i18n";

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

type View = "loading" | "notfound" | "options" | "running" | "done";
type Preset = PresetId | "custom";

let view: View = "loading";
let scan: Scan;
let plan: Plan;
let preset: Preset = "balanced";
let steps: { id: string; label: string; status?: Progress["status"]; detail?: string }[] = [];
let report: Report | null = null;

const app = document.getElementById("app")!;
const bar = document.getElementById("bar")!;
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

/** Locales worth keeping by default: Electron's fallback plus the system language. */
function defaultKeep(): Set<string> {
  const nav = navigator.language.toLowerCase();
  const primary = nav.split("-")[0];
  return new Set(scan.locales.map((l) => l.id).filter((id) => id === "en-US" || id.toLowerCase() === nav || id.toLowerCase().split("-")[0] === primary));
}

function applyPreset(p: PresetId) {
  const def = PRESETS[p];
  const keep = defaultKeep();
  preset = p;
  plan = {
    helper: true,
    run_entries: true,
    updater: def.updater && scan.updater.paths.length > 0,
    modules: scan.modules.filter((m) => MODULES[m.id] && def.risks.includes(MODULES[m.id].risk)).map((m) => m.id),
    locales: def.trimLocales ? scan.locales.filter((l) => !keep.has(l.id)).map((l) => l.id) : [],
    extras: scan.extras.filter((x) => def.risks.includes(EXTRAS[x.id].risk)).map((x) => x.id),
    autostart: scan.run_entries.length > 0,
    shortcut: true,
  };
}

function reclaimable(): number {
  const pick = (items: Item[], ids: string[]) => items.filter((i) => ids.includes(i.id)).reduce((s, i) => s + i.bytes, 0);
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

function risk(r: Entry["risk"]) {
  return `<span class="chip risk-${r}">${t(`risk_${r}` as Key)}</span>`;
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
      <input type="checkbox" ${r.attr} ${r.checked ? "checked" : ""} ${r.disabled ? "disabled" : ""}>
      <span></span>
    </label>
    <details>
      <summary>
        <span class="row-title">${esc(r.title)}</span>
        ${r.meta ? `<span class="meta">${esc(r.meta)}</span>` : ""}
        ${r.risk ? risk(r.risk) : ""}
        ${r.bytes !== undefined ? `<span class="size">${fmt(r.bytes)}</span>` : ""}
        <span class="caret" aria-hidden="true"></span>
      </summary>
      <div class="row-body">
        <p><b>${t("details_what")}</b> ${esc(r.what)}</p>
        <p><b>${t("details_effect")}</b> ${esc(r.effect)}</p>
      </div>
    </details>
  </div>`;
}

function section(title: Key, hint: Key, body: string, note = ""): string {
  return `<section class="card">
    <header><h2>${t(title)}</h2><p class="hint">${t(hint)}</p></header>
    ${note}
    <div class="rows">${body}</div>
  </section>`;
}

function renderStatus(): string {
  const running = scan.running;
  const autostart = scan.run_entries.length > 0;
  const svc = t(`service_${scan.service}` as Key);
  return `<section class="card status">
    <header><h2>${t("status_title")}</h2></header>
    <dl>
      <dt>${t("status_path")}</dt><dd class="mono">${esc(scan.root ?? "")}</dd>
      <dt>${t("status_versions")}</dt><dd>${scan.versions.map((v, i) => `<span class="chip${i === 0 ? " chip-accent" : ""}">${esc(v)}${i === 0 ? ` · ${t("status_latest")}` : ""}</span>`).join(" ") || "—"}</dd>
      <dt>Discord</dt><dd><span class="dot ${running ? "dot-warn" : "dot-ok"}"></span>${running ? `${t("status_running")} <span class="hint">(${t("status_running_hint")})</span>` : t("status_closed")}</dd>
      <dt>${t("status_service")}</dt><dd><span class="dot ${scan.service === "running" ? "dot-warn" : "dot-ok"}"></span>${svc}</dd>
      <dt>${t("status_autostart")}</dt><dd>${autostart ? t("yes") : t("no")}</dd>
    </dl>
  </section>`;
}

function renderPresets(): string {
  const ids: Preset[] = ["minimal", "balanced", "aggressive", "custom"];
  return `<section class="card presets">
    <header><h2>${t("presets")}</h2></header>
    <div class="seg" role="radiogroup">
      ${ids.map((p) => `<button type="button" role="radio" aria-checked="${p === preset}" class="${p === preset ? "on" : ""}" ${p === "custom" ? "disabled" : `data-preset="${p}"`}>${t(`preset_${p}` as Key)}</button>`).join("")}
    </div>
    <p class="hint">${t(`preset_${preset}_hint` as Key)}</p>
  </section>`;
}

function renderOptions() {
  const has = (items: Item[]) => items.length > 0;
  const background = [
    row({ attr: 'data-opt="helper"', checked: plan.helper, title: t("helper_title"), what: t("helper_what"), effect: t("helper_effect"), risk: "safe", meta: scan.service === "absent" && scan.helper_exes.length === 0 ? t("service_absent") : t("helper_found", { n: scan.helper_exes.length }) }),
    row({ attr: 'data-opt="run_entries"', checked: plan.run_entries, title: t("run_title"), what: t("run_what"), effect: t("run_effect"), risk: "safe", meta: t("run_found", { n: scan.run_entries.length }) }),
    row({ attr: 'data-opt="autostart"', checked: plan.autostart, title: t("autostart_title"), what: t("autostart_what"), effect: t("autostart_effect"), disabled: !scan.latest_exe }),
  ].join("");

  const updates = [
    row({ attr: 'data-opt="updater"', checked: plan.updater, title: t("updater_title"), what: t("updater_what"), effect: t("updater_effect"), risk: "moderate", bytes: scan.updater.bytes, disabled: scan.updater.paths.length === 0 }),
    row({ attr: 'data-opt="shortcut"', checked: plan.shortcut || plan.updater, title: t("shortcut_title"), what: t("shortcut_what"), effect: t("shortcut_effect"), disabled: plan.updater || !scan.latest_exe }),
  ].join("");

  const modules = scan.modules
    .filter((m) => !PROTECTED.includes(m.id))
    .sort((a, b) => b.bytes - a.bytes)
    .map((m) => {
      const e = moduleEntry(m.id);
      return row({ attr: `data-module="${esc(m.id)}"`, checked: plan.modules.includes(m.id), title: info(e).title, what: info(e).what, effect: info(e).effect, risk: e.risk, bytes: m.bytes, meta: m.id });
    })
    .join("");
  const kept = scan.modules.filter((m) => PROTECTED.includes(m.id)).map((m) => m.id);
  const modulesNote = (plan.updater || plan.modules.length === 0 ? "" : `<p class="note">${t("modules_comeback")}</p>`) + (kept.length ? `<p class="hint">${t("modules_protected", { list: kept.join(", ") })}</p>` : "");

  const locales = `<div class="locales">${scan.locales
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((l) => {
      const req = l.id === "en-US";
      const keep = req || !plan.locales.includes(l.id);
      return `<label class="loc${keep ? " on" : ""}"><input type="checkbox" data-locale="${esc(l.id)}" ${keep ? "checked" : ""} ${req ? "disabled" : ""}><span>${esc(l.id)}</span><small>${req ? t("locales_required") : fmt(l.bytes)}</small></label>`;
    })
    .join("")}</div>`;

  const extras = scan.extras
    .map((x) => {
      const e = EXTRAS[x.id];
      return row({ attr: `data-extra="${esc(x.id)}"`, checked: plan.extras.includes(x.id), title: info(e).title, what: info(e).what, effect: info(e).effect, risk: e.risk, bytes: x.bytes });
    })
    .join("");

  app.innerHTML = renderStatus() + renderPresets() + section("sec_background", "sec_background_hint", background) + section("sec_updates", "sec_updates_hint", updates) + (has(scan.modules) ? section("sec_modules", "sec_modules_hint", modules, modulesNote) : "") + (has(scan.locales) ? section("sec_locales", "sec_locales_hint", locales) : "") + (has(scan.extras) ? section("sec_extras", "sec_extras_hint", extras) : "");

  bar.hidden = false;
  bar.innerHTML = `<div><strong>${t("bar_reclaim", { size: fmt(reclaimable()) })}</strong><span class="hint"> · ${t("bar_actions", { n: actionCount() })}</span></div>
    <button type="button" class="primary" data-action="clean" ${actionCount() === 0 ? "disabled" : ""}>${t("clean")}</button>`;
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
  dialog.innerHTML = `<h2>${t("review_title")}</h2>
    <p class="hint">${t("review_body")}</p>
    <ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    <p><strong>${t("bar_reclaim", { size: fmt(reclaimable()) })}</strong></p>
    <div class="actions"><button type="button" data-action="cancel">${t("cancel")}</button><button type="button" class="primary" data-action="confirm">${t("confirm")}</button></div>`;
  dialog.showModal();
}

function renderRunning() {
  bar.hidden = true;
  app.innerHTML = `<section class="card"><header><h2>${t("running_title")}</h2></header>
    <ul class="steps">${steps.map((s) => `<li class="${s.status ?? "pending"}"><span class="dot"></span><span>${esc(s.label)}</span>${s.detail ? `<small class="mono">${esc(s.detail)}</small>` : ""}</li>`).join("")}</ul></section>`;
}

function renderDone() {
  bar.hidden = true;
  app.innerHTML = `<section class="card done">
    <header><h2>${t("done_title")}</h2></header>
    <p class="big">${t("done_freed", { size: fmt(report!.freed) })}</p>
    ${report!.warnings.length ? `<p class="note">${t("done_warnings")}</p><ul class="warnings mono">${report!.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
    <p class="hint">${t("done_note")}</p>
    <div class="actions">
      <button type="button" data-action="rescan">${t("rescan")}</button>
      ${scan.latest_exe ? `<button type="button" class="primary" data-action="launch">${t("launch")}</button>` : ""}
    </div>
  </section>`;
}

function render() {
  document.getElementById("tagline")!.textContent = t("tagline");
  document.getElementById("lang")!.textContent = t("lang_switch");
  document.getElementById("gh")!.textContent = t("github");
  switch (view) {
    case "loading":
      bar.hidden = true;
      app.innerHTML = `<div class="center"><div class="spinner"></div><p>${t("scanning")}</p></div>`;
      break;
    case "notfound":
      bar.hidden = true;
      app.innerHTML = `<section class="card center"><h2>${t("notfound_title")}</h2><p class="hint">${t("notfound_body", { path: "%LOCALAPPDATA%\\Discord" })}</p><button type="button" class="primary" data-action="rescan">${t("rescan")}</button></section>`;
      break;
    case "options":
      renderOptions();
      break;
    case "running":
      renderRunning();
      break;
    case "done":
      renderDone();
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
    applyPreset("balanced");
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
  else if (d.extra) plan.extras = toggle(plan.extras, d.extra, el.checked);
  else if (d.locale) plan.locales = toggle(plan.locales, d.locale, !el.checked);
  else return;
  if (d.opt === "updater" && el.checked) plan.shortcut = true;
  preset = "custom";
  render();
});

document.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-action],[data-preset]");
  if (!btn) return;
  if (btn.dataset.preset) {
    applyPreset(btn.dataset.preset as PresetId);
    render();
    return;
  }
  switch (btn.dataset.action) {
    case "clean":
      renderReview();
      break;
    case "cancel":
      dialog.close();
      break;
    case "confirm":
      dialog.close();
      void runPlan();
      break;
    case "rescan":
      void load();
      break;
    case "launch":
      void invoke("launch", { exe: scan.latest_exe });
      break;
    case "github":
      void openUrl(REPO);
      break;
    case "lang":
      setLang(getLang() === "en" ? "fr" : "en");
      render();
      break;
  }
});

setLang(getLang());
void load();
