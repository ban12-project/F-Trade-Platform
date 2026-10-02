export function sanitizeBrowserFailureCode(value: unknown): string;
export function describeBrowserLaunchFailure(
  stage: unknown,
  error: unknown,
): {
  event: "browser_launch_failed";
  stage: string;
  request: string;
  code: string;
  httpStatus: number | null;
};
