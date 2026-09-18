# CamoFox v1.16.0 upgrade validation

Issue: #378. Candidate: jo-inc/camofox-browser at `79d425be26743883a06613eaa3be5e38e7ab5409` (v1.16.0), paired upstream with Camoufox `152.0.4-beta.28`, camoufox-js `0.11.5`, and Playwright `1.59.1`.

The candidate was built in an isolated, credential-free Vercel Sandbox. The image reports Camoufox 152.0.4-beta.28. The existing account environment was not modified.

## Evidence

- 22 browser-node tests passed using Node 24 with the project's tsx loader.
- The login plugin contract passed against the exact release source archive.
- Agent image, browser image, required VNC tools, and preloaded GeoIP database built successfully.
- The read-only, network-disabled real-page startup check failed in Vercel Sandbox. HTTP health alone succeeded, but creation of an actual page timed out.
- GitHub image CI failed on both amd64 and arm64. The amd64 log independently records the same 30-second page creation timeout. Other required application checks passed on the initial candidate.
- Direct server diagnostics reproduced HTTP 500 with `tab create timed out after 30000ms`. This occurred on an empty synthetic session before any Facebook access.

- Setting writable temporary XDG cache/config directories removed dconf warnings but did not resolve page creation. The browser process launches, then the automation connection remains unavailable. Debug output also reports a missing `glxtest` executable; its causal role is not established.

- A second isolated image replaced only the browser binary with official Camoufox `152.0.4-beta.30`, verified against release asset SHA-256 `5720d45b894ce1770543de024c6f10d514b38be560fa2dc3226b3d8586caf672`. It reproduced the same HTTP 500 and 30-second page creation timeout with writable temporary XDG directories.

## Decision

Do not merge or deploy the candidate until real browser startup and image checks pass. The result does not establish whether upgrading resolves Messenger encrypted-history PIN restore failures: that test has not yet been reached.

Keep the existing persistence setting unchanged during version isolation. Its `indexedDB: false` setting means IndexedDB is not included in storage-state checkpoints; this is a separate persistence consideration, not evidence that the user's PIN changed or is incorrect.
