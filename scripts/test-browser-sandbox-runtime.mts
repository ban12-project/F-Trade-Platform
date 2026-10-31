import { rejectRetiredSandboxExecution } from "../lib/browser-fleet/sandbox-retired";

// Retired live cloud tool. Fail before provider access, local builds or uploads.
rejectRetiredSandboxExecution();
