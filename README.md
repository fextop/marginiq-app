# MarginIQ — App (MVP)

Приложение для расчёта реальной чистой маржи по каждому товару и рекламной кампании после рекламы, эквайринга и себестоимости.

## Stack

- **Next.js 15** (App Router) на Vercel
- **Supabase** (Postgres + Auth) — EU регион
- **Tailwind CSS** + design tokens из лендинга marginiq.dev
- **TypeScript** везде

## Этапы

**Ступень 1 (текущая):** MVP для одного пользователя на CSV-данных, потом API.
**Ступень 2:** Multi-tenant SaaS с регистрацией, OAuth-подключениями, биллингом.
**Ступень 3:** White-label, partner program, новые CRM.

См. `MarginIQ-MVP-Plan.md` для деталей.

## Локальная разработка

```bash
# 1. Установить зависимости
npm install

# 2. Скопировать .env.example в .env.local и заполнить
cp .env.example .env.local

# 3. Запустить дев-сервер
npm run dev
```

## Структура проекта

```
app/
├── dashboard/          — главный экран с KPI и таблицами
├── settings/           — настройки + CSV-импорт
└── api/
    ├── cron/           — Vercel cron jobs (каждый час)
    │   ├── sync-google-ads/
    │   ├── sync-salesdrive/
    │   └── recompute-margins/
    └── import/         — CSV upload endpoints
lib/
├── supabase/           — клиенты для server/client/admin
└── types/              — TypeScript типы для схемы БД
supabase/
└── migrations/         — SQL миграции схемы БД
```

## Cron расписание

| Endpoint | Schedule | Что делает |
|---|---|---|
| `/api/cron/sync-google-ads` | `0 * * * *` (XX:00) | Тянет данные из Google Ads API |
| `/api/cron/sync-salesdrive` | `5 * * * *` (XX:05) | Тянет заказы из SalesDrive |
| `/api/cron/recompute-margins` | `10 * * * *` (XX:10) | Атрибуция + пересчёт маржи |

Защита: каждый endpoint проверяет заголовок `Authorization: Bearer ${CRON_SECRET}`. Vercel автоматически подставляет его.

## База данных

Основные таблицы:
- `integrations` — credentials для Google Ads / SalesDrive
- `ad_metrics` — дневная статистика по кампаниям
- `orders` — заказы с **себестоимостью и комиссией по факту** из CRM
- `order_items` — позиции заказа (для маржи по SKU)
- `sync_logs` — диагностика

Views:
- `v_orders_attributed` — заказы + привязка к кампании по UTM/gclid
- `v_campaign_daily` — дневная агрегация: выручка, расход, чистая маржа
- `v_kpi_summary` — сводные метрики за 30 дней (для дашборда)
- `v_product_margin` — маржа по SKU

Применить миграции:
```bash
# Через Supabase CLI
supabase db push

# Или вручную через SQL Editor в Supabase Dashboard
```

## Deploy

Подключён к GitHub, автоматический деплой на push в `main`. Production URL: `app.marginiq.dev`.
