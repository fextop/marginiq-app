"use client";

import { useState } from "react";

export type OrderTableRow = {
  id: string;
  dateLabel: string;
  dateSort: string;
  externalId: string;
  externalOrderNo: string | null;
  status: string | null;
  statusGroup: string | null;
  revenue: number;
  margin: number;
  marginPct: number;
  isSuccess: boolean;
  manager: string;
  productsLabel: string;
};

type SortKey = "date" | "status" | "revenue" | "margin";
type SortDir = "asc" | "desc";

// Порядок груп статусів для сортування за статусом: продажі першими.
const STATUS_ORDER: Record<string, number> = {
  success: 0,
  pending: 1,
  cancelled: 2,
};

export function OrdersTable({ rows }: { rows: OrderTableRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // За замовчуванням: дата — новіші зверху, решта — більші зверху.
      setSortDir("desc");
    }
  }

  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "date") {
      cmp = a.dateSort < b.dateSort ? -1 : a.dateSort > b.dateSort ? 1 : 0;
    } else if (sortKey === "revenue") {
      cmp = a.revenue - b.revenue;
    } else if (sortKey === "margin") {
      cmp = a.margin - b.margin;
    } else if (sortKey === "status") {
      const ao = STATUS_ORDER[a.statusGroup ?? ""] ?? 99;
      const bo = STATUS_ORDER[b.statusGroup ?? ""] ?? 99;
      cmp = ao - bo;
      // У межах одного статусу — новіші зверху.
      if (cmp === 0) {
        cmp = a.dateSort < b.dateSort ? 1 : a.dateSort > b.dateSort ? -1 : 0;
      }
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-text-mute">
          <tr>
            <SortableTh
              label="Дата"
              active={sortKey === "date"}
              dir={sortDir}
              onClick={() => toggleSort("date")}
            />
            <th className="px-6 py-3">№ заявки</th>
            <SortableTh
              label="Статус"
              active={sortKey === "status"}
              dir={sortDir}
              onClick={() => toggleSort("status")}
            />
            <SortableTh
              label="Виручка"
              align="right"
              active={sortKey === "revenue"}
              dir={sortDir}
              onClick={() => toggleSort("revenue")}
            />
            <SortableTh
              label="Маржа"
              align="right"
              active={sortKey === "margin"}
              dir={sortDir}
              onClick={() => toggleSort("margin")}
            />
            <th className="px-6 py-3 text-right">%</th>
            <th className="px-6 py-3">Товари</th>
            <th className="px-6 py-3">Менеджер</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {sorted.map((o) => (
            <tr
              key={o.id}
              className={`border-b border-border/50 last:border-0 ${
                !o.isSuccess ? "opacity-60" : ""
              }`}
            >
              <td className="px-6 py-3 text-text-mute">{o.dateLabel}</td>
              <td className="px-6 py-3 font-mono text-xs">
                <div className="font-semibold">{o.externalId}</div>
                {o.externalOrderNo && (
                  <div className="text-text-mute">сайт: {o.externalOrderNo}</div>
                )}
              </td>
              <td className="px-6 py-3">
                <StatusBadge group={o.statusGroup} status={o.status} />
              </td>
              <td className="px-6 py-3 text-right font-semibold">
                {formatMoney(o.revenue)}
              </td>
              <td
                className={`px-6 py-3 text-right font-semibold ${
                  o.isSuccess
                    ? o.margin < 0
                      ? "text-signal-red"
                      : "text-accent"
                    : "text-text-mute"
                }`}
              >
                {o.isSuccess ? formatMoney(o.margin) : "—"}
              </td>
              <td className="px-6 py-3 text-right text-text-mute">
                {o.isSuccess ? o.marginPct.toFixed(1) + "%" : "—"}
              </td>
              <td className="max-w-[280px] px-6 py-3">
                {o.productsLabel ? (
                  <div className="text-xs text-text-mute">{o.productsLabel}</div>
                ) : (
                  <span className="text-text-mute">—</span>
                )}
              </td>
              <td className="px-6 py-3 text-xs text-text-mute">
                {o.manager || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th className={`px-6 py-3 ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition hover:text-text ${
          active ? "text-text" : "text-text-mute"
        }`}
      >
        {label}
        <span className={`text-[10px] ${active ? "opacity-100" : "opacity-30"}`}>
          {active ? (dir === "asc" ? "▲" : "▼") : "▾"}
        </span>
      </button>
    </th>
  );
}

function StatusBadge({
  group,
  status,
}: {
  group: string | null;
  status: string | null;
}) {
  const config: Record<string, { label: string; classes: string }> = {
    success: { label: status ?? "Успіх", classes: "bg-accent/15 text-accent" },
    pending: {
      label: status ?? "В обробці",
      classes: "bg-accent-alt/15 text-accent-alt",
    },
    cancelled: {
      label: status ?? "Скасовано",
      classes: "bg-signal-red/15 text-signal-red",
    },
  };
  const cfg = config[group ?? "unknown"] ?? {
    label: status ?? "—",
    classes: "bg-bg-elevated text-text-mute",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cfg.classes}`}
    >
      {cfg.label}
    </span>
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
