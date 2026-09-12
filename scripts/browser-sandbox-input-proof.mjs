// Observe synthetic remote DOM state; input itself must arrive through noVNC.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const mode = process.argv[2];
assert.ok(["setup", "mouse", "keyboard"].includes(mode));
const tabId = readFileSync("/tmp/ftrade-synthetic-tab-id", "utf8");
writeFileSync("/tmp/ftrade-lease", String(Date.now() + 90000), { mode: 0o600 });
async function evaluate(expression) {
  const response = await fetch(`http://127.0.0.1:9377/tabs/${tabId}/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "synthetic-profile", expression }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  return (await response.json()).result;
}
if (mode === "setup") {
  assert.equal(
    await evaluate(`(() => {
    document.documentElement.dataset.ftradeClick = '';
    document.addEventListener('click', () => { document.documentElement.dataset.ftradeClick = 'clicked'; }, { once: true });
    return true;
  })()`),
    true,
  );
} else {
  let matched = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    matched = await evaluate(
      mode === "mouse"
        ? "document.documentElement.dataset.ftradeClick === 'clicked'"
        : "location.hash === '#ftrade-keyboard-proof'",
    );
    if (matched) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(matched, true, `remote ${mode} state not observed`);
}
console.log(`PASS remote synthetic ${mode}`);
