import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const fixtureRoot = "app/testing";
const dynamicFixturePaths = {
  "/testing/workspace-navigation/[projectId]": [
    "/testing/workspace-navigation/00000000-0000-4000-8000-000000000263",
  ],
  "/testing/workspace-library/[collection]": [
    "/testing/workspace-library/products",
    "/testing/workspace-library/content",
    "/testing/workspace-library/customers",
  ],
};
function fixturePages(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? fixturePages(path)
      : /^page\.(tsx?|jsx?)$/.test(entry.name)
        ? [directory]
        : [];
  });
}
const fixtureRoutes = fixturePages(fixtureRoot)
  .map((directory) =>
    `/testing/${relative(fixtureRoot, directory).split(sep).join("/")}`.replace(/\/$/, ""),
  )
  .filter((route) => route !== "/testing") // Intentionally public static navigation baseline.
  .flatMap((route) => {
    assert.ok(
      !/[()@]/.test(route),
      `Fixture route groups/slots need an explicit URL mapping: ${route}`,
    );
    if (!route.includes("[")) return [route];
    assert.ok(dynamicFixturePaths[route], `Add concrete paths for dynamic fixture: ${route}`);
    return dynamicFixturePaths[route];
  })
  .sort();
assert.ok(fixtureRoutes.length > 0, "Discover at least one private fixture route");

const port = "3119";
const origin = `http://127.0.0.1:${port}`;
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", port],
  {
    env: { ...process.env, NEXT_ENABLE_TESTING_API: "0" },
    stdio: ["ignore", "inherit", "inherit"],
  },
);
let startupError;
child.on("error", (error) => {
  startupError = error;
});
const exited = new Promise((resolve) => child.once("exit", resolve));
const request = (path) =>
  fetch(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(5000) });

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error(`Next.js exited with ${child.exitCode}`);
    try {
      const response = await request("/testing/workspace-navigation");
      await response.arrayBuffer();
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  assert.ok(ready, "Production server must start");
  const unexpectedResponses = [];
  for (const path of fixtureRoutes) {
    const response = await request(path);
    const body = await response.text();
    if (response.status !== 404)
      unexpectedResponses.push({
        path,
        status: response.status,
        streamedNotFound: body.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
      });
  }
  assert.deepEqual(
    unexpectedResponses,
    [],
    "Every private fixture must return an HTTP 404 before streaming",
  );
  const baseline = await request("/testing");
  assert.equal(baseline.status, 200, "Public static navigation baseline remains available");
  assert.match(await baseline.text(), /Playwright 测试基线/);
  for (const path of ["/workspace", "/workspace/00000000-0000-4000-8000-000000000263"]) {
    const response = await request(path);
    await response.arrayBuffer();
    assert.equal(response.status, 307, "Anonymous workspace access must redirect");
    assert.equal(new URL(response.headers.get("location"), origin).pathname, "/auth");
  }
  console.log(
    `PASS production isolation for ${fixtureRoutes.length} fixture paths, public baseline and anonymous workspace authorization boundary`,
  );
} finally {
  if (child.exitCode === null && !startupError) {
    child.kill("SIGTERM");
    await Promise.race([exited, delay(5000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
