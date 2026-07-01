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

## Environment

Create `.env.local` from `.env.example` and set:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
```

`SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are optional. When they are missing, the search UI falls back to LRCLIB results.

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

Created storage bucket:

- `vocalmap-audio`

Every application table has Row Level Security enabled. Policies restrict users to their own rows, except system markers, which authenticated users can read. Storage policies restrict audio objects to authenticated owners inside their own user folder.

For email code auth, configure the Supabase Auth email template to include the one-time token:

```text
{{ .Token }}
```

If the template uses `{{ .ConfirmationURL }}`, Supabase sends an email link instead of the code expected by this UI.

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
npm run typecheck
npm run lint
npm run build
npm audit
```
