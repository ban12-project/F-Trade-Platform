import { z } from "zod";
import providerLabels from "./model-providers.json";

export { providerLabels };
export type SupportedModelProvider = keyof typeof providerLabels;
export const modelProviderSchema = z.enum(Object.keys(providerLabels) as SupportedModelProvider[]);
