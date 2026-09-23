import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function scope(accountId, nodeId) {
  if (!uuid.test(accountId ?? "") || !uuid.test(nodeId ?? ""))
    throw new Error("native_profile_scope_invalid");
  return { version: 1, accountId, nodeId };
}
function paths(root, accountId) {
  const directory = join(root, "native-profile-v1");
  const hash = createHash("sha256").update(accountId).digest("hex").slice(0, 32);
  return {
    directory,
    profile: join(directory, "firefox"),
    manifest: join(directory, "owner.json"),
    legacyDirectory: join(root, "profiles", hash),
    legacy: join(root, "profiles", hash, "storage-state.json"),
  };
}
async function directory(path, privateMode = false) {
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o022) !== 0 ||
    (privateMode && (stat.mode & 0o777) !== 0o700)
  )
    throw new Error("native_profile_directory_invalid");
}
async function privateJson(path, limit, strictMode = true) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o022) !== 0 ||
      (strictMode && (stat.mode & 0o777) !== 0o600) ||
      stat.size > limit
    )
      throw new Error("native_profile_file_invalid");
    const text = await file.readFile("utf8");
    if (Buffer.byteLength(text) > limit) throw new Error("native_profile_file_invalid");
    return { value: JSON.parse(text), text };
  } finally {
    await file.close();
  }
}
async function legacyState(root, accountId) {
  const p = paths(root, accountId);
  await directory(join(root, "profiles"));
  await directory(p.legacyDirectory);
  const { value, text } = await privateJson(p.legacy, 16 * 1024 * 1024, false);
  if (!value || !Array.isArray(value.cookies) || !Array.isArray(value.origins))
    throw new Error("native_profile_legacy_invalid");
  // Legacy JSON cannot preserve non-extractable keys. Do not pretend to migrate them.
  if (value.origins.some((origin) => origin.indexedDB?.length))
    throw new Error("native_profile_legacy_indexeddb_unsupported");
  return { value, digest: createHash("sha256").update(text).digest("hex") };
}

/** Explicit local administration, never called by task startup or an HTTP route.
 * The original JSON is retained for rollback. Runtime startup cannot initialize
 * a missing profile, so a missing volume cannot silently become a fresh login.
 */
export async function initializeNativeProfile({ root = "/data", accountId, nodeId, source }) {
  const identity = scope(accountId, nodeId);
  if (!["empty", "legacy-json"].includes(source)) throw new Error("native_profile_source_invalid");
  await directory(root);
  const p = paths(root, accountId);
  let digest = null;
  if (source === "legacy-json") digest = (await legacyState(root, accountId)).digest;
  else {
    // An existing legacy snapshot requires an explicit migration choice.
    try {
      await lstat(p.legacy);
      throw new Error("native_profile_migration_required");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  // Exclusive creation: partial initialization is an operator-visible failure,
  // never an invitation to overwrite or recreate the directory automatically.
  await mkdir(p.directory, { mode: 0o700 });
  await mkdir(p.profile, { mode: 0o700 });
  await writeFile(
    p.manifest,
    JSON.stringify({ ...identity, source, legacyDigest: digest, imported: source === "empty" }),
    { flag: "wx", mode: 0o600 },
  );
}

export function createNativeProfileRuntime({
  firefox,
  environment = process.env,
  root = "/data",
  leaseDeadline = async () => Number(await readFile("/tmp/ftrade-lease", "utf8")),
}) {
  const mode = environment.FTRADE_NATIVE_PROFILE ?? "0";
  if (mode === "0") return null;
  if (mode !== "1") throw new Error("native_profile_mode_invalid");
  const identity = scope(environment.FTRADE_PROFILE_ACCOUNT_ID, environment.FTRADE_PROFILE_NODE_ID);
  const p = paths(root, identity.accountId);
  let context;
  async function active() {
    const deadline = await leaseDeadline();
    if (!Number.isFinite(deadline) || deadline <= Date.now())
      throw new Error("native_profile_lease_expired");
  }
  function assertAccount(userId) {
    if (String(userId) !== identity.accountId)
      throw Object.assign(new Error("native_profile_account_mismatch"), { statusCode: 403 });
  }
  return {
    assertAccount,
    async launch(options) {
      await active();
      await directory(root);
      await directory(p.directory, true);
      await directory(p.profile, true);
      const { value: manifest } = await privateJson(p.manifest, 4096);
      if (
        Object.keys(manifest).sort().join(",") !==
          "accountId,imported,legacyDigest,nodeId,source,version" ||
        manifest.version !== 1 ||
        manifest.accountId !== identity.accountId ||
        manifest.nodeId !== identity.nodeId ||
        !["empty", "legacy-json"].includes(manifest.source) ||
        typeof manifest.imported !== "boolean" ||
        (manifest.source === "empty"
          ? manifest.legacyDigest !== null || !manifest.imported
          : !/^[a-f0-9]{64}$/.test(manifest.legacyDigest)) ||
        options.storageState !== undefined
      )
        throw new Error("native_profile_manifest_invalid");
      const legacy = !manifest.imported ? await legacyState(root, identity.accountId) : null;
      if (legacy && legacy.digest !== manifest.legacyDigest)
        throw new Error("native_profile_migration_source_changed");
      // Firefox owns the OS-level exclusive profile lock, including across
      // containers. Never remove its lock files or fall back to a temp profile.
      const candidate = await firefox.launchPersistentContext(p.profile, options).catch(() => {
        throw new Error("native_profile_launch_failed");
      });
      try {
        await active();
        if (legacy) {
          await candidate.setStorageState(legacy.value);
          const temporary = join(p.directory, `owner-${randomUUID()}.tmp`);
          await writeFile(temporary, JSON.stringify({ ...manifest, imported: true }), {
            flag: "wx",
            mode: 0o600,
          });
          await rename(temporary, p.manifest);
        }
        await active();
        const browser = candidate.browser();
        if (!browser) throw new Error("native_profile_browser_missing");
        context = candidate;
        return browser;
      } catch (error) {
        await candidate.close().catch(() => {});
        throw new Error(
          String(error.message).startsWith("native_profile_")
            ? error.message
            : "native_profile_initialization_failed",
        );
      }
    },
    async contextFor(userId) {
      assertAccount(userId);
      await active();
      if (!context?.browser()?.isConnected()) throw new Error("native_profile_context_unavailable");
      return context;
    },
  };
}
