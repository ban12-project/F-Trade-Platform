import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const namespaceCalls = ["clone", "clone3", "unshare"];

// Local Podman diagnostic only. Do not replace the production Docker policy.
export function restrictUserNamespaces(input, architecture = process.arch) {
  if (!["x64", "arm64"].includes(architecture))
    throw new Error("unsupported_clone_argument_layout");
  if (input?.defaultAction !== "SCMP_ACT_ERRNO" || !Array.isArray(input.syscalls))
    throw new Error("expected_deny_by_default_seccomp_profile");
  for (const name of namespaceCalls) {
    const rules = input.syscalls.filter((rule) => rule.names?.includes(name));
    const rule = rules[0];
    if (
      rules.length !== 1 ||
      rule.action !== "SCMP_ACT_ALLOW" ||
      (rule.args?.length ?? 0) !== 0 ||
      Object.keys(rule.includes ?? {}).length !== 0 ||
      Object.keys(rule.excludes ?? {}).length !== 0
    )
      throw new Error("namespace_policy_requires_manual_review");
  }
  const output = structuredClone(input);
  output.syscalls = output.syscalls
    .map((rule) => ({
      ...rule,
      names: rule.names.filter((name) => !namespaceCalls.includes(name)),
    }))
    .filter((rule) => rule.names.length > 0);
  output.syscalls.push(
    {
      names: ["clone", "unshare"],
      action: "SCMP_ACT_ALLOW",
      args: [{ index: 0, value: 0x10000000, valueTwo: 0, op: "SCMP_CMP_MASKED_EQ" }],
    },
    // clone3's flags are behind a pointer; force callers to use filtered clone.
    { names: ["clone3"], action: "SCMP_ACT_ERRNO", errnoRet: 38 },
  );
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination || process.argv.length !== 4)
    throw new Error("usage: node scripts/podman-browser-seccomp.mjs INPUT OUTPUT");
  const profile = restrictUserNamespaces(JSON.parse(readFileSync(source, "utf8")));
  writeFileSync(destination, `${JSON.stringify(profile, null, 2)}\n`, { flag: "wx" });
}
