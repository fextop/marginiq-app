import Link from "next/link";
import { redirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";
import { DateRangePicker } from "../_components/date-range-picker";

type OrderRow = {
  id: string;
  status: string | null;
  status_group: string | null;
  revenue: number;
  created_at_external: string | null;
};

// Усі замовлення кешуються на 60 с; фільтрація за періодом — у JS.
const loadFunnelData = unstable_cache(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("orders")
      .select("id, status, status_group, revenue, created_at_external")
      .limit(10000);
    return (data as OrderRow[]) ?? [];
  },
  ["funnel-data-v1"],
  { revalidate: 60 },
);

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
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

  const sp = await searchParams;
  const fromParam = typeof sp.from === "string" && sp.from ? sp.from : null;
  const toParam = typeof sp.to === "string" && sp.to ? sp.to : null;
  const periodFiltered = !!(fromParam || toParam);

  const allOrders = await loadFunnelData();
  const hasData = allOrders.length > 0;

  // Межі дат для DateRangePicker.
  const allDatesSorted = allOrders
    .map((o) => o.created_at_external)
    .filter((d): d is string => !!d)
    .map((d) => d.slice(0, 10))
    .sort();
  const fullStart = allDatesSorted[0] ?? null;
  const fullEnd = allDatesSorted[allDatesSorted.length - 1] ?? null;

  // Фільтр за обраним періодом.
  const orders = allOrders.filter((o) => {
    if (!periodFiltered) return true;
    if (!o.created_at_external) return false;
    const d = o.created_at_external.slice(0, 10);
    if (fromParam && d < fromParam) return false;
    if (toParam && d > toParam) return false;
    return true;
  });

  const total = orders.length;

  // Розбивка за статусами.
  type StatusAgg = {
    status: string;
    group: string;
    count: number;
    revenue: number;
  };
  const statusMap = new Map<string, StatusAgg>();
  let successCount = 0;
  let pendingCount = 0;
  let cancelledCount = 0;
  let successRevenue = 0;
  let pendingRevenue = 0;
  let lostRevenue = 0; // відмови + повернення (без дублів)
  let dublRevenue = 0;

  for (const o of orders) {
    const group = o.status_group ?? "unknown";
    const status = o.status ?? "(без статусу)";
    const rev = Number(o.revenue) || 0;
    const key = `${group}::${status}`;
    const prev = statusMap.get(key);
    if (prev) {
      prev.count += 1;
      prev.revenue += rev;
    } else {
      statusMap.set(key, { status, group, count: 1, revenue: rev });
    }
    if (group === "success") {
      successCount += 1;
      successRevenue += rev;
    } else if (group === "pending") {
      pendingCount += 1;
      pendingRevenue += rev;
    } else if (group === "cancelled") {
      cancelledCount += 1;
      const isDubl = status.toLowerCase().includes("дубль");
      if (isDubl) dublRevenue += rev;
      else lostRevenue += rev;
    }
  }

  const statusRows = Array.from(statusMap.values()).sort(
    (a, b) => b.count - a.count,
  );
  const maxStatusCount = statusRows.reduce((m, s) => Math.max(m, s.count), 1);

  // Воронка: 3 ступені.
  const inProgressOrDone = successCount + pendingCount;
  const funnelSteps = [
    {
      label: "Усі замовлення",
      sub: "усі заявки, що надійшли",
      count: total,
      tone: "neutral" as const,
    },
    {
      label: "В роботі та продані",
      sub: "не скасовані — реальний потік",
      count: inProgressOrDone,
      tone: "alt" as const,
    },
    {
      label: "Продажі",
      sub: "завершені успішним продажем",
      count: successCount,
      tone: "accent" as const,
    },
  ];

  const convOverall = total > 0 ? (successCount / total) * 100 : 0;
  const convStep2 = total > 0 ? (inProgressOrDone / total) * 100 : 0;
  const convStep3 =
    inProgressOrDone > 0 ? (successCount / inProgressOrDone) * 100 : 0;

  // Ширина ступені воронки: від 56% до 100% пропорційно кількості.
  const stepWidth = (count: number) =>
    total > 0 ? 56 + 44 * (count / total) : 100;

  const periodNote = periodFiltered
    ? `за обраний період${
        fromParam && toParam
          ? ` · ${formatDateShort(fromParam)} — ${formatDateShort(toParam)}`
          : ""
      }`
    : "за весь час";

  return (
    <div className="min-h-screen">
      <TopNav user={navUser} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold tracking-tight">
            Воронка замовлень
          </h1>
          <p className="mt-2 text-text-mute">
            {hasData
              ? `Шлях замовлень за статусами — ${total} замовлень ${periodNote}.`
              : "Дані з'являться після першого імпорту замовлень."}
          </p>
        </div>

        {hasData && (
          <div className="mb-8">
            <DateRangePicker
              from={fromParam}
              to={toParam}
              fullStart={fullStart}
              fullEnd={fullEnd}
            />
          </div>
        )}

        {total === 0 ? (
          <div className="rounded-2xl border border-border bg-bg-card p-10 text-center">
            <h2 className="text-xl font-bold">Немає замовлень за період</h2>
            <p className="mx-auto mt-2 max-w-md text-text-mute">
              За обраний діапазон дат замовлень не знайдено. Спробуйте інший
              період.
            </p>
          </div>
        ) : (
          <>
            {/* Головна метрика — конверсія */}
            <div className="mb-8 overflow-hidden rounded-2xl border border-accent/25 bg-accent/5">
              <div className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-text-mute">
                    Загальна конверсія в продаж
                  </div>
                  <div className="mt-1 text-4xl font-extrabold tabular-nums text-accent">
                    {convOverall.toFixed(1)}%
                  </div>
                  <div className="mt-1 text-sm text-text-mute">
                    {successCount} продажів зі {total} замовлень
                  </div>
                </div>
                <div className="text-sm text-text-mute sm:text-right">
                  Кожні 10 замовлень дають{" "}
                  <span className="font-semibold text-text">
                    ~{Math.round(convOverall / 10)}
                  </span>{" "}
                  продажів.
                </div>
              </div>
            </div>

            {/* Воронка */}
            <div className="rounded-2xl border border-border bg-bg-card p-6">
              <h2 className="text-lg font-bold">Воронка за стадіями</h2>
              <p className="mt-1 text-sm text-text-mute">
                Як замовлення звужуються від усіх заявок до завершених продажів.
              </p>

              <div className="mt-6 space-y-1">
                {funnelSteps.map((step, idx) => {
                  const w = stepWidth(step.count);
                  const pctOfTotal =
                    total > 0 ? (step.count / total) * 100 : 0;
                  const toneClasses =
                    step.tone === "accent"
                      ? "bg-gradient-accent text-black"
                      : step.tone === "alt"
                        ? "border border-accent-alt/30 bg-accent-alt/15 text-text"
                        : "border border-border bg-bg-elevated text-text";
                  return (
                    <div key={step.label}>
                      <div
                        className={`mx-auto flex items-center justify-between gap-4 rounded-xl px-5 py-4 ${toneClasses}`}
                        style={{ width: `${w}%` }}
                      >
                        <div className="min-w-0">
                          <div className="font-bold">{step.label}</div>
                          <div
                            className={`text-xs ${
                              step.tone === "accent"
                                ? "text-black/70"
                                : "text-text-mute"
                            }`}
                          >
                            {step.sub}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-2xl font-extrabold tabular-nums">
                            {step.count}
                          </div>
                          <div
                            className={`text-xs tabular-nums ${
                              step.tone === "accent"
                                ? "text-black/70"
                                : "text-text-mute"
                            }`}
                          >
                            {pctOfTotal.toFixed(1)}% від усіх
                          </div>
                        </div>
                      </div>

                      {/* Конектор між ступенями */}
                      {idx < funnelSteps.length - 1 && (
                        <div className="flex items-center justify-center gap-2 py-2 text-xs text-text-mute">
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <path d="M12 5v14M19 12l-7 7-7-7" />
                          </svg>
                          {idx === 0 ? (
                            <span>
                              <span className="font-semibold text-text">
                                {convStep2.toFixed(1)}%
                              </span>{" "}
                              не скасовано ·{" "}
                              <span className="text-signal-red">
                                −{cancelledCount} скасовано
                              </span>
                            </span>
                          ) : (
                            <span>
                              <span className="font-semibold text-text">
                                {convStep3.toFixed(1)}%
                              </span>{" "}
                              завершено продажем ·{" "}
                              <span className="text-accent-alt">
                                {pendingCount} ще в обробці
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Розподіл за статусами */}
            <div className="mt-8 rounded-2xl border border-border bg-bg-card">
              <div className="border-b border-border px-6 py-4">
                <h2 className="text-lg font-bold">Розподіл за статусами</h2>
                <p className="mt-1 text-sm text-text-mute">
                  Усі статуси замовлень із SalesDrive. Колір — за групою:{" "}
                  <span className="text-accent">продаж</span>,{" "}
                  <span className="text-accent-alt">в обробці</span>,{" "}
                  <span className="text-signal-red">скасовано</span>.
                </p>
              </div>
              <div className="space-y-4 p-6">
                {statusRows.map((s) => {
                  const barPct = (s.count / maxStatusCount) * 100;
                  const sharePct =
                    total > 0 ? (s.count / total) * 100 : 0;
                  const barColor =
                    s.group === "success"
                      ? "bg-accent"
                      : s.group === "pending"
                        ? "bg-accent-alt"
                        : "bg-signal-red";
                  const dotColor =
                    s.group === "success"
                      ? "bg-accent"
                      : s.group === "pending"
                        ? "bg-accent-alt"
                        : "bg-signal-red";
                  return (
                    <div key={`${s.group}-${s.status}`}>
                      <div className="flex items-baseline justify-between gap-4 text-sm">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`}
                          />
                          <span className="font-medium">{s.status}</span>
                        </div>
                        <div className="shrink-0 tabular-nums text-text-mute">
                          <span className="font-semibold text-text">
                            {s.count}
                          </span>{" "}
                          · {sharePct.toFixed(1)}% ·{" "}
                          {formatMoney(s.revenue)}
                        </div>
                      </div>
                      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-bg-elevated">
                        <div
                          className={`h-full rounded-full ${barColor}`}
                          style={{ width: `${Math.max(barPct, 1.5)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Гроші */}
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              <MoneyCard
                label="Виручка продажів"
                value={formatMoney(successRevenue)}
                hint={`${successCount} завершених замовлень`}
                tone="accent"
              />
              <MoneyCard
                label="В обробці"
                value={formatMoney(pendingRevenue)}
                hint={`${pendingCount} замовлень очікують рішення`}
                tone="alt"
              />
              <MoneyCard
                label="Втрачена виручка"
                value={formatMoney(lostRevenue)}
                hint="відмови та повернення (без дублів)"
                tone="red"
              />
            </div>

            <p className="mt-4 text-xs text-text-mute">
              «Втрачена виручка» — сума замовлень зі статусами «Відмова» та
              «Повернення». Дублі ({formatMoney(dublRevenue)}) не враховано: це
              технічні дублікати наявних замовлень, а не реальні втрати.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return (
    new Intl.NumberFormat("uk-UA", {
      maximumFractionDigits: 0,
    }).format(Math.round(value)) + " ₴"
  );
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function MoneyCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "accent" | "alt" | "red";
}) {
  const barColor =
    tone === "accent"
      ? "bg-gradient-accent"
      : tone === "alt"
        ? "bg-accent-alt"
        : "bg-signal-red";
  const valueColor =
    tone === "red" ? "text-signal-red" : tone === "alt" ? "text-text" : "text-text";
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-bg-card p-5">
      <div className={`absolute left-0 top-0 h-full w-1 ${barColor}`} />
      <div className="text-xs font-medium uppercase tracking-wider text-text-mute">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${valueColor}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-text-mute">{hint}</div>
    </div>
  );
}
