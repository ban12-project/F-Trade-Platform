/** Retired after the VPS migration. Keep this tombstone for historical test
 * routes; even an old enabled prop cannot restore the managed creation UI.
 */
export function SandboxRegistrationCard(_props: {
  enabled?: boolean;
  onCreated?: () => Promise<void>;
}) {
  return null;
}
