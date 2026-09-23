import { writeFileSync } from "node:fs";

const renew = () => writeFileSync("/tmp/ftrade-lease", String(Date.now() + 90000), { mode: 0o600 });
renew();
const heartbeat = setInterval(renew, 10000);
try {
  const headers = {
    Authorization: "Bearer synthetic-only-api-probe-414",
    "Content-Type": "application/json",
  };
  async function req(path, body, method) {
    const r = await fetch(`http://127.0.0.1:9377${path}`, {
      headers,
      method: method ?? (body ? "POST" : "GET"),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(90000),
    });
    const d = await r.json();
    if (!r.ok) throw Error(`http_${r.status}`);
    return d;
  }
  for (let i = 0; i < 60; i++) {
    try {
      const h = await req("/health");
      if (h.ok === true) break;
    } catch {}
    if (i === 59) throw Error("not_ready");
    await new Promise((r) => setTimeout(r, 1000));
  }
  await req("/start", {});
  const mode = process.argv[2];
  const userId = "22222222-2222-4222-8222-222222222222";
  const t = await req("/tabs", {
    userId,
    sessionKey: "probe",
    url: `https://storage.test/?mode=${mode}`,
  });
  let passed = false;
  for (let i = 0; i < 30; i++) {
    const s = await req(`/tabs/${t.tabId}/snapshot?userId=${userId}`);
    const str = JSON.stringify(s);
    if (
      str.includes(
        mode === "write"
          ? "synthetic_key_written"
          : "synthetic_key_restored_nonextractable_roundtrip",
      )
    ) {
      passed = true;
      break;
    }
    if (str.includes("synthetic_failed")) throw Error("fixture_failed");
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!passed) throw Error("snapshot_not_ready");
  const r = await fetch("http://127.0.0.1:9377/tabs", {
    headers,
    method: "POST",
    body: JSON.stringify({
      userId: "other-synthetic-account",
      sessionKey: "probe",
      url: "https://storage.test/?mode=read",
    }),
  });
  if (r.status !== 403) throw Error(`isolation_failed_${r.status}`);
  const sessionClosed = process.argv[3] !== "keep-session";
  if (sessionClosed) await req(`/sessions/${userId}`, null, "DELETE");
  console.log(
    JSON.stringify({ mode, apiRoundTrip: true, otherAccountRejected: true, sessionClosed }),
  );
} finally {
  clearInterval(heartbeat);
}
