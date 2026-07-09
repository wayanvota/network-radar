# Security

Network Radar handles sensitive relationship data. The default configuration is local-only.

## Do Not Commit

- `.env.local`
- `data/`
- `exports/`
- real contacts
- OAuth tokens
- Gmail metadata
- LinkedIn search results

## Recommended Use

- Run on `127.0.0.1`.
- Use read-only Google scopes.
- Use LinkedIn browser automation only for read-only search.
- Review consent before exporting shortlists.
- Share public profile links instead of private emails whenever possible.

## Reporting Issues

Open a GitHub issue for code problems, but do not include contact data, tokens, message snippets, screenshots with private information, or real email addresses.
