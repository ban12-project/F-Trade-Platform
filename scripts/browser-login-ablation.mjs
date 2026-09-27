/** Offline source ablation: synthetic DOMs, temporary modules, no account or broker access. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.env.REVIEW_OUTPUT_DIR ?? "artifacts/browser-login-ablation");
const temp = await mkdtemp(join(tmpdir(), "ftrade-login-ablation-"));
const files = [
  "login.mjs",
  "login-flow.mjs",
  "idle.mjs",
  "agent.mjs",
  "login-plugin/automatic-page.js",
  "login-plugin/automatic-runtime.js",
];
const sources = Object.fromEntries(
  await Promise.all(
    files.map(async (f) => [f, await readFile(join(root, "ops/browser-node", f), "utf8")]),
  ),
);
const hash = (s) => createHash("sha256").update(s).digest("hex");
const sourceHashes = Object.fromEntries(files.map((f) => [f, hash(sources[f])]));
const replaceOnce = (s, before, after) => {
  assert.equal(s.split(before).length, 2, `Mutation anchor drift: ${before}`);
  return s.replace(before, after);
};
const variants = [
  { name: "full" },
  { name: "without_ready_preservation", noReady: true },
  { name: "without_observation_retry", noObservation: true },
  { name: "without_both", noReady: true, noObservation: true },
  { name: "without_task_cleanup", noCleanup: true },
];
const scenarios = ["ready", "transient_overflow", "persistent_overflow", "late_identity_conflict"];
const report = {
  classification: "synthetic_engineering_evidence",
  experiment: "browser-login-ablation-v1",
  testedRevision: process.env.REVIEW_REVISION ?? "working-tree",
  nodeVersion: process.version,
  sourceHashes,
  variants: [],
  design:
    "2x2 ready-preservation/observation-shape plus independent task-cleanup ablation; 3 deterministic repeats",
  clock:
    "injected virtual observation sleep; real Chromium DOM; no real elapsed-time or production transport claim",
  rows: [],
  status: "running",
};
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  report.browserVersion = browser.version();
  for (const variant of variants) {
    const dir = join(temp, variant.name);
    await cp(join(root, "ops/browser-node"), dir, { recursive: true });
    if (variant.noReady)
      await writeFile(
        join(dir, "login.mjs"),
        replaceOnce(
          sources["login.mjs"],
          'return outcome === "ready" ? null : "page_contract_failed";',
          'return outcome === "ready" ? "completed" : "page_contract_failed";',
        ),
      );
    if (variant.noObservation)
      await writeFile(
        join(dir, "login-plugin/automatic-page.js"),
        replaceOnce(
          sources["login-plugin/automatic-page.js"],
          `    if (operation === "observe")
      return {
        state: "invalid",
        originVerified: location.origin === "https://www.facebook.com",
        identityVerified: false,
      };
`,
          "",
        ),
      );
    let agent = sources["agent.mjs"];
    if (variant.noCleanup)
      agent = replaceOnce(
        agent,
        `.finally(() => {
        slot.loginTask = null;
      })`,
        "",
      );
    // Execute the exact production settlement block with a recording stop boundary.
    // Network/container retirement remains covered by the separate same-image report.
    const start = "    slot.loginTask = execute(renewed.loginAuthorization)";
    const end = "\n  }\n}\nlet ticking = false;";
    assert.equal(agent.split(start).length, 2);
    assert.equal(agent.split(end).length, 2);
    const block = agent.slice(agent.indexOf(start), agent.indexOf(end));
    report.variants.push({
      name: variant.name,
      settlementBlockHash: hash(block),
      loginModuleHash: hash(await readFile(join(dir, "login.mjs"), "utf8")),
      observationProgramHash: hash(
        await readFile(join(dir, "login-plugin/automatic-page.js"), "utf8"),
      ),
    });
    const settle = new Function(
      "slot",
      "execute",
      "renewed",
      "profile",
      "loginStopOutcome",
      "stop",
      `${block}\nreturn slot.loginTask;`,
    );
    const mod = (p) => import(pathToFileURL(join(dir, p)).href);
    const { loginStopOutcome } = await mod("login.mjs");
    const { viewerGraceExpired } = await mod("idle.mjs");
    const { runFacebookLoginFlow } = await mod("login-flow.mjs");
    const { createAutomaticLoginRuntime } = await mod("login-plugin/automatic-runtime.js");
    const { validateLoginProfile } = await mod("login-plugin/index.js");
    for (let repetition = 1; repetition <= 3; repetition++) {
      for (const scenario of scenarios) {
        const context = await browser.newContext();
        try {
          await context.route("**/*", (route) =>
            route.fulfill({
              contentType: "text/html",
              body: '<div id="chats"><span>No chats</span></div>',
            }),
          );
          await context.addCookies([
            { name: "c_user", value: "123456789", url: "https://www.facebook.com" },
          ]);
          const page = await context.newPage();
          await page.goto("https://www.facebook.com/messages/");
          await page.evaluate(
            ({ overflow, wrong }) => {
              const identity = document.createElement("script");
              identity.type = "application/json";
              identity.textContent = JSON.stringify({
                require: [
                  [
                    "CurrentUserInitialData",
                    [],
                    { USER_ID: wrong ? "999999999" : "123456789", ACCOUNT_ID: "123456789" },
                    1,
                  ],
                ],
              });
              document.head.append(identity);
              if (overflow) {
                const payload = document.createElement("script");
                payload.id = "overflow";
                payload.type = "application/json";
                payload.textContent = JSON.stringify({ unrelated: "x".repeat(4_000_000) });
                document.head.append(payload);
              }
            },
            { overflow: scenario !== "ready", wrong: scenario === "late_identity_conflict" },
          );
          const profile = validateLoginProfile({
            version: 2,
            reviewRef: "evidence-synthetic-ablation",
            reviewedAt: new Date(Date.now() - 1000).toISOString(),
            expiresAt: new Date(Date.now() + 180000).toISOString(),
            url: "https://www.facebook.com/login/",
            form: "#login",
            username: "#user",
            password: "#password",
            automation: {
              mode: "observe-only",
              accountRef: "123456789",
              identity: {
                selector: 'script[type="application/json"]',
                attribute: "facebook-current-user",
              },
              passwordSubmit: "#submit",
              totp: {
                url: "https://www.facebook.com/two_factor/",
                marker: "#totp",
                input: "#code",
                submit: "#verify",
              },
              pin: {
                url: "https://www.facebook.com/messages/",
                marker: "#pin",
                input: "#pin-code",
                submit: "#restore",
              },
              ready: {
                url: "https://www.facebook.com/messages/",
                marker: "#chats",
                empty: "span",
                emptyText: "No chats",
                thread: "a[data-thread-id]",
              },
              checkpoint: "#checkpoint",
              rejected: "#rejected",
              loading: "#loading",
            },
          });
          const packet = {
            userId: "00000000-0000-4000-8000-000000000001",
            runId: "00000000-0000-4000-8000-000000000002",
            requestId: "00000000-0000-4000-8000-000000000003",
            tabId: "tab",
            expiresAt: Date.now() + 60000,
          };
          const runtime = createAutomaticLoginRuntime({
            accountId: packet.userId,
            runId: packet.runId,
            profile,
            leaseDeadline: () => packet.expiresAt,
            sessions: new Map([
              [
                packet.userId,
                { tabGroups: new Map([[packet.runId, new Map([["tab", { page }]])]]) },
              ],
            ]),
          });
          let reads = 0,
            claims = 0,
            submissions = 0,
            clock = 0;
          const result = await runFacebookLoginFlow({
            observeOnly: true,
            deadline: 30000,
            now: () => clock,
            sleep: async (ms) => {
              clock += ms;
            },
            assertActive() {},
            acquireCredentials() {
              claims++;
              throw new Error("unexpected credential claim");
            },
            submit() {
              submissions++;
              throw new Error("unexpected submission");
            },
            async observe() {
              const value = await runtime("observe", packet);
              if (++reads === 1 && scenario !== "persistent_overflow")
                await page.locator("#overflow").evaluateAll((elements) =>
                  elements.forEach((el) => {
                    el.remove();
                  }),
                );
              return value;
            },
          });
          const slot = { loginTask: null };
          const stops = [];
          await settle(
            slot,
            async () => result.outcome,
            { loginAuthorization: {} },
            profile,
            loginStopOutcome,
            async (_slot, reason) => {
              stops.push(reason);
            },
          );
          const state = {
            automatic: true,
            loginTask: Boolean(slot.loginTask),
            connected: true,
            pendingConnection: false,
            readyAt: 1,
          };
          const row = {
            variant: variant.name,
            scenario,
            repetition,
            outcome: result.outcome,
            reads,
            claims,
            submissions,
            immediateStop: stops[0] ?? null,
            taskCleared: !slot.loginTask,
            connectedPreserved: stops.length === 0 && !viewerGraceExpired(state, 100001),
            pendingPreserved:
              stops.length === 0 &&
              !viewerGraceExpired({ ...state, connected: false, pendingConnection: true }, 100001),
            idleRetires: viewerGraceExpired({ ...state, connected: false }, 60002),
            disconnectRetires: viewerGraceExpired({ ...state, disconnectedAt: 1 }, 15002),
          };
          report.rows.push(row);
          const ready =
            scenario === "ready" || (scenario === "transient_overflow" && !variant.noObservation);
          assert.equal(row.outcome, ready ? "ready" : "refused");
          assert.equal(
            reads,
            scenario === "ready" || variant.noObservation
              ? 1
              : scenario === "persistent_overflow"
                ? 21
                : 2,
          );
          assert.equal(claims + submissions, 0);
          assert.equal(
            row.immediateStop,
            ready ? (variant.noReady ? "completed" : null) : "page_contract_failed",
          );
          assert.equal(row.connectedPreserved, ready && !variant.noReady);
          assert.equal(row.pendingPreserved, ready && !variant.noReady);
          assert.equal(row.taskCleared, !variant.noCleanup);
          assert.equal(row.idleRetires, !variant.noCleanup);
          assert.equal(row.disconnectRetires, !variant.noCleanup);
        } finally {
          await context.close();
        }
      }
    }
  }
  report.status = "pass";
} catch (error) {
  report.status = "fail";
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  const after = Object.fromEntries(
    await Promise.all(
      files.map(async (f) => [f, hash(await readFile(join(root, "ops/browser-node", f), "utf8"))]),
    ),
  );
  report.productionSourcesUnchanged = JSON.stringify(after) === JSON.stringify(sourceHashes);
  if (!report.productionSourcesUnchanged) {
    report.status = "fail";
    process.exitCode = 1;
  }
  await rm(temp, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "login-ablation.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      status: report.status,
      rows: report.rows.length,
      productionSourcesUnchanged: report.productionSourcesUnchanged,
      ...(report.error ? { error: report.error } : {}),
    }),
  );
}
