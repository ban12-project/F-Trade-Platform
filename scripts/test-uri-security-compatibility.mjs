import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ajvRequire = createRequire(require.resolve("ajv"));
const uri = ajvRequire("fast-uri");
const shadcnRequire = createRequire(require.resolve("shadcn/mcp"));
const socksRequire = createRequire(shadcnRequire.resolve("socks"));
const sdkRequire = createRequire(
  shadcnRequire.resolve("@modelcontextprotocol/sdk/server/index.js"),
);
const limiterRequire = createRequire(sdkRequire.resolve("express-rate-limit"));

test("installed Ajv URI resolver does not promote encoded schemes", () => {
  for (const value of ["%6Aavascript:alert(1)", "%u006Aavascript:alert(1)"]) {
    assert.notEqual(uri.parse(value).scheme, "javascript");
    assert.ok(!uri.normalize(value).startsWith("javascript:"));
    assert.throws(() => uri.resolve("https://synthetic.invalid/", value), /scheme is malformed/);
  }
  assert.equal(uri.equal("%68ttp://synthetic.invalid/", "http://synthetic.invalid/"), false);
});

test("Ajv retains local schema references and validation without network resolution", () => {
  const Ajv = ajvRequire("ajv");
  const ajv = new Ajv();
  ajv.addSchema({ $id: "https://synthetic.invalid/schemas/value", type: "integer", minimum: 1 });
  const validate = ajv.compile({
    $id: "https://synthetic.invalid/schemas/record",
    type: "object",
    properties: { count: { $ref: "value" } },
    required: ["count"],
    additionalProperties: false,
  });
  assert.equal(validate({ count: 1 }), true);
  for (const value of [{ count: 0 }, { count: "1" }, {}, { count: 1, extra: true }]) {
    assert.equal(validate(value), false);
  }
  assert.equal(uri.resolve("https://synthetic.invalid/a/b", "../c"), "https://synthetic.invalid/c");
});

for (const [name, parent] of [
  ["SOCKS", socksRequire],
  ["MCP rate limiter", limiterRequire],
]) {
  const path = parent.resolve("ip-address");
  test(`${name} actual IP parser retains IPv4/IPv6 and rejects bounded adversarial input`, () => {
    const { Address4, Address6 } = parent("ip-address");
    assert.equal(new Address4("192.0.2.1").correctForm(), "192.0.2.1");
    assert.equal(new Address6("2001:db8::1").correctForm(), "2001:db8::1");
    assert.equal(new Address6("fe80::1%eth0").zone, "%eth0");
    assert.equal(Address6.isValid("not-an-address"), false);
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const { Address6 } = require(process.argv[1]);
      if (Address6.isValid("%".repeat(80000) + "\\n")) process.exit(2);
    `,
        path,
      ],
      { timeout: 1500, encoding: "utf8", maxBuffer: 1024 },
    );
    assert.equal(child.error, undefined, "IP rejection exceeded the bounded child deadline");
    assert.equal(child.status, 0);
  });
}
