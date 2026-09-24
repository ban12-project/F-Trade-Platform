// Only the read-only timestamp hover has a reviewed, recoverable 422 response.
// The Facebook driver validates its exact error code and the resulting permalink.
export async function checkedBrowserResponse(response, path, body) {
  if (response.ok || (response.status === 422 && path === "/act" && body?.kind === "hover"))
    return response;
  await response.body?.cancel();
  throw new Error("browser_request_failed");
}
