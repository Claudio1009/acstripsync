create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles read" on public.profiles for select to authenticated using (true);
create policy "profiles own update" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "profiles own insert" on public.profiles for insert to authenticated with check (auth.uid() = id);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name) values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)));
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date,
  days int not null default 3 check (days between 1 and 30),
  code text not null unique default upper(substr(md5(random()::text),1,6)),
  status text not null default 'organizare',
  organizer_id uuid not null default auth.uid(),
  chosen_recommendation_id uuid,
  created_at timestamptz not null default now()
);

create table public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  role text not null default 'membru',
  budget int,
  beach int, nature int, culture int, fun int,
  pace text,
  prefs_complete boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create or replace function public.is_trip_member(_trip uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.trip_members where trip_id = _trip and user_id = auth.uid())
$$;
create or replace function public.is_trip_organizer(_trip uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.trips where id = _trip and organizer_id = auth.uid())
$$;

create or replace function public.add_organizer_member() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members (trip_id, user_id, role) values (new.id, new.organizer_id, 'organizator');
  return new;
end; $$;
create trigger on_trip_created after insert on public.trips for each row execute function public.add_organizer_member();

create or replace function public.join_trip(_code text) returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'Neautentificat'; end if;
  select id into t from public.trips where code = upper(trim(_code));
  if t is null then raise exception 'Cod invalid'; end if;
  insert into public.trip_members (trip_id, user_id) values (t, auth.uid()) on conflict do nothing;
  return t;
end; $$;
grant execute on function public.join_trip(text) to authenticated;

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null, country text, cost_estimate int, description text,
  group_score int, member_scores jsonb not null default '[]', explanation text,
  created_at timestamptz not null default now()
);

create table public.votes (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  target_type text not null default 'destination',
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id, target_type, target_id)
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null, category text, cost int default 0, duration_hours numeric default 2, description text,
  created_at timestamptz not null default now()
);

create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  day int not null, position int not null default 0,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.trips, public.trip_members, public.recommendations, public.votes, public.activities, public.itinerary_items to authenticated;
grant all on public.trips, public.trip_members, public.recommendations, public.votes, public.activities, public.itinerary_items to service_role;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.recommendations enable row level security;
alter table public.votes enable row level security;
alter table public.activities enable row level security;
alter table public.itinerary_items enable row level security;

create policy "trips read" on public.trips for select to authenticated using (public.is_trip_member(id) or organizer_id = auth.uid());
create policy "trips insert" on public.trips for insert to authenticated with check (organizer_id = auth.uid());
create policy "trips update" on public.trips for update to authenticated using (organizer_id = auth.uid());
create policy "trips delete" on public.trips for delete to authenticated using (organizer_id = auth.uid());

create policy "members read" on public.trip_members for select to authenticated using (public.is_trip_member(trip_id));
create policy "members own update" on public.trip_members for update to authenticated using (user_id = auth.uid());
create policy "members leave" on public.trip_members for delete to authenticated using (user_id = auth.uid() or public.is_trip_organizer(trip_id));

create policy "rec read" on public.recommendations for select to authenticated using (public.is_trip_member(trip_id));
create policy "rec write" on public.recommendations for insert to authenticated with check (public.is_trip_member(trip_id));
create policy "rec delete" on public.recommendations for delete to authenticated using (public.is_trip_organizer(trip_id));

create policy "votes read" on public.votes for select to authenticated using (public.is_trip_member(trip_id));
create policy "votes insert" on public.votes for insert to authenticated with check (user_id = auth.uid() and public.is_trip_member(trip_id));
create policy "votes delete" on public.votes for delete to authenticated using (user_id = auth.uid());

create policy "act read" on public.activities for select to authenticated using (public.is_trip_member(trip_id));
create policy "act insert" on public.activities for insert to authenticated with check (public.is_trip_member(trip_id));
create policy "act delete" on public.activities for delete to authenticated using (public.is_trip_organizer(trip_id));

create policy "it read" on public.itinerary_items for select to authenticated using (public.is_trip_member(trip_id));
create policy "it insert" on public.itinerary_items for insert to authenticated with check (public.is_trip_member(trip_id));
create policy "it update" on public.itinerary_items for update to authenticated using (public.is_trip_member(trip_id));
create policy "it delete" on public.itinerary_items for delete to authenticated using (public.is_trip_member(trip_id));