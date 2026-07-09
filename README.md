# Network Radar

Network Radar is a local-first relationship search tool for people who make intros, shortlists, and referrals from a large personal network.

It runs on your laptop. Contact data, Gmail metadata, LinkedIn browser results, OAuth tokens, exports, and the SQLite database live under local ignored files. The GitHub repository is for code and process only.

## What It Does

- Searches contacts by person, organization, location, interest, title, notes, and evidence.
- Keeps fit and warmth separate.
- Tracks warmth by channel: Gmail sent, Gmail received, LinkedIn messages, contact presence, and recency.
- Treats consent as its own field: `Unknown`, `Ask first`, `Share OK`, or `Do not share`.
- Imports files from Google Contacts, LinkedIn exports, and Gmail Takeout.
- Syncs Google Contacts through the Google People API after local OAuth setup.
- Syncs Gmail metadata through the Gmail API after local OAuth setup.
- Runs optional OpenAI enrichment for tags and embeddings.
- Runs an optional read-only LinkedIn browser search through a local browser profile.
- Exports a shareable shortlist CSV without private notes or email addresses by default.

## Local Quick Start

Requirements:

- Node.js 22.5 or newer.
- A local OpenAI API key in `.env.local` for enrichment.
- Optional Google OAuth credentials for Google Contacts and Gmail sync.
- Optional `npm install` if you want LinkedIn browser automation through Playwright.

Run:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5178
```

## Local Files That Must Not Be Committed

These are ignored by `.gitignore`:

- `.env.local`
- `data/`
- `exports/`
- `screenshots/`
- `node_modules/`

The local SQLite database is:

```text
data/network-radar.sqlite
```

Google OAuth tokens are stored at:

```text
data/google-token.json
```

The LinkedIn browser profile is stored at:

```text
data/linkedin-browser-profile/
```

## Google Contacts And Gmail Setup

1. Create a Google Cloud OAuth client.
2. Add this redirect URI:

```text
http://127.0.0.1:5178/auth/google/callback
```

3. Add these values to `.env.local`:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://127.0.0.1:5178/auth/google/callback
```

4. Start the local app and click `Authorize Google`.
5. Use `Tools` then `Sync Google Contacts` or `Sync Gmail`.

Scopes requested:

- `https://www.googleapis.com/auth/contacts.readonly`
- `https://www.googleapis.com/auth/gmail.readonly`

## LinkedIn Setup

LinkedIn does not provide a normal personal network API for this use case. Network Radar uses a local, visible browser profile instead.

Run:

```bash
npm install
npm run dev
```

Then use `Tools` then `LinkedIn Search`.

The browser workflow is intentionally read-only. It opens LinkedIn search, waits for login if needed, reads visible people-search result cards, and imports names, headlines, and profile links. It does not send messages, connection requests, reactions, or profile edits.

Use judgment. LinkedIn is a closed platform, and automated browsing may violate or stress its terms depending on how it is used.

## OpenAI Enrichment

OpenAI enrichment does two things:

- Creates embeddings for future semantic ranking.
- Suggests professional tags from available contact evidence.

Run it from `Tools` then `OpenAI Enrich`.

The current enrichment prompt explicitly avoids inferring sensitive traits. You should still inspect suggested tags before using them in public-facing shortlists.

## Deployment Notes

This is designed as a laptop tool, not a public web app.

Render, Neon, or other hosted services can help if you later want:

- A private remote copy for your own use.
- A Postgres database instead of local SQLite.
- A background worker for scheduled sync.

Do not deploy this as a public multi-user app without adding proper authentication, encryption at rest, audit logs, rate limits, and a much stricter consent model.

## Repository Policy

Safe to publish:

- Source code.
- Setup docs.
- Sample fake contacts.
- Architecture notes.

Never publish:

- `.env.local`
- `data/`
- real contacts
- Gmail metadata
- LinkedIn scraped results
- OAuth tokens
- exports with private notes or email addresses

## Current Limits

- Google sync requires you to create OAuth credentials.
- LinkedIn automation depends on visible page structure and may break.
- Gmail sync imports metadata and evidence snippets, not full message bodies.
- SQLite uses Node's experimental `node:sqlite` module.
- Semantic ranking is scaffolded through embeddings, but the visible ranker is still a transparent lexical first pass.
