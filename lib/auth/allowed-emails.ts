/**
 * Whitelist дозволених email-адрес для MVP.
 *
 * На Ступені 1 (MVP for self) — лише власник проекту може зайти.
 * Список читається з env var `ALLOWED_EMAILS` (через кому).
 * Якщо змінна не задана — нікого не пускаємо (fail closed).
 *
 * Приклад env:
 *   ALLOWED_EMAILS=fedox.com.ua@gmail.com,partner@example.com
 *
 * На Ступені 2 цей файл буде замінено повноцінною таблицею
 * organization_members у БД + RLS policies.
 */

export function getAllowedEmails(): string[] {
  const raw = process.env.ALLOWED_EMAILS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = getAllowedEmails();
  return allowed.includes(email.toLowerCase());
}
