# Architecture

Network Radar is intentionally local-first.

## Runtime

- `server.mjs` runs a Node HTTP server on `127.0.0.1`.
- `index.html`, `styles.css`, and `app.js` provide the browser interface.
- `data/network-radar.sqlite` stores contacts, evidence, import logs, warmth signals, consent, and embeddings.
- `.env.local` stores local secrets and is ignored by Git.

## Data Model

Contacts are one row per person. The merge keys are:

- email address
- LinkedIn or profile URL
- name plus first organization

Evidence is stored separately so every match can show why the person surfaced.

Warmth is channel-specific:

- Gmail sent
- Gmail received
- LinkedIn messages
- contact presence
- last touched

Fit is separate from warmth. Consent is separate from both.

## Connectors

Google Contacts:

- Uses the People API.
- Requires local OAuth.
- Imports names, emails, phones, organizations, titles, locations, biographies, and URLs.

Gmail:

- Uses the Gmail API.
- Requires local OAuth.
- Imports message metadata: From, To, Cc, Subject, and Date.
- Converts email participants into contact warmth evidence.

LinkedIn:

- Uses local browser automation when Playwright is installed.
- Uses a separate local browser profile under `data/`.
- Reads visible search results only.
- Does not write to LinkedIn.

OpenAI:

- Uses embeddings for semantic search scaffolding.
- Uses a small enrichment prompt for professional tags.
- Should not infer sensitive traits.

## Why Not Public By Default

The relationship graph is sensitive. A public deployment would need authentication, encryption at rest, access logs, deletion workflows, data-processing notices, connector review, and consent controls. The default version avoids that by keeping the tool on the user's machine.
