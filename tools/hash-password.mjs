import { pbkdf2Sync, randomBytes } from "node:crypto";

const ITERATIONS = 310_000;

async function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    console.error("An interactive terminal is required.");
    console.error("Alternatively run: node tools/hash-password.mjs \"your password\"");
    process.exit(1);
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();

  return new Promise((resolve) => {
    let input = "";
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(input);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          input = input.slice(0, -1);
          continue;
        }
        input += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

let password = process.argv[2];
if (!password) {
  password = await readHidden("Password (input hidden): ");
  const confirmation = await readHidden("Confirm password: ");
  if (password !== confirmation) {
    console.error("Passwords did not match.");
    process.exit(1);
  }
}

if (!password) {
  console.error("Password cannot be empty.");
  process.exit(1);
}

const salt = randomBytes(16);
const digest = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
const verifier = [
  "pbkdf2-sha256",
  ITERATIONS,
  salt.toString("base64"),
  digest.toString("base64")
].join("$");

console.log(verifier);
