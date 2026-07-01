create extension if not exists pgcrypto with schema extensions;

do $$
begin
  create type public.audio_target_type as enum ('song', 'line', 'word');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.annotation_target_type as enum ('line', 'word');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  artist text,
  album_name text,
  album_art_url text,
  spotify_track_id text,
  spotify_url text,
  duration_ms integer,
  source_lyrics_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint songs_title_not_empty check (char_length(btrim(title)) > 0),
  constraint songs_duration_nonnegative check (duration_ms is null or duration_ms >= 0)
);

create table if not exists public.lyric_lines (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  "position" integer not null,
  text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lyric_lines_song_position_unique unique (song_id, "position"),
  constraint lyric_lines_position_nonnegative check ("position" >= 0)
);

create table if not exists public.lyric_words (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.lyric_lines (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  "position" integer not null,
  text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lyric_words_line_position_unique unique (line_id, "position"),
  constraint lyric_words_position_nonnegative check ("position" >= 0),
  constraint lyric_words_text_not_empty check (char_length(btrim(text)) > 0)
);

create table if not exists public.markers (
  id text primary key,
  user_id uuid references auth.users (id) on delete cascade,
  label text not null,
  meaning text not null,
  color text not null,
  icon text not null,
  is_system boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint markers_owner_rule check ((is_system and user_id is null) or ((not is_system) and user_id is not null)),
  constraint markers_label_not_empty check (char_length(btrim(label)) > 0),
  constraint markers_meaning_not_empty check (char_length(btrim(meaning)) > 0),
  constraint markers_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint markers_icon_allowed check (
    icon = any (array[
      'up', 'down', 'wave', 'line', 'breath', 'accent', 'soft', 'strong',
      'pause', 'cut', 'repeat', 'spark', 'volume', 'mute'
    ])
  )
);

create table if not exists public.annotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  line_id uuid references public.lyric_lines (id) on delete cascade,
  word_id uuid references public.lyric_words (id) on delete cascade,
  target_type public.annotation_target_type not null,
  marker_id text not null references public.markers (id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint annotations_target_shape check (
    (target_type = 'line' and line_id is not null and word_id is null)
    or (target_type = 'word' and line_id is not null and word_id is not null)
  ),
  constraint annotations_unique_marker_per_target unique nulls not distinct (user_id, target_type, line_id, word_id, marker_id)
);

create table if not exists public.audio_references (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  line_id uuid references public.lyric_lines (id) on delete cascade,
  word_id uuid references public.lyric_words (id) on delete cascade,
  target_type public.audio_target_type not null,
  storage_path text not null,
  mime_type text not null,
  duration_ms integer,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint audio_target_shape check (
    (target_type = 'song' and line_id is null and word_id is null)
    or (target_type = 'line' and line_id is not null and word_id is null)
    or (target_type = 'word' and line_id is not null and word_id is not null)
  ),
  constraint audio_unique_target unique nulls not distinct (user_id, target_type, song_id, line_id, word_id),
  constraint audio_duration_nonnegative check (duration_ms is null or duration_ms >= 0),
  constraint audio_size_positive check (size_bytes is null or size_bytes > 0)
);

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists songs_user_updated_idx on public.songs (user_id, updated_at desc);
create index if not exists songs_user_title_idx on public.songs (user_id, lower(title));
create index if not exists lyric_lines_user_idx on public.lyric_lines (user_id);
create index if not exists lyric_lines_song_position_idx on public.lyric_lines (song_id, "position");
create index if not exists lyric_words_user_idx on public.lyric_words (user_id);
create index if not exists lyric_words_song_idx on public.lyric_words (song_id);
create index if not exists lyric_words_line_position_idx on public.lyric_words (line_id, "position");
create index if not exists markers_user_idx on public.markers (user_id);
create index if not exists annotations_user_song_idx on public.annotations (user_id, song_id);
create index if not exists annotations_line_idx on public.annotations (line_id);
create index if not exists annotations_word_idx on public.annotations (word_id);
create index if not exists annotations_marker_idx on public.annotations (marker_id);
create index if not exists audio_references_user_song_idx on public.audio_references (user_id, song_id);
create index if not exists audio_references_line_idx on public.audio_references (line_id);
create index if not exists audio_references_word_idx on public.audio_references (word_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_songs_updated_at on public.songs;
create trigger set_songs_updated_at
before update on public.songs
for each row execute function public.set_updated_at();

drop trigger if exists set_lyric_lines_updated_at on public.lyric_lines;
create trigger set_lyric_lines_updated_at
before update on public.lyric_lines
for each row execute function public.set_updated_at();

drop trigger if exists set_lyric_words_updated_at on public.lyric_words;
create trigger set_lyric_words_updated_at
before update on public.lyric_words
for each row execute function public.set_updated_at();

drop trigger if exists set_markers_updated_at on public.markers;
create trigger set_markers_updated_at
before update on public.markers
for each row execute function public.set_updated_at();

drop trigger if exists set_annotations_updated_at on public.annotations;
create trigger set_annotations_updated_at
before update on public.annotations
for each row execute function public.set_updated_at();

drop trigger if exists set_audio_references_updated_at on public.audio_references;
create trigger set_audio_references_updated_at
before update on public.audio_references
for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.songs enable row level security;
alter table public.lyric_lines enable row level security;
alter table public.lyric_words enable row level security;
alter table public.markers enable row level security;
alter table public.annotations enable row level security;
alter table public.audio_references enable row level security;

create policy "Users can read their profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "Users can insert their profile"
on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);

create policy "Users can update their profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Users can read their songs"
on public.songs for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their songs"
on public.songs for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their songs"
on public.songs for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their songs"
on public.songs for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their lyric lines"
on public.lyric_lines for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their lyric lines"
on public.lyric_lines for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their lyric lines"
on public.lyric_lines for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their lyric lines"
on public.lyric_lines for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their lyric words"
on public.lyric_words for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their lyric words"
on public.lyric_words for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their lyric words"
on public.lyric_words for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their lyric words"
on public.lyric_words for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read system and own markers"
on public.markers for select to authenticated
using (is_system or (select auth.uid()) = user_id);

create policy "Users can insert own markers"
on public.markers for insert to authenticated
with check ((select auth.uid()) = user_id and not is_system);

create policy "Users can update own markers"
on public.markers for update to authenticated
using ((select auth.uid()) = user_id and not is_system)
with check ((select auth.uid()) = user_id and not is_system);

create policy "Users can delete own markers"
on public.markers for delete to authenticated
using ((select auth.uid()) = user_id and not is_system);

create policy "Users can read their annotations"
on public.annotations for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their annotations"
on public.annotations for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their annotations"
on public.annotations for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their annotations"
on public.annotations for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their audio references"
on public.audio_references for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their audio references"
on public.audio_references for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their audio references"
on public.audio_references for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their audio references"
on public.audio_references for delete to authenticated
using ((select auth.uid()) = user_id);

insert into public.markers (id, label, meaning, color, icon, is_system, sort_order)
values
  ('up', 'Up', 'Pitch rises', '#1aae39', 'up', true, 10),
  ('down', 'Down', 'Pitch falls', '#0075de', 'down', true, 20),
  ('vib', 'Vib', 'Vibrato', '#8f4fd7', 'wave', true, 30),
  ('hold', 'Hold', 'Sustain the sound', '#c69214', 'line', true, 40),
  ('breath', 'Breath', 'Take a breath', '#2a9d99', 'breath', true, 50),
  ('accent', 'Accent', 'Emphasize this sound', '#dc2f2f', 'accent', true, 60),
  ('soft', 'Soft', 'Sing gently', '#ff64c8', 'soft', true, 70),
  ('strong', 'Strong', 'Add strength', '#dd5b00', 'strong', true, 80),
  ('slide-up', 'Slide up', 'Slide upward', '#178a2f', 'up', true, 90),
  ('slide-down', 'Slide down', 'Slide downward', '#1d6fbd', 'down', true, 100),
  ('legato', 'Legato', 'Connect smoothly without a break', '#6b58c8', 'wave', true, 110),
  ('pause', 'Pause', 'Pause or slow down', '#615d59', 'pause', true, 120),
  ('cut', 'Cut', 'Release the sound quickly', '#9b2f2f', 'cut', true, 130),
  ('run', 'Run', 'Melisma or vocal run', '#007a7a', 'repeat', true, 140),
  ('mix', 'Mix', 'Mixed voice', '#7a48aa', 'spark', true, 150),
  ('head', 'Head', 'Head voice', '#4a85d8', 'volume', true, 160),
  ('chest', 'Chest', 'Chest voice', '#8a4b24', 'strong', true, 170),
  ('falsetto', 'Falsetto', 'Falsetto', '#c45aa0', 'soft', true, 180),
  ('twang', 'Twang', 'Bright twang tone', '#b76a00', 'spark', true, 190),
  ('cry', 'Cry', 'Crying tone', '#5b70c8', 'wave', true, 200),
  ('mute', 'Mute', 'Sing quieter or remove extra sound', '#6d6a65', 'mute', true, 210)
on conflict (id) do update
set label = excluded.label,
    meaning = excluded.meaning,
    color = excluded.color,
    icon = excluded.icon,
    is_system = excluded.is_system,
    sort_order = excluded.sort_order,
    updated_at = now();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vocalmap-audio',
  'vocalmap-audio',
  false,
  52428800,
  array[
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Users can read own vocal audio objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'vocalmap-audio'
  and owner_id = (select auth.uid())::text
);

create policy "Users can upload own vocal audio objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'vocalmap-audio'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can update own vocal audio objects"
on storage.objects for update to authenticated
using (
  bucket_id = 'vocalmap-audio'
  and owner_id = (select auth.uid())::text
)
with check (
  bucket_id = 'vocalmap-audio'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can delete own vocal audio objects"
on storage.objects for delete to authenticated
using (
  bucket_id = 'vocalmap-audio'
  and owner_id = (select auth.uid())::text
);

revoke all on public.profiles from anon;
revoke all on public.songs from anon;
revoke all on public.lyric_lines from anon;
revoke all on public.lyric_words from anon;
revoke all on public.markers from anon;
revoke all on public.annotations from anon;
revoke all on public.audio_references from anon;

grant all on public.profiles to authenticated;
grant all on public.songs to authenticated;
grant all on public.lyric_lines to authenticated;
grant all on public.lyric_words to authenticated;
grant all on public.markers to authenticated;
grant all on public.annotations to authenticated;
grant all on public.audio_references to authenticated;
