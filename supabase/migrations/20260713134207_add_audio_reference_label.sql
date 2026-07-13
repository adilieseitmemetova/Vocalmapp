alter table public.audio_references
  add column if not exists label text;

update public.audio_references
set label = case
  when target_type = 'song' then 'Audio file'
  else 'Recording'
end
where label is null or char_length(btrim(label)) = 0;

alter table public.audio_references
  alter column label set default 'Audio file',
  alter column label set not null;

alter table public.audio_references
  drop constraint if exists audio_references_label_not_empty;

alter table public.audio_references
  add constraint audio_references_label_not_empty
  check (char_length(btrim(label)) > 0);
