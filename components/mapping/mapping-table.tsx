"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type AdCampaign = {
  campaign_id: string;
  campaign_name: string;
  spend: number;
};

/**
 * Той самий fuzzy mapper, що і на сервері/дашборді. Тримаємо локальну копію,
 * щоб показати юзеру "запропоноване автоматично" значення поряд із dropdown.
 *
 * Stage 2: винести в окремий модуль і ділити.
 */
function suggestUtmCampaign(adCampaignName: string): string | null {
  const lower = adCampaignName.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/кос[ыіы]/, "ts_kosy"],
    [/пил[ыіы]/, "ts_pily"],
    [/болгарк/, "ts_bolgarki"],
    [/культиватор/, "ts_cultivators"],
    [/набор/, "ts_nabory-instrumentov"],
    [/воздухо|повітродув/, "ts_povitroduvky"],
    [/кустор[іе]з/, "ts_kustorezy"],
    [/перфор/, "ts_perforatory"],
    [/пульверизатор|spray/, "ts_paint_spray"],
    [/секатор/, "ts_sekatory"],
    [/мойк/, "ts_moyki"],
    [/шурупов[её]рт/, "ts_shurupoverty"],
    [/зернодробил/, "ts_zernodrobilki"],
    [/гайковерт/, "ts_gaykoverty"],
  ];
  for (const [re, utm] of map) {
    if (re.test(lower)) return utm;
  }
  return null;
}

type RowState = "saved" | "auto" | "dirty" | "saving" | "none" | "error";

type Props = {
  campaigns: AdCampaign[];
  existingMappings: Record<string, string>;
  utmOptions: string[];
};

export function MappingTable({
  campaigns,
  existingMappings,
  utmOptions,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // НОВЕ: користувачем додані UTM, доступні у dropdown без перезавантаження
  const [customUtms, setCustomUtms] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUtmInput, setNewUtmInput] = useState("");

  // Локальний стан значень
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const c of campaigns) {
      initial[c.campaign_id] = existingMappings[c.campaign_id] ?? "";
    }
    return initial;
  });
  const [savedValues, setSavedValues] = useState<Record<string, string>>(
    () => ({ ...existingMappings }),
  );
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  // Обʼєднаний відсортований список опцій (initial + custom)
  const allUtmOptions = useMemo(() => {
    const set = new Set<string>([...utmOptions, ...customUtms]);
    return Array.from(set).sort();
  }, [utmOptions, customUtms]);

  const getRowState = (campaign: AdCampaign): RowState => {
    const current = values[campaign.campaign_id] ?? "";
    const saved = savedValues[campaign.campaign_id] ?? "";

    if (errors[campaign.campaign_id]) return "error";
    if (savingIds.has(campaign.campaign_id)) return "saving";

    if (current !== saved) return "dirty";
    if (saved) return "saved";

    const suggest = suggestUtmCampaign(campaign.campaign_name);
    return suggest ? "auto" : "none";
  };

  const dirtyCount = useMemo(() => {
    let c = 0;
    for (const k of Object.keys(values)) {
      if ((values[k] ?? "") !== (savedValues[k] ?? "")) c++;
    }
    return c;
  }, [values, savedValues]);

  function handleAddUtm() {
    const trimmed = newUtmInput.trim();
    if (!trimmed) return;
    if (!allUtmOptions.includes(trimmed)) {
      setCustomUtms((prev) => [...prev, trimmed]);
    }
    setNewUtmInput("");
    setShowAddForm(false);
  }

  async function save(campaign: AdCampaign) {
    const utm = values[campaign.campaign_id] ?? "";
    setSavingIds((s) => new Set(s).add(campaign.campaign_id));
    setErrors((e) => ({ ...e, [campaign.campaign_id]: null }));

    try {
      const res = await fetch("/api/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_campaign_id: campaign.campaign_id,
          ad_campaign_name: campaign.campaign_name,
          utm_campaign: utm,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors((e) => ({
          ...e,
          [campaign.campaign_id]: data.error ?? `HTTP ${res.status}`,
        }));
        return;
      }
      setSavedValues((s) => ({ ...s, [campaign.campaign_id]: utm }));
      startTransition(() => router.refresh());
    } catch (err) {
      setErrors((e) => ({
        ...e,
        [campaign.campaign_id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setSavingIds((s) => {
        const n = new Set(s);
        n.delete(campaign.campaign_id);
        return n;
      });
    }
  }

  async function saveAll() {
    for (const c of campaigns) {
      const current = values[c.campaign_id] ?? "";
      const saved = savedValues[c.campaign_id] ?? "";
      if (current !== saved) {
        await save(c);
      }
    }
  }

  return (
    <div className="mt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <LegendItem dot="bg-accent" label="Збережено" />
          <LegendItem dot="bg-accent-alt" label="Авто (fuzzy match)" />
          <LegendItem dot="bg-signal-orange" label="Незбережені зміни" />
          <LegendItem dot="bg-text-mute/40" label="Немає звʼязку" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!showAddForm ? (
            <button
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-card px-3 py-1.5 text-xs font-semibold text-text-mute transition hover:border-accent-alt hover:text-text"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Додати нову UTM
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newUtmInput}
                onChange={(e) => setNewUtmInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddUtm();
                  if (e.key === "Escape") {
                    setNewUtmInput("");
                    setShowAddForm(false);
                  }
                }}
                placeholder="напр. ts_new_campaign"
                className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-sm placeholder:text-text-mute/60 focus:border-accent focus:outline-none"
              />
              <button
                onClick={handleAddUtm}
                disabled={!newUtmInput.trim()}
                className="rounded-md bg-gradient-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
              >
                Додати
              </button>
              <button
                onClick={() => {
                  setNewUtmInput("");
                  setShowAddForm(false);
                }}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text-mute transition hover:text-text"
              >
                Скасувати
              </button>
            </div>
          )}

          {dirtyCount > 0 && (
            <button
              onClick={saveAll}
              disabled={isPending || savingIds.size > 0}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-accent px-4 py-2 text-sm font-semibold text-black shadow-lg shadow-accent/20 transition hover:-translate-y-0.5 disabled:opacity-60"
            >
              Зберегти всі ({dirtyCount})
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-text-mute">
            <tr>
              <th className="px-6 py-3">Кампанія Google Ads</th>
              <th className="px-6 py-3 text-right">Витрата</th>
              <th className="w-[280px] px-6 py-3">UTM-кампанія</th>
              <th className="w-[120px] px-6 py-3">Статус</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const state = getRowState(c);
              const current = values[c.campaign_id] ?? "";
              const saved = savedValues[c.campaign_id] ?? "";
              const isDirty = current !== saved;
              const suggested = suggestUtmCampaign(c.campaign_name);
              const isSaving = savingIds.has(c.campaign_id);
              const error = errors[c.campaign_id];

              return (
                <tr
                  key={c.campaign_id}
                  className="border-b border-border/50 last:border-0"
                >
                  <td className="px-6 py-3">
                    <div className="font-medium">{c.campaign_name}</div>
                    <div className="text-xs text-text-mute">
                      ID: {c.campaign_id}
                    </div>
                    {error && (
                      <div className="mt-1 text-xs text-signal-red">{error}</div>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums">
                    {Math.round(c.spend).toLocaleString("uk-UA")} ₴
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={current}
                        onChange={(e) =>
                          setValues((v) => ({
                            ...v,
                            [c.campaign_id]: e.target.value,
                          }))
                        }
                        disabled={isSaving}
                        className="w-full rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
                      >
                        <option value="">— не зіставлено —</option>
                        {allUtmOptions.map((utm) => (
                          <option key={utm} value={utm}>
                            {utm}
                            {utm === suggested ? "  ✦ авто" : ""}
                          </option>
                        ))}
                      </select>
                      {isDirty && (
                        <button
                          onClick={() => save(c)}
                          disabled={isSaving}
                          className="shrink-0 rounded-md bg-gradient-accent px-3 py-1.5 text-xs font-semibold text-black hover:-translate-y-0.5 disabled:opacity-60"
                        >
                          {isSaving ? "…" : "OK"}
                        </button>
                      )}
                    </div>
                    {!current && suggested && (
                      <button
                        onClick={() => {
                          setValues((v) => ({
                            ...v,
                            [c.campaign_id]: suggested,
                          }));
                        }}
                        className="mt-1 text-xs text-accent-alt hover:underline"
                      >
                        Прийняти автомаппінг: {suggested}
                      </button>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <StatusBadge state={state} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-text-mute">
        Збережені зіставлення мають пріоритет над автоматичним fuzzy-матчингом
        на дашборді. Щоб видалити звʼязок, оберіть{" "}
        <em>«— не зіставлено —»</em> та натисніть OK. Для UTM, якої ще немає
        в замовленнях, натисніть{" "}
        <em>«+ Додати нову UTM»</em> зверху.
      </p>
    </div>
  );
}

function LegendItem({ dot, label }: { dot: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-text-mute">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </div>
  );
}

function StatusBadge({ state }: { state: RowState }) {
  switch (state) {
    case "saved":
      return <Badge color="accent" label="Збережено" />;
    case "auto":
      return <Badge color="accent-alt" label="Авто" />;
    case "dirty":
      return <Badge color="yellow" label="Зміни" />;
    case "saving":
      return <Badge color="muted" label="…" />;
    case "error":
      return <Badge color="red" label="Помилка" />;
    default:
      return <Badge color="muted" label="Немає" />;
  }
}

function Badge({
  color,
  label,
}: {
  color: "accent" | "accent-alt" | "yellow" | "muted" | "red";
  label: string;
}) {
  const classMap: Record<typeof color, string> = {
    accent: "bg-accent/15 text-accent",
    "accent-alt": "bg-accent-alt/15 text-accent-alt",
    yellow: "bg-signal-orange/15 text-signal-orange",
    muted: "bg-bg-elevated text-text-mute",
    red: "bg-signal-red/15 text-signal-red",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${classMap[color]}`}
    >
      {label}
    </span>
  );
}
