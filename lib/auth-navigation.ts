/** Navigation only; never use the return destination to authorize a request. */
export const workspacePathHeader = "x-workspace-return-path";

function unsafePath(value: string) {
  return Array.from(value).some(
    (character) =>
      character === "\\" || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
  );
}

export function workspaceSignInTarget(value: string | null | undefined): string {
  if (!value || unsafePath(value)) return "/workspace";
  try {
    const url = new URL(value, "https://workspace.invalid");
    const path = decodeURIComponent(url.pathname);
    if (
      !value.startsWith("/") ||
      value.startsWith("//") ||
      url.origin !== "https://workspace.invalid" ||
      unsafePath(path) ||
      (path !== "/workspace" && !path.startsWith("/workspace/"))
    )
      return "/workspace";
    return url.pathname + url.search;
  } catch {
    return "/workspace";
  }
}

export function workspaceSignInHref(target: string | null | undefined): string {
  return `/auth?${new URLSearchParams({ next: workspaceSignInTarget(target) })}`;
}
