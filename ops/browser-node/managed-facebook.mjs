import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const configurationKeys = [
  "BROWSER_TASK_ADAPTER",
  "FACEBOOK_DOM_PROFILES_FILE",
  "FACEBOOK_INBOX_PROFILES_FILE",
  "FACEBOOK_LOGIN_PROFILES_FILE",
];

// Private administrator-owned files, never paths or scripts supplied by a job.
export async function managedFacebookEnvironment(directory, nodeId, environment = process.env) {
  if (!directory) return {};
  try {
    if (configurationKeys.some((key) => environment[key])) throw new Error();
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700)
      throw new Error();
    async function readPrivate(name, limit) {
      const file = await open(
        join(directory, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const stat = await file.stat();
        if (
          !stat.isFile() ||
          stat.uid !== process.getuid() ||
          (stat.mode & 0o777) !== 0o600 ||
          stat.size > limit
        )
          throw new Error();
        const source = await file.readFile("utf8");
        if (Buffer.byteLength(source) > limit) throw new Error();
        return source;
      } finally {
        await file.close();
      }
    }
    let source;
    try {
      source = await readPrivate("manifest.json", 4096);
    } catch (error) {
      // An empty provisioned directory intentionally retains interactive-only mode.
      if (error.code === "ENOENT") return {};
      throw error;
    }
    const manifest = JSON.parse(source);
    if (
      !manifest ||
      Object.keys(manifest).sort().join(",") !== "inbox,login,nodeId,publish,version" ||
      manifest.version !== 1 ||
      manifest.nodeId !== nodeId ||
      ![manifest.publish, manifest.inbox, manifest.login].every(
        (value) => typeof value === "boolean",
      )
    )
      throw new Error();
    const result = {};
    for (const [enabled, file, key] of [
      [manifest.publish, "publication.json", "FACEBOOK_DOM_PROFILES_FILE"],
      [manifest.inbox, "inbox.json", "FACEBOOK_INBOX_PROFILES_FILE"],
      [manifest.login, "login.json", "FACEBOOK_LOGIN_PROFILES_FILE"],
    ]) {
      if (!enabled) continue;
      // Existing capability loaders subsequently validate schema, scope and expiry.
      const values = JSON.parse(await readPrivate(file, 64000));
      if (!Array.isArray(values) || values.length < 1 || values.length > 16) throw new Error();
      result[key] = join(directory, file);
    }
    if (manifest.publish || manifest.inbox)
      result.BROWSER_TASK_ADAPTER = fileURLToPath(
        new URL("./facebook-adapter.mjs", import.meta.url),
      );
    return result;
  } catch {
    // JSON parse/provider errors can contain private account or selector data.
    throw new Error("managed_facebook_configuration_invalid");
  }
}
