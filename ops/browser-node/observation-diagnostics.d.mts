export function observationHttpFailure(error: unknown): string | null;
export function parseObservationHttpFailure(value: unknown): {
  httpStatus: number;
  request: string;
  step: string;
  code: string;
} | null;
