# vocalmapp Product Specification

## Purpose

vocalmapp helps a vocalist remember how to sing each part of a song. A song becomes a private vocal map: lyrics, line-level cues, word-level cues, and short audio references.

## Primary User

The primary user is a singer learning and rehearsing songs. Common situations include reviewing a lesson, preparing for rehearsal, or keeping vocal notes in one place instead of scattered notes, screenshots, and voice messages.

## Core Workflows

1. Sign in with a Supabase email one-time code.
2. View a protected dashboard of personal songs.
3. Create a song manually.
4. Search Spotify metadata when credentials are configured.
5. Fall back to LRCLIB search when Spotify is unavailable.
6. Import title, artist, album, cover art, duration, Spotify URL, and available lyrics.
7. Paste or edit lyrics manually.
8. View lyrics by line with clickable words.
9. Add one or more vocal markers to a line.
10. Add one or more vocal markers to a word.
11. Upload a song audio or backing track.
12. Record a short reference audio for a line or word.
13. Play or delete stored audio references.
14. Create custom vocal markers.
15. Delete custom markers and remove their annotations.
16. Return later and see all saved maps from Supabase.

## Data Model

The schema is normalized for ownership, RLS, and future product growth:

- `profiles`: authenticated user profile data.
- `songs`: user-owned song metadata and source lyrics.
- `lyric_lines`: ordered lyric lines.
- `lyric_words`: ordered words for each line.
- `markers`: system markers and user-owned custom markers.
- `annotations`: line or word marker placements.
- `audio_references`: song, line, or word audio metadata.
- `storage.objects`: private audio files in the `vocalmap-audio` bucket.

## Security Requirements

- All application tables must have RLS enabled.
- Anonymous access is not allowed for application data.
- Authenticated users can only access their own songs, lyrics, annotations, audio references, profiles, and custom markers.
- Authenticated users can read system markers.
- Audio files must be private and scoped to the owning user's storage folder.
- The service-role key must never be exposed to the browser.

## Internationalization

English is the default language. User-facing text is managed through `messages/en.json` with next-intl.

## Out of Scope

- Automatic vocal analysis.
- Audio transcription.
- Word-level time synchronization.
- Sheet music notation.
- Social sharing.
- Downloading music from Spotify.
- Using Spotify as a lyrics provider.
