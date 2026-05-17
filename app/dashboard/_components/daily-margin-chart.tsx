"use client";

import { useState } from "react";

export type DailyPoint = {
  date: string; // YYYY-MM-DD
  revenue: number;
  margin: number; // валова маржа за день
  orders: number;
};

type Props = {
  data: DailyPoint[];
};

// Кольори з tailwind.config (SVG потребує конкретних значень).
const C = {
  accent: "#00D9A3",
  accentAlt: "#00B8E6",
  border: "#252B36",
  barIdle: "#181C24",
  textMute: "#8B92A0",
  red: "#FF4757",
};

function money(v: number): string {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(
    Math.round(v),
  );
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
}

export function DailyMarginChart({ data }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-bg-card p-8 text-center text-sm text-text-mute">
        Немає даних за обраний період.
      </div>
    );
  }

  // Геометрія SVG.
  const W = 860;
  const H = 300;
  const padL = 56;
  const padR = 16;
  const padT = 20;
  const padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);
  // Верхня межа осі — округлюємо вгору до «гарного» числа.
  const niceMax = (() => {
    const raw = maxRevenue * 1.1;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    return Math.ceil(raw / mag) * mag;
  })();

  const slot = plotW / data.length;
  const barW = Math.min(slot * 0.6, 22);

  const x = (i: number) => padL + slot * i + slot / 2;
  const y = (v: number) => padT + plotH - (v / niceMax) * plotH;

  // Лінія маржі (може бути від'ємною — обрізаємо до 0 знизу для відображення).
  const marginLine = data
    .map((d, i) => `${x(i)},${y(Math.max(d.margin, 0))}`)
    .join(" ");

  // Мітки осі Y.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    v: niceMax * f,
    y: padT + plotH - f * plotH,
  }));

  // Мітки осі X — не більше ~10, рівномірно.
  const xStep = Math.ceil(data.length / 10);

  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);
  const totalMargin = data.reduce((s, d) => s + d.margin, 0);
  const h = hover != null ? data[hover] : null;

  return (
    <div className="rounded-2xl border border-border bg-bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h2 className="text-lg font-bold">Динаміка по днях</h2>
          <p className="mt-1 text-sm text-text-mute">
            Виручка та валова маржа (виручка − собівартість − комісії − знижки)
            за кожен день. Реклама не розбита по днях — у графік не входить.
          </p>
        </div>
        <div className="flex gap-4 text-right text-sm">
          <div>
            <div className="text-xs text-text-mute">Виручка</div>
            <div className="font-bold tabular-nums">{money(totalRevenue)} ₴</div>
          </div>
          <div>
            <div className="text-xs text-text-mute">Валова маржа</div>
            <div className="font-bold tabular-nums text-accent">
              {money(totalMargin)} ₴
            </div>
          </div>
        </div>
      </div>

      <div className="relative px-3 py-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          onMouseLeave={() => setHover(null)}
        >
          {/* Сітка + мітки Y */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={padL}
                x2={W - padR}
                y1={t.y}
                y2={t.y}
                stroke={C.border}
                strokeWidth={1}
                strokeDasharray={i === 0 ? "0" : "3 3"}
              />
              <text
                x={padL - 8}
                y={t.y + 4}
                textAnchor="end"
                fontSize={11}
                fill={C.textMute}
              >
                {money(t.v)}
              </text>
            </g>
          ))}

          {/* Бари виручки */}
          {data.map((d, i) => {
            const bx = x(i) - barW / 2;
            const by = y(d.revenue);
            const isHover = hover === i;
            return (
              <rect
                key={d.date}
                x={bx}
                y={by}
                width={barW}
                height={Math.max(padT + plotH - by, 0)}
                rx={2}
                fill={isHover ? C.accentAlt : C.barIdle}
                stroke={isHover ? C.accentAlt : C.border}
                strokeWidth={1}
              />
            );
          })}

          {/* Лінія валової маржі */}
          <polyline
            points={marginLine}
            fill="none"
            stroke={C.accent}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {data.map((d, i) => (
            <circle
              key={d.date}
              cx={x(i)}
              cy={y(Math.max(d.margin, 0))}
              r={hover === i ? 4 : 2.5}
              fill={d.margin < 0 ? C.red : C.accent}
            />
          ))}

          {/* Мітки X */}
          {data.map((d, i) =>
            i % xStep === 0 ? (
              <text
                key={d.date}
                x={x(i)}
                y={H - padB + 18}
                textAnchor="middle"
                fontSize={10}
                fill={C.textMute}
              >
                {dayLabel(d.date)}
              </text>
            ) : null,
          )}

          {/* Прозорі зони наведення */}
          {data.map((d, i) => (
            <rect
              key={d.date}
              x={padL + slot * i}
              y={padT}
              width={slot}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}

          {/* Вертикальна лінія наведення */}
          {hover != null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padT}
              y2={padT + plotH}
              stroke={C.accentAlt}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
        </svg>

        {/* Легенда */}
        <div className="mt-1 flex items-center gap-4 px-3 text-xs text-text-mute">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm border border-border bg-bg-elevated" />
            Виручка
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded-full bg-accent" />
            Валова маржа
          </span>
        </div>

        {/* Тултип */}
        {h && (
          <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs shadow-xl">
            <div className="font-semibold">{dayLabel(h.date)}</div>
            <div className="mt-1 flex gap-4 tabular-nums">
              <span className="text-text-mute">
                Виручка:{" "}
                <span className="font-semibold text-text">
                  {money(h.revenue)} ₴
                </span>
              </span>
              <span className="text-text-mute">
                Маржа:{" "}
                <span
                  className={`font-semibold ${
                    h.margin < 0 ? "text-signal-red" : "text-accent"
                  }`}
                >
                  {money(h.margin)} ₴
                </span>
              </span>
              <span className="text-text-mute">
                Замовлень:{" "}
                <span className="font-semibold text-text">{h.orders}</span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
