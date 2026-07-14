delete from storage.objects
where bucket_id = 'vocalmap-audio'
  and name in (
    select storage_path
    from public.audio_references
    where target_type = 'line'
  );

delete from public.annotations
where target_type = 'line';

delete from public.target_notes
where target_type = 'line';

delete from public.audio_references
where target_type = 'line';

drop index if exists public.audio_unique_line_target;

alter table public.annotations
  drop constraint if exists annotations_target_shape,
  add constraint annotations_target_shape check (
    target_type = 'word'
    and line_index >= 0
    and word_index is not null
    and word_index >= 0
  );

alter table public.target_notes
  drop constraint if exists target_notes_target_shape,
  add constraint target_notes_target_shape check (
    target_type = 'word'
    and line_index >= 0
    and word_index is not null
    and word_index >= 0
  );

alter table public.audio_references
  drop constraint if exists audio_target_shape,
  add constraint audio_target_shape check (
    (target_type = 'song' and line_index is null and word_index is null)
    or (target_type = 'word' and line_index >= 0 and word_index is not null and word_index >= 0)
  );
