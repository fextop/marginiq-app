"use client";

import { useState } from "react";

export type DailyPoint = {
  date: string; // YYYY-MM-DD
  revenue: number;
  margin: number; // прибуток БЕЗ реклами (виручка − собівартість − комісії − знижки)
  netProfit: number; // чистий прибуток З рекламою (margin − розподілена реклама)
  orders: number;
};

type Props = {
  data: DailyPoint[];
};

// Кольори (SVG потребує конкретних значень).
const C = {
  revenue: "#00B8E6", // accent-alt — виручка (блакитний)
  profit: "#8FDD7A", // салатовий — прибуток без реклами
  netProfit: "#00D9A3", // accent — чистий прибуток з рекламою (ізумрудний)
  bar: "#2E3552", // приглушені стовпці — замовлення
  barHover: "#3D4570",
  border: "#252B36",
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

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}

export function DailyMarginChart({ data }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);
  const totalProfit = data.reduce((s, d) => s + d.margin, 0);
  const totalNetProfit = data.reduce((s, d) => s + d.netProfit, 0);

  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-bg-card p-8 text-center text-sm text-text-mute">
        Немає даних за обраний період.
      </div>
    );
  }

  // Геометрія SVG. padT збільшено, щоб підписи осей (₴ / шт) не накладались
  // на верхні числові мітки.
  const W = 880;
  const H = 246;
  const padL = 58; // ліва вісь — гроші
  const padR = 42; // права вісь — замовлення
  const padT = 32; // місце для підписів осей зверху
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Ліва вісь — гроші.
  const maxMoney = Math.max(...data.map((d) => d.revenue), 1);
  const minVal = Math.min(
    0,
    ...data.map((d) => d.margin),
    ...data.map((d) => d.netProfit),
  );
  const moneyTop = niceCeil(maxMoney);
  const moneyBottom = minVal < 0 ? -niceCeil(-minVal) : 0;

  // Права вісь — замовлення.
  const maxOrders = Math.max(...data.map((d) => d.orders), 1);
  const ordersTop = maxOrders <= 6 ? maxOrders : Math.ceil(maxOrders / 5) * 5;

  const slot = plotW / data.length;
  const barW = Math.min(slot * 0.5, 16);

  const x = (i: number) => padL + slot * i + slot / 2;
  const yMoney = (v: number) =>
    padT + plotH - ((v - moneyBottom) / (moneyTop - moneyBottom)) * plotH;
  const yOrders = (v: number) => padT + plotH - (v / ordersTop) * plotH;

  const baseY = yMoney(moneyBottom);

  const revenuePts = data.map((d, i) => `${x(i)},${yMoney(d.revenue)}`);
  const revenueLine = revenuePts.join(" ");
  const revenueArea =
    `${x(0)},${baseY} ` + revenueLine + ` ${x(data.length - 1)},${baseY}`;
  const profitLine = data
    .map((d, i) => `${x(i)},${yMoney(d.margin)}`)
    .join(" ");
  const netProfitLine = data
    .map((d, i) => `${x(i)},${yMoney(d.netProfit)}`)
    .join(" ");

  // Мітки лівої осі (гроші).
  const moneyTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = moneyBottom + (moneyTop - moneyBottom) * f;
    return { v, y: padT + plotH - f * plotH };
  });

  // Мітки правої осі (замовлення) — цілі.
  const orderStep = ordersTop <= 6 ? 1 : Math.ceil(ordersTop / 6);
  const orderTicks: number[] = [];
  for (let v = 0; v <= ordersTop; v += orderStep) orderTicks.push(v);

  const xStep = Math.ceil(data.length / 10);
  const h = hover != null ? data[hover] : null;

  return (
    <div className="rounded-2xl border border-border bg-bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3">
        <div className="max-w-xl">
          <h2 className="text-base font-bold">Динаміка по днях</h2>
          <p className="mt-0.5 text-xs text-text-mute">
            <span className="text-text">Прибуток</span> — без реклами (виручка −
            собівартість − комісії − знижки).{" "}
            <span className="text-text">Чистий прибуток</span> — мінус реклама,
            розподілена по днях пропорційно виручці.
          </p>
        </div>
        <div className="flex gap-3 text-right text-xs">
          <div>
            <div className="text-text-mute">Виручка</div>
            <div className="text-sm font-bold tabular-nums">
              {money(totalRevenue)} ₴
            </div>
          </div>
          <div>
            <div className="text-text-mute">Прибуток</div>
            <div
              className="text-sm font-bold tabular-nums"
              style={{ color: C.profit }}
            >
              {money(totalProfit)} ₴
            </div>
          </div>
          <div>
            <div className="text-text-mute">Чистий прибуток</div>
            <div className="text-sm font-bold tabular-nums text-accent">
              {money(totalNetProfit)} ₴
            </div>
          </div>
        </div>
      </div>

      {/* Легенда */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pt-3 text-xs text-text-mute">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: C.revenue }} />
          Виручка
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: C.profit }} />
          Прибуток (без реклами)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: C.netProfit }} />
          Чистий прибуток (з рекламою)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C.bar }} />
          Замовлення
        </span>
      </div>

      <div className="relative px-2 pb-2 pt-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          onMouseLeave={() => setHover(null)}
        >
          {/* Підписи осей — зверху, у власній зоні (не накладаються на мітки) */}
          <text x={padL - 8} y={14} textAnchor="end" fontSize={10} fill={C.textMute}>
            ₴
          </text>
          <text
            x={W - padR + 8}
            y={14}
            textAnchor="start"
            fontSize={10}
            fill={C.textMute}
          >
            шт
          </text>

          {/* Сітка + ліва вісь (гроші) */}
          {moneyTicks.map((t, i) => (
            <g key={`m${i}`}>
              <line
                x1={padL}
                x2={W - padR}
                y1={t.y}
                y2={t.y}
                stroke={C.border}
                strokeWidth={1}
                strokeDasharray={t.v === 0 ? "0" : "3 3"}
              />
              <text
                x={padL - 8}
                y={t.y + 4}
                textAnchor="end"
                fontSize={10}
                fill={C.textMute}
              >
                {money(t.v)}
              </text>
            </g>
          ))}

          {/* Права вісь (замовлення) */}
          {orderTicks.map((v) => (
            <text
              key={`o${v}`}
              x={W - padR + 8}
              y={yOrders(v) + 4}
              textAnchor="start"
              fontSize={10}
              fill={C.textMute}
            >
              {v}
            </text>
          ))}

          {/* Стовпці — замовлення (права вісь) */}
          {data.map((d, i) => {
            const by = yOrders(d.orders);
            const isHover = hover === i;
            return (
              <rect
                key={`b${d.date}`}
                x={x(i) - barW / 2}
                y={by}
                width={barW}
                height={Math.max(baseY - by, 0)}
                rx={2}
                fill={isHover ? C.barHover : C.bar}
              />
            );
          })}

          {/* Area під виручкою */}
          <polygon points={revenueArea} fill={C.revenue} fillOpacity={0.1} />

          {/* Лінія виручки */}
          <polyline
            points={revenueLine}
            fill="none"
            stroke={C.revenue}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Лінія прибутку без реклами */}
          <polyline
            points={profitLine}
            fill="none"
            stroke={C.profit}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Лінія чистого прибутку з рекламою */}
          <polyline
            points={netProfitLine}
            fill="none"
            stroke={C.netProfit}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Точки */}
          {data.map((d, i) => (
            <g key={`p${d.date}`}>
              <circle
                cx={x(i)}
                cy={yMoney(d.revenue)}
                r={hover === i ? 3.5 : 0}
                fill={C.revenue}
              />
              <circle
                cx={x(i)}
                cy={yMoney(d.margin)}
                r={hover === i ? 3 : 0}
                fill={C.profit}
              />
              <circle
                cx={x(i)}
                cy={yMoney(d.netProfit)}
                r={hover === i ? 3.5 : 0}
                fill={d.netProfit < 0 ? C.red : C.netProfit}
              />
            </g>
          ))}

          {/* Мітки осі X */}
          {data.map((d, i) =>
            i % xStep === 0 ? (
              <text
                key={`x${d.date}`}
                x={x(i)}
                y={H - padB + 16}
                textAnchor="middle"
                fontSize={9}
                fill={C.textMute}
              >
                {dayLabel(d.date)}
              </text>
            ) : null,
          )}

          {/* Вертикальна лінія наведення */}
          {hover != null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padT}
              y2={padT + plotH}
              stroke={C.revenue}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {/* Зони наведення */}
          {data.map((d, i) => (
            <rect
              key={`h${d.date}`}
              x={padL + slot * i}
              y={padT}
              width={slot}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>

        {/* Тултип */}
        {h && (
          <div className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs shadow-xl">
            <div className="font-semibold">{dayLabel(h.date)}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 tabular-nums">
              <span className="text-text-mute">
                Виручка:{" "}
                <span className="font-semibold" style={{ color: C.revenue }}>
                  {money(h.revenue)} ₴
                </span>
              </span>
              <span className="text-text-mute">
                Прибуток:{" "}
                <span className="font-semibold" style={{ color: C.profit }}>
                  {money(h.margin)} ₴
                </span>
              </span>
              <span className="text-text-mute">
                Чистий прибуток:{" "}
                <span
                  className={`font-semibold ${
                    h.netProfit < 0 ? "text-signal-red" : "text-accent"
                  }`}
                >
                  {money(h.netProfit)} ₴
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
