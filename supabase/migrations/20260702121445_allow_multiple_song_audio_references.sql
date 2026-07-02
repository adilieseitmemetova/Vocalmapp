alter table public.audio_references
drop constraint if exists audio_unique_target;

create unique index if not exists audio_unique_line_target
on public.audio_references (user_id, target_type, song_id, line_id)
where target_type = 'line';

create unique index if not exists audio_unique_word_target
on public.audio_references (user_id, target_type, song_id, line_id, word_id)
where target_type = 'word';
