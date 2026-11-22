// One selection rule for both admission and execution. Never promote an expired
// profile or derive an account binding from its display name.
export function withInboxSetup(base, setup, now = () => Date.now()) {
  const selection = () => {
    const entries = new Map();
    const key = (p) => JSON.stringify([p.channelRef, p.accountRef]);
    for (const scope of base.inboxScopes ?? []) {
      if (scope.expiresAt > now()) entries.set(key(scope), { scope, adapter: base });
    }
    for (const scope of setup.scopes()) {
      if (scope.expiresAt > now()) entries.set(key(scope), { scope, adapter: setup });
    }
    return [...entries.values()];
  };
  return {
    get capabilities() {
      return [...new Set([...base.capabilities, ...(selection().length ? ["inbox"] : [])])];
    },
    get publicationScopes() {
      return base.publicationScopes;
    },
    get inboxScopes() {
      return selection().map(({ scope }) => scope);
    },
    execute(context) {
      if (context.run.kind !== "inbox") return base.execute?.(context) ?? "failed";
      const selected = selection().find(
        ({ scope }) =>
          scope.channelRef === context.run.channelRef &&
          scope.accountRef === context.run.accountRef,
      );
      return selected?.adapter.execute(context) ?? "failed";
    },
  };
}
