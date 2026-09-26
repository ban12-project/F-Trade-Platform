import { z } from "zod";
import { videoPlatformSchema } from "./contracts";

/** A source audit, independent of render-preset availability and actual publication receipts.
 * Version 1 records incomplete reviews only: it cannot certify platform acceptance.
 */
export const videoRuleSourceReviewSchema = z
  .object({
    contractVersion: z.literal("1.0.0"),
    classification: z.literal("sanitized_aggregate"),
    reviewId: z.string().min(1),
    reviewedAt: z.iso.datetime(),
    platform: videoPlatformSchema,
    projectPreset: z
      .object({
        version: z.string().min(1),
        minDurationSeconds: z.number().nonnegative(),
        maxDurationSeconds: z.number().positive(),
      })
      .strict(),
    // This describes the project decision, not the account used by an arbitrary exported file.
    projectPublishingScope: z
      .object({
        path: z.enum(["facebook_profile_browser", "not_selected"]),
        accountCategory: z.enum(["personal_profile", "not_selected"]),
        apiVersion: z.string().min(1).nullable(),
        decisionRef: z.string().min(1).nullable(),
      })
      .strict(),
    sources: z
      .array(
        z
          .object({
            url: z.url(),
            kind: z.enum(["vendor_documentation", "vendor_sample", "vendor_collection"]),
            readStatus: z.enum(["readable", "incomplete", "unavailable"]),
            // A pinned sample commit is not a version of a publishing API or current platform rules.
            documentRevision: z.string().min(1).nullable(),
            ruleVersion: z.string().min(1).nullable(),
            scope: z.enum(["publishing_api", "encoding_guidance", "not_established"]),
            observedSummary: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    differences: z.array(z.string().min(1)),
    unresolved: z.array(z.string().min(1)).min(1),
    measurements: z
      .object({
        fileSizeBytes: z.literal("available_when_reported"),
        averageBitrateBps: z.literal("available_when_reported"),
        peakBitrateBps: z.literal("not_measured"),
        missingValue: z.null(),
      })
      .strict(),
    sourceApplicability: z.literal("unverified"),
    platformAcceptance: z.literal("not_evaluated"),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.projectPreset.minDurationSeconds > review.projectPreset.maxDurationSeconds)
      context.addIssue({
        code: "custom",
        path: ["projectPreset"],
        message: "Invalid project duration range",
      });
    const scope = review.projectPublishingScope;
    if (
      scope.path === "facebook_profile_browser" &&
      (review.platform !== "facebook" ||
        scope.accountCategory !== "personal_profile" ||
        scope.apiVersion !== null ||
        !scope.decisionRef)
    )
      context.addIssue({
        code: "custom",
        path: ["projectPublishingScope"],
        message: "Browser Profile scope cannot imply a Graph API version",
      });
    if (
      scope.path === "not_selected" &&
      (scope.accountCategory !== "not_selected" || scope.apiVersion !== null)
    )
      context.addIssue({
        code: "custom",
        path: ["projectPublishingScope"],
        message: "An unselected path cannot establish account/API eligibility",
      });
  });

export type VideoRuleSourceReview = z.infer<typeof videoRuleSourceReviewSchema>;
