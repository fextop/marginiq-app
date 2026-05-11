-- ============================================================
-- MarginIQ MVP — початкова схема БД
-- Підхід: на Ступені 1 один користувач (ти).
-- На Ступені 2 додамо organization_id + RLS.
-- ============================================================

-- ----------
-- integrations: збережені credentials для кожного джерела
-- ----------
create table public.integrations (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('google_ads', 'salesdrive')),
  display_name  text,
  credentials   jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  last_sync_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (source)
);

-- ----------
-- ad_metrics: щоденні метрики реклами з Google Ads
-- ----------
create table public.ad_metrics (
  id                    uuid primary key default gen_random_uuid(),
  date                  date not null,
  source                text not null default 'google_ads',
  campaign_id           text not null,
  campaign_name         text not null,
  ad_group_id           text,
  ad_group_name         text,
  spend                 numeric(14, 2) not null default 0,   -- грн
  clicks                integer not null default 0,
  impressions           integer not null default 0,
  conversions_reported  numeric(10, 2) not null default 0,   -- те, що Google нарахував
  raw_data              jsonb,                                -- backup сирих даних
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (source, campaign_id, date, ad_group_id)
);

create index ad_metrics_date_idx on public.ad_metrics (date desc);
create index ad_metrics_campaign_idx on public.ad_metrics (campaign_id);

-- ----------
-- orders: замовлення з SalesDrive (та інших CRM у майбутньому)
-- ВАЖЛИВО: cost і acquiring_fee приходять ПО ФАКТУ з заказу
-- (а не з окремої таблиці товарів), бо SalesDrive вже їх містить.
-- ----------
create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  source               text not null default 'salesdrive',  -- 'salesdrive', 'horoshop', etc.
  external_id          text not null,                        -- ID замовлення в CRM
  external_order_no    text,                                 -- людський номер (Order #12345)
  status               text,                                 -- 'paid', 'pending', 'cancelled', ...
  status_group         text,                                 -- спрощений: 'success', 'cancelled', 'pending'
  
  -- грошові поля по факту (всі в грн)
  revenue              numeric(14, 2) not null default 0,    -- сума замовлення
  cost_of_goods        numeric(14, 2) not null default 0,    -- собівартість (з SalesDrive по факту)
  acquiring_fee        numeric(14, 2) not null default 0,    -- комісія еквайрингу/оплати частинами/податок
  delivery_cost        numeric(14, 2) not null default 0,    -- доставка (якщо платить магазин)
  discount             numeric(14, 2) not null default 0,    -- знижка
  
  -- атрибуція
  utm_source           text,
  utm_medium           text,
  utm_campaign         text,
  utm_content          text,
  utm_term             text,
  gclid                text,                                 -- для точної атрибуції Google Ads
  referrer             text,
  
  -- посилання на campaign (заповнюється після recompute)
  attributed_campaign_id   text,
  attributed_ad_group_id   text,
  attribution_method       text,                             -- 'gclid', 'utm_campaign', 'manual', 'none'
  
  raw_data             jsonb,                                -- backup сирих даних з API
  created_at_external  timestamptz,                          -- коли замовлення створено в CRM
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (source, external_id)
);

create index orders_created_external_idx on public.orders (created_at_external desc);
create index orders_utm_campaign_idx on public.orders (utm_campaign);
create index orders_gclid_idx on public.orders (gclid) where gclid is not null;
create index orders_attributed_campaign_idx on public.orders (attributed_campaign_id);
create index orders_status_group_idx on public.orders (status_group);

-- ----------
-- order_items: позиції в замовленні (для розбивки маржі по SKU)
-- ----------
create table public.order_items (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders(id) on delete cascade,
  sku                text,
  product_name       text,
  qty                integer not null default 1,
  unit_price         numeric(14, 2) not null default 0,      -- ціна за штуку
  unit_cost          numeric(14, 2) not null default 0,      -- собівартість за штуку (з SalesDrive)
  line_total         numeric(14, 2) not null default 0,      -- qty * unit_price
  created_at         timestamptz not null default now()
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_sku_idx on public.order_items (sku);

-- ----------
-- sync_logs: для діагностики синхронізацій
-- ----------
create table public.sync_logs (
  id              uuid primary key default gen_random_uuid(),
  source          text not null,                             -- 'google_ads', 'salesdrive', 'csv_import'
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'running',           -- 'running', 'success', 'error'
  rows_inserted   integer default 0,
  rows_updated    integer default 0,
  error_message   text,
  meta            jsonb
);

create index sync_logs_source_started_idx on public.sync_logs (source, started_at desc);

-- ============================================================
-- Тригер update_updated_at для всіх таблиць
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create trigger ad_metrics_updated_at before update on public.ad_metrics
  for each row execute function public.set_updated_at();
create trigger integrations_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();
