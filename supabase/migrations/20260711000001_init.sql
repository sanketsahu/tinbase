-- ============================================================================
-- 20260711000001_init.sql — tinbase dev demo schema
--
-- A production-grade e-commerce + content + support schema used as the local
-- demo dataset. Auto-applied on fresh boots by the supabase/ project loader
-- and by `npm run db:reset`. Every statement is idempotent so the file can
-- safely run more than once against the same database.
--
-- SECURITY MODEL (mirrors Supabase):
--   • public is the only schema exposed through the Data API for
--     anon/authenticated, so EVERY table here has RLS enabled with explicit
--     policies. service_role bypasses RLS.
--   • Managed schemas (auth, storage, cron, …) are protected by grants and
--     API non-exposure — RLS there is neither needed nor supported the same
--     way. Never put secrets in public.
--   • Views can't hold policies; active_products uses security_invoker so the
--     caller's RLS on public.products applies through it.
-- ============================================================================

-- ── Enums ────────────────────────────────────────────────────────────────────

do $$ begin
  create type public.order_status as enum ('pending', 'paid', 'shipped', 'delivered', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.ticket_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null;
end $$;

-- ── Tables ───────────────────────────────────────────────────────────────────

-- One profile per auth user. The PK doubles as the FK to auth.users, so a
-- deleted account takes its profile with it.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  full_name text,
  avatar_url text,
  bio text,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Public-facing user profiles, one per auth.users row.';

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

comment on table public.organizations is 'Teams / workspaces. Visible only to their members (see policies).';

create table if not exists public.org_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.products (
  id bigint generated always as identity primary key,
  sku text unique not null,
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  stock int not null default 0,
  tags text[] not null default '{}',
  attributes jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.products is 'Product catalog. Publicly readable; writes go through service_role only.';

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status public.order_status not null default 'pending',
  total numeric(10,2),
  shipping_address jsonb,
  placed_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id bigint not null references public.products (id),
  quantity int not null check (quantity > 0),
  unit_price numeric(10,2) not null
);

create table if not exists public.posts (
  id bigint generated always as identity primary key,
  author_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  slug text unique not null,
  content text,
  published boolean not null default false,
  view_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Threaded comments: parent_id → comments.id gives reply chains; deleting a
-- parent removes the whole thread, deleting an author keeps their comments
-- but anonymizes them (set null).
create table if not exists public.comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  parent_id bigint references public.comments (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  subject text not null,
  body text,
  priority public.ticket_priority not null default 'medium',
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── Views ────────────────────────────────────────────────────────────────────

-- security_invoker: the view runs with the CALLER's permissions, so the RLS
-- policies on public.products apply through it. Without it, a view runs as
-- its owner and silently bypasses RLS (the studio flags that as UNRESTRICTED).
create or replace view public.active_products
with (security_invoker = on) as
  select id, sku, name, description, price, stock, tags, attributes, created_at
  from public.products
  where active;

comment on view public.active_products is 'Storefront view: only purchasable products. security_invoker, so product RLS applies.';

-- ── Functions & triggers ─────────────────────────────────────────────────────

-- Keep updated_at fresh on every UPDATE (attached to profiles and posts).
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

-- Server-side order total (sum of line items). Used by the seed to backfill
-- orders.total, and handy from PostgREST: /rest/v1/rpc/order_total
create or replace function public.order_total(order_uuid uuid) returns numeric
language sql stable as $$
  select coalesce(sum(quantity * unit_price), 0)::numeric(10,2)
  from public.order_items
  where order_id = order_uuid
$$;

-- Membership check for org policies. SECURITY DEFINER on purpose: a policy on
-- org_members that queried org_members directly would recurse into itself
-- ("infinite recursion detected in policy"); a definer function reads the
-- table with the owner's rights and breaks the cycle. Standard Supabase
-- pattern for many-to-many linking tables.
create or replace function public.is_org_member(org uuid) returns boolean
language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.org_members
    where org_id = org and user_id = auth.uid()
  )
$$;

-- ── Indexes ──────────────────────────────────────────────────────────────────

create index if not exists orders_user_id_idx on public.orders (user_id);
-- Partial: the open-orders dashboard never looks at delivered orders.
create index if not exists orders_open_status_idx on public.orders (status) where status <> 'delivered';
create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists comments_post_id_idx on public.comments (post_id);
create index if not exists posts_author_id_idx on public.posts (author_id);
create index if not exists org_members_user_id_idx on public.org_members (user_id);
-- GIN for containment queries: attributes @> '{"color":"black"}', tags && '{sale}'
create index if not exists products_attributes_gin_idx on public.products using gin (attributes);
create index if not exists products_tags_gin_idx on public.products using gin (tags);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- public is API-exposed, so EVERY table gets RLS + explicit policies.
-- service_role bypasses RLS; anon/authenticated get exactly what is written here.

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.support_tickets enable row level security;

-- profiles: readable by everyone, writable only by the owner
drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Profiles are viewable by everyone" on public.profiles
  for select to anon, authenticated using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- products: a public storefront catalog — world-readable, staff-only writes
-- (no insert/update/delete policies: only service_role can write).
drop policy if exists "Products are viewable by everyone" on public.products;
create policy "Products are viewable by everyone" on public.products
  for select to anon, authenticated using (true);

-- organizations: visible to their members only
drop policy if exists "Members can view their organizations" on public.organizations;
create policy "Members can view their organizations" on public.organizations
  for select to authenticated using (public.is_org_member(id));

-- org_members: you can see your own memberships and your co-members
-- (via the definer helper — see is_org_member for why).
drop policy if exists "Members can view org membership" on public.org_members;
create policy "Members can view org membership" on public.org_members
  for select to authenticated using (user_id = auth.uid() or public.is_org_member(org_id));

-- posts: published posts are public; drafts only visible to their author
drop policy if exists "Published posts are viewable, drafts by author" on public.posts;
create policy "Published posts are viewable, drafts by author" on public.posts
  for select to anon, authenticated using (published or author_id = auth.uid());

drop policy if exists "Authors can insert their own posts" on public.posts;
create policy "Authors can insert their own posts" on public.posts
  for insert to authenticated with check (author_id = auth.uid());

drop policy if exists "Authors can update their own posts" on public.posts;
create policy "Authors can update their own posts" on public.posts
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "Authors can delete their own posts" on public.posts;
create policy "Authors can delete their own posts" on public.posts
  for delete to authenticated using (author_id = auth.uid());

-- comments: visible wherever the parent post is visible; write your own
drop policy if exists "Comments on visible posts are viewable" on public.comments;
create policy "Comments on visible posts are viewable" on public.comments
  for select to anon, authenticated using (
    exists (select 1 from public.posts p where p.id = post_id and (p.published or p.author_id = auth.uid()))
  );

drop policy if exists "Users can comment on visible posts" on public.comments;
create policy "Users can comment on visible posts" on public.comments
  for insert to authenticated with check (
    author_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id and (p.published or p.author_id = auth.uid()))
  );

drop policy if exists "Authors can update their own comments" on public.comments;
create policy "Authors can update their own comments" on public.comments
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "Authors can delete their own comments" on public.comments;
create policy "Authors can delete their own comments" on public.comments
  for delete to authenticated using (author_id = auth.uid());

-- orders: customers see and create only their own orders
drop policy if exists "Users can view their own orders" on public.orders;
create policy "Users can view their own orders" on public.orders
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Users can create their own orders" on public.orders;
create policy "Users can create their own orders" on public.orders
  for insert to authenticated with check (user_id = auth.uid());

-- order_items: visible/insertable only through an order the caller owns
drop policy if exists "Users can view items of their own orders" on public.order_items;
create policy "Users can view items of their own orders" on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

drop policy if exists "Users can add items to their own orders" on public.order_items;
create policy "Users can add items to their own orders" on public.order_items
  for insert to authenticated with check (
    exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

-- support_tickets: fully private to the reporter
drop policy if exists "Users manage their own tickets" on public.support_tickets;
create policy "Users manage their own tickets" on public.support_tickets
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Storage policies ─────────────────────────────────────────────────────────
-- storage.objects IS queried as the caller's role by the storage API, so RLS
-- policies there are meaningful (unlike the rest of the managed schemas).
--   avatars:   public bucket — world-readable; users write files under their
--              own uid/ prefix.
--   documents: private bucket — owners only.

drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable" on storage.objects
  for select to anon, authenticated using (bucket_id = 'avatars');

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars' and name like auth.uid()::text || '/%'
  );

drop policy if exists "Users can manage their own documents" on storage.objects;
create policy "Users can manage their own documents" on storage.objects
  for all to authenticated using (bucket_id = 'documents' and owner = auth.uid())
  with check (bucket_id = 'documents' and owner = auth.uid());

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Bootstrap default privileges already grant table access broadly — RLS is the
-- row filter, grants are the coarse switch (the Supabase model). Functions:

grant execute on function public.order_total(uuid) to anon, authenticated, service_role;
grant execute on function public.is_org_member(uuid) to anon, authenticated, service_role;
