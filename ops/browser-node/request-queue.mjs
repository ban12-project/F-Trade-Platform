const queues = new WeakMap();

// The official runtime admits one operation at a time. Serialize before sending
// requests; never retry a rejected operation or an ambiguous side effect.
export async function scheduleBrowserRequest(slot, work, signal) {
  function active() {
    signal.throwIfAborted();
    if (slot.stopping || slot.abort.signal.aborted) throw new Error("browser_request_stopped");
    if (slot.expiresAt <= Date.now()) throw new Error("local_lease_expired");
  }
  active();
  const queue = queues.get(slot) ?? { tail: Promise.resolve(), size: 0 };
  if (queue.size >= 8) throw new Error("browser_request_queue_full");
  queues.set(slot, queue);
  queue.size++;
  const current = queue.tail.then(async () => {
    active();
    const result = await work();
    active();
    return result;
  });
  queue.tail = current;
  // A failure rejects callers already queued behind it without sending them.
  // Ownership survives an observer timeout until the actual work settles.
  void current
    .finally(() => {
      queue.size--;
      if (queue.tail === current) queues.delete(slot);
    })
    .catch(() => {});
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([current, cancelled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
