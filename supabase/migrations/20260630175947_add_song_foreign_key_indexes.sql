create index if not exists annotations_song_id_idx on public.annotations (song_id);
create index if not exists audio_references_song_id_idx on public.audio_references (song_id);
