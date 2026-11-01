const stages = new Set([
  "not-started",
  "display",
  "launch-options",
  "profile-check",
  "firefox-launch",
  "publish",
]);
const statuses = new Set(["idle", "starting", "ready", "failed"]);
const codes = new Set([
  "native_profile_lease_expired",
  "native_profile_manifest_invalid",
  "native_profile_directory_invalid",
  "native_profile_file_invalid",
  "native_profile_launch_failed",
  "native_profile_browser_missing",
  "native_profile_initialization_failed",
]);

/** Project only fixed enums; health responses and exceptions are not trusted log data. */
export function sanitizeStartupDiagnostics(value) {
  if (!value || !stages.has(value.stage) || !statuses.has(value.status)) return null;
  return {
    stage: value.stage,
    status: value.status,
    code: codes.has(value.code) ? value.code : "unclassified",
  };
}

export function createStartupDiagnostics() {
  let state = { stage: "not-started", status: "idle", code: "unclassified" };
  return {
    begin() {
      state = { stage: "display", status: "starting", code: "unclassified" };
    },
    stage(stage) {
      if (state.status === "starting" && stages.has(stage)) state.stage = stage;
    },
    ready() {
      state.status = "ready";
    },
    fail(error) {
      state.status = "failed";
      state.code = codes.has(error?.message) ? error.message : "unclassified";
    },
    read() {
      return { ...state };
    },
  };
}
