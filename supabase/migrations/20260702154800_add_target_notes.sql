do $$
begin
  create type public.note_target_type as enum ('line', 'word');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.target_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  line_id uuid references public.lyric_lines (id) on delete cascade,
  word_id uuid references public.lyric_words (id) on delete cascade,
  target_type public.note_target_type not null,
  text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint target_notes_text_not_empty check (char_length(btrim(text)) > 0),
  constraint target_notes_target_shape check (
    (target_type = 'line' and line_id is not null and word_id is null)
    or (target_type = 'word' and line_id is not null and word_id is not null)
  ),
  constraint target_notes_unique_target unique nulls not distinct (user_id, target_type, song_id, line_id, word_id)
);

create index if not exists target_notes_user_song_idx on public.target_notes (user_id, song_id);
create index if not exists target_notes_line_idx on public.target_notes (line_id);
create index if not exists target_notes_word_idx on public.target_notes (word_id);

drop trigger if exists set_target_notes_updated_at on public.target_notes;
create trigger set_target_notes_updated_at
before update on public.target_notes
for each row execute function public.set_updated_at();

alter table public.target_notes enable row level security;

revoke all on public.target_notes from anon;
revoke all on public.target_notes from authenticated;
grant select, insert, update, delete on public.target_notes to authenticated;

drop policy if exists "Users can read their target notes" on public.target_notes;
drop policy if exists "Users can insert their target notes" on public.target_notes;
drop policy if exists "Users can update their target notes" on public.target_notes;
drop policy if exists "Users can delete their target notes" on public.target_notes;

create policy "Users can read their target notes"
on public.target_notes for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their target notes"
on public.target_notes for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.songs s
    where s.id = target_notes.song_id
      and s.user_id = (select auth.uid())
  )
  and (
    (
      target_type = 'line'
      and line_id is not null
      and word_id is null
      and exists (
        select 1
        from public.lyric_lines l
        where l.id = target_notes.line_id
          and l.song_id = target_notes.song_id
          and l.user_id = (select auth.uid())
      )
    )
    or
    (
      target_type = 'word'
      and line_id is not null
      and word_id is not null
      and exists (
        select 1
        from public.lyric_words w
        where w.id = target_notes.word_id
          and w.line_id = target_notes.line_id
          and w.song_id = target_notes.song_id
          and w.user_id = (select auth.uid())
      )
    )
  )
);

create policy "Users can update their target notes"
on public.target_notes for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.songs s
    where s.id = target_notes.song_id
      and s.user_id = (select auth.uid())
  )
  and (
    (
      target_type = 'line'
      and line_id is not null
      and word_id is null
      and exists (
        select 1
        from public.lyric_lines l
        where l.id = target_notes.line_id
          and l.song_id = target_notes.song_id
          and l.user_id = (select auth.uid())
      )
    )
    or
    (
      target_type = 'word'
      and line_id is not null
      and word_id is not null
      and exists (
        select 1
        from public.lyric_words w
        where w.id = target_notes.word_id
          and w.line_id = target_notes.line_id
          and w.song_id = target_notes.song_id
          and w.user_id = (select auth.uid())
      )
    )
  )
);

create policy "Users can delete their target notes"
on public.target_notes for delete to authenticated
using ((select auth.uid()) = user_id);

alter table public.markers drop constraint if exists markers_icon_allowed;
alter table public.markers add constraint markers_icon_allowed check (
  icon = any (array[
    'up', 'down', 'wave', 'line', 'breath', 'accent', 'soft', 'strong',
    'pause', 'cut', 'repeat', 'spark', 'volume', 'mute', 'waveform', 'waves',
    'mic', 'music', 'ear', 'headphones', 'timer', 'activity', 'gauge', 'zap',
    'smile', 'frown', 'up-right', 'down-right', 'chevrons-up', 'chevrons-down',
    'mic-vocal', 'podcast', 'radio', 'volume-low', 'volume-off', 'audio-lines',
    'chart-up', 'chart-down', 'signal-high', 'signal-low', 'move-vertical',
    'arrow-up-down', 'arrow-left-right', 'refresh', 'rotate', 'undo', 'redo',
    'corner-up-right', 'corner-down-right', 'spline', 'blend', 'layers',
    'brackets', 'braces', 'hash', 'equal', 'tally-1', 'tally-2', 'tally-3'
  ])
);
