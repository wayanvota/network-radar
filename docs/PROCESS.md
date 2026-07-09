# Build Process For Others

1. Clone the repository.
2. Copy `.env.example` to `.env.local`.
3. Add an OpenAI API key if you want enrichment.
4. Add Google OAuth credentials if you want Google Contacts or Gmail sync.
5. Run `npm run dev`.
6. Open `http://127.0.0.1:5178`.
7. Load the fake sample data first.
8. Import or sync your own data only after confirming `.gitignore` excludes `.env.local` and `data/`.

## Recommended Workflow

Start with exports:

- Google Contacts CSV or vCard.
- LinkedIn connections CSV.
- Gmail Takeout MBOX if API setup is not ready.

Then move to account sync:

- Authorize Google.
- Sync contacts.
- Sync a bounded Gmail query, such as `newer_than:365d`.
- Run OpenAI enrichment on a small batch.
- Review tags and consent before exporting.

Use LinkedIn browser search last. Treat it as a read-only scout for net-new people, not as a messaging or connection-request agent.

## Shortlist Hygiene

Before sharing a shortlist:

- Check the evidence panel.
- Set consent.
- Remove private notes.
- Prefer public links over emails.
- Mark uncertain claims as unverified.
