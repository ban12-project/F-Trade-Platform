export function checkedBrowserResponse(
  response: Response,
  path: string,
  body?: { kind?: string },
): Promise<Response>;
