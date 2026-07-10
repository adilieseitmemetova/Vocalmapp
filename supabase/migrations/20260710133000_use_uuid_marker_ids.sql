alter table public.markers add column if not exists code text;

update public.markers
set code = id
where is_system
  and code is null;

drop policy if exists "Users can insert their annotations" on public.annotations;
drop policy if exists "Users can update their annotations" on public.annotations;

alter table public.annotations drop constraint if exists annotations_marker_id_fkey;
alter table public.annotations drop constraint if exists annotations_unique_marker_per_target;
drop index if exists public.annotations_unique_user_song_marker_per_target;
drop index if exists public.annotations_unique_legacy_marker_per_target;
drop index if exists public.annotations_marker_idx;

alter table public.markers add column id_uuid uuid;

with system_marker_ids (code, id) as (
  values
    ('up', '34f85819-dcd5-4b7f-9b87-cbee1db85a25'::uuid),
    ('down', '82004da2-f63f-48e7-9b82-63c2a91c301e'::uuid),
    ('vib', '303b12be-046c-4a45-ac77-cf9f60b547b0'::uuid),
    ('hold', '284ca9bc-c5a5-4db3-8cb6-edf24503ec3a'::uuid),
    ('breath', '2072f47a-2598-4ba9-8a1e-67dea4335a43'::uuid),
    ('accent', '2ccfea58-2b63-44c1-a040-40732059f846'::uuid),
    ('soft', 'ce75d279-28ff-4a4f-be74-44c66b3857a5'::uuid),
    ('strong', 'cc9803f3-931b-4529-893b-be366da4acbc'::uuid),
    ('slide-up', '1966ec87-3456-4e0e-afbe-482080a6f1bf'::uuid),
    ('slide-down', '6b282870-226c-4b9e-8f3d-6bb7a1b6ee98'::uuid),
    ('legato', '127094a9-16ad-4f42-b028-78d0a9f3800c'::uuid),
    ('pause', 'de929752-6e49-4e8e-8161-88ff6d3a5ce5'::uuid),
    ('cut', '857c0b2b-2b65-43cf-af5e-0225f1d140b7'::uuid),
    ('run', '4cb865a7-978c-40d3-832e-2def53d5e162'::uuid),
    ('mix', 'a31c20a8-a098-4663-8f86-10a4e0fefc19'::uuid),
    ('head', '419e0b18-7050-47cb-b71d-89bc89c1c295'::uuid),
    ('chest', '4132a919-5641-414f-807a-b2f2c946d828'::uuid),
    ('falsetto', 'fedc613b-7f55-4a6e-b695-a359e7c8e838'::uuid),
    ('twang', '76358f71-404f-46b8-835d-2c15f68ce660'::uuid),
    ('cry', '8e1a09fe-fd69-4d48-b4ba-e3eac08cea01'::uuid),
    ('mute', 'cf2ae020-9b52-44f7-8f9d-fc91ff2e3654'::uuid)
)
update public.markers marker
set id_uuid = system_marker_ids.id
from system_marker_ids
where marker.id_uuid is null
  and marker.is_system
  and coalesce(marker.code, marker.id) = system_marker_ids.code;

update public.markers
set id_uuid = case
  when id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then id::uuid
  else gen_random_uuid()
end
where id_uuid is null;

alter table public.markers alter column id_uuid set not null;

alter table public.annotations add column marker_uuid uuid;

update public.annotations annotation
set marker_uuid = marker.id_uuid
from public.markers marker
where annotation.marker_id = marker.id;

do $$
begin
  if exists (select 1 from public.annotations where marker_uuid is null) then
    raise exception 'Cannot migrate annotations.marker_id because some markers are missing.';
  end if;
end
$$;

alter table public.annotations alter column marker_uuid set not null;

alter table public.markers drop constraint if exists markers_pkey;
alter table public.markers drop column id;
alter table public.markers rename column id_uuid to id;
alter table public.markers alter column id set default gen_random_uuid();
alter table public.markers add constraint markers_pkey primary key (id);

alter table public.annotations drop column marker_id;
alter table public.annotations rename column marker_uuid to marker_id;
alter table public.annotations
  add constraint annotations_marker_id_fkey
  foreign key (marker_id) references public.markers (id) on delete cascade;

drop index if exists public.markers_system_code_unique;
create unique index if not exists markers_system_code_unique
on public.markers (code)
where is_system and code is not null;

alter table public.markers drop constraint if exists markers_system_code_required;
alter table public.markers add constraint markers_system_code_required check (
  (is_system and code is not null and char_length(btrim(code)) > 0)
  or not is_system
);

create index if not exists annotations_marker_idx on public.annotations (marker_id);

create unique index if not exists annotations_unique_user_song_marker_per_target
on public.annotations (user_id, target_type, user_song_id, line_index, word_index, marker_id) nulls not distinct
where user_song_id is not null;

create unique index if not exists annotations_unique_legacy_marker_per_target
on public.annotations (user_id, target_type, line_id, word_id, marker_id) nulls not distinct
where user_song_id is null;

create policy "Users can insert their annotations"
on public.annotations for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.markers marker
    where marker.id = annotations.marker_id
      and (marker.is_system or marker.user_id = (select auth.uid()))
  )
  and (
    (
      user_song_id is not null
      and exists (
        select 1
        from public.user_songs user_song
        where user_song.id = annotations.user_song_id
          and user_song.user_id = (select auth.uid())
      )
      and line_index is not null
      and line_index >= 0
      and (
        (target_type = 'line' and word_index is null)
        or (target_type = 'word' and word_index is not null and word_index >= 0)
      )
    )
    or
    (
      user_song_id is null
      and song_id is not null
      and exists (
        select 1
        from public.songs song
        where song.id = annotations.song_id
          and song.user_id = (select auth.uid())
      )
    )
  )
);

create policy "Users can update their annotations"
on public.annotations for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.markers marker
    where marker.id = annotations.marker_id
      and (marker.is_system or marker.user_id = (select auth.uid()))
  )
  and (
    (
      user_song_id is not null
      and exists (
        select 1
        from public.user_songs user_song
        where user_song.id = annotations.user_song_id
          and user_song.user_id = (select auth.uid())
      )
      and line_index is not null
      and line_index >= 0
      and (
        (target_type = 'line' and word_index is null)
        or (target_type = 'word' and word_index is not null and word_index >= 0)
      )
    )
    or
    (
      user_song_id is null
      and song_id is not null
      and exists (
        select 1
        from public.songs song
        where song.id = annotations.song_id
          and song.user_id = (select auth.uid())
      )
    )
  )
);
