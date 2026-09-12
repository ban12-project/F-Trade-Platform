// Runs inside a disposable test browser container. Only synthetic example.com state.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const mode = process.argv[2];
assert.ok(mode === "write" || mode === "read");
// Fetch cancellation alone cannot bound native browser startup diagnostics.
const hardDeadline = setTimeout(() => process.exit(124), 110000);
const timer = setInterval(
  () => writeFileSync("/tmp/ftrade-lease", String(Date.now() + 90000)),
  5000,
);
async function api(path, body) {
  const response = await fetch(`http://127.0.0.1:9377${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (response.status !== 200) {
    // This fixture has synthetic data only; retain the error for live diagnosis.
    try {
      const { launchOptions } = await import("/app/node_modules/camoufox-js/dist/index.js");
      const options = await launchOptions({
        executable_path: "/root/.cache/camoufox/camoufox-bin",
        headless: true,
        exclude_addons: ["UBO"],
        enable_cache: true,
      });
      console.log("Synthetic diagnostic: launch options resolved");
      const { firefox } = await import("/app/node_modules/playwright-core/index.mjs");
      const browser = await firefox.launch({ ...options, timeout: 20000 });
      await browser.close();
      console.log("Synthetic diagnostic: headless browser launched");
    } catch (error) {
      console.log("Synthetic launch diagnostic:", String(error).slice(0, 3000));
    }
    throw new Error(
      `browser API ${path}: ${response.status} ${(await response.text()).slice(0, 2000)}`,
    );
  }
  return response.json();
}
try {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (
      await fetch("http://127.0.0.1:9377/health")
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const userId = "synthetic-profile";
  const tab = await api("/tabs", { userId, sessionKey: "synthetic", url: "https://example.com" });
  assert.ok(tab.tabId);
  writeFileSync("/tmp/ftrade-synthetic-tab-id", tab.tabId, { mode: 0o600 });
  if (mode === "write")
    await api(`/tabs/${tab.tabId}/evaluate`, {
      userId,
      expression: `(() => { document.cookie = 'ftrade_synthetic=restored; Max-Age=3600; Path=/; Secure'; localStorage.setItem('ftrade_synthetic', 'restored'); return true; })()`,
    });
  const state = await api(`/tabs/${tab.tabId}/evaluate`, {
    userId,
    expression: `({ cookie: document.cookie.includes('ftrade_synthetic=restored'), storage: localStorage.getItem('ftrade_synthetic') })`,
  });
  assert.deepEqual(state.result, { cookie: true, storage: "restored" });
  console.log(`PASS synthetic browser ${mode}: cookie and localStorage`);
} finally {
  clearInterval(timer);
  clearTimeout(hardDeadline);
}
