import { z } from "zod";

/** Null records missing probe evidence; it must never be replaced with a guessed default. */
export const videoEncodingSchema = z
  .object({
    pixelFormat: z.string().nullable(),
    sampleAspectRatio: z.string().nullable(),
    audioSampleRate: z.number().int().positive().nullable(),
    audioChannels: z.number().int().positive().nullable(),
  })
  .strict();
export type VideoEncoding = z.infer<typeof videoEncodingSchema>;

export const videoProbeEntries =
  "format=format_name,duration,size,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_aspect_ratio,sample_rate,channels,bit_rate";
