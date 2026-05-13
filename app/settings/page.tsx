import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";
import { SalesDriveUpload } from "@/components/upload/salesdrive-upload";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const navUser = {
    email: user.email ?? "",
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl:
      (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };

  return (
    <div className="min-h-screen">
      <TopNav user={navUser} />

      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-3xl font-extrabold tracking-tight">Налаштування</h1>
        <p className="mt-2 text-text-mute">
          Підключення джерел даних та імпорт CSV/XLSX.
        </p>

        <div className="mt-8 space-y-4">
          <SettingsBlock
            title="Google Ads"
            status="not_connected"
            description="Підключення через OAuth після отримання Developer Token. Поки що — завантаження CSV-експорту."
          />
          <SettingsBlock
            title="SalesDrive"
            status="manual_import"
            description="Завантажуйте XLSX експорт замовлень нижче. Після отримання API key — автоматична синхронізація."
          />
        </div>

        <div className="mt-8 space-y-4">
          <SalesDriveUpload />

          <div className="rounded-xl border border-border bg-bg-card p-6 opacity-60">
            <h2 className="text-lg font-bold">Імпорт Google Ads CSV</h2>
            <p className="mt-2 text-sm text-text-mute">
              Скоро: завантаження CSV експорту кампаній із Google Ads.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function SettingsBlock({
  title,
  status,
  description,
}: {
  title: string;
  status: "connected" | "not_connected" | "manual_import";
  description: string;
}) {
  const statusConfig = {
    connected: { label: "Підключено", className: "bg-accent/15 text-accent" },
    not_connected: { label: "Не підключено", className: "bg-bg-elevated text-text-mute" },
    manual_import: { label: "Ручний імпорт", className: "bg-accent-alt/15 text-accent-alt" },
  }[status];

  return (
    <div className="rounded-xl border border-border bg-bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold">{title}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.className}`}
            >
              {statusConfig.label}
            </span>
          </div>
          <p className="mt-2 text-sm text-text-mute">{description}</p>
        </div>
      </div>
    </div>
  );
}
