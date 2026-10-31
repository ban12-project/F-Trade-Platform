import { z } from "zod";
import { type FleetState, isLive } from "./policy";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.uuid();
const volume = z
  .object({ name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/), sha256: hash })
  .strict();
/** Only fingerprints and identities belong in this receipt. Never include
 * cookies, account references, keys, proxy credentials or selector files. */
export const browserVpsInventorySchema = z
  .object({
    nodeId: uuid,
    installationId: uuid,
    nodeState: volume,
    accountVolumes: z.array(volume.extend({ nodeId: uuid, accountId: uuid }).strict()).min(1),
    privateConfigSha256: hash,
    agentImage: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    browserImage: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    nativeProfiles: z.boolean(),
  })
  .strict();

/** Validate a frozen source inventory against a destination readback. Older
 * retained accounts can outnumber the current broker accounts: compare every
 * source volume, not just current accounts/recent runs. This checks receipts,
 * not physical transfer; the operator must produce them from stopped runtimes. */
export function verifyBrowserVpsRestore(
  sourceInput: unknown,
  targetInput: unknown,
  state: FleetState,
  approvedTargetAgentImage?: string,
) {
  const source = browserVpsInventorySchema.parse(sourceInput);
  const target = browserVpsInventorySchema.parse(targetInput);
  const expectedAgent = approvedTargetAgentImage ?? source.agentImage;
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedAgent) || target.agentImage !== expectedAgent)
    throw new Error("migration_agent_image_not_approved");
  if (
    state.version !== 1 ||
    !state.installationId ||
    state.installationId !== source.installationId
  )
    throw new Error("migration_installation_mismatch");
  const canonical = (inventory: typeof source) => {
    const names = new Set<string>();
    for (const entry of inventory.accountVolumes) {
      if (
        entry.nodeId !== inventory.nodeId ||
        entry.name !== `ftbrowser-${inventory.nodeId}-${entry.accountId}` ||
        names.has(entry.name)
      )
        throw new Error("migration_volume_identity_invalid");
      names.add(entry.name);
    }
    for (const account of state.accounts)
      if (!names.has(`ftbrowser-${inventory.nodeId}-${account.id}`))
        throw new Error("migration_current_account_missing");
    return JSON.stringify({
      ...inventory,
      accountVolumes: [...inventory.accountVolumes].sort((a, b) => a.name.localeCompare(b.name)),
    });
  };
  if (canonical({ ...source, agentImage: expectedAgent }) !== canonical(target))
    throw new Error("migration_restore_mismatch");
  return {
    nodeId: source.nodeId,
    preservedVolumes: source.accountVolumes.length,
    installationId: source.installationId,
  };
}

/** Separate from byte/inventory verification: quarantined is still a live slot.
 * Use the existing Agent recovery protocol and confirmed source stop to settle
 * it; never delete a run or infer clean shutdown from an expired lease. */
export function assertBrowserVpsCutoverDrained(state: FleetState) {
  if (state.runs.some((run) => isLive(run) || run.status === "queued"))
    throw new Error("migration_requires_drained_queue");
}
