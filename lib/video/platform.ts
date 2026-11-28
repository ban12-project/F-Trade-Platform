import { z } from "zod";

export const videoPlatformSchema = z.enum(["facebook", "instagram", "x", "youtube", "tiktok"]);
export type VideoPlatform = z.infer<typeof videoPlatformSchema>;
