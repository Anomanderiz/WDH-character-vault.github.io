const SESSION_KEY = "waterdeep-vault-auth";
const PBKDF2_PATTERN = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;
const BCRYPT_PATTERN = /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/;

const gateEl = document.querySelector("#vault-gate");
const appEl = document.querySelector("#vault-app");
const formEl = document.querySelector("#vault-gate-form");
const passwordEl = document.querySelector("#vault-password");
const unlockEl = document.querySelector("#vault-unlock");
const statusEl = document.querySelector("#vault-gate-status");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function readVerifier() {
  if (!window.VAULT_CONFIG_LOADED) {
    throw new Error("Password configuration was not found.");
  }

  const verifier = window.VAULT_AUTH?.passwordVerifier;
  const pbkdf2Match = typeof verifier === "string" ? verifier.match(PBKDF2_PATTERN) : null;
  if (pbkdf2Match) {
    const iterations = Number(pbkdf2Match[1]);
    if (!Number.isSafeInteger(iterations) || iterations < 100_000) {
      throw new Error("Password configuration uses an unsafe iteration count.");
    }

    return {
      algorithm: "pbkdf2-sha256",
      raw: verifier,
      iterations,
      salt: decodeBase64(pbkdf2Match[2]),
      expected: decodeBase64(pbkdf2Match[3])
    };
  }

  if (typeof verifier === "string" && BCRYPT_PATTERN.test(verifier)) {
    return {
      algorithm: "bcrypt",
      raw: verifier
    };
  }

  throw new Error("Password configuration is missing or invalid.");
}

async function verifyPassword(password, verifier) {
  if (verifier.algorithm === "bcrypt") {
    if (typeof window.bcrypt?.compare !== "function") {
      throw new Error("The bcrypt verifier failed to load.");
    }
    return window.bcrypt.compare(password, verifier.raw);
  }

  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: verifier.salt,
      iterations: verifier.iterations
    },
    passwordKey,
    verifier.expected.length * 8
  );
  return equalBytes(new Uint8Array(bits), verifier.expected);
}

async function openVault(verifier) {
  const cacheBust = window.VAULT_CACHE_BUST || Date.now().toString(36);
  await import(`./app.js?v=${encodeURIComponent(cacheBust)}`);

  try {
    sessionStorage.setItem(SESSION_KEY, verifier.raw);
  } catch {}

  gateEl.hidden = true;
  appEl.removeAttribute("inert");
  appEl.setAttribute("aria-hidden", "false");
  document.body.classList.remove("vault-locked");
}

function disableGate(message) {
  passwordEl.disabled = true;
  unlockEl.disabled = true;
  unlockEl.classList.add("opacity-70", "cursor-not-allowed");
  setStatus(message, true);
}

let verifier;
try {
  verifier = readVerifier();
} catch (error) {
  console.error(error);
  disableGate("The vault password has not been configured. Ask the vault keeper for help.");
}

if (verifier) {
  let savedVerifier = "";
  try {
    savedVerifier = sessionStorage.getItem(SESSION_KEY) || "";
  } catch {}

  if (savedVerifier === verifier.raw) {
    setStatus("Restoring this session\u2026");
    openVault(verifier).catch((error) => {
      console.error(error);
      disableGate("The vault could not be opened. Please reload and try again.");
    });
  } else {
    setStatus("");
    passwordEl.focus();

    formEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = passwordEl.value;
      if (!password) return;

      passwordEl.disabled = true;
      unlockEl.disabled = true;
      unlockEl.classList.add("opacity-70", "cursor-wait");
      setStatus("Testing the wards\u2026");

      let accepted = false;
      try {
        accepted = await verifyPassword(password, verifier);
      } catch (error) {
        console.error(error);
        disableGate("This browser could not verify the password.");
        return;
      }

      passwordEl.value = "";
      if (accepted) {
        setStatus("The vault opens\u2026");
        try {
          await openVault(verifier);
        } catch (error) {
          console.error(error);
          disableGate("The vault could not be opened. Please reload and try again.");
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 650));
      passwordEl.disabled = false;
      unlockEl.disabled = false;
      unlockEl.classList.remove("opacity-70", "cursor-wait");
      setStatus("That password did not open the vault.", true);
      passwordEl.focus();
    });
  }
}
