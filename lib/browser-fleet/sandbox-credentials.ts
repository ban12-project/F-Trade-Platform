import {
  decryptFacebookCredential,
  encryptFacebookCredential,
  type VaultKeyring,
} from "../social/facebook-vault-crypto";
import { accessKeyNodeId } from "./security";

const scope = (nodeId: string) => ({ channelRef: "browser-sandbox", accountRef: nodeId });

export function sealBrowserSandboxKey(nodeId: string, accessKey: string, ring: VaultKeyring) {
  if (accessKeyNodeId(accessKey) !== nodeId) throw new Error("sandbox_key_node_mismatch");
  return encryptFacebookCredential(accessKey, scope(nodeId), "node-access", ring);
}

export function openBrowserSandboxKey(nodeId: string, ciphertext: string, ring: VaultKeyring) {
  const value = decryptFacebookCredential(ciphertext, scope(nodeId), "node-access", ring);
  if (typeof value !== "string" || accessKeyNodeId(value) !== nodeId)
    throw new Error("sandbox_key_node_mismatch");
  return value;
}
