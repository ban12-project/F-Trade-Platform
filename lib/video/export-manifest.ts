import { type VideoExportArtifact, videoExportArtifactSchema } from "./contracts";
import {
  VideoExportValidationError,
  type VideoExportViolation,
  videoExportPresets,
} from "./export-presets";
import { validateProbedVideoExport } from "./media-probe";

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
      item.verification === "verified",
  );
  let validation: ManifestValidation = {
    scope: "project_export_preset",
    status: "unverified",
    reason: "Recorded preset is not available for verification.",
    violations: [],
  };
  if (preset) {
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
  return {
    schemaVersion: "1.0.0",
    exportId: artifact.id,
    videoId: artifact.videoId,
    platform: artifact.platform,
    surface: artifact.surface,
    preset: { version: artifact.presetVersion, sourceUrl: artifact.presetSourceUrl },
    measured: artifact.measured,
    timelineDurationSeconds: artifact.timelineDurationSeconds,
    reviewStatus: artifact.status,
    renderedAt: artifact.createdAt,
    validation,
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
