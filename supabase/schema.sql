-- Structure Studio: data + matching schema.
create extension if not exists pg_trgm;
-- Sourced fields stored as jsonb {value, source}. Full Property kept in `data`.

create table if not exists properties (
  id             text primary key,
  use            text not null check (use in ('residential','commercial','mixed')),
  nation         text not null check (nation in ('england','scotland','wales','ni')),
  postcode_area  text,
  property_type  text,
  address        text not null,
  postcode       text,
  price_gbp      jsonb,   -- Sourced<number> {value, source}
  rent_pa_gbp    jsonb,   -- Sourced<number>
  yield_pct      jsonb,   -- Sourced<number>
  source_kind    text not null,
  source_file    text,
  data           jsonb not null,  -- full Property
  updated_at     timestamptz not null default now()
);

create index if not exists properties_use_idx           on properties (use);
create index if not exists properties_nation_idx        on properties (nation);
create index if not exists properties_postcode_area_idx on properties (postcode_area);
create index if not exists properties_property_type_idx on properties (property_type);
create index if not exists properties_address_trgm_idx  on properties using gin (address gin_trgm_ops);

create table if not exists uploads (
  id            uuid primary key default gen_random_uuid(),
  filename      text not null,
  storage_path  text not null,
  extracted     jsonb,
  created_at    timestamptz not null default now()
);

-- Read-only public access for the anon key; writes via service role only.
alter table properties enable row level security;
alter table uploads    enable row level security;
drop policy if exists properties_read on properties;
create policy properties_read on properties for select using (true);
