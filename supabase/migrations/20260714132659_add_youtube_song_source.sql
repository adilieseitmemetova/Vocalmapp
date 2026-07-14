alter table public.tracks
  add column if not exists youtube_video_id text,
  add column if not exists video_title text,
  add column if not exists channel_title text,
  add column if not exists thumbnail_url text,
  add column if not exists original_search_query text,
  add column if not exists selected_version_type text;

alter table public.user_songs
  add column if not exists source text not null default 'legacy',
  add column if not exists youtube_video_id text,
  add column if not exists video_title text,
  add column if not exists channel_title text,
  add column if not exists thumbnail_url text,
  add column if not exists original_search_query text,
  add column if not exists selected_version_type text;

create table if not exists public.lyric_timestamps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  user_song_id uuid not null references public.user_songs (id) on delete cascade,
  line_index integer not null,
  word_index integer not null,
  timestamp_ms integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lyric_timestamps_position_nonnegative check (line_index >= 0 and word_index >= 0),
  constraint lyric_timestamps_time_nonnegative check (timestamp_ms >= 0),
  constraint lyric_timestamps_target_unique unique nulls not distinct (user_id, user_song_id, line_index, word_index)
);

create index if not exists lyric_timestamps_user_song_position_idx
on public.lyric_timestamps (user_id, user_song_id, line_index, word_index);

alter table public.lyric_timestamps enable row level security;
revoke all on public.lyric_timestamps from anon;
revoke all on public.lyric_timestamps from authenticated;
grant select, insert, update, delete on public.lyric_timestamps to authenticated;

create policy "Users can read their lyric timestamps"
on public.lyric_timestamps for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their lyric timestamps"
on public.lyric_timestamps for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.user_songs
    where user_songs.id = lyric_timestamps.user_song_id
      and user_songs.user_id = (select auth.uid())
  )
);

create policy "Users can update their lyric timestamps"
on public.lyric_timestamps for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.user_songs
    where user_songs.id = lyric_timestamps.user_song_id
      and user_songs.user_id = (select auth.uid())
  )
);

create policy "Users can delete their lyric timestamps"
on public.lyric_timestamps for delete to authenticated
using ((select auth.uid()) = user_id);

drop trigger if exists set_lyric_timestamps_updated_at on public.lyric_timestamps;
create trigger set_lyric_timestamps_updated_at
before update on public.lyric_timestamps
for each row execute function public.set_updated_at();

alter table public.tracks
  add constraint tracks_youtube_video_id_format
  check (youtube_video_id is null or youtube_video_id ~ '^[A-Za-z0-9_-]{11}$') not valid,
  add constraint tracks_selected_version_type_valid
  check (selected_version_type is null or selected_version_type in ('official-video', 'official-audio', 'lyric-video', 'live', 'acoustic', 'karaoke', 'cover', 'other')) not valid;

alter table public.user_songs
  add constraint user_songs_youtube_video_id_format
  check (youtube_video_id is null or youtube_video_id ~ '^[A-Za-z0-9_-]{11}$') not valid,
  add constraint user_songs_source_valid
  check (source in ('youtube', 'manual', 'legacy', 'spotify')) not valid,
  add constraint user_songs_selected_version_type_valid
  check (selected_version_type is null or selected_version_type in ('official-video', 'official-audio', 'lyric-video', 'live', 'acoustic', 'karaoke', 'cover', 'other')) not valid;

create unique index if not exists tracks_youtube_video_id_unique
on public.tracks (created_by, youtube_video_id)
where youtube_video_id is not null;

create index if not exists user_songs_youtube_video_id_idx
on public.user_songs (user_id, youtube_video_id)
where youtube_video_id is not null;

update public.user_songs
set source = 'legacy'
where source is null;

update public.user_songs
set source = 'spotify'
where youtube_video_id is null
  and exists (
    select 1 from public.tracks
    where tracks.id = user_songs.track_id
      and tracks.source = 'spotify'
  );

alter table public.tracks validate constraint tracks_youtube_video_id_format;
alter table public.tracks validate constraint tracks_selected_version_type_valid;
alter table public.user_songs validate constraint user_songs_youtube_video_id_format;
alter table public.user_songs validate constraint user_songs_source_valid;
alter table public.user_songs validate constraint user_songs_selected_version_type_valid;
