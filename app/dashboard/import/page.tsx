import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";
import { ImportView } from "./_components/import-view";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const navUser = {
    email: user.email ?? "",
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };

  return (
    <div className="min-h-screen">
      <TopNav user={navUser} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-2 rounded-lg border border-border bg-bg-card px-4 py-2 text-sm font-medium text-text-mute transition hover:-translate-x-0.5 hover:border-accent-alt hover:text-text"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Назад до дашборду
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight">
            Імпорт даних
          </h1>
          <p className="mt-2 text-text-mute">
            Завантажте вивантаження SalesDrive та Google Ads — дані
            обробляються на сервері й одразу потрапляють в аналітику. Повторний
            імпорт того ж періоду безпечний: дані замінюються, дублі не
            виникають.
          </p>
        </div>

        <ImportView />

        <div className="mt-8 rounded-xl border border-border bg-bg-card p-6">
          <h3 className="text-sm font-bold tracking-tight">Як це працює</h3>
          <ul className="mt-3 space-y-2 text-sm text-text-mute">
            <li>
              <b className="text-text">Замовлення SalesDrive</b> — кожен рядок
              файлу це позиція; рядки з однаковими датою та телефоном
              об&apos;єднуються в одне замовлення. Комісія еквайрингу береться
              один раз на замовлення й враховується в чистій маржі.
            </li>
            <li>
              <b className="text-text">Google Ads</b> — рекламний розхід
              прив&apos;язується до товарів через словник артикулів Horoshop.
              Імпортуються лише позиції, що мали покази, кліки або витрати.
            </li>
            <li>
              Імпорт замінює дані за відповідний період, тому файли можна
              перезавантажувати скільки завгодно разів.
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}
