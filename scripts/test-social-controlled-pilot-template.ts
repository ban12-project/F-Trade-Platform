import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const template = await readFile(
    path.join(process.cwd(), "docs/testing/social-controlled-pilot.template.md"),
    "utf8",
  );
  for (const gate of ["固定美国出口 IP", "签名命令", "Gate 01", "被动 DM", "30 天", "NO_GO"])
    assert.match(template, new RegExp(gate));
  assert.match(template, /共同前置条件缺失时全部 NO_GO/);
  assert.match(template, /文本通过不能放行单图、视频、登录恢复或入站/);
  assert.match(template, /未分流消息保持 `leadId = null`/);
  assert.match(template, /未知外部效果不得重试/);
  assert.match(template, /同一 Issue 补充 PR/);
  assert.match(template, /不随入站验收启用/);
  console.log("PASS controlled social pilot template requires evidence and fail-closed Go/No-Go");
}

void main();
