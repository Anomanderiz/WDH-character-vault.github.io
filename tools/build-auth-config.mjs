import { writeFile } from "node:fs/promises";

const CONFIG_PATTERN = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;
const outputPath = process.argv[2] || "vault-config.js";
const verifier = process.env.VAULT_PASSWORD_HASH?.trim();
const match = verifier?.match(CONFIG_PATTERN);

if (!match) {
  console.error("VAULT_PASSWORD_HASH is missing or is not a valid PBKDF2-SHA256 verifier.");
  console.error("Generate one with: node tools/hash-password.mjs \"your password\"");
  process.exit(1);
}

const iterations = Number(match[1]);
if (!Number.isSafeInteger(iterations) || iterations < 100_000) {
  console.error("VAULT_PASSWORD_HASH must use at least 100,000 PBKDF2 iterations.");
  process.exit(1);
}

const config = `window.VAULT_AUTH = ${JSON.stringify({ passwordVerifier: verifier })};\n`;
await writeFile(outputPath, config, "utf8");
console.log(`Created ${outputPath}`);
