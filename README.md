# vocalmapp

vocalmapp is a private Next.js App Router application for vocalists who mark up lyrics with vocal cues and short reference recordings.

## Stack

- Next.js App Router
- React Server Components for protected page bootstrapping
- Client components for the interactive lyric editor, recording, and uploads
- Tailwind CSS v4
- next-intl with English as the default locale
- Supabase Auth, Database, Row Level Security, and Storage
- Supabase email one-time code authentication
- YouTube Data API v3 for server-side song search
- Official YouTube IFrame Player API for in-app playback

## Environment

Create `.env.local` from `.env.example` and set:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
YOUTUBE_API_KEY=
```

`YOUTUBE_API_KEY` is server-only. Enable YouTube Data API v3 for the key and do not expose it with a `NEXT_PUBLIC_` prefix. Search is authenticated, validates queries, limits requests per user, and does not log API keys.

Audio is played through the official YouTube player. vocalmapp does not host, proxy, extract, or download copyrighted audio.

Do not expose `SUPABASE_SERVICE_ROLE_KEY` to client code. The application uses the public Supabase anon key with RLS for browser access.

## Supabase Setup

The live schema was created with Supabase MCP for project `gzbqhahmqespmimdojzr`.

Created public tables:

- `profiles`
- `songs`
- `lyric_lines`
- `lyric_words`
- `markers`
- `annotations`
- `audio_references`
- `lyric_timestamps`

Created storage bucket:

- `vocalmap-audio`

Every application table has Row Level Security enabled. Policies restrict users to their own rows, except system markers, which authenticated users can read. Storage policies restrict audio objects to authenticated owners inside their own user folder.

For email code auth with automatic login and registration, configure the Supabase Auth email
templates to include the one-time token:

```text
{{ .Token }}
```

Use the **Magic Link / OTP** template for returning users and the **Confirm signup** template for
new users. Remove `{{ .ConfirmationURL }}`, `{{ .TokenHash }}`, and direct `/auth/v1/verify` links
from auth emails, because email prefetchers can open those links and consume the one-time token
before the user enters the code. Set **Authentication > Providers > Email > Email OTP Expiration**
to a practical value such as `300` or `3600` seconds. The sign-in form accepts Supabase email OTP
lengths from 6 to 10 digits.

## Development

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

## Verification

```bash
npm run test
npm run typecheck
npm run lint
npm run build
npm audit
```
