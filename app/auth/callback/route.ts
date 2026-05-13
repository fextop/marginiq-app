import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/allowed-emails";

/**
 * Обробляє редірект з Google після успішного OAuth.
 * Обмінює `code` на сесію і перевіряє email у whitelist.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] exchange error:", error.message);
    return NextResponse.redirect(`${origin}/login?error=auth_exchange_failed`);
  }

  // Перевіряємо whitelist. Якщо email не дозволений — виходимо із сесії
  // і відправляємо на forbidden, щоб юзер не мав активного логіну на стороні клієнта.
  if (!isEmailAllowed(data.user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/auth/forbidden`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
