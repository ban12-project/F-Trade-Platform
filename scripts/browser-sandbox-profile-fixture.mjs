// Runs inside a disposable test browser container. Only synthetic example.com state.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const mode = process.argv[2];
assert.ok(mode === "write" || mode === "read");
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
}
