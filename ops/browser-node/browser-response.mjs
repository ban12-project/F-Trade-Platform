import { sanitizeBrowserFailureCode } from "./launch-diagnostics.mjs";

async function failureCode(response) {
  if (!response.headers.get("content-type")?.includes("application/json") || !response.body) {
    await response.body?.cancel();
    return "unclassified";
  }
  const reader = response.body.getReader();
  // Diagnostics cannot hold a failed launch open or retain arbitrary response bodies.
  const timer = setTimeout(() => void reader.cancel().catch(() => {}), 250);
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2048) return "unclassified";
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return sanitizeBrowserFailureCode(body?.error);
  } catch {
    return "unclassified";
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Only the read-only timestamp hover has a reviewed, recoverable 422 response.
// The Facebook driver validates its exact error code and the resulting permalink.
export async function checkedBrowserResponse(response, path, body) {
  if (response.ok || (response.status === 422 && path === "/act" && body?.kind === "hover"))
    return response;
  const code = await failureCode(response);
  throw Object.assign(new Error("browser_request_failed"), {
    browserFailureCode: code,
    browserHttpStatus: response.status,
    browserRequestStage:
      path === "/tabs"
        ? "open-tab"
        : path.endsWith("/navigate")
          ? "navigate"
          : path.includes("/snapshot?")
            ? "snapshot"
            : path === "/vnc/status"
              ? "vnc-status"
              : "other",
  });
}
