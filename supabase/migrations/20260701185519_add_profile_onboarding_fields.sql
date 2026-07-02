alter table public.profiles
  add column if not exists vocal_goal text,
  add column if not exists onboarding_completed boolean not null default false;

alter table public.profiles
  drop constraint if exists profiles_display_name_length,
  add constraint profiles_display_name_length
    check (display_name is null or char_length(btrim(display_name)) between 2 and 40);

alter table public.profiles
  drop constraint if exists profiles_vocal_goal_length,
  add constraint profiles_vocal_goal_length
    check (vocal_goal is null or char_length(btrim(vocal_goal)) <= 160);
