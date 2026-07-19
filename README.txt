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
   - Open index.html and you’re done.

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
