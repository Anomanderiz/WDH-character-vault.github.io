// Foundry Character Vault – a tiny static viewer for exported Actor snapshots.
// No framework. Just taste.

const SITE_BASE = new URL(window.location.href);
// If someone visits the Pages URL without the trailing slash, relative fetches can escape the repo path.
if (!SITE_BASE.pathname.endsWith("/")) SITE_BASE.pathname += "/";

const MANIFEST_URL = new URL("data/manifest.json", SITE_BASE).toString();
const LS_KEY = "fcv_local_actor_payloads_v1";

const $ = (sel) => document.querySelector(sel);

const rosterEl = $("#roster");
const sheetEl = $("#sheet");
const statusEl = $("#status");
const searchEl = $("#search");

const importBtn = $("#importBtn");
const importFile = $("#importFile");
const refreshBtn = $("#refresh");

let allPayloads = []; // [{id, name, meta, payload, corpus}]
let selectedId = null;

function safeText(s) {
  return (s ?? "").toString();
}

function norm(s) {
  return safeText(s).toLowerCase().trim();
}

function nameKey(s) {
  // normalise for comparisons (strip punctuation, collapse whitespace)
  return norm(s).replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function fmtSigned(n) {
  const x = Number(n ?? 0);
  return x >= 0 ? `+${x}` : `${x}`;
}

function guessSystem(payload) {
  return (
    payload?.systemId ||
    payload?.actor?.system?.id ||
    payload?.actor?.systemId ||
    "unknown"
  );
}

function actorFromPayload(payload) {
  return payload?.actor || payload?.data?.actor || payload?.document || payload;
}

function resolveUrl(pathish) {
  const cleaned = safeText(pathish).replace(/^\.\//, "");
  return new URL(cleaned, SITE_BASE).toString();
}

// =======================
// dnd5e derived maths (exports often omit computed fields)
// =======================
function abilityMod(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 0;
  return Math.floor((s - 10) / 2);
}

function totalLevel(actor) {
  const sys = actor?.system || {};
  const items = actor?.items || [];
  const classes = items.filter((i) => i?.type === "class");
  const lvl = classes.reduce((a, c) => a + Number(c?.system?.levels ?? 0), 0);
  return lvl || Number(sys?.details?.level ?? 0) || 0;
}

function proficiencyBonus(level) {
  const l = Number(level);
  if (!Number.isFinite(l) || l <= 0) return 0;
  return 2 + Math.floor((l - 1) / 4);
}

function parseFlatBonus(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  const s = String(v).trim();
  if (!s) return 0;

  // Avoid trying to interpret dice formulae (e.g., "1d4").
  if (/[dD]\d/.test(s)) return 0;

  const nums = s.match(/[+-]?\d+/g);
  if (!nums) return 0;

  return nums
    .map((n) => Number(n))
    .filter(Number.isFinite)
    .reduce((a, b) => a + b, 0);
}

function profComponent(rank, prof) {
  const r = Number(rank ?? 0);
  if (!Number.isFinite(r) || r <= 0) return 0;

  if (r === 0.5) return Math.floor(prof / 2);
  if (r === 1) return prof;
  if (r === 2) return 2 * prof;

  return Math.floor(r * prof);
}

function dnd5eDerived(actor) {
  const sys = actor?.system || {};
  const level = totalLevel(actor);
  const prof = proficiencyBonus(level);

  const abilities = sys?.abilities || {};
  const abilityMods = {
    str: abilityMod(abilities?.str?.value),
    dex: abilityMod(abilities?.dex?.value),
    con: abilityMod(abilities?.con?.value),
    int: abilityMod(abilities?.int?.value),
    wis: abilityMod(abilities?.wis?.value),
    cha: abilityMod(abilities?.cha?.value),
  };

  const skills = sys?.skills || {};
  const skillTotals = {};
  for (const [k, sk] of Object.entries(skills)) {
    const ability = sk?.ability;
    const base = ability && abilityMods[ability] != null ? abilityMods[ability] : 0;
    const profPart = profComponent(sk?.value, prof);

    const bonus =
      parseFlatBonus(sk?.bonuses?.check) +
      parseFlatBonus(sys?.bonuses?.abilities?.skill) +
      parseFlatBonus(sys?.bonuses?.skills?.check);

    skillTotals[k] = base + profPart + bonus;
  }

  const passivePrc =
    10 +
    (skillTotals?.prc ?? 0) +
    parseFlatBonus(skills?.prc?.bonuses?.passive) +
    parseFlatBonus(sys?.bonuses?.skills?.passive);

  return { level, prof, abilityMods, skillTotals, passivePrc };
}

function computeACArmorAndShield(actor) {
  // Approximates @attributes.ac.armor: base armour (or 10) + shield bonuses.
  const items = actor?.items || [];
  const equipped = items.filter((i) => i?.system?.equipped);

  const armours = equipped.filter(
    (i) =>
      i?.type === "equipment" &&
      Number.isFinite(i?.system?.armor?.value) &&
      i?.system?.type?.value !== "shield"
  );

  const shields = equipped.filter(
    (i) =>
      i?.type === "equipment" &&
      Number.isFinite(i?.system?.armor?.value) &&
      i?.system?.type?.value === "shield"
  );

  const bestArmour = armours
    .sort(
      (a, b) =>
        Number(b?.system?.armor?.value ?? 0) - Number(a?.system?.armor?.value ?? 0)
    )[0];

  const armourBase = bestArmour ? Number(bestArmour.system.armor.value) : 10;
  const shieldBonus = shields.reduce(
    (a, s) => a + Number(s?.system?.armor?.value ?? 0),
    0
  );

  return { armourBase, shieldBonus, bestArmour };
}

function computeAC(actor, derived) {
  const sys = actor?.system || {};
  const ac = sys?.attributes?.ac || {};

  // If the export included a resolved value, use it.
  if (Number.isFinite(ac?.value)) return Number(ac.value);
  if (Number.isFinite(ac?.flat)) return Number(ac.flat);

  const { armourBase, shieldBonus, bestArmour } = computeACArmorAndShield(actor);

  const dex = derived?.abilityMods?.dex ?? 0;
  const dexCap = bestArmour ? bestArmour?.system?.armor?.dex : null;
  const acDex = dexCap == null || dexCap === "" ? dex : Math.min(dex, Number(dexCap) || 0);

  // If the system provides a custom AC formula, obey it (safely).
  // IMPORTANT: @abilities.dex.mod is FULL Dex mod (no cap). If you want capped Dex, use @attributes.ac.dex.
  if (ac?.calc === "custom" && typeof ac?.formula === "string") {
    const ctx = {
      "@attributes.ac.armor": armourBase + shieldBonus,
      "@attributes.ac.dex": acDex,
      "@abilities.str.mod": derived?.abilityMods?.str ?? 0,
      "@abilities.dex.mod": derived?.abilityMods?.dex ?? 0,
      "@abilities.con.mod": derived?.abilityMods?.con ?? 0,
      "@abilities.int.mod": derived?.abilityMods?.int ?? 0,
      "@abilities.wis.mod": derived?.abilityMods?.wis ?? 0,
      "@abilities.cha.mod": derived?.abilityMods?.cha ?? 0,
    };

    let expr = ac.formula;
    for (const [token, val] of Object.entries(ctx)) {
      expr = expr.split(token).join(String(Number(val ?? 0)));
    }

    // Safe-eval: only arithmetic allowed after substitution.
    if (/^[0-9+\-*/().\s]+$/.test(expr)) {
      try {
        // eslint-disable-next-line no-new-func
        const n = Function(`return (${expr});`)();
        if (Number.isFinite(n)) return n;
      } catch {
        // fall through
      }
    }
    // If formula contains unknown tokens, fall through to heuristic.
  }

  // Heuristic default: armour + (capped) dex + shield + flat bonus (if any)
  const flatBonus = parseFlatBonus(ac?.bonus);
  return armourBase + acDex + shieldBonus + flatBonus;
}

function spellPreparedLabel(spell) {
  const s = spell?.system || {};

  // dnd5e v4 stores this as 0/1/2
  const p = s?.prepared;
  if (p === 2) return "Always prepared";
  if (p === 1) return "Prepared";
  if (p === 0) return "Not prepared";

  // Older/alt schema
  const mode = s?.preparation?.mode;
  if (mode === "prepared") return s?.preparation?.prepared ? "Prepared" : "Not prepared";
  if (mode === "always") return "Always prepared";
  return "";
}

const FILTERED_FEATURES = new Set(
  [
    "hide",
    "search",
    "attack",
    "check cover",
    "dash",
    "disengage",
    "grapple",
    "knock out",
    "magic",
    "ready",
    "ready spell",
    "stabilise",
    "study",
    "underwater",
    "dodge",
    "fall",
    "help",
    "influence",
    "mount",
    "ready action",
    "shove",
    "squeeze",
    "suffocation",
  ].map(nameKey)
);

function shouldHideFeature(item) {
  return FILTERED_FEATURES.has(nameKey(item?.name));
}

// =======================
// UI helpers
// =======================
function rosterItem(payload) {
  const actor = actorFromPayload(payload);
  const meta = getMeta(payload);

  const tpl = $("#rosterItemTpl");
  const node = tpl.content.firstElementChild.cloneNode(true);

  node.dataset.id = actor?._id || payload?.id || crypto.randomUUID();
  node.querySelector("img").src =
    actor?.img || "https://dummyimage.com/160x160/111827/ffffff&text=%E2%98%85";
  node.querySelector(".name").textContent = actor?.name || "Unnamed";
  node.querySelector(".meta").textContent = meta.line1;

  node.addEventListener("click", () => selectActor(node.dataset.id));
  return node;
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function clearSheet() {
  sheetEl.innerHTML = `<div class="text-slate-300">Select a character, or hit <span class="text-white font-semibold">Import JSON</span>.</div>`;
}

function pill(text) {
  const tpl = $("#pillTpl");
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.textContent = text;
  return node;
}

function section(title, bodyNode) {
  const wrap = document.createElement("div");
  wrap.className =
    "rounded-3xl bg-white/5 border border-white/10 overflow-hidden";

  const head = document.createElement("button");
  head.className =
    "w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition";
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

function kvGrid(rows) {
  const grid = document.createElement("div");
  grid.className = "grid grid-cols-2 md:grid-cols-3 gap-2";

  for (const [k, v] of rows) {
    const card = document.createElement("div");
    card.className =
      "rounded-2xl bg-slate-950/40 border border-white/10 px-3 py-2";
    card.innerHTML = `<div class="text-xs text-slate-400">${k}</div><div class="font-semibold">${v}</div>`;
    grid.appendChild(card);
  }
  return grid;
}

function listCards(items, subtitleFn) {
  const wrap = document.createElement("div");
  wrap.className = "grid grid-cols-1 md:grid-cols-2 gap-2";
  for (const it of items) {
    const card = document.createElement("div");
    card.className =
      "rounded-2xl bg-slate-950/40 border border-white/10 p-3";
    const sub = subtitleFn ? subtitleFn(it) : "";
    card.innerHTML = `<div class="font-medium">${safeText(
      it.name || "Unnamed"
    )}</div>${sub ? `<div class="text-xs text-slate-400 mt-1">${sub}</div>` : ""}`;
    wrap.appendChild(card);
  }
  return wrap;
}

function inventorySearchNode(gear) {
  const wrap = document.createElement("div");
  wrap.className = "flex flex-col gap-3";

  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search inventory…";
  input.className =
    "w-full rounded-2xl bg-slate-950/40 border border-white/10 px-3 py-2 text-slate-100 " +
    "placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-white/20";

  const listWrap = document.createElement("div");

  const render = () => {
    const q = norm(input.value);
    const filtered = !q ? gear : gear.filter((g) => norm(g?.name).includes(q));
    listWrap.innerHTML = "";
    listWrap.appendChild(
      filtered.length
        ? listCards(filtered, (g) => {
            const qty = g?.system?.quantity;
            const eq = g?.system?.equipped ? "equipped" : "";
            return [`qty ${qty ?? 1}`, eq].filter(Boolean).join(" • ");
          })
        : document.createTextNode("No matching items.")
    );
  };

  input.addEventListener("input", render);
  wrap.appendChild(input);
  wrap.appendChild(listWrap);
  render();
  return wrap;
}

// =======================
// Meta / search corpus
// =======================
function dnd5eMeta(actor) {
  const sys = actor?.system || {};
  const hp = sys?.attributes?.hp;
  const init = sys?.attributes?.init;

  const items = actor?.items || [];
  const classes = items.filter((i) => i?.type === "class");
  const level = totalLevel(actor) || "";
  const classNames = classes.map((c) => c?.name).filter(Boolean).join(", ");

  const derived = dnd5eDerived(actor);
  const acValue = computeAC(actor, derived);

  return {
    line1: [classNames || sys?.details?.class || "Character", level ? `Lv ${level}` : ""]
      .filter(Boolean)
      .join(" • "),
    line2: [
      `AC ${Number.isFinite(acValue) ? acValue : "–"}`,
      `HP ${hp?.value ?? "–"}/${hp?.max ?? "–"}`,
      `PB ${fmtSigned(derived.prof)}`,
    ].join("  ·  "),
    init: init?.mod ?? init?.total ?? init?.value ?? derived?.abilityMods?.dex,
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
  bits.push(sys?.details?.race);
  bits.push(sys?.details?.background);
  for (const it of items) bits.push(it?.name);

  return norm(bits.filter(Boolean).join(" "));
}

// =======================
// Rendering
// =======================
function renderDnd5e(payload) {
  const actor = actorFromPayload(payload);
  const sys = actor?.system || {};
  const meta = dnd5eMeta(actor);
  const derived = dnd5eDerived(actor);
  const acValue = computeAC(actor, derived);

  const root = document.createElement("div");
  root.className = "flex flex-col gap-4";

  // hero
  const hero = document.createElement("div");
  hero.className = "rounded-3xl bg-white/5 border border-white/10 p-4 md:p-5";
  hero.innerHTML = `
    <div class="flex gap-4 items-start">
      <img src="${actor?.img || ""}" class="h-20 w-20 rounded-3xl object-cover border border-white/10" />
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
  const race = sys?.details?.race;
  const bg = sys?.details?.background;
  const align = sys?.details?.alignment;
  [race, bg, align].filter(Boolean).forEach((x) => pills.appendChild(pill(x)));

  root.appendChild(hero);

  // Abilities
  const abilities = sys?.abilities || {};
  const abilityRows = [
    ["STR", `${abilities?.str?.value ?? "–"} (${fmtSigned(derived.abilityMods.str)})`],
    ["DEX", `${abilities?.dex?.value ?? "–"} (${fmtSigned(derived.abilityMods.dex)})`],
    ["CON", `${abilities?.con?.value ?? "–"} (${fmtSigned(derived.abilityMods.con)})`],
    ["INT", `${abilities?.int?.value ?? "–"} (${fmtSigned(derived.abilityMods.int)})`],
    ["WIS", `${abilities?.wis?.value ?? "–"} (${fmtSigned(derived.abilityMods.wis)})`],
    ["CHA", `${abilities?.cha?.value ?? "–"} (${fmtSigned(derived.abilityMods.cha)})`],
  ];
  root.appendChild(section("Abilities", kvGrid(abilityRows)));

  // Combat
  const attr = sys?.attributes || {};
  const movement = attr?.movement || {};
  const combatRows = [
    ["Armour Class", Number.isFinite(acValue) ? acValue : "–"],
    [
      "Hit Points",
      `${attr?.hp?.value ?? "–"} / ${attr?.hp?.max ?? "–"}${
        attr?.hp?.temp ? ` (temp ${attr?.hp?.temp})` : ""
      }`,
    ],
    [
      "Initiative",
      fmtSigned(attr?.init?.mod ?? attr?.init?.total ?? attr?.init ?? derived.abilityMods.dex),
    ],
    ["Proficiency Bonus", fmtSigned(derived.prof)],
    [
      "Speed",
      `walk ${movement?.walk ?? "–"}${movement?.fly ? `, fly ${movement.fly}` : ""}${
        movement?.swim ? `, swim ${movement.swim}` : ""
      }`,
    ],
    ["Passive Perception", Number.isFinite(derived.passivePrc) ? derived.passivePrc : "–"],
  ];
  root.appendChild(section("Combat", kvGrid(combatRows)));

  // Skills
  const skillLabels = {
    acr: "Acrobatics",
    ani: "Animal Handling",
    arc: "Arcana",
    ath: "Athletics",
    dec: "Deception",
    his: "History",
    ins: "Insight",
    itm: "Intimidation",
    inv: "Investigation",
    med: "Medicine",
    nat: "Nature",
    prc: "Perception",
    prf: "Performance",
    per: "Persuasion",
    rel: "Religion",
    sle: "Sleight of Hand",
    ste: "Stealth",
    sur: "Survival",
  };
  const skillRows = Object.keys(skillLabels).map((k) => [
    skillLabels[k],
    fmtSigned(derived.skillTotals?.[k] ?? 0),
  ]);
  root.appendChild(section("Skills", kvGrid(skillRows)));

  // Items
  const items = actor?.items || [];
  const spells = items
    .filter((i) => i?.type === "spell")
    .sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)));
  const feats = items
    .filter((i) => i?.type === "feat")
    .sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)));
  const gearTypes = new Set([
    "weapon",
    "equipment",
    "consumable",
    "tool",
    "loot",
    "backpack",
    "container",
  ]);
  const gear = items
    .filter((i) => gearTypes.has(i?.type))
    .sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)));

  // Spells – include prepared status
  root.appendChild(
    section(
      "Spells",
      spells.length
        ? listCards(spells, (s) => {
            const lvl = s?.system?.level;
            const school = s?.system?.school;
            const prep = spellPreparedLabel(s);
            return [lvl === 0 ? "Cantrip" : `Level ${lvl}`, school, prep]
              .filter(Boolean)
              .join(" • ");
          })
        : document.createTextNode("No spells exported.")
    )
  );

  // Features – filter out common actions
  const cleanedFeats = feats.filter((f) => !shouldHideFeature(f));
  root.appendChild(
    section(
      "Features",
      cleanedFeats.length ? listCards(cleanedFeats) : document.createTextNode("No features exported.")
    )
  );

  // Inventory – per-sheet search
  root.appendChild(
    section(
      "Inventory",
      gear.length ? inventorySearchNode(gear) : document.createTextNode("No inventory exported.")
    )
  );

  // Biography
  const bio = sys?.details?.biography?.value || sys?.details?.biography || "";
  const notes = document.createElement("div");
  notes.className = "prose prose-invert max-w-none text-slate-200/90";
  notes.innerHTML = bio || "<em>No biography exported.</em>";
  root.appendChild(section("Biography", notes));

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
      <img src="${actor?.img || ""}" class="h-20 w-20 rounded-3xl object-cover border border-white/10" />
      <div class="min-w-0 flex-1">
        <h2 class="text-2xl font-semibold tracking-tight truncate">${safeText(actor?.name)}</h2>
        <div class="mt-1 text-slate-300">System: <span class="text-white font-medium">${sysId}</span></div>
        <div class="mt-3 text-slate-300/90">Rich rendering is implemented for dnd5e. Other systems show a raw snapshot.</div>
      </div>
    </div>
  `;
  root.appendChild(hero);

  const pre = document.createElement("pre");
  pre.className =
    "text-xs whitespace-pre-wrap break-words rounded-3xl bg-slate-950/50 border border-white/10 p-4 max-h-[60vh] overflow-auto scrollbar";
  pre.textContent = JSON.stringify(payload, null, 2);

  root.appendChild(section("Raw data", pre));
  return root;
}

function renderSheet(payload) {
  const sysId = guessSystem(payload);
  if (sysId === "dnd5e") return renderDnd5e(payload);
  return renderUnknown(payload);
}

// =======================
// Roster rendering / selection
// =======================
function paintRoster(payloads) {
  rosterEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const p of payloads) frag.appendChild(rosterItem(p));
  rosterEl.appendChild(frag);

  if (!payloads.length) {
    rosterEl.innerHTML = `<div class="p-4 text-slate-300">No characters loaded.</div>`;
    clearSheet();
  }
}

function selectActor(id) {
  selectedId = id;
  const found = allPayloads.find((x) => (actorFromPayload(x.payload)?._id || x.id) === id);
  if (!found) return;

  rosterEl.querySelectorAll("button[data-id]").forEach((b) => {
    b.classList.toggle("bg-white/10", b.dataset.id === id);
  });

  sheetEl.innerHTML = "";
  sheetEl.appendChild(renderSheet(found.payload));
}

function filterRosterBySearch() {
  const q = norm(searchEl.value);
  const filtered = !q ? allPayloads : allPayloads.filter((x) => x.corpus.includes(q));
  paintRoster(filtered.map((x) => x.payload));

  if (selectedId) {
    const still = filtered.some((p) => (actorFromPayload(p.payload)?._id || p.id) === selectedId);
    if (!still) clearSheet();
  }
}

// =======================
// Data loading
// =======================
async function loadManifestPayloads() {
  const res = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
  const manifest = await res.json(); // [{file,name?}]

  const payloads = [];
  for (const entry of manifest) {
    const url = resolveUrl(entry.file);
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) continue;
    const payload = await r.json();
    payloads.push(payload);
  }
  return payloads;
}

function loadLocalPayloads() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveLocalPayloads(payloads) {
  localStorage.setItem(LS_KEY, JSON.stringify(payloads));
}

async function initialise() {
  setStatus("Loading manifest…");
  let manifestPayloads = [];
  try {
    manifestPayloads = await loadManifestPayloads();
  } catch (e) {
    console.warn(e); // not fatal
  }

  const localPayloads = loadLocalPayloads();
  const merged = [...manifestPayloads, ...localPayloads];

  allPayloads = merged
    .map((payload) => {
      const actor = actorFromPayload(payload);
      const id = actor?._id || payload?.id || crypto.randomUUID();
      const meta = getMeta(payload);
      return {
        id,
        name: actor?.name || "Unnamed",
        meta,
        payload,
        corpus: extractSearchCorpus(payload),
      };
    })
    .sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)));

  paintRoster(allPayloads.map((x) => x.payload));
  setStatus(
    allPayloads.length
      ? `${allPayloads.length} character(s) loaded.`
      : "No data loaded – import JSON to begin."
  );
}

// =======================
// Events
// =======================
importBtn.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const files = Array.from(importFile.files || []);
  if (!files.length) return;

  const newPayloads = [];
  for (const f of files) {
    try {
      const text = await f.text();
      const payload = JSON.parse(text);
      newPayloads.push(payload);
    } catch (e) {
      console.warn("Bad JSON:", f.name, e);
    }
  }

  const existingLocal = loadLocalPayloads();
  const mergedLocal = [...existingLocal, ...newPayloads];
  saveLocalPayloads(mergedLocal);

  await initialise();
});

refreshBtn.addEventListener("click", initialise);
searchEl.addEventListener("input", filterRosterBySearch);

initialise();
