import { updateRfqDraft } from "../rfq/assessment";

type Rfq = Record<string, any>;

/** Supported request vocabulary only; alternatives and corrections need human confirmation. */
export function inquiryProductType(message: string) {
  const patterns = {
    clutch_disc: /\bclutch\s+dis[ck]s?\b|离合器片/gi,
    clutch_cover: /\b(?:clutch\s+covers?|pressure\s+plates?)\b|离合器盖|压盘/gi,
    release_bearing: /\b(?:release|throw[- ]out)\s+bearings?\b|分离轴承/gi,
    clutch_kit: /\bclutch\s+kits?\b|离合器套件/gi,
  } as const;
  const matches = (Object.keys(patterns) as (keyof typeof patterns)[]).filter((type) =>
    patterns[type].test(message),
  );
  const uncertain =
    /\b(?:not|wrong|incorrect|cancel|ignore|except|instead|no longer|unsure|unknown|or|and)\b|[/&]|不是|不要|不确定|取消|或者|或是/i.test(
      message,
    );
  return {
    value: matches.length === 1 && !uncertain ? matches[0] : undefined,
    mentioned: matches.length > 0,
  };
}

/** Explicit customer requests only; a brand does not establish an exact model or fitment. */
export function inquiryVehicle(message: string) {
  // Labels must start a field, not occur in prose such as "product model:".
  // Keep unsupported values mentioned so history cannot silently reuse an old value.
  const labeled = (field: "brand" | "model") => {
    const matches = [
      ...message.matchAll(
        new RegExp(
          `(?:^|[;,\\n])\\s*(?:(?:not|wrong|incorrect|ignore)\\s+)?(?:vehicle\\s+)?${field}\\s*[:=]([^;,\\n]*)`,
          "gi",
        ),
      ),
    ];
    const value = matches.length === 1 ? matches[0][1].trim() : undefined;
    const uncertain =
      /\b(?:not|wrong|incorrect|cancel|ignore|except|instead|no longer|unknown|unsure|or|and)\b/i.test(
        message,
      );
    return {
      mentioned: matches.length > 0,
      value:
        value && value.length <= 100 && /^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u.test(value) && !uncertain
          ? value
          : undefined,
    };
  };
  const labeledBrand = labeled("brand");
  const labeledModel = labeled("model");
  const supported = ["Toyota", "Honda", "Ford", "Volkswagen"];
  const brands = new Set(
    [...message.matchAll(/\b(Toyota|Honda|Ford|Volkswagen)\b/gi)].map((match) =>
      match[1].toLowerCase(),
    ),
  );
  const inferredBrand =
    brands.size === 1 ? supported.find((value) => brands.has(value.toLowerCase())) : undefined;
  const brand = labeledBrand.mentioned
    ? labeledBrand.value &&
      [...brands].every((value) => value === labeledBrand.value?.toLowerCase())
      ? labeledBrand.value
      : undefined
    : inferredBrand;
  const models = [
    ...message.matchAll(
      /\b(Toyota|Honda|Ford|Volkswagen)\s+([A-Za-z0-9 /&-]{2,100}?)\s+clutch\b/gi,
    ),
  ];
  const candidate = models.length === 1 ? models[0][2].trim() : undefined;
  const proseModel =
    brand && candidate && !/[/&]|\b(?:or|and|not|instead|unknown|unsure)\b/i.test(candidate)
      ? candidate
      : undefined;
  const model = labeledModel.mentioned
    ? labeledModel.value &&
      (!models.length ||
        (models.length === 1 && proseModel?.toLowerCase() === labeledModel.value.toLowerCase()))
      ? labeledModel.value
      : undefined
    : proseModel;
  return {
    brand,
    model,
    brandMentioned: labeledBrand.mentioned || brands.size > 0,
    modelMentioned: labeledModel.mentioned || models.length > 0,
  };
}

export function applyInquiryMessage(rfq: Rfq, message: string) {
  const patch: Rfq = { product: {}, commercial: {} };
  const productType = inquiryProductType(message);
  if (productType.value) patch.product.product_type = productType.value;
  // Only a single unambiguous explicit value is suggested. Unsupported prose stays manual.
  const unique = (pattern: RegExp) => {
    const matches = [...message.matchAll(pattern)];
    return matches.length === 1 ? matches[0] : undefined;
  };
  const quantity = unique(/(?<![\w.,+-])([1-9]\d*)\s*(?:pcs?|pieces?)\b/gi);
  // A single unit suffix can apply to a range/list, not just its final number.
  const beforeQuantity = quantity ? message.slice(0, quantity.index) : "";
  const afterQuantity = quantity ? message.slice((quantity.index ?? 0) + quantity[0].length) : "";
  const alternativeBefore = /\d\s*(?:to|or|and|[/&–—-])\s*$/i.test(beforeQuantity);
  const alternativeAfter = /^\s*(?:to|or|and|[/&–—-])\s*\d/i.test(afterQuantity);
  if (
    quantity &&
    !alternativeBefore &&
    !alternativeAfter &&
    Number.isSafeInteger(Number(quantity[1]))
  )
    patch.commercial.quantity = Number(quantity[1]);
  // Capture the complete labeled field before validating. Spaces can separate
  // numeric OE groups; unsupported prose must not become a shortened reference.
  const oe = unique(/\b(?:oe|oem)[ \t]*[:#-][ \t]*([^,;\r\n]*)/gi);
  const oeValue = oe?.[1].trim().replace(/[ \t]+/g, " ");
  if (
    oeValue &&
    oeValue.length <= 240 &&
    (/^[A-Za-z0-9-]{3,240}$/.test(oeValue) || /^(?:[A-Za-z] ?)?\d+(?: \d+)+$/.test(oeValue))
  )
    patch.product.oe_number = oeValue;
  const destination = unique(/\bdestination\s*[:=]\s*([A-Za-z][A-Za-z -]{2,239})(?=[,;.\n]|$)/gi);
  if (destination) patch.commercial.destination = destination[1].trim();
  const vehicle = inquiryVehicle(message);
  if (vehicle.brand) patch.product.vehicle_brand = vehicle.brand;
  if (vehicle.model) patch.product.vehicle_model = vehicle.model;
  return updateRfqDraft(rfq, patch);
}

export function nextClarification(rfq: Rfq) {
  const missing = rfq.missing_fields as string[];
  const first = missing[0];
  if (!first)
    return {
      status: "ready" as const,
      message: "RFQ is complete and ready for human quotation handoff.",
    };
  const prompts: Record<string, string> = {
    product_type: "Which clutch component do you need?",
    vehicle_model_or_oe_number:
      "Please provide the OE number or the exact vehicle brand and model.",
    quantity: "What quantity do you need?",
    destination: "What is the destination country or port?",
  };
  return {
    status: "clarification_required" as const,
    field: first,
    message: prompts[first] ?? "Please provide the missing RFQ detail.",
  };
}

export function assertNoAgentQuotation(rfq: Rfq) {
  if (rfq.missing_fields.length)
    throw new Error("Agent must continue clarification and cannot quote an incomplete RFQ");
  throw new Error("Agent cannot send a formal quotation; hand off to a human");
}
