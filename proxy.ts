import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(new URL("/auth", request.url));
  }
  if (session.user.role !== "admin") {
    return NextResponse.redirect(new URL("/auth?error=access-denied", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/console/:path*"],
};
