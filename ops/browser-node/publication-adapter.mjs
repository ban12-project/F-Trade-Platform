// One selection rule for both admission and execution. Never promote an expired
// profile or derive an account binding from its display name.
export function withPublicationSetup(base, setup, now = () => Date.now()) {
  const selection = () => {
    const entries = new Map();
    const key = (p) => JSON.stringify([p.channelRef, p.accountRef]);
    for (const scope of setup.scopes())
      if (scope.expiresAt > now()) entries.set(key(scope), { scope, adapter: setup });
    for (const scope of base.publicationScopes ?? []) {
      if (scope.expiresAt <= now()) continue;
      const previous = entries.get(key(scope));
      if (!previous || scope.textOnly !== true) entries.set(key(scope), { scope, adapter: base });
    }
    return [...entries.values()];
  };
  return {
    get capabilities() {
      return [...new Set([...base.capabilities, ...(selection().length ? ["publish"] : [])])];
    },
    get publicationScopes() {
      return selection().map(({ scope }) => scope);
    },
    inboxScopes: base.inboxScopes,
    execute(context) {
      if (context.run.kind !== "publish") return base.execute?.(context) ?? "failed";
      const selected = selection().find(
        ({ scope }) =>
          scope.channelRef === context.run.channelRef &&
          scope.accountRef === context.run.accountRef,
      );
      return selected?.adapter.execute(context) ?? "failed";
    },
  };
}
