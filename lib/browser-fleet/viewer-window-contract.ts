import { z } from "zod";

const origin = z.url().refine((value) => {
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) && url.origin === value;
});
export const viewerWindowConnectionSchema = z
  .object({ origin, token: z.string().min(1).max(8192) })
  .strict();
export type ViewerWindowConnection = z.infer<typeof viewerWindowConnectionSchema>;
export const viewerWindowMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ftrade-viewer-window-bind"), nonce: z.uuid() }).strict(),
  z.object({ type: z.literal("ftrade-viewer-window-ready"), nonce: z.uuid() }).strict(),
  z
    .object({
      type: z.literal("ftrade-viewer-window-connection"),
      nonce: z.uuid(),
      connection: viewerWindowConnectionSchema,
    })
    .strict(),
]);
