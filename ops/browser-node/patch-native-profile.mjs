import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const hashes = {
  "server.js": "6dfc9cf2cb1e5ed208a649a2696f39c892008638021207482ac842dab1c0c879",
  "plugins/persistence/index.js":
    "47724352f30a46ab7bda98533ff8228fe64d173995b97425fca62bf32c56e3fa",
};
export function patchNativeProfileSource(file, source) {
  if (createHash("sha256").update(source).digest("hex") !== hashes[file])
    throw new Error("native_profile_upstream_changed");
  const replacements =
    file === "server.js"
      ? [
          [
            "async function launchBrowserInstance() {",
            'const nativeProfile = createNativeProfileRuntime({ firefox });\n\nasync function launchBrowserInstance() {\n  if (nativeProfile && (MAX_SESSIONS !== 1 || proxyPool?.canRotateSessions))\n    throw new Error("native_profile_requires_one_fixed_account");',
          ],
          [
            "candidateBrowser = await firefox.launch(options);",
            "candidateBrowser = nativeProfile\n        ? await nativeProfile.launch({ ...options, viewport: null, ...contextIdentityOptions({ hasProxy: !!proxyPool, directIdentity: CONFIG.directIdentity }) })\n        : await firefox.launch(options);",
          ],
          [
            "async function getSession(userId, { trace = false } = {}) {",
            "async function getSession(userId, { trace = false } = {}) {\n  nativeProfile?.assertAccount(userId);",
          ],
          [
            "const context = await b.newContext(contextOptions);",
            "const context = nativeProfile ? await nativeProfile.contextFor(key) : await b.newContext(contextOptions);",
          ],
        ]
      : [
          [
            "export async function register(app, ctx, pluginConfig = {}) {",
            'export async function register(app, ctx, pluginConfig = {}) {\n  // Native profile startup owns migration and persistence. JSON restore must not overwrite it.\n  if (process.env.FTRADE_NATIVE_PROFILE === "1") return;',
          ],
        ];
  let result = source;
  for (const [before, after] of replacements) {
    if (result.split(before).length !== 2) throw new Error("native_profile_patch_ambiguous");
    result = result.replace(before, after);
  }
  if (file === "server.js")
    result = `import { createNativeProfileRuntime } from "./ftrade-native-profile.mjs";\n${result}`;
  return result;
}
export async function patchNativeProfile(root) {
  const files = await Promise.all(
    Object.keys(hashes).map(async (file) => ({
      file,
      content: patchNativeProfileSource(file, await readFile(join(root, file), "utf8")),
    })),
  );
  // Validate every pinned input before modifying any file.
  for (const { file, content } of files) await writeFile(join(root, file), content);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await patchNativeProfile(process.argv[2] ?? "/app");
