// Foundry Character Vault – static viewer for exported Actor snapshots (dnd5e-first).
// Zero server, zero listeners, maximum vibes.

const MANIFEST_URL = "./data/manifest.json";
const LOCAL_PORTRAIT_DIR = "./data/portraits";
const LOCAL_PORTRAIT_SUFFIX = "-img";
const LOCAL_PORTRAIT_EXTS = ["webp", "png", "jpg", "jpeg", "avif"];
const DEFAULT_AVATAR = "https://dummyimage.com/160x160/111827/ffffff&text=%E2%98%85";
const portraitUrlCache = new Map();

const $ = (sel) => document.querySelector(sel);

const rosterEl = $("#roster");
const sheetEl = $("#sheet");
const statusEl = $("#status");
const searchEl = $("#search");

const refreshBtn = $("#refresh");

let allPayloads = [];  // [{id, name, meta, payload, corpus}]
let selectedId = null;

// ----------------------------
// small utils
// ----------------------------
function safeText(s) { return (s ?? "").toString(); }
function norm(s) { return safeText(s).toLowerCase().trim(); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function fmtSigned(n) {
  const x = Number(n ?? 0);
  return (x >= 0 ? `+${x}` : `${x}`);
}

function tryNum(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "number" && Number.isFinite(x)) return x;
  const s = safeText(x).trim();
  if (!s) return null;
  // accept "+2", "-1", "2"
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Number(s);
  return null;
}

function parseBonusString(x) {
  const n = tryNum(x);
  return Number.isFinite(n) ? n : 0;
}

function guessSystem(payload) {
  return payload?.systemId || payload?.actor?.system?.id || payload?.actor?.systemId || "unknown";
}

function actorFromPayload(payload) {
  return payload?.actor || payload?.data?.actor || payload?.document || payload;
}

function resolveItemNameById(actor, id, preferredTypes = []) {
  const wantedId = safeText(id).trim();
  if (!wantedId) return "";
  const items = actor?.items || [];

  const typeMatch = items.find((it) =>
    safeText(it?._id).trim() === wantedId &&
    (!preferredTypes.length || preferredTypes.includes(it?.type))
  );
  if (typeMatch?.name) return safeText(typeMatch.name).trim();

  const anyMatch = items.find((it) => safeText(it?._id).trim() === wantedId);
  if (anyMatch?.name) return safeText(anyMatch.name).trim();

  return "";
}

function detailLabel(actor, value, preferredTypes = []) {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return "";
    const fromItem = resolveItemNameById(actor, raw, preferredTypes);
    return fromItem || raw;
  }

  if (typeof value === "object") {
    const explicit = safeText(value?.name || value?.label).trim();
    if (explicit) return explicit;
    const refId = safeText(value?._id || value?.id || value?.uuid).trim();
    if (refId) {
      const fromItem = resolveItemNameById(actor, refId, preferredTypes);
      return fromItem || refId;
    }
    return "";
  }

  return safeText(value).trim();
}

function slugName(name) {
  return safeText(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function wordsName(name) {
  return safeText(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function portraitBases(actorName) {
  const raw = safeText(actorName).trim();
  const rawLower = raw.toLowerCase();
  const words = wordsName(raw);
  const slug = words.replace(/\s+/g, "-");
  const bases = [];
  if (raw) bases.push(`${raw}${LOCAL_PORTRAIT_SUFFIX}`);
  if (rawLower && rawLower !== raw) bases.push(`${rawLower}${LOCAL_PORTRAIT_SUFFIX}`);
  if (words && words !== rawLower) bases.push(`${words}${LOCAL_PORTRAIT_SUFFIX}`);
  if (slug) bases.push(`${slug}${LOCAL_PORTRAIT_SUFFIX}`);
  return [...new Set(bases)];
}

function canLoadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function resolveLocalPortrait(actorName) {
  const key = safeText(actorName).trim();
  if (!key) return null;
  if (portraitUrlCache.has(key)) return portraitUrlCache.get(key);

  for (const base of portraitBases(key)) {
    const encBase = encodeURIComponent(base);
    for (const ext of LOCAL_PORTRAIT_EXTS) {
      const url = `${LOCAL_PORTRAIT_DIR}/${encBase}.${ext}`;
      // eslint-disable-next-line no-await-in-loop
      if (await canLoadImage(url)) {
        portraitUrlCache.set(key, url);
        return url;
      }
    }
  }

  portraitUrlCache.set(key, null);
  return null;
}

function actorImageUrl(payload, actor) {
  return payload?.__portrait || actor?.img || DEFAULT_AVATAR;
}

function setStatus(msg) { statusEl.textContent = msg; }

function clearSheet() {
  sheetEl.innerHTML = `<div class="text-slate-300">Select a character.</div>`;
}

function pill(text) {
  const tpl = $("#pillTpl");
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.textContent = text;
  return node;
}

function section(title, bodyNode, sectionId = "") {
  const wrap = document.createElement("div");
  wrap.className = "rounded-3xl bg-white/5 border border-white/10 overflow-hidden";
  if (sectionId) wrap.id = sectionId;

  const head = document.createElement("button");
  head.className = "w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition";
  head.innerHTML = `<div class="font-semibold">${title}</div><div class="text-slate-400 text-sm">toggle</div>`;

  const body = document.createElement("div");
  body.className = "px-4 pb-4";
  body.appendChild(bodyNode);

  let open = true;
  head.addEventListener("click", () => {
    open = !open;
    body.style.display = open ? "block" : "none";
  });

  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

function makeAnchorId(prefix, label) {
  const base = safeText(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${prefix}-${base || "section"}`;
}

function quickAccessNav(items) {
  const nav = document.createElement("nav");
  nav.className = "order-first xl:order-last sticky top-3 z-30 xl:top-4 xl:self-start w-full xl:w-auto flex flex-col gap-2 rounded-2xl bg-slate-950/75 border border-white/10 p-2 shadow-soft";
  nav.setAttribute("aria-label", "Quick section access");
  nav.dataset.expanded = "0";

  const top = document.createElement("div");
  top.className = "flex items-center gap-2";

  const title = document.createElement("div");
  title.className = "px-1 text-[11px] uppercase tracking-wide text-slate-300";
  title.textContent = "Quick Access Bar";
  top.appendChild(title);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ml-auto rounded-xl px-2 py-1 text-xs text-slate-100 border border-white/10 hover:bg-white/10 transition";
  toggle.textContent = "Open";
  toggle.setAttribute("aria-expanded", "false");
  top.appendChild(toggle);
  nav.appendChild(top);

  const list = document.createElement("div");
  list.className = "hidden flex-col gap-2";

  for (const it of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "text-left whitespace-nowrap rounded-xl px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition border border-white/10";
    btn.textContent = it.label;
    btn.addEventListener("click", () => {
      const target = document.getElementById(it.id);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      setExpanded(false);
    });
    list.appendChild(btn);
  }
  nav.appendChild(list);

  const setExpanded = (expanded) => {
    nav.dataset.expanded = expanded ? "1" : "0";
    toggle.textContent = expanded ? "Close" : "Open";
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    list.style.display = expanded ? "flex" : "none";
  };

  toggle.addEventListener("click", () => {
    setExpanded(nav.dataset.expanded !== "1");
  });

  // Default state: collapsed.
  setExpanded(false);

  return nav;
}

function kvGrid(rows) {
  const grid = document.createElement("div");
  grid.className = "grid grid-cols-2 md:grid-cols-3 gap-2";

  for (const [k, v] of rows) {
    const card = document.createElement("div");
    card.className = "rounded-2xl bg-slate-950/40 border border-white/10 px-3 py-2";
    card.innerHTML = `<div class="text-xs text-slate-400">${k}</div><div class="font-semibold">${v}</div>`;
    grid.appendChild(card);
  }
  return grid;
}

function htmlTextContent(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = safeText(html);
  return safeText(tmp.textContent).replace(/\s+/g, " ").trim();
}

function itemDescriptionHtml(item) {
  const desc = item?.system?.description;
  if (typeof desc?.value === "string") return desc.value.trim();
  if (typeof desc === "string") return desc.trim();
  return "";
}

function listCards(items, subtitleFn, options = {}) {
  const wrap = document.createElement("div");
  wrap.className = "grid grid-cols-1 md:grid-cols-2 gap-2";
  const explicitDescriptionFn = typeof options?.descriptionFn === "function" ? options.descriptionFn : null;

  for (const it of items) {
    const card = document.createElement("div");
    const title = safeText(it?.name || "Unnamed");
    const sub = subtitleFn ? subtitleFn(it) : "";
    const hasDescriptionField = Boolean(it?.system) && Object.prototype.hasOwnProperty.call(it.system, "description");
    const descriptionFn = explicitDescriptionFn || (hasDescriptionField ? itemDescriptionHtml : null);

    if (!descriptionFn) {
      card.className = "rounded-2xl bg-slate-950/40 border border-white/10 p-3";
      card.innerHTML = `<div class="font-medium">${title}</div>${sub ? `<div class="text-xs text-slate-400 mt-1">${sub}</div>` : ""}`;
      wrap.appendChild(card);
      continue;
    }

    card.className = "rounded-2xl bg-slate-950/40 border border-white/10 overflow-hidden";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "w-full text-left px-3 py-3 hover:bg-white/5 transition";
    header.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="font-medium">${title}</div>
          ${sub ? `<div class="text-xs text-slate-400 mt-1">${sub}</div>` : ""}
          <div class="text-[11px] text-slate-500 mt-1">Click for description</div>
        </div>
        <div class="shrink-0 text-xs text-slate-400" data-role="state">Show</div>
      </div>
    `;

    const rawDescription = safeText(descriptionFn(it)).trim();
    const hasDescription = htmlTextContent(rawDescription).length > 0;

    const body = document.createElement("div");
    body.className = "px-3 pb-3 border-t border-white/10";
    body.style.display = "none";

    const desc = document.createElement("div");
    desc.className = "prose prose-invert max-w-none text-slate-200/90 prose-sm";
    desc.innerHTML = hasDescription ? rawDescription : "<em>No description exported.</em>";
    body.appendChild(desc);

    const state = header.querySelector("[data-role='state']");
    let open = false;
    header.addEventListener("click", () => {
      open = !open;
      body.style.display = open ? "block" : "none";
      if (state) state.textContent = open ? "Hide" : "Show";
    });

    card.appendChild(header);
    card.appendChild(body);
    wrap.appendChild(card);
  }
  return wrap;
}

// ----------------------------
// dnd5e maths
// ----------------------------
function abilityMod(score) {
  const s = Number(score ?? 0);
  if (!Number.isFinite(s)) return 0;
  return Math.floor((s - 10) / 2);
}

function getClassLevel(actor) {
  const items = actor?.items || [];
  const classes = items.filter(i => i?.type === "class");
  const fromClasses = classes.reduce((a, c) => a + Number(c?.system?.levels ?? 0), 0);
  const fromDetails = Number(actor?.system?.details?.level ?? 0);
  return (fromClasses || fromDetails || 0);
}

function profBonusFromLevel(level) {
  const lvl = Math.max(1, Number(level || 1));
  return 2 + Math.floor((lvl - 1) / 4);
}

function getProfBonus(actor) {
  const sys = actor?.system || {};
  const direct = tryNum(sys?.attributes?.prof);
  if (Number.isFinite(direct)) return direct;
  return profBonusFromLevel(getClassLevel(actor));
}

function getAbilities(actor) {
  const abilities = actor?.system?.abilities || {};
  const out = {};
  for (const k of ["str","dex","con","int","wis","cha"]) {
    const score = tryNum(abilities?.[k]?.value) ?? 0;
    const mod = tryNum(abilities?.[k]?.mod);
    out[k] = {
      score,
      mod: Number.isFinite(mod) ? mod : abilityMod(score),
      label: safeText(abilities?.[k]?.label || k.toUpperCase()),
    };
  }
  return out;
}

function getAllEffects(actor) {
  const effects = [];
  const actorEffects = actor?.effects || [];
  for (const e of actorEffects) if (e && !e.disabled) effects.push(e);

  const items = actor?.items || [];
  for (const it of items) {
    const ie = it?.effects || [];
    for (const e of ie) {
      if (!e || e.disabled) continue;
      // for item effects, transfer false usually means "not applied to actor"
      if (e.transfer === false) continue;
      effects.push(e);
    }
  }
  return effects;
}

function titleCaseWords(s) {
  return safeText(s).replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

function normaliseStatuses(effect) {
  const raw = effect?.statuses;
  if (Array.isArray(raw)) {
    const bits = raw.map((x) => safeText(x).trim()).filter(Boolean);
    if (!bits.length) return [];
    // Some exports serialise a single status string as char array.
    const merged = bits.every((x) => x.length === 1) ? [bits.join("")] : bits;
    return merged
      .map((x) => titleCaseWords(x.replace(/[-_]+/g, " ").trim()))
      .filter(Boolean);
  }
  const one = safeText(raw).trim();
  if (!one) return [];
  return [titleCaseWords(one.replace(/[-_]+/g, " ").trim())];
}

function effectDisposition(effect) {
  const auraHostile = effect?.flags?.ActiveAuras?.hostile;
  if (typeof auraHostile === "boolean") return auraHostile ? "hostile" : "friendly";

  if (typeof effect?.hostile === "boolean") return effect.hostile ? "hostile" : "friendly";
  if (typeof effect?.friendly === "boolean") return effect.friendly ? "friendly" : "hostile";

  const auraDisposition = tryNum(effect?.flags?.ActiveAuras?.disposition);
  if (Number.isFinite(auraDisposition) && auraDisposition !== 0) return auraDisposition > 0 ? "friendly" : "hostile";

  const disposition = tryNum(effect?.disposition);
  if (Number.isFinite(disposition) && disposition !== 0) return disposition > 0 ? "friendly" : "hostile";

  return "";
}

function formatEffectDuration(effect, disposition) {
  // Duration is shown only for explicitly-marked friendly effects.
  if (disposition !== "friendly") return "";
  const d = effect?.duration || {};
  const rounds = tryNum(d?.rounds);
  const turns = tryNum(d?.turns);
  const seconds = tryNum(d?.seconds);

  const parts = [];
  if (Number.isFinite(rounds) && rounds > 0) parts.push(`${rounds} round${rounds === 1 ? "" : "s"}`);
  if (Number.isFinite(turns) && turns > 0) parts.push(`${turns} turn${turns === 1 ? "" : "s"}`);
  if (Number.isFinite(seconds) && seconds > 0) {
    if (seconds >= 60 && seconds % 60 === 0) {
      const mins = seconds / 60;
      parts.push(`${mins} min${mins === 1 ? "" : "s"}`);
    } else {
      parts.push(`${seconds}s`);
    }
  }

  return parts.join(", ");
}

function collectDisplayEffects(actor) {
  const out = [];
  const items = actor?.items || [];
  const itemById = new Map(items.map((it) => [safeText(it?._id), it]));

  const originItemType = (effect) => {
    const origin = safeText(effect?.origin);
    const m = origin.match(/Item\.([A-Za-z0-9]+)/);
    if (!m) return "";
    return safeText(itemById.get(m[1])?.type);
  };

  const actorEffects = actor?.effects || [];
  for (const e of actorEffects) {
    if (!e || e.disabled) continue;
    if (originItemType(e) === "spell") continue;
    out.push({ effect: e, source: "Actor" });
  }

  for (const it of items) {
    if (it?.type === "spell") continue;
    const ie = it?.effects || [];
    for (const e of ie) {
      if (!e || e.disabled) continue;
      if (e.transfer === false) continue;
      out.push({ effect: e, source: safeText(it?.name || "Item") });
    }
  }

  return out
    .map(({ effect, source }) => {
      const name = safeText(effect?.name || "Unnamed Effect");
      const statuses = normaliseStatuses(effect);
      const disposition = effectDisposition(effect);
      const duration = formatEffectDuration(effect, disposition);

      const bits = [];
      if (source !== "Actor") bits.push(`source ${source}`);
      if (statuses.length) bits.push(`status ${statuses.join(", ")}`);
      if (disposition) bits.push(disposition);
      if (duration) bits.push(`duration ${duration}`);

      return { name, meta: bits.join(" • ") };
    })
    .sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)));
}

function renderActiveEffects(actor) {
  const effects = collectDisplayEffects(actor);
  if (!effects.length) return document.createTextNode("No active effects in export.");
  return listCards(effects, (e) => e.meta);
}

const MODE_CUSTOM = 0;
const MODE_MULTIPLY = 1;
const MODE_ADD = 2;
const MODE_DOWNGRADE = 3;
const MODE_UPGRADE = 4;
const MODE_OVERRIDE = 5;

function isTruthyEffectValue(raw) {
  const n = tryNum(raw);
  if (Number.isFinite(n)) return n !== 0;
  const s = norm(raw);
  return s === "true" || s === "yes" || s === "on";
}

function applyNumericEffectMode(current, value, mode) {
  const curr = Number.isFinite(current) ? Number(current) : 0;
  const val = Number(value);
  if (!Number.isFinite(val)) return curr;

  if (mode === MODE_ADD) return curr + val;
  if (mode === MODE_MULTIPLY) return curr * val;
  if (mode === MODE_DOWNGRADE) return Math.min(curr, val);
  if (mode === MODE_UPGRADE) return Math.max(curr, val);
  // Foundry "CUSTOM" (0) commonly acts as set for simple numeric exports.
  if (mode === MODE_CUSTOM || mode === MODE_OVERRIDE) return val;
  return curr;
}

function computeMovement(actor) {
  const out = {};
  const keys = ["walk", "burrow", "climb", "fly", "swim"];
  const movement = actor?.system?.attributes?.movement || {};
  for (const k of keys) out[k] = tryNum(movement?.[k]) ?? 0;

  const effects = getAllEffects(actor);
  for (const ef of effects) {
    const changes = ef?.changes || [];
    for (const ch of changes) {
      const key = safeText(ch?.key).toLowerCase();
      if (!key.startsWith("system.attributes.movement.")) continue;
      const val = tryNum(ch?.value);
      if (!Number.isFinite(val)) continue;
      const mode = Number(ch?.mode ?? MODE_CUSTOM);

      if (key === "system.attributes.movement.all") {
        for (const k of keys) out[k] = applyNumericEffectMode(out[k], val, mode);
        continue;
      }

      const m = key.match(/^system\.attributes\.movement\.(walk|burrow|climb|fly|swim)$/);
      if (!m) continue;
      out[m[1]] = applyNumericEffectMode(out[m[1]], val, mode);
    }
  }

  for (const k of keys) out[k] = Math.max(0, Number(out[k]) || 0);
  return out;
}

function formatMovement(movement) {
  const order = ["walk", "burrow", "climb", "fly", "swim"];
  const bits = [];
  for (const k of order) {
    const v = tryNum(movement?.[k]);
    if (!Number.isFinite(v)) continue;
    if (v <= 0 && k !== "walk") continue;
    bits.push(`${k} ${v}`);
  }
  return bits.join(", ") || "–";
}

function computeSenses(actor) {
  const keys = ["darkvision", "blindsight", "tremorsense", "truesight"];
  const senses = actor?.system?.attributes?.senses || {};
  const out = {};
  for (const k of keys) out[k] = tryNum(senses?.[k]) ?? 0;

  const effects = getAllEffects(actor);
  for (const ef of effects) {
    const changes = ef?.changes || [];
    for (const ch of changes) {
      const key = safeText(ch?.key).toLowerCase();
      const m = key.match(/^system\.attributes\.senses\.(darkvision|blindsight|tremorsense|truesight)$/);
      if (!m) continue;

      const val = tryNum(ch?.value);
      if (!Number.isFinite(val)) continue;
      const mode = Number(ch?.mode ?? MODE_CUSTOM);
      const senseKey = m[1];
      out[senseKey] = applyNumericEffectMode(out[senseKey], val, mode);
    }
  }

  for (const k of keys) out[k] = Math.max(0, Number(out[k]) || 0);
  return out;
}

function formatSenses(senses, special) {
  const labels = {
    darkvision: "Darkvision",
    blindsight: "Blindsight",
    tremorsense: "Tremorsense",
    truesight: "Truesight"
  };

  const bits = [];
  for (const k of Object.keys(labels)) {
    const v = tryNum(senses?.[k]);
    if (Number.isFinite(v) && v > 0) bits.push(`${labels[k]} ${v}`);
  }

  const specialText = safeText(special).trim();
  if (specialText) bits.push(specialText);

  return bits.join(", ") || "–";
}

function pct(part, total) {
  const t = Number(total || 0);
  const p = Number(part || 0);
  if (!Number.isFinite(t) || t <= 0) return 0;
  if (!Number.isFinite(p) || p <= 0) return 0;
  return clamp((p / t) * 100, 0, 100);
}

function renderResourceBarHtml({ current, max, label, fillClass, bgClass = "bg-slate-800/70", extraFillHtml = "" }) {
  const p = pct(current, max);
  const c = Number.isFinite(Number(current)) ? Number(current) : 0;
  const m = Number.isFinite(Number(max)) ? Number(max) : 0;

  return `
    <div class="space-y-1">
      <div class="flex items-center text-xs text-slate-300">
        <span>${safeText(label || "")}</span>
        <span class="ml-auto text-slate-400">${c}/${m}</span>
      </div>
      <div class="relative h-2.5 rounded-full ${bgClass} overflow-hidden border border-white/10">
        <div class="absolute inset-y-0 left-0 ${fillClass}" style="width:${p}%;"></div>
        ${extraFillHtml}
      </div>
    </div>
  `;
}

function getHitDiceSummary(actor) {
  const classes = (actor?.items || []).filter((i) => i?.type === "class");
  let total = 0;
  let used = 0;
  const breakdown = [];

  for (const c of classes) {
    const levels = Math.max(0, Number(tryNum(c?.system?.levels) ?? 0));
    if (levels <= 0) continue;
    total += levels;

    const spentRaw = Math.max(0, Number(tryNum(c?.system?.hd?.spent) ?? 0));
    used += Math.min(levels, spentRaw);

    const die = safeText(c?.system?.hd?.denomination).trim();
    if (die) breakdown.push(`${levels}${die}`);
  }

  const usedSafe = Math.min(used, total);
  const unused = Math.max(0, total - usedSafe);
  return { total, used: usedSafe, unused, breakdown: breakdown.join(" + ") };
}

function renderHitPointsValue(hp) {
  const max = Math.max(0, Number(tryNum(hp?.max) ?? 0));
  const value = clamp(Number(tryNum(hp?.value) ?? 0), 0, Math.max(max, 0));
  const temp = Math.max(0, Number(tryNum(hp?.temp) ?? 0));

  // Temp HP is rendered as a blue cap segment after normal HP.
  const totalForBar = Math.max(1, max + temp);
  const tempPct = pct(temp, totalForBar);
  const normalLabel = temp > 0 ? `${value}/${max} (+${temp} temp)` : `${value}/${max}`;

  const extraFillHtml = temp > 0
    ? `<div class="absolute inset-y-0 bg-sky-400/90" style="left:${pct(value, totalForBar)}%;width:${tempPct}%;"></div>`
    : "";

  return renderResourceBarHtml({
    current: value,
    max: totalForBar,
    label: normalLabel,
    fillClass: "bg-emerald-500/90",
    extraFillHtml
  });
}

function renderHitDiceValue(actor) {
  const hd = getHitDiceSummary(actor);
  if (hd.total <= 0) return "–";

  const label = `${hd.unused} unused / ${hd.used} used${hd.breakdown ? ` (${hd.breakdown})` : ""}`;
  return renderResourceBarHtml({
    current: hd.unused,
    max: hd.total,
    label,
    fillClass: "bg-rose-500/90"
  });
}

// Pull only numeric changes that we can safely apply offline.
function extractACAdjustments(actor) {
  const adj = {
    valueAdd: 0, valueOverride: null,
    flatOverride: null,
    bonusAdd: 0, bonusOverride: null,
    armorAdd: 0, armorOverride: null,
    baseAdd: 0, baseOverride: null,
    dexAdd: 0, dexOverride: null,
    shieldAdd: 0, shieldOverride: null,
  };

  const effects = getAllEffects(actor);

  for (const ef of effects) {
    const changes = ef?.changes || [];
    for (const ch of changes) {
      const key = safeText(ch?.key);
      const mode = Number(ch?.mode ?? 0);

      // We only trust plain numbers here.
      const val = tryNum(ch?.value);
      if (!Number.isFinite(val)) continue;

      const apply = (field) => {
        if (mode === MODE_OVERRIDE) adj[field + "Override"] = val;
        else if (mode === MODE_ADD) adj[field + "Add"] += val;
      };

      if (key === "system.attributes.ac.value") apply("value");
      else if (key === "system.attributes.ac.flat") adj.flatOverride = (mode === MODE_OVERRIDE ? val : (adj.flatOverride ?? 0) + val);
      else if (key === "system.attributes.ac.bonus") apply("bonus");
      else if (key === "system.attributes.ac.armor") apply("armor");
      else if (key === "system.attributes.ac.base") apply("base");
      else if (key === "system.attributes.ac.dex") apply("dex");
      else if (key === "system.attributes.ac.shield") apply("shield");
    }
  }
  return adj;
}

function isEquipped(it) {
  return Boolean(it?.system?.equipped);
}

function isShield(it) {
  const t = it?.system?.type?.value || it?.system?.type?.baseItem;
  return t === "shield" || norm(it?.name) === "shield";
}

function getACArmorParts(actor) {
  const items = actor?.items || [];

  let bestArmor = null; // {base, magical, dexCap}
  let shieldTotal = 0;

  for (const it of items) {
    if (it?.type !== "equipment") continue;
    if (!isEquipped(it)) continue;

    const armor = it?.system?.armor || {};
    const base = tryNum(armor?.value);
    if (!Number.isFinite(base)) continue;

    const magical = tryNum(armor?.magicalBonus) ?? tryNum(it?.system?.magicalBonus) ?? 0;
    const dexCap = (armor?.dex === null || armor?.dex === undefined) ? null : tryNum(armor?.dex);

    if (isShield(it)) {
      shieldTotal += (base + (magical || 0));
    } else {
      const candidate = { base: base + (magical || 0), dexCap };
      if (!bestArmor || candidate.base > bestArmor.base) bestArmor = candidate;
    }
  }

  return {
    armorBase: bestArmor ? bestArmor.base : 10,
    armorDexCap: bestArmor ? bestArmor.dexCap : null,
    shieldTotal
  };
}

// Safe-ish evaluation for Foundry-style formulas after token substitution.
// Supports min/max/floor/ceil/round. Any leftover @tokens become 0 (so custom AC never silently "disappears").
function evalFormula(formula, ctx) {
  let expr = safeText(formula).trim();
  if (!expr) return null;

  // Replace Foundry-style @paths directly from the provided context.
  // Unknown @paths become 0 – but we treat "all tokens became 0" as a failed evaluation later.
  let replacedAny = false;
  expr = expr.replace(/@[A-Za-z0-9_.]+/g, (m) => {
    replacedAny = true;
    const v = Number(ctx?.[m] ?? ctx?.[m.toLowerCase()] ?? 0);
    return String(Number.isFinite(v) ? v : 0);
  });

  // Normalise common helpers.
  expr = expr
    .replace(/\bmin\s*\(/gi, "Math.min(")
    .replace(/\bmax\s*\(/gi, "Math.max(")
    .replace(/\bfloor\s*\(/gi, "Math.floor(")
    .replace(/\bceil\s*\(/gi, "Math.ceil(")
    .replace(/\bround\s*\(/gi, "Math.round(");

  // If any non-finite placeholders crept in, zero them out.
  expr = expr.replace(/\bundefined\b|\bnull\b|\bNaN\b/gi, "0");

  // Reject anything that looks like code injection.
  if (/[;{}[\]=:'"\\<>?`]/.test(expr)) return null;
  // Also reject keywords that could be abused even without punctuation.
  if (/\b(Function|eval|constructor|globalThis|window|document|process|require)\b/.test(expr)) return null;

  // Only allow identifiers we explicitly tolerate.
  const ids = expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  const ok = new Set(["Math", "min", "max", "floor", "ceil", "round"]);
  for (const id of ids) {
    if (!ok.has(id)) return null;
  }

  try {
    // eslint-disable-next-line no-new-func
    const fn = Function('"use strict"; return (' + expr + ');');
    const out = fn();
    const n = Number(out);
    if (!Number.isFinite(n)) return null;

    // If the formula had @tokens but none were in ctx, we likely just evaluated a bunch of zeros.
    // Treat that as failure so we can fall back to heuristics.
    if (replacedAny && /@/.test(formula) && n === 0 && /@[A-Za-z0-9_.]+/.test(formula)) {
      // If ctx genuinely resolves to 0, this is still "correct", but for AC it's almost never intended.
      // We only use this to avoid masking token-mapping bugs.
      return null;
    }

    return n;
  } catch {
    return null;
  }
}


function computeAC(actor) {
  const sys = actor?.system || {};
  const ac = sys?.attributes?.ac || {};

  const abilities = getAbilities(actor);
  const dexMod = abilities.dex.mod;

  const parts = getACArmorParts(actor);
  const adj = extractACAdjustments(actor);

  // Armour base (feeds @attributes.ac.armor).
  let armorToken = parts.armorBase;
  if (Number.isFinite(adj.armorOverride)) armorToken = adj.armorOverride;
  armorToken += (adj.armorAdd || 0);

  // Shield contribution (feeds @attributes.ac.shield).
  let shieldToken = parts.shieldTotal;
  if (Number.isFinite(adj.shieldOverride)) shieldToken = adj.shieldOverride;
  shieldToken += (adj.shieldAdd || 0);

  // Base AC for "no armour" style calcs (feeds @attributes.ac.base).
  let baseToken = 10;
  if (Number.isFinite(adj.baseOverride)) baseToken = adj.baseOverride;
  baseToken += (adj.baseAdd || 0);

  // Dex contribution for @attributes.ac.dex (capped if armour says so).
  const cap = parts.armorDexCap;
  let dexToken = (Number.isFinite(cap) ? Math.min(dexMod, cap) : dexMod);
  if (Number.isFinite(adj.dexOverride)) dexToken = adj.dexOverride;
  dexToken += (adj.dexAdd || 0);

  // Generic bonuses (rings, cloaks, effects, etc.).
  let bonusToken = parseBonusString(ac?.bonus);
  if (Number.isFinite(adj.bonusOverride)) bonusToken = adj.bonusOverride;
  bonusToken += (adj.bonusAdd || 0);

  // Direct "add to AC value" effects (treated as bonus).
  bonusToken += (adj.valueAdd || 0);

  const pb = getProfBonus(actor);

  // 1) Custom formula gets first bite of the apple.
  // Some exports keep formula populated even when calc isn't strictly "custom" – if a formula exists, we honour it.
  if (typeof ac?.formula === "string" && ac.formula.trim()) {
    const raw = ac.formula;
    const compact = raw.replace(/\s+/g, "");
    const lowerRaw = raw.toLowerCase();

    // Fast-path for the most common custom formula (uncapped DEX) – avoids any token-resolution weirdness.
    if (compact === "@attributes.ac.armor+@abilities.dex.mod") {
      let val = armorToken + dexMod;
      val += shieldToken;  // shield is still part of AC unless explicitly omitted
      val += bonusToken;
      return Math.round(val);
    }

    const ctx = {
      "@attributes.ac.armor": armorToken,
      "@attributes.ac.base": baseToken,
      "@attributes.ac.shield": shieldToken,
      "@attributes.ac.dex": dexToken,
      "@attributes.ac.bonus": bonusToken,
      "@attributes.prof": pb,
      "@prof": pb,
      "@abilities.str.mod": abilities.str.mod,
      "@abilities.dex.mod": abilities.dex.mod,
      "@abilities.con.mod": abilities.con.mod,
      "@abilities.int.mod": abilities.int.mod,
      "@abilities.wis.mod": abilities.wis.mod,
      "@abilities.cha.mod": abilities.cha.mod,
    };

    let val = evalFormula(raw, ctx);
    if (Number.isFinite(val)) {
      // If the formula doesn't reference these common components, we add them.
      // This keeps "@attributes.ac.armor+@abilities.dex.mod" (and similar) correct without forcing everyone to write verbose formulas.
      if (!lowerRaw.includes("@attributes.ac.shield")) val += shieldToken;
      if (!lowerRaw.includes("@attributes.ac.bonus")) val += bonusToken;
      return Math.round(val);
    }

    // Fallback for custom formulas that explicitly request uncapped DEX but fail parser checks.
    if (lowerRaw.includes("@attributes.ac.armor") && lowerRaw.includes("@abilities.dex.mod")) {
      let val = armorToken + dexMod;
      if (!lowerRaw.includes("@attributes.ac.shield")) val += shieldToken;
      if (!lowerRaw.includes("@attributes.ac.bonus")) val += bonusToken;
      return Math.round(val);
    }
    // If evaluation fails, we fall through to heuristics.
  }

  // 2) Flat overrides (rare but explicit).
  if (Number.isFinite(adj.flatOverride)) return Math.round(adj.flatOverride + bonusToken);

  // 3) Direct AC value override from effects (e.g., "your AC becomes 13").
  if (Number.isFinite(adj.valueOverride)) return Math.round(adj.valueOverride + bonusToken);

  // 4) If snapshot already has a numeric ac.value, trust it (and still add numeric bonuses we found).
  const rawValue = tryNum(ac?.value);
  if (Number.isFinite(rawValue)) return Math.round(rawValue + bonusToken);

  // 5) Default: armour + shield + capped dex + bonuses.
  return Math.round(armorToken + shieldToken + dexToken + bonusToken);
}

// ----------------------------
// dnd5e display + filtering
// ----------------------------
const SKILL_LABELS = {
  acr: "Acrobatics", ani: "Animal Handling", arc: "Arcana", ath: "Athletics",
  dec: "Deception", his: "History", ins: "Insight", itm: "Intimidation",
  inv: "Investigation", med: "Medicine", nat: "Nature", prc: "Perception",
  prf: "Performance", per: "Persuasion", rel: "Religion", sle: "Sleight of Hand",
  ste: "Stealth", sur: "Survival"
};
const SAVE_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

function collectSkillRollModes(actor) {
  const keys = Object.keys(SKILL_LABELS);
  const out = {};
  for (const k of keys) out[k] = 0;

  const apply = (skillKey, value, mode) => {
    if (!Object.prototype.hasOwnProperty.call(out, skillKey)) return;
    out[skillKey] = applyNumericEffectMode(out[skillKey], value, mode);
  };

  const effects = getAllEffects(actor);
  for (const ef of effects) {
    const changes = ef?.changes || [];
    for (const ch of changes) {
      const key = safeText(ch?.key).toLowerCase();
      const mode = Number(ch?.mode ?? MODE_CUSTOM);

      const rollModeMatch = key.match(/^system\.skills\.([a-z]{3})\.roll\.mode$/);
      if (rollModeMatch) {
        const val = tryNum(ch?.value);
        if (Number.isFinite(val)) apply(rollModeMatch[1], val, mode);
        continue;
      }

      const advMatch = key.match(/^flags\.midi-qol\.advantage\.skill\.(all|[a-z]{3})$/);
      if (advMatch && isTruthyEffectValue(ch?.value)) {
        if (advMatch[1] === "all") for (const sk of keys) apply(sk, 1, mode);
        else apply(advMatch[1], 1, mode);
        continue;
      }

      const disMatch = key.match(/^flags\.midi-qol\.disadvantage\.skill\.(all|[a-z]{3})$/);
      if (disMatch && isTruthyEffectValue(ch?.value)) {
        if (disMatch[1] === "all") for (const sk of keys) apply(sk, -1, mode);
        else apply(disMatch[1], -1, mode);
      }
    }
  }

  for (const k of keys) {
    if (out[k] > 0) out[k] = 1;
    else if (out[k] < 0) out[k] = -1;
    else out[k] = 0;
  }

  return out;
}

function skillModeBadge(mode) {
  if (mode > 0) {
    return `<span class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-200/60 bg-emerald-500/75 text-[10px] font-bold text-white align-middle">A</span>`;
  }
  if (mode < 0) {
    return `<span class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-rose-200/60 bg-rose-500/75 text-[10px] font-bold text-white align-middle">D</span>`;
  }
  return "";
}

function renderSkillsGrid(actor) {
  const modeBySkill = collectSkillRollModes(actor);
  const rows = Object.keys(SKILL_LABELS).map((k) => {
    const badge = skillModeBadge(modeBySkill[k] || 0);
    const val = `${fmtSigned(skillBonus(actor, k))}${badge ? ` ${badge}` : ""}`;
    return [SKILL_LABELS[k], val];
  });
  return kvGrid(rows);
}

function collectSaveRollModes(actor) {
  const out = {};
  for (const k of SAVE_KEYS) {
    out[k] = tryNum(actor?.system?.abilities?.[k]?.save?.roll?.mode) ?? 0;
  }

  const apply = (abilityKey, value, mode) => {
    if (!Object.prototype.hasOwnProperty.call(out, abilityKey)) return;
    out[abilityKey] = applyNumericEffectMode(out[abilityKey], value, mode);
  };

  const effects = getAllEffects(actor);
  for (const ef of effects) {
    const changes = ef?.changes || [];
    for (const ch of changes) {
      const key = safeText(ch?.key).toLowerCase();
      const mode = Number(ch?.mode ?? MODE_CUSTOM);

      const rollModeMatch = key.match(/^system\.abilities\.(str|dex|con|int|wis|cha)\.save\.roll\.mode$/);
      if (rollModeMatch) {
        const val = tryNum(ch?.value);
        if (Number.isFinite(val)) apply(rollModeMatch[1], val, mode);
        continue;
      }

      const advMatch = key.match(/^flags\.midi-qol\.advantage\.ability\.save\.(all|str|dex|con|int|wis|cha)$/);
      if (advMatch && isTruthyEffectValue(ch?.value)) {
        if (advMatch[1] === "all") for (const ab of SAVE_KEYS) apply(ab, 1, mode);
        else apply(advMatch[1], 1, mode);
        continue;
      }

      const disMatch = key.match(/^flags\.midi-qol\.disadvantage\.ability\.save\.(all|str|dex|con|int|wis|cha)$/);
      if (disMatch && isTruthyEffectValue(ch?.value)) {
        if (disMatch[1] === "all") for (const ab of SAVE_KEYS) apply(ab, -1, mode);
        else apply(disMatch[1], -1, mode);
      }
    }
  }

  for (const k of SAVE_KEYS) {
    if (out[k] > 0) out[k] = 1;
    else if (out[k] < 0) out[k] = -1;
    else out[k] = 0;
  }
  return out;
}

function collectInitiativeRollMode(actor) {
  let out = tryNum(actor?.system?.attributes?.init?.roll?.mode) ?? 0;

  const effects = getAllEffects(actor);
  for (const ef of effects) {
    const changes = ef?.changes || [];
    for (const ch of changes) {
      const key = safeText(ch?.key).toLowerCase();
      const mode = Number(ch?.mode ?? MODE_CUSTOM);

      if (key === "system.attributes.init.roll.mode") {
        const v = tryNum(ch?.value);
        if (Number.isFinite(v)) out = applyNumericEffectMode(out, v, mode);
        continue;
      }

      if (
        (key === "flags.midi-qol.advantage.ability.check.dex" ||
         key === "flags.midi-qol.advantage.ability.check.all") &&
        isTruthyEffectValue(ch?.value)
      ) {
        out = applyNumericEffectMode(out, 1, mode);
        continue;
      }

      if (
        (key === "flags.midi-qol.disadvantage.ability.check.dex" ||
         key === "flags.midi-qol.disadvantage.ability.check.all") &&
        isTruthyEffectValue(ch?.value)
      ) {
        out = applyNumericEffectMode(out, -1, mode);
      }
    }
  }

  if (out > 0) return 1;
  if (out < 0) return -1;
  return 0;
}

function proficiencyMultiplier(value) {
  const val = tryNum(value);
  if (!Number.isFinite(val) || val <= 0) return 0;
  return val;
}

function saveProficiencyLabel(value) {
  const prof = proficiencyMultiplier(value);
  if (prof === 2) return "Expert";
  if (prof === 1) return "Prof";
  if (prof === 0.5) return "Half";
  if (prof > 0) return `x${prof}`;
  return "None";
}

function savingThrowBonus(actor, abilityKey) {
  const sys = actor?.system || {};
  const abilities = getAbilities(actor);
  const pb = getProfBonus(actor);

  const ab = sys?.abilities?.[abilityKey] || {};
  const prof = proficiencyMultiplier(ab?.proficient);
  const misc = parseBonusString(ab?.bonuses?.save) + parseBonusString(sys?.bonuses?.abilities?.save);
  const abilityModValue = abilities?.[abilityKey]?.mod ?? 0;

  return abilityModValue + (pb * prof) + misc;
}

function renderSavesGrid(actor) {
  const abilities = getAbilities(actor);
  const modeBySave = collectSaveRollModes(actor);
  const sysAbilities = actor?.system?.abilities || {};

  const rows = SAVE_KEYS.map((k) => {
    const label = `${safeText(abilities?.[k]?.label || k.toUpperCase())} Save`;
    const prof = saveProficiencyLabel(sysAbilities?.[k]?.proficient);
    const badge = skillModeBadge(modeBySave[k] || 0);
    const value = `${fmtSigned(savingThrowBonus(actor, k))} (${prof})${badge ? ` ${badge}` : ""}`;
    return [label, value];
  });

  return kvGrid(rows);
}

function skillBonus(actor, key) {
  const sys = actor?.system || {};
  const abilities = getAbilities(actor);
  const pb = getProfBonus(actor);

  const sk = sys?.skills?.[key] || {};
  const abilityKey = sk?.ability || ({
    acr:"dex", ani:"wis", arc:"int", ath:"str", dec:"cha", his:"int", ins:"wis", itm:"cha",
    inv:"int", med:"wis", nat:"int", prc:"wis", prf:"cha", per:"cha", rel:"int", sle:"dex", ste:"dex", sur:"wis"
  }[key] || "wis");

  const aMod = abilities?.[abilityKey]?.mod ?? 0;
  const profMult = proficiencyMultiplier(sk?.value); // 0 untrained, 0.5 half, 1 prof, 2 expertise
  const misc = parseBonusString(sk?.bonuses?.check);

  return aMod + (pb * profMult) + misc;
}

function passiveSkill(actor, key) {
  const sys = actor?.system || {};
  const sk = sys?.skills?.[key] || {};
  const misc = parseBonusString(sk?.bonuses?.passive);
  return 10 + skillBonus(actor, key) + misc;
}

function dnd5eMeta(actor) {
  const sys = actor?.system || {};
  const hp = sys?.attributes?.hp || {};
  const items = actor?.items || [];
  const classes = items.filter(i => i?.type === "class");
  const level = getClassLevel(actor) || "";
  const classNames = classes.map(c => c?.name).filter(Boolean).join(", ");

  const acVal = computeAC(actor);
  const pb = getProfBonus(actor);

  return {
    line1: [classNames || sys?.details?.class || "Character", level ? `Lv ${level}` : ""].filter(Boolean).join(" • "),
    line2: [`AC ${acVal ?? "–"}`, `HP ${hp?.value ?? "–"}/${hp?.max ?? "–"}`, `PB ${fmtSigned(pb ?? 0)}`].join("  ·  ")
  };
}

function defaultMeta(actor) {
  return { line1: actor?.type || "Actor", line2: "Snapshot" };
}

function getMeta(payload) {
  const actor = actorFromPayload(payload);
  const sysId = guessSystem(payload);
  if (sysId === "dnd5e") return dnd5eMeta(actor);
  return defaultMeta(actor);
}

function extractSearchCorpus(payload) {
  const actor = actorFromPayload(payload);
  const sys = actor?.system || {};
  const items = actor?.items || [];

  const bits = [];
  bits.push(actor?.name);
  bits.push(sys?.details?.class);
  bits.push(detailLabel(actor, sys?.details?.race, ["race"]));
  bits.push(detailLabel(actor, sys?.details?.background, ["background"]));

  for (const it of items) bits.push(it?.name);

  const abilities = sys?.abilities || {};
  Object.keys(abilities).forEach(k => bits.push(k, abilities[k]?.label));
  const skills = sys?.skills || {};
  Object.keys(skills).forEach(k => bits.push(k, SKILL_LABELS[k] || skills[k]?.label));

  return norm(bits.filter(Boolean).join(" "));
}

function rosterItem(entry) {
  const payload = entry.payload;
  const actor = actorFromPayload(payload);

  const tpl = $("#rosterItemTpl");
  const node = tpl.content.firstElementChild.cloneNode(true);

  node.dataset.id = entry.id;
  node.querySelector("img").src = actorImageUrl(payload, actor);
  node.querySelector(".name").textContent = actor?.name || "Unnamed";
  node.querySelector(".meta").textContent = entry.meta.line1;

  node.addEventListener("click", () => selectActor(node.dataset.id));
  return node;
}

const FEATURE_BLACKLIST = new Set([
  "hide","search","attack","check cover","dash","disengage","grapple","knock out","magic","ready","ready spell",
  "stabilise","study","underwater","dodge","fall","help","influence","mount","ready action","shove","squeeze","suffocation"
].map(x => norm(x)));

function spellPreparedTag(spell) {
  const p = tryNum(spell?.system?.prepared);
  if (p === 2) return "Always prepared";
  if (p === 1) return "Prepared";
  return "Not prepared";
}

function spellLevelNumber(spell) {
  const lvl = tryNum(spell?.system?.level);
  if (!Number.isFinite(lvl)) return 0;
  return clamp(Math.floor(lvl), 0, 9);
}

function renderInventoryWithSearch(gear) {
  const wrap = document.createElement("div");
  wrap.className = "space-y-3";

  const controls = document.createElement("div");
  controls.className = "flex flex-col md:flex-row md:items-center gap-2";
  controls.innerHTML = `
    <input class="w-full md:w-96 rounded-2xl bg-white/5 border border-white/10 px-4 py-2 outline-none focus:ring-2 focus:ring-indigo-400/40"
           placeholder="Search this inventory…" />
    <div class="text-xs text-slate-400 md:ml-auto" id="count"></div>
  `;
  wrap.appendChild(controls);

  const input = controls.querySelector("input");
  const count = controls.querySelector("#count");

  const listWrap = document.createElement("div");
  wrap.appendChild(listWrap);

  const render = () => {
    const q = norm(input.value);
    const filtered = !q ? gear : gear.filter(g => norm(g?.name).includes(q));
    count.textContent = `${filtered.length} item(s)`;
    listWrap.innerHTML = "";
    listWrap.appendChild(listCards(filtered, (g) => {
      const qty = tryNum(g?.system?.quantity) ?? 1;
      const eq = g?.system?.equipped ? "equipped" : "";
      const att = g?.system?.attunement ? "attunement" : "";
      return [`qty ${qty}`, eq, att].filter(Boolean).join(" • ");
    }));
  };

  input.addEventListener("input", render);
  render();

  return wrap;
}

function renderSpellsWithFilter(spells) {
  const wrap = document.createElement("div");
  wrap.className = "space-y-3";

  const controls = document.createElement("div");
  controls.className = "flex flex-col md:flex-row md:items-center gap-2";
  controls.innerHTML = `
    <div class="text-xs text-slate-400">Filter:</div>
    <select data-role="prep" class="w-full md:w-64 rounded-2xl bg-white/5 border border-white/10 px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-indigo-400/40" style="color-scheme: dark;">
      <option value="all">All spells</option>
      <option value="prepared">Prepared (incl. always)</option>
      <option value="always">Always prepared</option>
      <option value="not">Not prepared</option>
    </select>
    <select data-role="level" class="w-full md:w-56 rounded-2xl bg-white/5 border border-white/10 px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-indigo-400/40" style="color-scheme: dark;">
      <option value="all">All levels</option>
      <option value="0">Cantrip</option>
      <option value="1">Level 1</option>
      <option value="2">Level 2</option>
      <option value="3">Level 3</option>
      <option value="4">Level 4</option>
      <option value="5">Level 5</option>
      <option value="6">Level 6</option>
      <option value="7">Level 7</option>
      <option value="8">Level 8</option>
      <option value="9">Level 9</option>
    </select>
    <div class="text-xs text-slate-400 md:ml-auto" id="count"></div>
  `;
  wrap.appendChild(controls);

  const prepSel = controls.querySelector("select[data-role='prep']");
  const levelSel = controls.querySelector("select[data-role='level']");
  const count = controls.querySelector("#count");
  // Keep native option list readable on systems that ignore class styling for option popups.
  controls.querySelectorAll("option").forEach((opt) => {
    opt.style.color = "#0f172a";
    opt.style.backgroundColor = "#e2e8f0";
  });

  const listWrap = document.createElement("div");
  wrap.appendChild(listWrap);

  const render = () => {
    const mode = prepSel.value;
    const levelMode = levelSel.value;

    const filtered = spells.filter(s => {
      const p = tryNum(s?.system?.prepared) ?? 0;
      if (mode === "prepared" && !(p === 1 || p === 2)) return false;
      if (mode === "always" && p !== 2) return false;
      if (mode === "not" && p !== 0) return false;

      if (levelMode !== "all") {
        const want = Number(levelMode);
        if (spellLevelNumber(s) !== want) return false;
      }
      return true;
    });

    count.textContent = `${filtered.length} spell(s)`;

    listWrap.innerHTML = "";
    listWrap.appendChild(listCards(filtered, (s) => {
      const lvl = spellLevelNumber(s);
      const school = s?.system?.school;
      const tag = spellPreparedTag(s);
      return [lvl === 0 ? "Cantrip" : `Level ${lvl}`, school, tag].filter(Boolean).join(" • ");
    }));
  };

  prepSel.addEventListener("change", render);
  levelSel.addEventListener("change", render);
  render();

  return wrap;
}

const SPELL_SLOT_TABLE = {
  1: [2,0,0,0,0,0,0,0,0],
  2: [3,0,0,0,0,0,0,0,0],
  3: [4,2,0,0,0,0,0,0,0],
  4: [4,3,0,0,0,0,0,0,0],
  5: [4,3,2,0,0,0,0,0,0],
  6: [4,3,3,0,0,0,0,0,0],
  7: [4,3,3,1,0,0,0,0,0],
  8: [4,3,3,2,0,0,0,0,0],
  9: [4,3,3,3,1,0,0,0,0],
  10: [4,3,3,3,2,0,0,0,0],
  11: [4,3,3,3,2,1,0,0,0],
  12: [4,3,3,3,2,1,0,0,0],
  13: [4,3,3,3,2,1,1,0,0],
  14: [4,3,3,3,2,1,1,0,0],
  15: [4,3,3,3,2,1,1,1,0],
  16: [4,3,3,3,2,1,1,1,0],
  17: [4,3,3,3,2,1,1,1,1],
  18: [4,3,3,3,3,1,1,1,1],
  19: [4,3,3,3,3,2,1,1,1],
  20: [4,3,3,3,3,2,2,1,1]
};

const PACT_SLOT_TABLE = {
  1: { level: 1, max: 1 },
  2: { level: 1, max: 2 },
  3: { level: 2, max: 2 },
  4: { level: 2, max: 2 },
  5: { level: 3, max: 2 },
  6: { level: 3, max: 2 },
  7: { level: 4, max: 2 },
  8: { level: 4, max: 2 },
  9: { level: 5, max: 2 },
  10: { level: 5, max: 2 },
  11: { level: 5, max: 3 },
  12: { level: 5, max: 3 },
  13: { level: 5, max: 3 },
  14: { level: 5, max: 3 },
  15: { level: 5, max: 3 },
  16: { level: 5, max: 3 },
  17: { level: 5, max: 4 },
  18: { level: 5, max: 4 },
  19: { level: 5, max: 4 },
  20: { level: 5, max: 4 }
};

function baseSlotColor(level, isPact) {
  if (isPact) return "rgb(236,72,153)"; // pink
  const colors = [
    "rgb(14,165,233)", // 1
    "rgb(59,130,246)", // 2
    "rgb(99,102,241)", // 3
    "rgb(139,92,246)", // 4
    "rgb(168,85,247)", // 5
    "rgb(217,70,239)", // 6
    "rgb(244,114,182)", // 7
    "rgb(251,146,60)", // 8
    "rgb(250,204,21)" // 9
  ];
  return colors[clamp(level - 1, 0, colors.length - 1)];
}

function getCasterInfo(actor) {
  const classes = (actor?.items || []).filter((i) => i?.type === "class");
  let casterLevel = 0;
  let pactClassLevel = 0;

  for (const c of classes) {
    const levels = Math.max(0, Number(c?.system?.levels || 0));
    const prog = safeText(c?.system?.spellcasting?.progression).toLowerCase();
    if (prog === "full") casterLevel += levels;
    else if (prog === "half") casterLevel += Math.floor(levels / 2);
    else if (prog === "third") casterLevel += Math.floor(levels / 3);
    else if (prog === "artificer") casterLevel += Math.ceil(levels / 2);
    else if (prog === "pact") pactClassLevel += levels;
  }

  return {
    casterLevel: clamp(casterLevel, 0, 20),
    pactClassLevel: clamp(pactClassLevel, 0, 20)
  };
}

function buildSpellSlotRows(actor) {
  const sysSpells = actor?.system?.spells || {};
  const caster = getCasterInfo(actor);
  const slotMax = SPELL_SLOT_TABLE[caster.casterLevel] || SPELL_SLOT_TABLE[0] || [0,0,0,0,0,0,0,0,0];
  const rows = [];

  for (let level = 1; level <= 9; level++) {
    const k = `spell${level}`;
    const s = sysSpells?.[k] || {};
    const available = Math.max(0, Number(tryNum(s?.value) ?? 0));
    const override = tryNum(s?.override);
    const computedMax = Number.isFinite(override) && override >= 0 ? override : (slotMax[level - 1] || 0);
    const max = Math.max(available, computedMax, 0);
    if (max <= 0 && available <= 0) continue;
    rows.push({ label: `Level ${level}`, level, available, used: Math.max(0, max - available), max, isPact: false });
  }

  const pact = sysSpells?.pact || {};
  const pactAvail = Math.max(0, Number(tryNum(pact?.value) ?? 0));
  const pactOverride = tryNum(pact?.override);
  const pactInfo = PACT_SLOT_TABLE[caster.pactClassLevel] || { level: 1, max: 0 };
  const pactMax = Math.max(pactAvail, Number.isFinite(pactOverride) && pactOverride >= 0 ? pactOverride : pactInfo.max, 0);
  if (pactMax > 0 || pactAvail > 0) {
    rows.push({
      label: `Pact Lv ${pactInfo.level}`,
      level: pactInfo.level,
      available: pactAvail,
      used: Math.max(0, pactMax - pactAvail),
      max: pactMax,
      isPact: true
    });
  }

  return rows;
}

function pip(color, filled) {
  const dot = document.createElement("span");
  dot.className = "inline-block h-3.5 w-3.5 rounded-full border";
  dot.style.borderColor = "rgba(226,232,240,0.8)";
  dot.style.background = filled ? color : "rgba(15,23,42,0.42)";
  dot.style.boxShadow = filled ? `0 0 12px ${color}` : "none";
  return dot;
}

function renderSpellSlotsSummary(actor) {
  const rows = buildSpellSlotRows(actor);
  if (!rows.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "rounded-2xl bg-slate-950/40 border border-white/10 p-3 space-y-2";

  const title = document.createElement("div");
  title.className = "text-xs uppercase tracking-wide text-slate-300";
  title.textContent = "Spell Slots";
  wrap.appendChild(title);

  for (const row of rows) {
    const line = document.createElement("div");
    line.className = "flex items-center gap-3";

    const label = document.createElement("div");
    label.className = "w-24 shrink-0 text-xs text-slate-300";
    label.textContent = row.label;
    line.appendChild(label);

    const pips = document.createElement("div");
    pips.className = "flex flex-wrap gap-1.5";
    const color = baseSlotColor(row.level, row.isPact);
    for (let i = 0; i < row.available; i++) pips.appendChild(pip(color, true));
    for (let i = 0; i < row.used; i++) pips.appendChild(pip(color, false));
    line.appendChild(pips);

    const nums = document.createElement("div");
    nums.className = "ml-auto text-xs text-slate-400";
    nums.textContent = `${row.available}/${row.max}`;
    line.appendChild(nums);

    wrap.appendChild(line);
  }

  return wrap;
}

function renderSpellsSection(actor, spells) {
  const wrap = document.createElement("div");
  wrap.className = "space-y-3";

  const slots = renderSpellSlotsSummary(actor);
  if (slots) wrap.appendChild(slots);

  if (spells.length) {
    wrap.appendChild(renderSpellsWithFilter(spells));
  } else if (!slots) {
    wrap.appendChild(document.createTextNode("No spells exported."));
  }

  return wrap;
}

function renderDnd5e(payload) {
  const actor = actorFromPayload(payload);
  const sys = actor?.system || {};
  const meta = dnd5eMeta(actor);

  const root = document.createElement("div");
  root.className = "grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_12rem] gap-4 items-start";

  const contentCol = document.createElement("div");
  contentCol.className = "order-last xl:order-first flex flex-col gap-4 min-w-0";

  const anchorPrefix = makeAnchorId(`sheet-${safeText(actor?._id || actor?.name || "actor")}`, "root");
  const quickLinks = [];

  // hero
  const hero = document.createElement("div");
  hero.className = "rounded-3xl bg-white/5 border border-white/10 p-4 md:p-5";
  const overviewId = makeAnchorId(anchorPrefix, "Overview");
  hero.id = overviewId;
  hero.innerHTML = `
    <div class="flex gap-4 items-start">
      <img src="${actorImageUrl(payload, actor)}" class="h-20 w-20 rounded-3xl object-cover border border-white/10" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-2xl font-semibold tracking-tight truncate">${safeText(actor?.name)}</h2>
        </div>
        <div class="mt-1 text-slate-300">${safeText(meta.line1)}</div>
        <div class="mt-2 flex flex-wrap gap-2" id="pills"></div>
      </div>
    </div>
  `;
  const pills = hero.querySelector("#pills");
  pills.appendChild(pill(meta.line2));
  const race = detailLabel(actor, sys?.details?.race, ["race"]);
  const bg = detailLabel(actor, sys?.details?.background, ["background"]);
  const align = sys?.details?.alignment;
  [race, bg, align].filter(Boolean).forEach(x => pills.appendChild(pill(x)));

  contentCol.appendChild(hero);
  quickLinks.push({ label: "Overview", id: overviewId });

  const abilities = getAbilities(actor);
  const abilityRows = [
    ["STR", `${abilities.str.score} (${fmtSigned(abilities.str.mod)})`],
    ["DEX", `${abilities.dex.score} (${fmtSigned(abilities.dex.mod)})`],
    ["CON", `${abilities.con.score} (${fmtSigned(abilities.con.mod)})`],
    ["INT", `${abilities.int.score} (${fmtSigned(abilities.int.mod)})`],
    ["WIS", `${abilities.wis.score} (${fmtSigned(abilities.wis.mod)})`],
    ["CHA", `${abilities.cha.score} (${fmtSigned(abilities.cha.mod)})`],
  ];
  const abilitiesId = makeAnchorId(anchorPrefix, "Abilities");
  contentCol.appendChild(section("Abilities", kvGrid(abilityRows), abilitiesId));
  quickLinks.push({ label: "Abilities", id: abilitiesId });

  const attr = sys?.attributes || {};
  const movement = computeMovement(actor);
  const senses = computeSenses(actor);
  const hp = attr?.hp || {};
  const tempHp = Math.max(0, Number(tryNum(hp?.temp) ?? 0));
  const pb = getProfBonus(actor);
  const acVal = computeAC(actor);
  const initMode = collectInitiativeRollMode(actor);
  const initBadge = skillModeBadge(initMode);

  const combatRows = [
    ["Armour Class", acVal ?? "–"],
    ["Hit Points", renderHitPointsValue(hp)],
    ["Hit Dice", renderHitDiceValue(actor)],
    ...(tempHp > 0 ? [["Temporary Hit Points", `+${tempHp}`]] : []),
    ["Initiative", `${fmtSigned(abilities.dex.mod)}${initBadge ? ` ${initBadge}` : ""}`],
    ["Proficiency Bonus", fmtSigned(pb)],
    ["Speed", formatMovement(movement)],
    ["Senses", formatSenses(senses, attr?.senses?.special)],
    ["Passive Perception", passiveSkill(actor, "prc")],
  ];
  const combatId = makeAnchorId(anchorPrefix, "Combat");
  contentCol.appendChild(section("Combat", kvGrid(combatRows), combatId));
  quickLinks.push({ label: "Combat", id: combatId });

  const savesId = makeAnchorId(anchorPrefix, "Saves");
  contentCol.appendChild(section("Saves", renderSavesGrid(actor), savesId));
  quickLinks.push({ label: "Saves", id: savesId });

  // skills
  const skillsId = makeAnchorId(anchorPrefix, "Skills");
  contentCol.appendChild(section("Skills", renderSkillsGrid(actor), skillsId));
  quickLinks.push({ label: "Skills", id: skillsId });

  const effectsId = makeAnchorId(anchorPrefix, "Active Effects");
  contentCol.appendChild(section("Active Effects", renderActiveEffects(actor), effectsId));
  quickLinks.push({ label: "Effects", id: effectsId });

  // items
  const items = actor?.items || [];
  const spells = items
    .filter(i => i?.type === "spell")
    .sort((a, b) => {
      const la = spellLevelNumber(a);
      const lb = spellLevelNumber(b);
      if (la !== lb) return la - lb;
      return safeText(a.name).localeCompare(safeText(b.name));
    });

  const feats = items
    .filter(i => i?.type === "feat")
    .filter(f => !FEATURE_BLACKLIST.has(norm(f?.name)))
    .sort((a,b)=> safeText(a.name).localeCompare(safeText(b.name)));

  const gearTypes = new Set(["weapon","equipment","consumable","tool","loot","backpack"]);
  const gear = items
    .filter(i => gearTypes.has(i?.type))
    .sort((a,b)=> safeText(a.name).localeCompare(safeText(b.name)));

  const spellsId = makeAnchorId(anchorPrefix, "Spells");
  contentCol.appendChild(section("Spells", renderSpellsSection(actor, spells), spellsId));
  quickLinks.push({ label: "Spells", id: spellsId });

  const featuresId = makeAnchorId(anchorPrefix, "Features");
  contentCol.appendChild(section("Features", feats.length ? listCards(feats) : document.createTextNode("No features exported."), featuresId));
  quickLinks.push({ label: "Features", id: featuresId });

  const inventoryId = makeAnchorId(anchorPrefix, "Inventory");
  contentCol.appendChild(section("Inventory", gear.length ? renderInventoryWithSearch(gear) : document.createTextNode("No inventory exported."), inventoryId));
  quickLinks.push({ label: "Inventory", id: inventoryId });

  // notes
  const bio = sys?.details?.biography?.value || sys?.details?.biography || "";
  const notes = document.createElement("div");
  notes.className = "prose prose-invert max-w-none text-slate-200/90";
  notes.innerHTML = bio || "<em>No biography exported.</em>";
  const biographyId = makeAnchorId(anchorPrefix, "Biography");
  contentCol.appendChild(section("Biography", notes, biographyId));
  quickLinks.push({ label: "Biography", id: biographyId });

  root.appendChild(contentCol);
  root.appendChild(quickAccessNav(quickLinks));

  return root;
}

function renderUnknown(payload) {
  const actor = actorFromPayload(payload);
  const sysId = guessSystem(payload);

  const root = document.createElement("div");
  root.className = "flex flex-col gap-4";

  const hero = document.createElement("div");
  hero.className = "rounded-3xl bg-white/5 border border-white/10 p-5";
  hero.innerHTML = `
    <div class="flex gap-4 items-start">
      <img src="${actorImageUrl(payload, actor)}" class="h-20 w-20 rounded-3xl object-cover border border-white/10" />
      <div class="min-w-0 flex-1">
        <h2 class="text-2xl font-semibold tracking-tight truncate">${safeText(actor?.name)}</h2>
        <div class="mt-1 text-slate-300">System: <span class="text-white font-medium">${sysId}</span></div>
        <div class="mt-3 text-slate-300/90">This viewer has rich rendering for dnd5e. Other systems show raw snapshot.</div>
      </div>
    </div>
  `;
  root.appendChild(hero);

  const pre = document.createElement("pre");
  pre.className = "text-xs whitespace-pre-wrap break-words rounded-3xl bg-slate-950/50 border border-white/10 p-4 max-h-[60vh] overflow-auto scrollbar";
  pre.textContent = JSON.stringify(payload, null, 2);

  root.appendChild(section("Raw data", pre));
  return root;
}

function renderSheet(payload) {
  const sysId = guessSystem(payload);
  if (sysId === "dnd5e") return renderDnd5e(payload);
  return renderUnknown(payload);
}

// ----------------------------
// roster + global search
// ----------------------------
function paintRoster(entries) {
  rosterEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const entry of entries) frag.appendChild(rosterItem(entry));
  rosterEl.appendChild(frag);

  if (!entries.length) {
    rosterEl.innerHTML = `<div class="p-4 text-slate-300">No characters loaded.</div>`;
    clearSheet();
  }
}

function selectActor(id) {
  selectedId = id;
  const found = allPayloads.find(x => (actorFromPayload(x.payload)?._id || x.id) === id);
  if (!found) return;

  rosterEl.querySelectorAll("button[data-id]").forEach(b => {
    b.classList.toggle("bg-white/10", b.dataset.id === id);
  });

  sheetEl.innerHTML = "";
  sheetEl.appendChild(renderSheet(found.payload));
}

async function loadManifestPayloads() {
  const res = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
  const manifest = await res.json(); // [{file,name?}]

  const payloads = [];
  for (const entry of manifest) {
    const r = await fetch(entry.file, { cache: "no-store" });
    if (!r.ok) continue;
    const payload = await r.json();
    payloads.push(payload);
  }
  return payloads;
}

function applyGlobalSearch() {
  const q = norm(searchEl.value);
  const filtered = !q ? allPayloads : allPayloads.filter(x => x.corpus.includes(q));
  paintRoster(filtered);

  // if selected filtered out, clear
  if (selectedId) {
    const still = filtered.some(p => (actorFromPayload(p.payload)?._id || p.id) === selectedId);
    if (!still) {
      selectedId = null;
      clearSheet();
    }
  }
}

async function initialise() {
  setStatus("Loading…");
  portraitUrlCache.clear();
  let payloads = [];
  try {
    payloads = await loadManifestPayloads();
  } catch (e) {
    console.warn(e);
  }

  allPayloads = await Promise.all(payloads.map(async (payload) => {
    const actor = actorFromPayload(payload);
    const id = actor?._id || payload?.id || crypto.randomUUID();
    const portrait = await resolveLocalPortrait(actor?.name);
    payload.__portrait = portrait;
    return {
      id,
      name: actor?.name || "Unnamed",
      payload,
      meta: getMeta(payload),
      corpus: extractSearchCorpus(payload),
      portrait
    };
  }));
  allPayloads.sort((a,b)=> safeText(a.name).localeCompare(safeText(b.name)));

  paintRoster(allPayloads);
  setStatus(allPayloads.length ? `${allPayloads.length} character(s) loaded.` : "No data loaded.");
}

// ----------------------------
// events
// ----------------------------
refreshBtn.addEventListener("click", initialise);
searchEl.addEventListener("input", applyGlobalSearch);

initialise();
