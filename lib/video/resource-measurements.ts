import { z } from "zod";

/** Probe-reported values only. Null means unknown, never zero or a preset default. */
export const videoResourceMeasurementsSchema = z
  .object({
    fileSizeBytes: z.number().int().positive().nullable(),
    containerBitrateBps: z.number().int().positive().nullable(),
    videoBitrateBps: z.number().int().positive().nullable(),
    audioBitrateBps: z.number().int().positive().nullable(),
  })
  .strict();
export type VideoResourceMeasurements = z.infer<typeof videoResourceMeasurementsSchema>;

export function unknownVideoResourceMeasurements(): VideoResourceMeasurements {
  return {
    fileSizeBytes: null,
    containerBitrateBps: null,
    videoBitrateBps: null,
    audioBitrateBps: null,
  };
}

export function reportedPositiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
