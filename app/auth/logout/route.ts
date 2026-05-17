import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Вихід з акаунта. Викликається POST-формою з меню користувача.
// Після signOut робимо редірект на сторінку входу (303 — браузер
// виконає GET на /login).
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
}
