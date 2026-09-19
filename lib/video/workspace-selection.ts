import { z } from "zod";

const querySchema = z
  .object({
    item: z.uuid().optional(),
    product: z.uuid().optional(),
    new: z.literal("1").optional(),
  })
  .refine((value) => !(value.item && (value.product || value.new)));

export type VideoSelectionQuery = {
  item?: string | string[];
  product?: string | string[];
  new?: string | string[];
};
export type VideoWorkspaceSelection =
  | { mode: "collection" }
  | { mode: "create"; productId?: string }
  | { mode: "record"; id: string }
  | { mode: "unavailable"; message: string };

export function resolveVideoSelection(
  query: VideoSelectionQuery,
  recordIds: string[],
  readyProductIds: string[],
): VideoWorkspaceSelection {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success)
    return { mode: "unavailable", message: "视频入口无效，请返回内容列表重新选择。" };
  const { item, product, new: create } = parsed.data;
  if (item)
    return recordIds.includes(item)
      ? { mode: "record", id: item }
      : { mode: "unavailable", message: "这条视频已不可用，可能已被移除或不在当前项目中。" };
  if (product && !readyProductIds.includes(product))
    return { mode: "unavailable", message: "指定产品尚未核实或不属于当前项目，请先核对产品资料。" };
  if (create || product) return { mode: "create", ...(product ? { productId: product } : {}) };
  return { mode: "collection" };
}
