alter table public.tracks add column if not exists created_by uuid;
alter table public.lyrics_documents add column if not exists created_by uuid;

with track_owners as (
  select distinct on (user_songs.track_id)
    user_songs.track_id,
    user_songs.user_id
  from public.user_songs
  order by user_songs.track_id, user_songs.created_at, user_songs.id
)
update public.tracks
set created_by = track_owners.user_id
from track_owners
where tracks.id = track_owners.track_id
  and tracks.created_by is null;

with document_owners as (
  select distinct on (user_songs.lyrics_document_id)
    user_songs.lyrics_document_id,
    user_songs.user_id
  from public.user_songs
  order by user_songs.lyrics_document_id, user_songs.created_at, user_songs.id
)
update public.lyrics_documents
set created_by = document_owners.user_id
from document_owners
where lyrics_documents.id = document_owners.lyrics_document_id
  and lyrics_documents.created_by is null;

delete from public.lyrics_documents
where created_by is null;

delete from public.tracks
where created_by is null
  and not exists (
    select 1
    from public.lyrics_documents
    where lyrics_documents.track_id = tracks.id
  );

drop index if exists public.tracks_source_track_unique;
drop index if exists public.tracks_spotify_track_id_unique;
drop index if exists public.lyrics_documents_hash_tokenizer_unique;

alter table public.tracks
  alter column created_by set default auth.uid(),
  alter column created_by set not null;

alter table public.lyrics_documents
  alter column created_by set default auth.uid(),
  alter column created_by set not null;

alter table public.tracks drop constraint if exists tracks_created_by_fkey;
alter table public.tracks
  add constraint tracks_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete cascade;

alter table public.lyrics_documents drop constraint if exists lyrics_documents_created_by_fkey;
alter table public.lyrics_documents
  add constraint lyrics_documents_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete cascade;

create index if not exists tracks_created_by_idx on public.tracks (created_by);
create index if not exists lyrics_documents_created_by_idx on public.lyrics_documents (created_by);

create unique index tracks_source_track_unique
on public.tracks (created_by, source, source_track_id)
where source_track_id is not null;

create unique index tracks_spotify_track_id_unique
on public.tracks (created_by, spotify_track_id)
where spotify_track_id is not null;

create unique index lyrics_documents_hash_tokenizer_unique
on public.lyrics_documents (created_by, lyrics_hash, tokenizer_version);

revoke all on public.tracks from anon;
revoke all on public.lyrics_documents from anon;
revoke all on public.tracks from authenticated;
revoke all on public.lyrics_documents from authenticated;

grant select, insert on public.tracks to authenticated;
grant select, insert on public.lyrics_documents to authenticated;

drop policy if exists "Authenticated users can read tracks" on public.tracks;
drop policy if exists "Authenticated users can insert tracks" on public.tracks;
drop policy if exists "Users can insert their tracks" on public.tracks;
drop policy if exists "Authenticated users can read lyrics documents" on public.lyrics_documents;
drop policy if exists "Authenticated users can insert lyrics documents" on public.lyrics_documents;
drop policy if exists "Users can insert their lyrics documents" on public.lyrics_documents;

create policy "Authenticated users can read tracks"
on public.tracks for select to authenticated
using (
  created_by = (select auth.uid())
  or exists (
    select 1
    from public.user_songs
    where user_songs.track_id = tracks.id
      and user_songs.user_id = (select auth.uid())
  )
);

create policy "Users can insert their tracks"
on public.tracks for insert to authenticated
with check (created_by = (select auth.uid()));

create policy "Authenticated users can read lyrics documents"
on public.lyrics_documents for select to authenticated
using (
  created_by = (select auth.uid())
  or exists (
    select 1
    from public.user_songs
    where user_songs.lyrics_document_id = lyrics_documents.id
      and user_songs.user_id = (select auth.uid())
  )
);

create policy "Users can insert their lyrics documents"
on public.lyrics_documents for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1
    from public.tracks
    where tracks.id = lyrics_documents.track_id
      and (
        tracks.created_by = (select auth.uid())
        or exists (
          select 1
          from public.user_songs
          where user_songs.track_id = tracks.id
            and user_songs.user_id = (select auth.uid())
        )
      )
  )
);
