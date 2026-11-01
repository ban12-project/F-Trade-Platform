import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";

export const GEOIP_STORE = "/opt/ftrade/geoip";
const generationPattern = /^generations\/[a-f0-9-]{36}$/;

export async function writeGeoipStatus(root, value) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temporary = `${root}/status-${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, `${root}/status.json`);
}

export async function assertGeoipReady(root = GEOIP_STORE) {
  const status = JSON.parse(await readFile(`${root}/status.json`, "utf8"));
  const selected = await readlink(`${root}/current`);
  if (status.state !== "ready" || !generationPattern.test(selected) || status.current !== selected)
    throw new Error("official_geoip_not_ready");
  return status;
}

export async function publishGeoip(root, source, metadata) {
  let previous = null;
  try {
    const selected = await readlink(`${root}/current`);
    if (generationPattern.test(selected)) previous = selected;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const current = `generations/${randomUUID()}`;
  await mkdir(`${root}/generations`, { recursive: true, mode: 0o700 });
  await cp(source, `${root}/${current}`, { recursive: true, dereference: false });
  await writeFile(`${root}/${current}/manifest.json`, JSON.stringify(metadata), { mode: 0o600 });
  const temporary = `${root}/current-${randomUUID()}`;
  await symlink(current, temporary);
  await rename(temporary, `${root}/current`);
  await writeGeoipStatus(root, { state: "ready", current, previous, checkedAt: Date.now() });
}

export async function refreshGeoip(root, downloadAndValidate) {
  let old;
  try {
    old = JSON.parse(await readFile(`${root}/status.json`, "utf8"));
  } catch {}
  await writeGeoipStatus(root, { ...old, state: "updating" });
  try {
    const { directory, metadata } = await downloadAndValidate();
    await publishGeoip(root, directory, metadata);
  } catch (error) {
    await writeGeoipStatus(root, { ...old, state: "failed" });
    throw error;
  }
}

export async function rollbackGeoip(root, validate) {
  const status = JSON.parse(await readFile(`${root}/status.json`, "utf8"));
  if (!generationPattern.test(status.previous ?? "")) throw new Error("geoip_rollback_missing");
  // An expired prior database cannot restore admission.
  await validate(`${root}/${status.previous}`);
  const temporary = `${root}/current-${randomUUID()}`;
  await symlink(status.previous, temporary);
  await rename(temporary, `${root}/current`);
  await writeGeoipStatus(root, {
    state: "ready",
    current: status.previous,
    previous: status.current,
    checkedAt: Date.now(),
  });
}

export async function pruneGeoip(root) {
  const { readdir } = await import("node:fs/promises");
  const status = await assertGeoipReady(root);
  for (const name of await readdir(`${root}/generations`)) {
    const relative = `generations/${name}`;
    if (generationPattern.test(relative) && ![status.current, status.previous].includes(relative))
      await rm(`${root}/${relative}`, { recursive: true });
  }
}
