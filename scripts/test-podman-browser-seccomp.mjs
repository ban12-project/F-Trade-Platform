import assert from "node:assert/strict";
import { restrictUserNamespaces } from "./podman-browser-seccomp.mjs";

const input = {
  defaultAction: "SCMP_ACT_ERRNO",
  defaultErrnoRet: 1,
  syscalls: [
    { names: ["read", "write", "clone", "clone3", "unshare"], action: "SCMP_ACT_ALLOW" },
    { names: ["ptrace"], action: "SCMP_ACT_ERRNO", errnoRet: 1 },
  ],
};
const before = structuredClone(input);
const output = restrictUserNamespaces(input, "x64");
assert.deepEqual(input, before);
assert.equal(output.defaultAction, input.defaultAction);
assert.deepEqual(output.syscalls.slice(0, 2), [
  { names: ["read", "write"], action: "SCMP_ACT_ALLOW" },
  input.syscalls[1],
]);
const rule = output.syscalls.find((entry) => entry.names.includes("clone"));
const allowsFlags = (flags) =>
  rule.args.every(
    (arg) =>
      arg.index === 0 && arg.op === "SCMP_CMP_MASKED_EQ" && (flags & arg.value) === arg.valueTwo,
  );
assert.equal(allowsFlags(0x10000000 | 17), false);
assert.equal(allowsFlags(17), true);
assert.equal(allowsFlags(0x10f00), true);
assert.deepEqual(restrictUserNamespaces(input, "arm64"), output);
assert.throws(() => restrictUserNamespaces(input, "s390x"), /argument_layout/);
assert.throws(
  () => restrictUserNamespaces({ ...input, defaultAction: "SCMP_ACT_ALLOW" }),
  /deny_by_default/,
);
for (const change of [
  (p) => p.syscalls.push({ names: ["clone"], action: "SCMP_ACT_ERRNO" }),
  (p) => {
    p.syscalls[0].args = [{ index: 0, value: 17, op: "SCMP_CMP_EQ" }];
  },
  (p) => {
    p.syscalls[0].includes = { caps: ["CAP_SYS_ADMIN"] };
  },
  (p) => {
    p.syscalls[0].names = ["read", "write"];
  },
]) {
  const changed = structuredClone(input);
  change(changed);
  assert.throws(() => restrictUserNamespaces(changed), /manual_review/);
}
console.log(
  "PASS: local Podman namespace filter retains unrelated restrictions and rejects unknown policies",
);
