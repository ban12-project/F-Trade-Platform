import { type VideoExportArtifact, videoExportArtifactSchema } from "./contracts";
import {
  VideoExportValidationError,
  type VideoExportViolation,
  videoExportPresets,
} from "./export-presets";
import { validateProbedVideoExport } from "./media-probe";
import { unknownVideoResourceMeasurements } from "./resource-measurements";

type ManifestValidation = {
  scope: "project_export_preset";
  status: "passed" | "failed" | "unverified";
  reason: string | null;
  violations: readonly VideoExportViolation[];
};

/** A technical receipt, not a platform acceptance or publication claim. */
export function createVideoExportManifest(input: VideoExportArtifact) {
  const artifact = videoExportArtifactSchema.parse(input);
  const preset = videoExportPresets.find(
    (item) =>
      item.platform === artifact.platform &&
      item.surface === artifact.surface &&
      item.version === artifact.presetVersion &&
      item.sourceUrl === artifact.presetSourceUrl &&
      item.availability === "enabled",
  );
  let validation: ManifestValidation = {
    scope: "project_export_preset",
    status: "unverified",
    reason: "Recorded preset is not available for verification.",
    violations: [],
  };
  if (preset && !artifact.measured.encoding) {
    validation.reason = "Historical export has no encoding measurements; re-probe is required.";
  }
  if (preset && artifact.measured.encoding) {
    try {
      validateProbedVideoExport(artifact.platform, artifact.measured);
      validation = {
        scope: "project_export_preset",
        status: "passed",
        reason: null,
        violations: [],
      };
    } catch (error) {
      if (!(error instanceof VideoExportValidationError)) throw error;
      validation = {
        scope: "project_export_preset",
        status: "failed",
        reason: error.message,
        violations: error.violations,
      };
    }
  }
  const resources = artifact.measured.resources ?? unknownVideoResourceMeasurements();
  return {
    schemaVersion: "1.3.0",
    encodingContractVersion: "1.0.0",
    resourceMeasurement: {
      contractVersion: "1.0.0",
      source: "ffprobe_metadata" as const,
      bitrateScope: "reported_average" as const,
      unknownFields: Object.entries(resources)
        .filter(([, value]) => value === null)
        .map(([key]) => key),
      peakBitrate: "not_measured" as const,
    },
    exportId: artifact.id,
    videoId: artifact.videoId,
    platform: artifact.platform,
    surface: artifact.surface,
    preset: { version: artifact.presetVersion, sourceUrl: artifact.presetSourceUrl },
    measured: { ...artifact.measured, resources },
    timelineDurationSeconds: artifact.timelineDurationSeconds,
    reviewStatus: artifact.status,
    renderedAt: artifact.createdAt,
    validation,
    platformAcceptance: {
      status: "not_evaluated" as const,
      reason:
        "Project preset checks do not establish current platform or account-specific acceptance.",
    },
  };
}

export function videoExportManifestHeaders(filename: string) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "same-origin",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  };
}
