# vocalmapp Product Specification

## Purpose

vocalmapp helps a vocalist remember how to sing each part of a song. A song becomes a private vocal map: lyrics, line-level cues, word-level cues, and short audio references.

## Primary User

The primary user is a singer learning and rehearsing songs. Common situations include reviewing a lesson, preparing for rehearsal, or keeping vocal notes in one place instead of scattered notes, screenshots, and voice messages.

## Core Workflows

1. Sign in with a Supabase email one-time code.
2. View a protected dashboard of personal songs.
3. Search YouTube through a protected server route.
4. Compare matching video versions and explicitly choose one.
5. Save the selected YouTube video ID, title, channel, thumbnail, duration, search query, and version type.
6. Paste or edit lyrics manually, or import available lyrics from LRCLIB.
7. Play the selected video inside the official YouTube player.
8. Sync words and markers to saved player timestamps.
9. Replace a selected YouTube video without deleting a vocal map.
10. Upload a private practice audio file or record a short reference audio for a word.
11. Play or delete stored audio references.
12. Create custom vocal markers.
13. Delete custom markers and remove their annotations.
14. Return later and see all saved maps from Supabase.

## Data Model

The schema is normalized for ownership, RLS, and future product growth:

- `profiles`: authenticated user profile data.
- `songs`: user-owned song metadata and source lyrics.
- `lyric_lines`: ordered lyric lines.
- `lyric_words`: ordered words for each line.
- `markers`: system markers and user-owned custom markers.
- `annotations`: line or word marker placements.
- `audio_references`: song, line, or word audio metadata.
- `lyric_timestamps`: user-owned word timestamps used to seek the YouTube player.
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
- Sheet music notation.
- Social sharing.
- Downloading, extracting, proxying, or storing YouTube audio.
- Automatic AI analysis of YouTube audio.
