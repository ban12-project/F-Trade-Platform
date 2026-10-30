import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const root = createRequire(import.meta.url);
const dotenvx = createRequire(createRequire(root.resolve("shadcn")).resolve("@dotenvx/dotenvx"));
const installed = dirname(dotenvx.resolve("systeminformation"));
const parent = createRequire(join(installed, "processes.js"));

function windowsServices() {
  const commands = [];
  const original = parent("./util");
  const util = {
    ...original,
    powerShell: async (command) => {
      commands.push(command);
      return "Name : syntheticservice\r\nCaption : Synthetic Service\r\nStarted : True\r\nStartMode : Auto\r\nProcessId : 42";
    },
  };
  const denied = new Proxy(
    {},
    {
      get: (_target, key) => () => {
        throw new Error(`Unexpected OS call: ${String(key)}`);
      },
    },
  );
  const module = { exports: {} };
  runInNewContext(
    readFileSync(join(installed, "processes.js"), "utf8"),
    {
      module,
      exports: module.exports,
      process: { platform: "win32", nextTick: process.nextTick.bind(process) },
      require: (name) =>
        name === "./util"
          ? util
          : name === "child_process" || name === "fs"
            ? denied
            : parent(name),
    },
    { filename: "installed-systeminformation-processes.js", timeout: 1000 },
  );
  return { services: module.exports.services, commands };
}

for (const quote of ["\u2018", "\u2019", "\u201c", "\u201d"]) {
  test(`Windows service filter removes Unicode delimiter U+${quote.charCodeAt(0).toString(16)}`, async () => {
    const { services, commands } = windowsServices();
    await services(`synthetic${quote}service`);
    assert.equal(commands.length, 1);
    assert.ok(!commands[0].includes(quote), "untrusted PowerShell quote reached command boundary");
    assert.match(commands[0], /syntheticservice/);
  });
}

test("Windows services preserves valid names, wildcard and callback contracts", async () => {
  const { services, commands } = windowsServices();
  const result = await services("SyntheticService");
  assert.equal(result[0].name, "syntheticservice");
  assert.equal(result[0].running, true);
  assert.equal(result[0].startmode, "Auto");
  assert.match(commands[0], /Name='syntheticservice'/);
  const wildcard = await services("*");
  assert.equal(wildcard[0].name, "syntheticservice");
  assert.ok(!commands[1].includes("-Filter"));
  let callbackResult;
  await services("SyntheticService", (value) => {
    callbackResult = value;
  });
  assert.equal(callbackResult[0].running, true);
  const before = commands.length;
  assert.equal((await services({ invalid: true })).length, 0);
  assert.equal(commands.length, before);
});

// Execute the installed module with synthetic OS responses. No supplied command
// reaches a shell, and no interface path is read from the host filesystem.
function network(platform) {
  const commands = [];
  const paths = [];
  const denied = new Proxy(
    {},
    {
      get: (_target, key) => () => {
        throw new Error(`Unexpected OS call: ${String(key)}`);
      },
    },
  );
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    process: { platform, nextTick: process.nextTick.bind(process) },
    require: (name) => {
      if (name === "child_process")
        return {
          ...denied,
          exec: (command, callback) => {
            commands.push(command);
            callback(
              null,
              platform === "linux"
                ? "up\n100\n200\n0\n0\n0\n0\n"
                : "header\nem0 1500 link mac 1 0 0 100 1 0 200 0 0\n",
            );
          },
        };
      if (name === "fs")
        return {
          existsSync: (path) => {
            paths.push(path);
            return true;
          },
        };
      if (name === "os") return { networkInterfaces: () => ({ em0: [{ internal: false }] }) };
      if (name === "./util") return parent(name);
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  const prototype = runInNewContext(
    `${readFileSync(join(installed, "network.js"), "utf8")}\nObject.prototype;`,
    context,
    { timeout: 1000 },
  );
  return { stats: module.exports.networkStats, commands, paths, prototype };
}

test("Linux rejects traversal before filesystem or shell boundaries", async () => {
  const { stats, paths, commands } = network("linux");
  for (const name of ["../synthetic", "em0/../../synthetic", ".", ".."]) {
    const result = await stats(name);
    assert.equal(result[0].rx_bytes, 0);
  }
  assert.deepEqual(paths, []);
  assert.deepEqual(commands, []);
});

test("Linux keeps valid interface counters and callback contract", async () => {
  const { stats, paths, commands } = network("linux");
  let callbackResult;
  const result = await stats("em0", (value) => {
    callbackResult = value;
  });
  assert.equal(result, callbackResult);
  assert.equal(result[0].rx_bytes, 100);
  assert.equal(result[0].tx_bytes, 200);
  assert.deepEqual(paths, ["/sys/class/net/em0"]);
  assert.equal(commands.length, 1);
});

for (const platform of ["freebsd", "openbsd", "netbsd"]) {
  test(`${platform} interface cache cannot modify Object.prototype`, async () => {
    const { stats, prototype } = network(platform);
    const before = Object.getOwnPropertyDescriptors(prototype);
    const result = await stats("__proto__");
    assert.equal(result[0].rx_bytes, 100);
    assert.equal(result[0].tx_bytes, 200);
    assert.deepEqual(Object.getOwnPropertyDescriptors(prototype), before);
    const valid = await stats("em0");
    assert.equal(valid[0].iface, "em0");
    assert.equal(valid[0].rx_bytes, 100);
  });
}

test("dotenvx systemInformation retains its actual installed caller contract", async () => {
  const entry = root.resolve("@dotenvx/dotenvx", { paths: [dirname(root.resolve("shadcn"))] });
  const Session = createRequire(entry)("../db/session");
  // Invoke only this read-only method; do not construct/open a session store,
  // log host identifiers, authenticate, or contact the dotenvx service.
  const result = await Session.prototype.systemInformation.call({});
  assert.deepEqual(Object.keys(result).sort(), ["os_arch", "os_platform", "system_uuid"]);
  assert.equal(typeof result.os_arch, "string");
  assert.equal(typeof result.os_platform, "string");
  assert.ok(result.system_uuid === undefined || typeof result.system_uuid === "string");
});
