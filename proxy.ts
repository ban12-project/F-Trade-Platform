import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { workspacePathHeader, workspaceSignInHref } from "@/lib/auth-navigation";

export async function proxy(request: NextRequest) {
  // Proxy runs for navigations and prefetches. This is intentionally only an
  // optimistic cookie check; every workspace page and mutation verifies the
  // session and administrator role again before accessing protected data.
  const target = request.nextUrl.pathname + request.nextUrl.search;
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL(workspaceSignInHref(target), request.url));
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(workspacePathHeader, target);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/workspace/:path*"],
};
