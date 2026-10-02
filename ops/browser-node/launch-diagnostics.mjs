const stages = new Set([
  "volume",
  "network",
  "container-create",
  "container-start",
  "container-inspect",
  "browser-health",
  "egress",
  "vnc",
  "heartbeat",
  "watchdog",
]);
const requests = new Set(["open-tab", "navigate", "snapshot", "vnc-status", "other"]);
const codes = new Set([
  "native_profile_scope_invalid",
  "native_profile_directory_invalid",
  "native_profile_file_invalid",
  "native_profile_migration_required",
  "native_profile_lease_expired",
  "native_profile_manifest_invalid",
  "native_profile_launch_failed",
  "native_profile_browser_missing",
  "native_profile_context_unavailable",
]);

export function sanitizeBrowserFailureCode(value) {
  return codes.has(value) ? value : "unclassified";
}

/** Fixed enums only: never serialize the original error, URL, body or slot. */
export function describeBrowserLaunchFailure(stage, error) {
  return {
    event: "browser_launch_failed",
    stage: stages.has(stage) ? stage : "unknown",
    request: requests.has(error?.browserRequestStage) ? error.browserRequestStage : "unknown",
    code: sanitizeBrowserFailureCode(error?.browserFailureCode),
    httpStatus:
      Number.isInteger(error?.browserHttpStatus) &&
      error.browserHttpStatus >= 400 &&
      error.browserHttpStatus <= 599
        ? error.browserHttpStatus
        : null,
  };
}
