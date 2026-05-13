import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";
import { isEmailAllowed } from "@/lib/auth/allowed-emails";

const PROTECTED_PREFIXES = ["/dashboard", "/settings"];
const AUTH_ROUTES = ["/login", "/auth"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { supabase, response } = createMiddlewareClient(request);

  // Refresh session if expired - required for Server Components
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  const isAuthRoute = AUTH_ROUTES.some((p) => pathname.startsWith(p));

  // Захищені роути потребують авторизованого користувача з email у whitelist
  if (isProtected) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    if (!isEmailAllowed(user.email)) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/forbidden";
      return NextResponse.redirect(url);
    }
  }

  // Якщо вже авторизований і йде на /login — кидаємо на /dashboard
  if (pathname === "/login" && user && isEmailAllowed(user.email)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - api routes (вони мають власну логіку auth)
     */
    "/((?!_next/static|_next/image|favicon.ico|api).*)",
  ],
};
