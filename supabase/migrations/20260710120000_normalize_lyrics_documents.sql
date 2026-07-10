create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null default 'manual',
  source_track_id text,
  spotify_track_id text,
  title text not null,
  artist text,
  album_name text,
  album_art_url text,
  spotify_url text,
  duration_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tracks_title_not_empty check (char_length(btrim(title)) > 0),
  constraint tracks_duration_nonnegative check (duration_ms is null or duration_ms >= 0),
  constraint tracks_source_not_empty check (char_length(btrim(source)) > 0)
);

create table if not exists public.lyrics_documents (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  provider text not null default 'manual',
  provider_lyrics_id text,
  lyrics_text text not null,
  lyrics_hash text not null,
  tokenizer_version text not null default 'whitespace-v1',
  line_word_counts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lyrics_documents_provider_not_empty check (char_length(btrim(provider)) > 0),
  constraint lyrics_documents_hash_not_empty check (char_length(btrim(lyrics_hash)) > 0),
  constraint lyrics_documents_tokenizer_not_empty check (char_length(btrim(tokenizer_version)) > 0),
  constraint lyrics_documents_line_word_counts_array check (jsonb_typeof(line_word_counts) = 'array')
);

create table if not exists public.user_songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete restrict,
  lyrics_document_id uuid not null references public.lyrics_documents (id) on delete restrict,
  title text not null,
  artist text,
  album_name text,
  album_art_url text,
  spotify_track_id text,
  spotify_url text,
  duration_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_songs_title_not_empty check (char_length(btrim(title)) > 0),
  constraint user_songs_duration_nonnegative check (duration_ms is null or duration_ms >= 0)
);

create unique index if not exists tracks_source_track_unique
on public.tracks (created_by, source, source_track_id)
where source_track_id is not null;

create unique index if not exists tracks_spotify_track_id_unique
on public.tracks (created_by, spotify_track_id)
where spotify_track_id is not null;

create unique index if not exists lyrics_documents_hash_tokenizer_unique
on public.lyrics_documents (created_by, lyrics_hash, tokenizer_version);

create index if not exists tracks_created_by_idx on public.tracks (created_by);
create index if not exists lyrics_documents_created_by_idx on public.lyrics_documents (created_by);
create index if not exists lyrics_documents_track_id_idx on public.lyrics_documents (track_id);
create index if not exists user_songs_user_updated_idx on public.user_songs (user_id, updated_at desc);
create index if not exists user_songs_track_id_idx on public.user_songs (track_id);
create index if not exists user_songs_lyrics_document_id_idx on public.user_songs (lyrics_document_id);

drop trigger if exists set_tracks_updated_at on public.tracks;
create trigger set_tracks_updated_at
before update on public.tracks
for each row execute function public.set_updated_at();

drop trigger if exists set_lyrics_documents_updated_at on public.lyrics_documents;
create trigger set_lyrics_documents_updated_at
before update on public.lyrics_documents
for each row execute function public.set_updated_at();

drop trigger if exists set_user_songs_updated_at on public.user_songs;
create trigger set_user_songs_updated_at
before update on public.user_songs
for each row execute function public.set_updated_at();

alter table public.tracks enable row level security;
alter table public.lyrics_documents enable row level security;
alter table public.user_songs enable row level security;

revoke all on public.tracks from anon;
revoke all on public.lyrics_documents from anon;
revoke all on public.user_songs from anon;
revoke all on public.tracks from authenticated;
revoke all on public.lyrics_documents from authenticated;
revoke all on public.user_songs from authenticated;

grant select, insert on public.tracks to authenticated;
grant select, insert on public.lyrics_documents to authenticated;
grant select, insert, update, delete on public.user_songs to authenticated;

drop policy if exists "Authenticated users can read tracks" on public.tracks;
drop policy if exists "Authenticated users can insert tracks" on public.tracks;
drop policy if exists "Users can insert their tracks" on public.tracks;
drop policy if exists "Authenticated users can read lyrics documents" on public.lyrics_documents;
drop policy if exists "Authenticated users can insert lyrics documents" on public.lyrics_documents;
drop policy if exists "Users can insert their lyrics documents" on public.lyrics_documents;
drop policy if exists "Users can read their user songs" on public.user_songs;
drop policy if exists "Users can insert their user songs" on public.user_songs;
drop policy if exists "Users can update their user songs" on public.user_songs;
drop policy if exists "Users can delete their user songs" on public.user_songs;

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

create policy "Users can read their user songs"
on public.user_songs for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their user songs"
on public.user_songs for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their user songs"
on public.user_songs for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their user songs"
on public.user_songs for delete to authenticated
using ((select auth.uid()) = user_id);

alter table public.annotations add column if not exists user_song_id uuid references public.user_songs (id) on delete cascade;
alter table public.annotations add column if not exists line_index integer;
alter table public.annotations add column if not exists word_index integer;

alter table public.audio_references add column if not exists user_song_id uuid references public.user_songs (id) on delete cascade;
alter table public.audio_references add column if not exists line_index integer;
alter table public.audio_references add column if not exists word_index integer;

alter table public.target_notes add column if not exists user_song_id uuid references public.user_songs (id) on delete cascade;
alter table public.target_notes add column if not exists line_index integer;
alter table public.target_notes add column if not exists word_index integer;

alter table public.annotations alter column song_id drop not null;
alter table public.audio_references alter column song_id drop not null;
alter table public.target_notes alter column song_id drop not null;

create index if not exists annotations_user_song_idx on public.annotations (user_song_id);
create index if not exists annotations_user_song_position_idx on public.annotations (user_song_id, target_type, line_index, word_index);
create index if not exists audio_references_user_song_idx on public.audio_references (user_song_id);
create index if not exists audio_references_user_song_position_idx on public.audio_references (user_song_id, target_type, line_index, word_index);
create index if not exists target_notes_user_song_idx on public.target_notes (user_song_id);
create index if not exists target_notes_user_song_position_idx on public.target_notes (user_song_id, target_type, line_index, word_index);

alter table public.markers add column if not exists code text;

update public.markers
set code = id
where is_system
  and code is null;

create unique index if not exists markers_system_code_unique
on public.markers (code)
where is_system and code is not null;

do $$
declare
  song_record record;
  track_uuid uuid;
  lyrics_uuid uuid;
  word_counts jsonb;
  lyrics_hash_value text;
  track_source text;
  track_source_id text;
begin
  for song_record in
    select *
    from public.songs
  loop
    track_source := case when song_record.spotify_track_id is not null then 'spotify' else 'legacy' end;
    track_source_id := song_record.spotify_track_id;
    track_uuid := null;

    if track_source_id is not null then
      insert into public.tracks (
        created_by,
        source,
        source_track_id,
        spotify_track_id,
        title,
        artist,
        album_name,
        album_art_url,
        spotify_url,
        duration_ms,
        created_at,
        updated_at
      )
      values (
        song_record.user_id,
        track_source,
        track_source_id,
        song_record.spotify_track_id,
        song_record.title,
        song_record.artist,
        song_record.album_name,
        song_record.album_art_url,
        song_record.spotify_url,
        song_record.duration_ms,
        song_record.created_at,
        song_record.updated_at
      )
      on conflict do nothing
      returning id into track_uuid;

      if track_uuid is null then
        select id
        into track_uuid
        from public.tracks
        where created_by = song_record.user_id
          and (
            (source = track_source and source_track_id = track_source_id)
            or spotify_track_id = song_record.spotify_track_id
          )
        limit 1;
      end if;
    end if;

    if track_uuid is null then
      insert into public.tracks (
        created_by,
        source,
        source_track_id,
        spotify_track_id,
        title,
        artist,
        album_name,
        album_art_url,
        spotify_url,
        duration_ms,
        created_at,
        updated_at
      )
      values (
        song_record.user_id,
        track_source,
        track_source_id,
        song_record.spotify_track_id,
        song_record.title,
        song_record.artist,
        song_record.album_name,
        song_record.album_art_url,
        song_record.spotify_url,
        song_record.duration_ms,
        song_record.created_at,
        song_record.updated_at
      )
      returning id into track_uuid;
    end if;

    select coalesce(jsonb_agg(line_counts.word_count order by line_counts.position), '[]'::jsonb)
    into word_counts
    from (
      select l."position", count(w.id)::integer as word_count
      from public.lyric_lines l
      left join public.lyric_words w on w.line_id = l.id
      where l.song_id = song_record.id
      group by l.id, l."position"
    ) line_counts;

    lyrics_hash_value := encode(extensions.digest(song_record.source_lyrics_text, 'sha256'), 'hex');

    insert into public.lyrics_documents (
      created_by,
      track_id,
      provider,
      lyrics_text,
      lyrics_hash,
      tokenizer_version,
      line_word_counts,
      created_at,
      updated_at
    )
    values (
      song_record.user_id,
      track_uuid,
      'legacy',
      song_record.source_lyrics_text,
      lyrics_hash_value,
      'whitespace-v1',
      word_counts,
      song_record.created_at,
      song_record.updated_at
    )
    on conflict (created_by, lyrics_hash, tokenizer_version) do update
    set line_word_counts = excluded.line_word_counts
    returning id into lyrics_uuid;

    insert into public.user_songs (
      id,
      user_id,
      track_id,
      lyrics_document_id,
      title,
      artist,
      album_name,
      album_art_url,
      spotify_track_id,
      spotify_url,
      duration_ms,
      created_at,
      updated_at
    )
    values (
      song_record.id,
      song_record.user_id,
      track_uuid,
      lyrics_uuid,
      song_record.title,
      song_record.artist,
      song_record.album_name,
      song_record.album_art_url,
      song_record.spotify_track_id,
      song_record.spotify_url,
      song_record.duration_ms,
      song_record.created_at,
      song_record.updated_at
    )
    on conflict (id) do update
    set track_id = excluded.track_id,
        lyrics_document_id = excluded.lyrics_document_id,
        title = excluded.title,
        artist = excluded.artist,
        album_name = excluded.album_name,
        album_art_url = excluded.album_art_url,
        spotify_track_id = excluded.spotify_track_id,
        spotify_url = excluded.spotify_url,
        duration_ms = excluded.duration_ms,
        updated_at = excluded.updated_at;
  end loop;
end $$;

update public.annotations a
set user_song_id = a.song_id,
    line_index = l."position",
    word_index = null
from public.lyric_lines l
where a.user_song_id is null
  and a.target_type = 'line'
  and a.line_id = l.id;

update public.annotations a
set user_song_id = a.song_id,
    line_index = l."position",
    word_index = w."position"
from public.lyric_words w
join public.lyric_lines l on l.id = w.line_id
where a.user_song_id is null
  and a.target_type = 'word'
  and a.word_id = w.id;

update public.audio_references a
set user_song_id = a.song_id
where a.user_song_id is null
  and a.target_type = 'song';

update public.audio_references a
set user_song_id = a.song_id,
    line_index = l."position",
    word_index = null
from public.lyric_lines l
where a.user_song_id is null
  and a.target_type = 'line'
  and a.line_id = l.id;

update public.audio_references a
set user_song_id = a.song_id,
    line_index = l."position",
    word_index = w."position"
from public.lyric_words w
join public.lyric_lines l on l.id = w.line_id
where a.user_song_id is null
  and a.target_type = 'word'
  and a.word_id = w.id;

update public.target_notes n
set user_song_id = n.song_id,
    line_index = l."position",
    word_index = null
from public.lyric_lines l
where n.user_song_id is null
  and n.target_type = 'line'
  and n.line_id = l.id;

update public.target_notes n
set user_song_id = n.song_id,
    line_index = l."position",
    word_index = w."position"
from public.lyric_words w
join public.lyric_lines l on l.id = w.line_id
where n.user_song_id is null
  and n.target_type = 'word'
  and n.word_id = w.id;

alter table public.annotations drop constraint if exists annotations_target_shape;
alter table public.annotations drop constraint if exists annotations_unique_marker_per_target;

alter table public.annotations add constraint annotations_target_shape check (
  (
    user_song_id is not null
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
    and (
      (target_type = 'line' and line_id is not null and word_id is null)
      or (target_type = 'word' and line_id is not null and word_id is not null)
    )
  )
);

create unique index if not exists annotations_unique_user_song_marker_per_target
on public.annotations (user_id, target_type, user_song_id, line_index, word_index, marker_id) nulls not distinct
where user_song_id is not null;

create unique index if not exists annotations_unique_legacy_marker_per_target
on public.annotations (user_id, target_type, line_id, word_id, marker_id) nulls not distinct
where user_song_id is null;

alter table public.audio_references drop constraint if exists audio_target_shape;
drop index if exists public.audio_unique_line_target;
drop index if exists public.audio_unique_word_target;

alter table public.audio_references add constraint audio_target_shape check (
  (
    user_song_id is not null
    and (
      (target_type = 'song' and line_index is null and word_index is null)
      or (target_type = 'line' and line_index is not null and line_index >= 0 and word_index is null)
      or (target_type = 'word' and line_index is not null and line_index >= 0 and word_index is not null and word_index >= 0)
    )
  )
  or
  (
    user_song_id is null
    and (
      (target_type = 'song' and line_id is null and word_id is null)
      or (target_type = 'line' and line_id is not null and word_id is null)
      or (target_type = 'word' and line_id is not null and word_id is not null)
    )
  )
);

create unique index if not exists audio_unique_legacy_line_target
on public.audio_references (user_id, target_type, song_id, line_id)
where user_song_id is null and target_type = 'line';

create unique index if not exists audio_unique_legacy_word_target
on public.audio_references (user_id, target_type, song_id, line_id, word_id)
where user_song_id is null and target_type = 'word';

create unique index if not exists audio_unique_user_song_line_target
on public.audio_references (user_id, target_type, user_song_id, line_index)
where user_song_id is not null and target_type = 'line';

create unique index if not exists audio_unique_user_song_word_target
on public.audio_references (user_id, target_type, user_song_id, line_index, word_index)
where user_song_id is not null and target_type = 'word';

alter table public.target_notes drop constraint if exists target_notes_target_shape;
alter table public.target_notes drop constraint if exists target_notes_unique_target;

alter table public.target_notes add constraint target_notes_target_shape check (
  (
    user_song_id is not null
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
    and (
      (target_type = 'line' and line_id is not null and word_id is null)
      or (target_type = 'word' and line_id is not null and word_id is not null)
    )
  )
);

create unique index if not exists target_notes_unique_user_song_target
on public.target_notes (user_id, target_type, user_song_id, line_index, word_index) nulls not distinct
where user_song_id is not null;

create unique index if not exists target_notes_unique_legacy_target
on public.target_notes (user_id, target_type, song_id, line_id, word_id) nulls not distinct
where user_song_id is null;

drop policy if exists "Users can insert their annotations" on public.annotations;
drop policy if exists "Users can update their annotations" on public.annotations;

create policy "Users can insert their annotations"
on public.annotations for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.markers m
    where m.id = annotations.marker_id
      and (m.is_system or m.user_id = (select auth.uid()))
  )
  and (
    (
      user_song_id is not null
      and exists (
        select 1
        from public.user_songs us
        where us.id = annotations.user_song_id
          and us.user_id = (select auth.uid())
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
        from public.songs s
        where s.id = annotations.song_id
          and s.user_id = (select auth.uid())
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
    from public.markers m
    where m.id = annotations.marker_id
      and (m.is_system or m.user_id = (select auth.uid()))
  )
  and (
    (
      user_song_id is not null
      and exists (
        select 1
        from public.user_songs us
        where us.id = annotations.user_song_id
          and us.user_id = (select auth.uid())
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
        from public.songs s
        where s.id = annotations.song_id
          and s.user_id = (select auth.uid())
      )
    )
  )
);

drop policy if exists "Users can insert their audio references" on public.audio_references;
drop policy if exists "Users can update their audio references" on public.audio_references;

create policy "Users can insert their audio references"
on public.audio_references for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and storage_path like ((select auth.uid())::text || '/%')
  and (
    (
      user_song_id is not null
      and exists (
        select 1
        from public.user_songs us
        where us.id = audio_references.user_song_id
          and us.user_id = (select auth.uid())
      )
      and (
        target_type = 'song'
        or (target_type = 'line' and line_index is not null and line_index >= 0 and word_index is null)
        or (target_type = 'word' and line_index is not null and line_index >= 0 and word_index is not null and word_index >= 0)
      )
    )
    or
    (
      user_song_id is null
      and song_id is not null
      and exists (
        select 1
        from public.songs s
        where s.id = audio_references.song_id
          and s.user_id = (select auth.uid())
      )
    )
  )
);

create policy "Users can update their audio references"
on public.audio_references for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and storage_path like ((select auth.uid())::text || '/%')
  and (
    (
      user_song_id is not null
      and exists (
        select 1
        from public.user_songs us
        where us.id = audio_references.user_song_id
          and us.user_id = (select auth.uid())
      )
      and (
        target_type = 'song'
        or (target_type = 'line' and line_index is not null and line_index >= 0 and word_index is null)
        or (target_type = 'word' and line_index is not null and line_index >= 0 and word_index is not null and word_index >= 0)
      )
    )
    or
    (
      user_song_id is null
      and song_id is not null
      and exists (
        select 1
        from public.songs s
        where s.id = audio_references.song_id
          and s.user_id = (select auth.uid())
      )
    )
  )
);

drop policy if exists "Users can insert their target notes" on public.target_notes;
drop policy if exists "Users can update their target notes" on public.target_notes;

create policy "Users can insert their target notes"
on public.target_notes for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (
    (
      user_song_id is not null
      and exists (
        select 1
        from public.user_songs us
        where us.id = target_notes.user_song_id
          and us.user_id = (select auth.uid())
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
        from public.songs s
        where s.id = target_notes.song_id
          and s.user_id = (select auth.uid())
      )
    )
  )
);

create policy "Users can update their target notes"
on public.target_notes for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (
    (
      user_song_id is not null
      and exists (
        select 1
        from public.user_songs us
        where us.id = target_notes.user_song_id
          and us.user_id = (select auth.uid())
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
        from public.songs s
        where s.id = target_notes.song_id
          and s.user_id = (select auth.uid())
      )
    )
  )
);
