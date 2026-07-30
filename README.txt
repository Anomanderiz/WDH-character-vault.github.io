Waterdeep Character Vault (static)

A static, zero-server viewer for exported Foundry Actor snapshots. This build uses a glassmorphism Waterdeep theme, the supplied scenic background, and the supplied Waterdeep crest.

Workflow:
1) In Foundry (as GM), run the macro in `foundry-macro-export.js`.
   - It downloads one JSON file per PC.

2) Copy those JSON files into:
   /data/actors/

2b) Optional: add portrait overrides into:
   /data/portraits/
   Naming convention: <Character Name>-img.<ext>
   Example: Goody-img.png
   Supported extensions: .webp, .png, .jpg, .jpeg, .avif

3) Rebuild the manifest:
   - On GitHub: commit or upload the files. The "Build and deploy character
     vault" Action rebuilds and commits the manifest automatically.
   - Locally: node tools/build-manifest.mjs data/actors data/manifest.json

4) Host the folder as a static site (GitHub Pages, Netlify, Cloudflare Pages, etc).
   - The generated vault-config.js file must be present beside index.html.

Password setup
--------------
The password itself is never committed or deployed. Instead, the browser checks it
against either a salted PBKDF2-SHA256 verifier or a standard bcrypt hash.

1) Obtain either:
   - A PBKDF2-SHA256 verifier. The interactive command hides the password:

     node tools/hash-password.mjs

   - A standard 60-character bcrypt hash beginning with "$2a$", "$2b$", or
     "$2y$". A bcrypt cost of at least 12 is recommended.

2) Copy the complete verifier or hash.

3) In the GitHub repository, open Settings > Secrets and variables > Actions,
   choose "New repository secret", and name it:

   VAULT_PASSWORD_HASH

   Paste the verifier or bcrypt hash as its value. The deployment workflow uses the
   secret to create vault-config.js inside the Pages artifact. The workflow fails
   closed if the secret is absent or malformed.

4) Push to main or manually run the "Build and deploy character vault" workflow.

To change the password, generate a new verifier, replace the secret, and run the
deployment workflow again.

Local preview:
1) Set VAULT_PASSWORD_HASH to the generated verifier in your shell.
2) Run:

   node tools/build-auth-config.mjs

3) Serve the repository through a local web server. Opening index.html directly
   from the filesystem will not work because the app fetches JSON and JS modules.

vault-config.js is ignored by Git and must never be committed.

Security boundary:
This password screen is an access deterrent for a static site, not server-side
authentication. GitHub Pages must send the verifier to every browser, so someone
can inspect it, attempt offline password guesses, or bypass the client-side code.
The actor JSON and portraits also remain directly addressable and, in a public
repository, readable from the repository itself. Use a long, unique password. For
genuinely private character data, host the vault behind server-side authentication
or an access-control service instead of public GitHub Pages.

GitHub setup (one time):
- In Settings > Pages > Build and deployment, set Source to "GitHub Actions".
- In Settings > Actions > General > Workflow permissions, allow "Read and write
  permissions" so the Action can commit the rebuilt manifest.
- After that, upload actor JSONs and portraits through GitHub and commit them.
  The Action will update the manifest and deploy the refreshed vault.

Theme assets:
- /assets/waterdeep-bg.jpeg — full-page background image.
- /assets/waterdeep-crest.png — crest used in the header, hero panel, and empty state.

This viewer renders dnd5e snapshots richly. For other systems, it falls back to a raw JSON view.

Cache / refresh behaviour
-------------------------
The Refresh Data button now performs a hard vault refresh: it clears this origin's browser storage/cache entries, reloads the page with a unique `vaultRefresh` query string, and cache-busts app.js, data/manifest.json, actor JSON snapshots, and local portrait checks. This is meant to defeat stale GitHub Pages/browser cache behaviour after pushing new exports.
