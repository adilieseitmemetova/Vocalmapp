drop policy if exists "Users can insert their annotations" on public.annotations;
drop policy if exists "Users can update their annotations" on public.annotations;
drop policy if exists "Users can insert their audio references" on public.audio_references;
drop policy if exists "Users can update their audio references" on public.audio_references;
drop policy if exists "Users can insert their target notes" on public.target_notes;
drop policy if exists "Users can update their target notes" on public.target_notes;

drop index if exists public.annotations_line_idx;
drop index if exists public.annotations_song_id_idx;
drop index if exists public.annotations_unique_legacy_marker_per_target;
drop index if exists public.annotations_unique_user_song_marker_per_target;
drop index if exists public.annotations_user_song_idx;
drop index if exists public.annotations_word_idx;
drop index if exists public.audio_references_line_idx;
drop index if exists public.audio_references_song_id_idx;
drop index if exists public.audio_references_user_song_idx;
drop index if exists public.audio_references_word_idx;
drop index if exists public.audio_unique_legacy_line_target;
drop index if exists public.audio_unique_legacy_word_target;
drop index if exists public.audio_unique_user_song_line_target;
drop index if exists public.audio_unique_user_song_word_target;
drop index if exists public.target_notes_line_idx;
drop index if exists public.target_notes_unique_legacy_target;
drop index if exists public.target_notes_unique_user_song_target;
drop index if exists public.target_notes_user_song_idx;
drop index if exists public.target_notes_word_idx;

alter table public.annotations drop constraint if exists annotations_target_shape;
alter table public.audio_references drop constraint if exists audio_target_shape;
alter table public.target_notes drop constraint if exists target_notes_target_shape;

alter table public.annotations
  drop column if exists song_id,
  drop column if exists line_id,
  drop column if exists word_id;

alter table public.audio_references
  drop column if exists song_id,
  drop column if exists line_id,
  drop column if exists word_id;

alter table public.target_notes
  drop column if exists song_id,
  drop column if exists line_id,
  drop column if exists word_id;

alter table public.annotations
  alter column user_song_id set not null,
  alter column line_index set not null;

alter table public.audio_references
  alter column user_song_id set not null;

alter table public.target_notes
  alter column user_song_id set not null,
  alter column line_index set not null;

alter table public.annotations
  add constraint annotations_target_shape
  check (
    line_index >= 0
    and (
      (target_type = 'line' and word_index is null)
      or (target_type = 'word' and word_index is not null and word_index >= 0)
    )
  );

alter table public.audio_references
  add constraint audio_target_shape
  check (
    (target_type = 'song' and line_index is null and word_index is null)
    or (target_type = 'line' and line_index is not null and line_index >= 0 and word_index is null)
    or (target_type = 'word' and line_index is not null and line_index >= 0 and word_index is not null and word_index >= 0)
  );

alter table public.target_notes
  add constraint target_notes_target_shape
  check (
    line_index >= 0
    and (
      (target_type = 'line' and word_index is null)
      or (target_type = 'word' and word_index is not null and word_index >= 0)
    )
  );

create index if not exists annotations_user_id_idx on public.annotations (user_id);
create index if not exists annotations_user_song_id_idx on public.annotations (user_song_id);
create index if not exists annotations_user_song_position_idx on public.annotations (user_song_id, target_type, line_index, word_index);
create unique index if not exists annotations_unique_marker_per_target
on public.annotations (user_id, target_type, user_song_id, line_index, word_index, marker_id) nulls not distinct;

create index if not exists audio_references_user_id_idx on public.audio_references (user_id);
create index if not exists audio_references_user_song_id_idx on public.audio_references (user_song_id);
create index if not exists audio_references_user_song_position_idx on public.audio_references (user_song_id, target_type, line_index, word_index);
create unique index if not exists audio_unique_line_target
on public.audio_references (user_id, target_type, user_song_id, line_index)
where target_type = 'line';
create unique index if not exists audio_unique_word_target
on public.audio_references (user_id, target_type, user_song_id, line_index, word_index)
where target_type = 'word';

create index if not exists target_notes_user_id_idx on public.target_notes (user_id);
create index if not exists target_notes_user_song_id_idx on public.target_notes (user_song_id);
create index if not exists target_notes_user_song_position_idx on public.target_notes (user_song_id, target_type, line_index, word_index);
create unique index if not exists target_notes_unique_target
on public.target_notes (user_id, target_type, user_song_id, line_index, word_index) nulls not distinct;

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
  and exists (
    select 1
    from public.user_songs user_song
    where user_song.id = annotations.user_song_id
      and user_song.user_id = (select auth.uid())
  )
  and line_index >= 0
  and (
    (target_type = 'line' and word_index is null)
    or (target_type = 'word' and word_index is not null and word_index >= 0)
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
  and exists (
    select 1
    from public.user_songs user_song
    where user_song.id = annotations.user_song_id
      and user_song.user_id = (select auth.uid())
  )
  and line_index >= 0
  and (
    (target_type = 'line' and word_index is null)
    or (target_type = 'word' and word_index is not null and word_index >= 0)
  )
);

create policy "Users can insert their audio references"
on public.audio_references for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and storage_path like ((select auth.uid())::text || '/%')
  and exists (
    select 1
    from public.user_songs user_song
    where user_song.id = audio_references.user_song_id
      and user_song.user_id = (select auth.uid())
  )
  and (
    (target_type = 'song' and line_index is null and word_index is null)
    or (target_type = 'line' and line_index is not null and line_index >= 0 and word_index is null)
    or (target_type = 'word' and line_index is not null and line_index >= 0 and word_index is not null and word_index >= 0)
  )
);

create policy "Users can update their audio references"
on public.audio_references for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and storage_path like ((select auth.uid())::text || '/%')
  and exists (
    select 1
    from public.user_songs user_song
    where user_song.id = audio_references.user_song_id
      and user_song.user_id = (select auth.uid())
  )
  and (
    (target_type = 'song' and line_index is null and word_index is null)
    or (target_type = 'line' and line_index is not null and line_index >= 0 and word_index is null)
    or (target_type = 'word' and line_index is not null and line_index >= 0 and word_index is not null and word_index >= 0)
  )
);

create policy "Users can insert their target notes"
on public.target_notes for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.user_songs user_song
    where user_song.id = target_notes.user_song_id
      and user_song.user_id = (select auth.uid())
  )
  and line_index >= 0
  and (
    (target_type = 'line' and word_index is null)
    or (target_type = 'word' and word_index is not null and word_index >= 0)
  )
);

create policy "Users can update their target notes"
on public.target_notes for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.user_songs user_song
    where user_song.id = target_notes.user_song_id
      and user_song.user_id = (select auth.uid())
  )
  and line_index >= 0
  and (
    (target_type = 'line' and word_index is null)
    or (target_type = 'word' and word_index is not null and word_index >= 0)
  )
);

drop table if exists public.lyric_words;
drop table if exists public.lyric_lines;
drop table if exists public.songs;
