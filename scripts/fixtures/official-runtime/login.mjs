import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runFacebookLoginFlow } from "/project/browser-node/login-flow.mjs";

const origin = "https://www.facebook.com";
const accountRef = "123456789012345";
export function configureLoginFixture(accountId, runId) {
  process.env.FTRADE_ACCOUNT_ID = accountId;
  process.env.FTRADE_RUN_ID = runId;
  process.env.FTRADE_RUN_KIND = "interactive";
  process.env.FTRADE_ACCOUNT_REF = accountRef;
  process.env.FTRADE_LOGIN_PROFILE_JSON = JSON.stringify({
    version: 2,
    reviewRef: "evidence-official-synthetic-login",
    reviewedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    url: `${origin}/login/`,
    form: "#login",
    username: "#username",
    password: "#password",
    automation: {
      accountRef,
      identity: { selector: "#identity", attribute: "data-account-id" },
      passwordSubmit: "#password-submit",
      totp: {
        url: `${origin}/synthetic-totp`,
        marker: "#totp",
        input: "#code",
        submit: "#totp-submit",
      },
      pin: {
        url: `${origin}/synthetic-pin`,
        marker: "#pin",
        input: "#code",
        submit: "#pin-submit",
      },
      ready: {
        url: `${origin}/messages/`,
        marker: "#ready",
        empty: ".empty",
        emptyText: "No messages",
        thread: ".thread",
      },
      checkpoint: "#checkpoint",
      rejected: "#rejected",
      loading: "#loading",
    },
  });
}

export async function verifyLoginContracts({ context, accountId, runId, accessKey }) {
  const before = new Set(context.pages());
  let variant = "normal";
  const identity = () =>
    `<div id="identity" data-account-id="${variant === "wrong" ? "999999999999999" : accountRef}">Synthetic owner</div>`;
  const form = (phase, fields, next) =>
    `<form id="${phase === "password" ? "login" : phase}" method="post" action="/login/" onsubmit="event.preventDefault();localStorage.setItem('${phase}-count',String(Number(localStorage.getItem('${phase}-count')||0)+1));setTimeout(()=>location.href='${next}',50)">${fields}<button id="${phase}-submit" type="submit">Continue</button></form>`;
  const route = async (r) => {
    const path = new URL(r.request().url()).pathname;
    const body =
      path === "/login/"
        ? form(
            "password",
            '<input id="username"><input id="password" type="password">',
            "/synthetic-totp",
          )
        : path === "/synthetic-totp"
          ? form("totp", '<input id="code">', "/synthetic-pin")
          : path === "/synthetic-pin"
            ? identity() + form("pin", '<input id="code">', "/messages/")
            : path === "/checkpoint"
              ? '<div id="checkpoint">Synthetic human verification</div>'
              : ` ${identity()}<div id="ready"><div class="empty">No messages</div></div>`;
    await r.fulfill({ contentType: "text/html", body: `<!doctype html>${body}` });
  };
  await context.route(`${origin}/**`, route);
  const request = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:9377${path}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(35000),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const status = await request("/ftrade/login-status");
    assert.equal(status.version, 2);
    assert.equal(status.runId, runId);
    const tab = await request("/tabs", {
      userId: accountId,
      sessionKey: runId,
      url: `${origin}/checkpoint`,
    });
    const packet = {
      userId: accountId,
      runId,
      tabId: tab.tabId,
      requestId: randomUUID(),
      expiresAt: Date.now() + 85000,
    };
    const observe = () => request("/ftrade/login-observe", packet);
    assert.equal((await observe()).state, "checkpoint");
    assert.equal(
      (
        await request("/ftrade/login-submit", {
          ...packet,
          userId: randomUUID(),
          phase: "password",
          values: { username: "synthetic", password: "synthetic-only" },
        })
      ).outcome,
      "refused",
    );
    await request(`/tabs/${tab.tabId}/navigate`, { userId: accountId, url: `${origin}/login/` });
    const credentials = {
      username: "synthetic",
      password: "synthetic-only",
      totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      messengerPin: "123456",
    };
    const outcome = await runFacebookLoginFlow({
      credentials,
      observe,
      submit: async (phase, values) =>
        (await request("/ftrade/login-submit", { ...packet, phase, values })).outcome,
      assertActive() {
        assert.ok(Date.now() < packet.expiresAt);
      },
      deadline: packet.expiresAt,
    });
    assert.equal(outcome.outcome, "ready");
    assert.equal(outcome.historyEvidence, "empty_inbox");
    assert.deepEqual(outcome.factorPrompts, ["password", "totp", "pin"]);
    const counts = await request(`/tabs/${tab.tabId}/evaluate`, {
      userId: accountId,
      expression: "['password','totp','pin'].map(p=>localStorage.getItem(p+'-count'))",
    });
    assert.deepEqual(counts.result, ["1", "1", "1"]);
    assert.equal(
      (
        await request("/ftrade/login-submit", {
          ...packet,
          phase: "password",
          values: { username: "synthetic", password: "synthetic-only" },
        })
      ).outcome,
      "refused",
    );
    variant = "wrong";
    await request(`/tabs/${tab.tabId}/navigate`, { userId: accountId, url: `${origin}/messages/` });
    assert.equal((await observe()).accountMismatch, true);
    console.log(
      "PASS official service login integration: synthetic password/TOTP/PIN, checkpoint observation, one submission per factor, empty inbox evidence and identity mismatch; no external authentication",
    );
  } finally {
    await context.unroute(`${origin}/**`, route);
    for (const page of context.pages()) if (!before.has(page)) await page.close();
  }
}
