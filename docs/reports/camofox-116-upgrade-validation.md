# CamoFox stable upgrade validation

Issue: #378. Source: jo-inc/camofox-browser `79d425be26743883a06613eaa3be5e38e7ab5409` (v1.16.0). All project build entry points select official stable Camoufox `152.0.4-beta.30`; the upstream lockfile supplies camoufox-js 0.11.5 and Playwright 1.59.1.

## Startup failure and isolation

Initial isolated Vercel Sandbox and GitHub amd64/arm64 image checks failed when creating a real page under a read-only root filesystem. HTTP health succeeded, but page creation returned HTTP 500 after 30 seconds. Merely redirecting XDG cache/config directories did not fix this. Both beta.28 and beta.30 reproduced the failure.

Further tests in a fresh, credential-free Vercel Sandbox established:

- Official Python client 0.5.6 with Playwright 1.60 and stable beta.30 opened pages in both headless and headed modes.
- Node Playwright 1.59.1 and 1.60.0 both opened pages in both modes.
- camoufox-js 0.11.5 with the service's Linux, humanization, and cache launch options opened pages outside Docker.
- The same Node client, browser bundle, and launch options passed inside a writable Docker container, but failed under a read-only root filesystem.
- A writable-container filesystem audit identified `/root/camoufox` among newly written paths.
- Adding only a 16 MiB tmpfs at `/root/camoufox` made both minimal and service-style launches pass while retaining the read-only root filesystem and default container security settings.

The runtime now provides that bounded ephemeral directory, alongside the existing `/root/.camoufox` directory needed by the previous browser. Account storage remains in its existing `/data` volume. The image startup check exercises the new mount. Full candidate image CI must pass before rollout.

22 browser-node tests passed after the runtime change. The login plugin contract previously passed against the exact CamoFox release archive.

## PIN acceptance remains separate

The production account environment was not changed during isolation. Successful blank-page creation does not prove Messenger PIN recovery. After the reviewed image is ready, production validation must verify authenticated Messenger history restoration without resetting secure storage.

Keep `indexedDB: false` unchanged while isolating the version change. It means IndexedDB is not included in storage-state checkpoints; this is a separate persistence consideration, not evidence that the PIN changed or is incorrect.
