# End-to-end test report

## Scope

The harness exercises the browser, local HTTP server, SQLite persistence,
search and filtering, consent boundary, deduplication, public export, Google
Contacts, Gmail metadata, and OpenAI enrichment. Each run creates and removes a
temporary data directory. Connector fixtures use only `example.invalid`
identities and never read the normal ignored data, tokens, exports, or browser
profile.

GitHub Actions has no connector credentials. One separately authorized live
smoke used the local OpenAI key named `github` to enrich one fictional contact
with no email address or relationship history. It passed without exposing the
key or reading local network data.

## Results

| ID | Category | Expected behavior | Result |
|---|---|---|---|
| U01 | Local status | The application and connector status render | Pass |
| U02 | Sample import | The sample contact loads through the running backend | Pass |
| U03 | Evidence search | A compound evidence query returns the relevant contact | Pass |
| U04 | Contact detail | Selecting a result exposes evidence and consent | Pass |
| U05 | Consent gate | A do-not-share contact can be hidden | Pass |
| U06 | Organization filter | Organization filtering narrows the shortlist | Pass |
| U07 | Topic filter | Topic filtering uses transparent tags | Pass |
| U08 | Merge behavior | Duplicate email imports merge and preserve source flags | Pass |
| U09 | Google Contacts | An isolated People API fixture imports one contact | Pass |
| U10 | Gmail metadata | An isolated Gmail fixture records evidence and warmth | Pass |
| A01 | Malformed JSON | Invalid JSON receives a controlled 400 response | Pass |
| A02 | Body limit | A request over 1 MB receives 413 | Pass |
| A03 | Empty contact | A record with no name, email, or profile link is rejected | Pass |
| A04 | Query limit | An abusive list limit is clamped to 500 | Pass |
| A05 | Missing secret | OpenAI enrichment without a key fails closed with 503 | Pass |
| A06 | Malformed AI output | A non-array tag result cannot corrupt a contact | Pass |
| A07 | Provider throttling | An OpenAI 429 remains visible to the caller | Pass |
| A08 | CSV injection | Formula-like cells are neutralized and email stays private | Pass |
| A09 | LinkedIn boundary | An empty query is rejected before browser automation | Pass |
| A10 | OAuth integrity | A Google callback with the wrong state is rejected | Pass |

Local result: 20 of 20 categories passed in Chromium. JavaScript syntax checks
and the dependency audit also passed with zero known vulnerabilities. The first
run passed 19 of 20 because the agriculture fixture retained a digital-health
job title; correcting the contradictory fixture produced a complete pass.

[GitHub Actions run 34667958547](https://github.com/wayanvota/network-radar/actions/runs/34667958547)
passed all 20 categories in Chromium, the syntax checks, and the dependency
audit on Node 22.16.0.

## Defects fixed

- Duplicate contact upserts returned the incoming ID even when the record merged
  into an existing ID, producing a null API response. The endpoint now returns
  the stored merged record.
- Direct API callers could create empty contacts. An identifiable name, email,
  or profile link is now required.
- Malformed JSON, oversized bodies, missing credentials, empty LinkedIn
  queries, and OAuth state failures all appeared as generic 500 errors. They now
  return bounded status codes and stable error codes.
- Request bodies and numeric list/enrichment limits were not safely bounded.
- Model-produced tags were spread without verifying that the result was an
  array. Invalid model output now becomes an empty tag set.
- Public CSV cells beginning with spreadsheet formula characters were emitted
  directly. They are now prefixed so spreadsheet software treats them as text.
- The test seams now provide isolated data and connector endpoints without
  changing the local-first production defaults.

## Run locally

```bash
npm ci
npx playwright install chromium
npm run test:ci
npm audit --audit-level=high
```

## Debug and extend

- The test stack uses ports 5178 and 5180 and creates its database under the
  operating system's temporary directory.
- `tests/fixtures/connectors.mjs` supplies Google Contacts, Gmail, embeddings,
  tags, malformed tags, and rate-limit cases.
- Keep exactly 10 `U` and 10 `A` categories. Replace a weaker scenario when a
  more consequential behavior is added.
- Test through the browser or running HTTP boundary. Avoid private helper calls
  when the behavior is reachable through the product.
- Do not add a real contact, email, relationship history, OAuth token, LinkedIn
  profile, Gmail record, or provider key to fixtures or GitHub Actions.
