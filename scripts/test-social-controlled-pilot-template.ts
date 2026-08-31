import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const template = await readFile(path.join(process.cwd(), "docs/testing/social-controlled-pilot.template.md"), "utf8");
  for (const gate of ["固定美国出口 IP", "签名命令", "Gate 01", "被动 DM", "30 天", "NO_GO"]) assert.match(template, new RegExp(gate));
  assert.match(template, /全部项目通过前，渠道必须保持关闭/);
  console.log("PASS controlled social pilot template requires evidence and fail-closed Go/No-Go");
}

void main();
