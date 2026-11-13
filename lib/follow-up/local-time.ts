import { Temporal } from "@js-temporal/polyfill";

/** Exact instants for a local minute: none for a gap, two for a clock rollback. */
export function followUpTimeChoices(
  value: string | undefined,
  timeZone: string,
  savedInstant?: string,
) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  try {
    const local = Temporal.PlainDateTime.from(value);
    const saved = savedInstant
      ? Temporal.Instant.from(savedInstant).toZonedDateTimeISO(timeZone)
      : undefined;
    const preserveSaved = saved?.toPlainDateTime().toString({ smallestUnit: "minute" }) === value;
    const choices = ["earlier", "later"] as const;
    return choices
      .map((disambiguation) => local.toZonedDateTime(timeZone, { disambiguation }))
      .filter((date) => date.toPlainDateTime().equals(local))
      .map((date) => ({
        instant: (preserveSaved && saved?.offset === date.offset ? saved : date)
          .toInstant()
          .toString({ fractionalSecondDigits: 3 }),
        offset: date.offset,
      }))
      .filter((choice, index, all) => index === 0 || choice.instant !== all[0].instant);
  } catch {
    return [];
  }
}
