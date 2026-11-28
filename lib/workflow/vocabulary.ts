export const actorTypes = ["agent", "human", "system"] as const;
export type ActorType = (typeof actorTypes)[number];

export const aggregateTypes = [
  "product",
  "content",
  "video",
  "rfq",
  "quotation",
  "lead",
  "delivery_confirmation",
] as const;
export type AggregateType = (typeof aggregateTypes)[number];

export const humanGates = ["gate_01_truth", "gate_02_quote", "gate_03_delivery"] as const;
export type HumanGate = (typeof humanGates)[number];
