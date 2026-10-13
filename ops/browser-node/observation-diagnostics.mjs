import { sanitizeBrowserFailureCode } from "./launch-diagnostics.mjs";

const requests = new Set([
  "open-tab",
  "navigate",
  "evaluate",
  "scroll",
  "hover",
  "snapshot",
  "vnc-status",
  "other",
]);
const steps = new Set([
  "composer-closed",
  "identity-ready",
  "identity",
  "posts-ready",
  "posts-loaded",
  "post-count",
  "posts",
  "video-receipt",
  "unknown",
]);
const prefix = "publication_observe_http_";

// An existing receipt field carries these bounded tokens through signing,
// exact replay and persistence. Never serialize the original exception.
export function observationHttpFailure(error) {
  if (
    error?.message !== "browser_request_failed" ||
    !Number.isInteger(error.browserHttpStatus) ||
    error.browserHttpStatus < 300 ||
    error.browserHttpStatus > 599
  )
    return null;
  const request = requests.has(error.browserRequestStage) ? error.browserRequestStage : "other";
  const step = steps.has(error.browserObservationStage) ? error.browserObservationStage : "unknown";
  const code = sanitizeBrowserFailureCode(error.browserFailureCode);
  return `${prefix}${error.browserHttpStatus}__${request.replaceAll("-", "_")}__${step.replaceAll("-", "_")}__${code}`;
}

export function parseObservationHttpFailure(value) {
  if (typeof value !== "string" || value.length > 120 || !value.startsWith(prefix)) return null;
  const parts = value.slice(prefix.length).split("__");
  if (parts.length !== 4 || !/^[3-5][0-9]{2}$/.test(parts[0])) return null;
  const [status, requestToken, stepToken, code] = parts;
  const request = requestToken.replaceAll("_", "-");
  const step = stepToken.replaceAll("_", "-");
  if (!requests.has(request) || !steps.has(step) || sanitizeBrowserFailureCode(code) !== code)
    return null;
  const result = { httpStatus: Number(status), request, step, code };
  return observationHttpFailure({
    message: "browser_request_failed",
    browserHttpStatus: result.httpStatus,
    browserRequestStage: request,
    browserObservationStage: step,
    browserFailureCode: code,
  }) === value
    ? result
    : null;
}
