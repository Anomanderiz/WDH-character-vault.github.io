#!/usr/bin/env node
/**
 * Build data/manifest.json from JSON files in data/actors/
 * Usage:
 *   node tools/build-manifest.mjs data/actors data/manifest.json
 */
import fs from "node:fs";
import path from "node:path";

const [,, inDir, outFile] = process.argv;

if (!inDir || !outFile) {
  console.error("Usage: node tools/build-manifest.mjs data/actors data/manifest.json");
  process.exit(1);
}

const files = fs.readdirSync(inDir).filter(f => f.toLowerCase().endsWith(".json"));
const manifest = [];

for (const f of files) {
  const p = path.join(inDir, f);
  const raw = fs.readFileSync(p, "utf8");
  try {
    const payload = JSON.parse(raw);
    const actor = payload?.actor || payload?.data?.actor || payload;
    const name = actor?.name || f.replace(/\.json$/i, "");
    manifest.push({ name, file: `./data/actors/${f}` });
  } catch {
    // skip invalid JSON
  }
}

manifest.sort((a,b) => a.name.localeCompare(b.name));

fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Wrote ${manifest.length} entries to ${outFile}`);
