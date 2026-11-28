import { z } from "zod";
import { privateReference } from "@/lib/evidence/form-reference";

export const opportunityDecisionFormSchema = z.object({
  projectId: z.uuid(),
  leadId: z.uuid(),
  evidenceRef: privateReference,
});
