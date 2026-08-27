import { NextResponse, type NextRequest } from "next/server";

import { getSessionCookie } from "better-auth/cookies";

export async function proxy(request: NextRequest) {
  // Proxy runs for navigations and prefetches. This is intentionally only an
  // optimistic cookie check; every console page and mutation verifies the
  // session and administrator role again before accessing protected data.
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/auth", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/console/:path*"],
};
