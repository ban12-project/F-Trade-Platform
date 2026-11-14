import { z } from "zod";

const calendarDate = z.iso.date("请填写有效的日历日期。");
const timeZone = z
  .string()
  .trim()
  .min(1, "请明确报价适用的时区。")
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "请选择有效的 IANA 时区。");

/** Human-confirmed calendar dates, inclusive at both ends in the named timezone. */
export const quotationValiditySchema = z
  .object({
    version: z.literal(1),
    starts_on: calendarDate,
    expires_on: calendarDate,
    time_zone: timeZone,
  })
  .superRefine((value, context) => {
    if (value.expires_on < value.starts_on) {
      context.addIssue({
        code: "custom",
        path: ["expires_on"],
        message: "截止日期不能早于起算日期。",
      });
    }
  });

export type QuotationValidity = z.infer<typeof quotationValiditySchema>;

/** Count calendar days without converting local midnight through DST boundaries. */
export function quotationValidityDays(value: QuotationValidity): number {
  const valid = quotationValiditySchema.parse(value);
  return (
    (Date.parse(`${valid.expires_on}T00:00:00Z`) - Date.parse(`${valid.starts_on}T00:00:00Z`)) /
      86_400_000 +
    1
  );
}
