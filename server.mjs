import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { URL, fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, ".env.local"));
loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5178);
const DATA_DIR = path.join(__dirname, "data");
const EXPORT_DIR = path.join(__dirname, "exports");
const DB_PATH = path.join(DATA_DIR, "network-radar.sqlite");
const GOOGLE_TOKEN_PATH = path.join(DATA_DIR, "google-token.json");
const LINKEDIN_PROFILE_DIR = path.join(DATA_DIR, "linkedin-browser-profile");
const PUBLIC_FILES = new Set(["/", "/index.html", "/styles.css", "/app.js", "/design-concept.png"]);

await fsp.mkdir(DATA_DIR, { recursive: true });
await fsp.mkdir(EXPORT_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
initDb();

if (process.argv.includes("--init-db")) {
  console.log(JSON.stringify({ db: DB_PATH, status: "initialized" }, null, 2));
  process.exit(0);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
    if (req.method === "GET" && PUBLIC_FILES.has(url.pathname)) return serveStatic(res, url.pathname);
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, health());
    if (req.method === "GET" && url.pathname === "/api/contacts") return json(res, listContacts(url.searchParams));
    if (req.method === "POST" && url.pathname === "/api/contacts") return json(res, upsertContact(await readJson(req)));
    if (req.method === "DELETE" && url.pathname === "/api/contacts") return json(res, clearContacts());
    if (req.method === "POST" && url.pathname === "/api/sample") return json(res, importSample());
    if (req.method === "POST" && url.pathname === "/api/openai/enrich") return json(res, await enrichContacts(await readJson(req)));
    if (req.method === "POST" && url.pathname === "/api/google/sync-contacts") return json(res, await syncGoogleContacts());
    if (req.method === "POST" && url.pathname === "/api/google/sync-gmail") return json(res, await syncGmail(await readJson(req)));
    if (req.method === "GET" && url.pathname === "/auth/google/start") return redirect(res, googleAuthUrl());
    if (req.method === "GET" && url.pathname === "/auth/google/callback") return json(res, await googleCallback(url.searchParams));
    if (req.method === "POST" && url.pathname === "/api/linkedin/search") return json(res, await linkedinSearch(await readJson(req)));
    if (req.method === "GET" && url.pathname === "/api/export/public-shortlist") return exportPublicShortlist(res, url.searchParams);
    return notFound(res);
  } catch (error) {
    console.error(error);
    return json(res, { error: error.message }, 500);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Network Radar running locally: http://127.0.0.1:${PORT}`);
});

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
    const [key, ...rest] = trimmed.split("=");
    if (!process.env[key]) process.env[key] = rest.join("=").replace(/^"|"$/g, "");
  });
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      emails_json TEXT NOT NULL DEFAULT '[]',
      phones_json TEXT NOT NULL DEFAULT '[]',
      orgs_json TEXT NOT NULL DEFAULT '[]',
      titles_json TEXT NOT NULL DEFAULT '[]',
      locations_json TEXT NOT NULL DEFAULT '[]',
      links_json TEXT NOT NULL DEFAULT '[]',
      bio TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      sources_json TEXT NOT NULL DEFAULT '{}',
      consent TEXT NOT NULL DEFAULT 'unknown',
      warmth_json TEXT NOT NULL DEFAULT '{}',
      embedding_json TEXT NOT NULL DEFAULT '[]',
      shortlisted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      source TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(contact_id) REFERENCES contacts(id)
    );
    CREATE TABLE IF NOT EXISTS imports (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      imported_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_contact ON evidence(contact_id);
  `);
}

function health() {
  return {
    ok: true,
    localOnly: true,
    dbPath: DB_PATH,
    contactCount: db.prepare("SELECT COUNT(*) AS count FROM contacts").get().count,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    googleAuthorized: fs.existsSync(GOOGLE_TOKEN_PATH),
    linkedInProfileDir: LINKEDIN_PROFILE_DIR
  };
}

function listContacts(params) {
  const q = params.get("q") || "";
  const limit = Math.min(Number(params.get("limit") || 200), 500);
  const evidenceMatches = evidenceMatchCounts(q);
  const rows = db.prepare("SELECT * FROM contacts ORDER BY updated_at DESC").all().map((row) => rowToContact(row, false));
  const scored = rows
    .map((contact) => ({ contact, score: scoreContact(contact, q, evidenceMatches.get(contact.id) || 0), warmth: warmthProfile(contact) }))
    .filter(({ score }) => !q.trim() || score.fit > 0)
    .sort((a, b) => b.score.fit - a.score.fit || b.warmth.points - a.warmth.points);
  return {
    contacts: scored.slice(0, limit).map((item) => ({
      ...item,
      contact: withEvidence(item.contact, 8)
    })),
    total: rows.length,
    matches: scored.length,
    limit
  };
}

function upsertContact(input) {
  const contact = cleanContact(input);
  mergeContact(contact);
  return { contact: getContact(contact.id) };
}

function clearContacts() {
  db.exec("DELETE FROM evidence; DELETE FROM contacts; DELETE FROM imports;");
  return { ok: true };
}

function mergeContact(incoming) {
  const existing = findExisting(incoming);
  if (!existing) {
    writeContact(incoming);
    writeEvidence(incoming.id, incoming.evidence || []);
    return incoming.id;
  }
  const merged = {
    ...existing,
    name: existing.name || incoming.name,
    emails: unique([...existing.emails, ...incoming.emails]),
    phones: unique([...existing.phones, ...incoming.phones]),
    orgs: unique([...existing.orgs, ...incoming.orgs]),
    titles: unique([...existing.titles, ...incoming.titles]),
    locations: unique([...existing.locations, ...incoming.locations]),
    links: unique([...existing.links, ...incoming.links]),
    bio: snippet([existing.bio, incoming.bio].filter(Boolean).join(" "), 2000),
    notes: [existing.notes, incoming.notes].filter(Boolean).join("\n"),
    tags: unique([...existing.tags, ...incoming.tags, ...inferTags(incoming)]),
    sources: { ...existing.sources, ...incoming.sources },
    warmth: mergeWarmth(existing.warmth, incoming.warmth),
    consent: existing.consent === "unknown" ? incoming.consent : existing.consent,
    embedding: existing.embedding?.length ? existing.embedding : incoming.embedding
  };
  writeContact(merged);
  writeEvidence(merged.id, incoming.evidence || []);
  return merged.id;
}

function findExisting(contact) {
  for (const email of contact.emails) {
    const rows = db.prepare("SELECT * FROM contacts WHERE emails_json LIKE ?").all(`%${email.toLowerCase()}%`).map(rowToContact);
    const match = rows.find((row) => row.emails.some((candidate) => candidate.toLowerCase() === email.toLowerCase()));
    if (match) return match;
  }
  for (const link of contact.links) {
    const normalizedLink = normalizeLink(link);
    if (!normalizedLink) continue;
    const rows = db.prepare("SELECT * FROM contacts WHERE links_json LIKE ?").all(`%${normalizedLink}%`).map(rowToContact);
    const match = rows.find((row) => row.links.map(normalizeLink).includes(normalizedLink));
    if (match) return match;
  }
  const nameOrg = normalizeText(`${contact.name} ${first(contact.orgs)}`);
  if (!nameOrg) return null;
  const rows = db.prepare("SELECT * FROM contacts WHERE name = ?").all(contact.name).map(rowToContact);
  return rows.find((row) => normalizeText(`${row.name} ${first(row.orgs)}`) === nameOrg) || null;
}

function writeContact(contact) {
  const stmt = db.prepare(`
    INSERT INTO contacts (
      id, name, emails_json, phones_json, orgs_json, titles_json, locations_json, links_json,
      bio, notes, tags_json, sources_json, consent, warmth_json, embedding_json, shortlisted, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, emails_json=excluded.emails_json, phones_json=excluded.phones_json,
      orgs_json=excluded.orgs_json, titles_json=excluded.titles_json, locations_json=excluded.locations_json,
      links_json=excluded.links_json, bio=excluded.bio, notes=excluded.notes, tags_json=excluded.tags_json,
      sources_json=excluded.sources_json, consent=excluded.consent, warmth_json=excluded.warmth_json,
      embedding_json=excluded.embedding_json, shortlisted=excluded.shortlisted, updated_at=excluded.updated_at
  `);
  stmt.run(
    contact.id, contact.name, j(contact.emails), j(contact.phones), j(contact.orgs), j(contact.titles),
    j(contact.locations), j(contact.links), contact.bio, contact.notes, j(contact.tags), j(contact.sources),
    contact.consent, j(contact.warmth), j(contact.embedding || []), contact.shortlisted ? 1 : 0,
    new Date().toISOString()
  );
}

function writeEvidence(contactId, evidence) {
  const stmt = db.prepare("INSERT OR IGNORE INTO evidence (id, contact_id, source, text) VALUES (?, ?, ?, ?)");
  evidence.forEach((item) => {
    const id = sha(`${contactId}:${item.source}:${item.text}`);
    stmt.run(id, contactId, item.source || "Unknown", item.text || "");
  });
}

function getContact(id) {
  const row = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id);
  return row ? rowToContact(row) : null;
}

function rowToContact(row, includeEvidence = true) {
  const contact = {
    id: row.id,
    name: row.name,
    emails: parseJson(row.emails_json, []),
    phones: parseJson(row.phones_json, []),
    orgs: parseJson(row.orgs_json, []),
    titles: parseJson(row.titles_json, []),
    locations: parseJson(row.locations_json, []),
    links: parseJson(row.links_json, []),
    bio: row.bio,
    notes: row.notes,
    tags: parseJson(row.tags_json, []),
    sources: parseJson(row.sources_json, {}),
    consent: row.consent,
    warmth: parseJson(row.warmth_json, defaultWarmth()),
    embedding: parseJson(row.embedding_json, []),
    shortlisted: Boolean(row.shortlisted),
    updatedAt: row.updated_at
  };
  contact.evidence = includeEvidence ? evidenceForContact(contact.id, 20) : [];
  return contact;
}

function withEvidence(contact, limit = 20) {
  return { ...contact, evidence: evidenceForContact(contact.id, limit) };
}

function evidenceForContact(contactId, limit = 20) {
  return db.prepare("SELECT source, text, created_at FROM evidence WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?").all(contactId, limit);
}

function evidenceMatchCounts(query) {
  const counts = new Map();
  const terms = unique([normalizeText(query), ...tokenize(query)]).filter(Boolean).slice(0, 8);
  for (const term of terms) {
    const rows = db.prepare(`
      SELECT contact_id, COUNT(*) AS count
      FROM evidence
      WHERE lower(text) LIKE ?
      GROUP BY contact_id
    `).all(`%${term.toLowerCase()}%`);
    rows.forEach((row) => counts.set(row.contact_id, (counts.get(row.contact_id) || 0) + Number(row.count || 0)));
  }
  return counts;
}

async function syncGoogleContacts() {
  const token = await googleToken();
  let nextPageToken = "";
  let imported = 0;
  do {
    const url = new URL("https://people.googleapis.com/v1/people/me/connections");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("personFields", "names,emailAddresses,phoneNumbers,organizations,locations,biographies,urls");
    if (nextPageToken) url.searchParams.set("pageToken", nextPageToken);
    const data = await googleFetch(url, token);
    for (const person of data.connections || []) {
      mergeContact(contactFromGooglePerson(person));
      imported += 1;
    }
    nextPageToken = data.nextPageToken || "";
  } while (nextPageToken);
  recordImport("google-contacts", "People API", imported);
  return { imported };
}

async function syncGmail(input = {}) {
  const token = await googleToken();
  const query = input.query || "newer_than:365d";
  const max = Math.min(Number(input.max || 300), 2000);
  let pageToken = "";
  let imported = 0;
  do {
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", query);
    listUrl.searchParams.set("maxResults", String(Math.min(100, max - imported)));
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);
    const list = await googleFetch(listUrl, token);
    for (const message of list.messages || []) {
      const detail = await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`, token);
      for (const contact of contactsFromGmailMessage(detail)) {
        mergeContact(contact);
      }
      imported += 1;
      if (imported >= max) break;
    }
    pageToken = imported < max ? list.nextPageToken || "" : "";
  } while (pageToken);
  recordImport("gmail", query, imported);
  return { importedMessages: imported, query };
}

async function googleToken() {
  if (!fs.existsSync(GOOGLE_TOKEN_PATH)) throw new Error("Google is not authorized. Open /auth/google/start first.");
  const saved = JSON.parse(await fsp.readFile(GOOGLE_TOKEN_PATH, "utf8"));
  if (saved.expires_at && Date.now() < saved.expires_at - 60000) return saved.access_token;
  if (!saved.refresh_token) throw new Error("Google token expired and has no refresh token. Reauthorize Google.");
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: saved.refresh_token,
    grant_type: "refresh_token"
  });
  const refreshed = await postForm("https://oauth2.googleapis.com/token", body);
  const next = {
    ...saved,
    access_token: refreshed.access_token,
    expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000
  };
  await fsp.writeFile(GOOGLE_TOKEN_PATH, JSON.stringify(next, null, 2));
  return next.access_token;
}

function googleAuthUrl() {
  requireGoogleConfig();
  const state = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(DATA_DIR, "google-oauth-state.txt"), state);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", [
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/gmail.readonly"
  ].join(" "));
  return url.toString();
}

async function googleCallback(params) {
  requireGoogleConfig();
  const expected = fs.existsSync(path.join(DATA_DIR, "google-oauth-state.txt"))
    ? fs.readFileSync(path.join(DATA_DIR, "google-oauth-state.txt"), "utf8")
    : "";
  if (!expected || params.get("state") !== expected) throw new Error("Google OAuth state mismatch.");
  const code = params.get("code");
  if (!code) throw new Error("Google OAuth callback did not include a code.");
  const token = await postForm("https://oauth2.googleapis.com/token", new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: googleRedirectUri()
  }));
  await fsp.writeFile(GOOGLE_TOKEN_PATH, JSON.stringify({
    ...token,
    expires_at: Date.now() + Number(token.expires_in || 3600) * 1000
  }, null, 2));
  return { ok: true, message: "Google authorized locally. You can close this tab and sync contacts or Gmail." };
}

async function linkedinSearch(input = {}) {
  const query = input.query || "";
  if (!query.trim()) throw new Error("LinkedIn search query required.");
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error("LinkedIn browser automation requires optional dependency `playwright`. Run `npm install` first.");
  }
  const browser = await playwright.chromium.launchPersistentContext(LINKEDIN_PROFILE_DIR, {
    headless: process.env.LINKEDIN_HEADLESS === "true",
    executablePath: chromePath(),
    viewport: { width: 1440, height: 980 }
  });
  const page = await browser.newPage();
  const url = new URL("https://www.linkedin.com/search/results/people/");
  url.searchParams.set("keywords", query);
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(Number(input.loginWaitMs || 8000));
  const results = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("a[href*='/in/']")).slice(0, 25);
    return cards.map((link) => {
      const root = link.closest("li") || link.parentElement;
      const text = root?.innerText || link.innerText || "";
      const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
      return {
        name: lines[0] || link.textContent.trim(),
        headline: lines.slice(1, 4).join(" "),
        url: link.href.split("?")[0]
      };
    }).filter((item, index, arr) => item.name && item.url && arr.findIndex((x) => x.url === item.url) === index);
  });
  await browser.close();
  let imported = 0;
  results.forEach((item) => {
    mergeContact(cleanContact({
      name: item.name,
      titles: [item.headline],
      links: [item.url],
      bio: item.headline,
      sources: { linkedin: true },
      evidence: [{ source: "LinkedIn browser search", text: `Read-only visible search result for "${query}": ${item.headline}` }]
    }));
    imported += 1;
  });
  recordImport("linkedin-browser", query, imported);
  return { imported, results };
}

async function enrichContacts(input = {}) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const limit = Math.min(Number(input.limit || 20), 100);
  const contacts = db.prepare("SELECT * FROM contacts ORDER BY updated_at DESC LIMIT ?").all(limit).map(rowToContact);
  let enriched = 0;
  for (const contact of contacts) {
    const embedding = await embed(contactCorpus(contact));
    const tags = await suggestTags(contact);
    writeContact({ ...contact, embedding, tags: unique([...contact.tags, ...tags]) });
    enriched += 1;
  }
  return { enriched };
}

async function embed(text) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: openaiHeaders(),
    body: JSON.stringify({
      model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
      input: text.slice(0, 12000)
    })
  });
  if (!response.ok) throw new Error(`OpenAI embedding failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return data.data?.[0]?.embedding || [];
}

async function suggestTags(contact) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openaiHeaders(),
    body: JSON.stringify({
      model: process.env.OPENAI_ENRICH_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: "Extract 5 to 12 concise professional tags from the contact evidence. Return JSON only: {\"tags\":[...]}. Do not infer sensitive traits."
        },
        { role: "user", content: contactCorpus(contact).slice(0, 8000) }
      ],
      text: { format: { type: "json_object" } }
    })
  });
  if (!response.ok) throw new Error(`OpenAI enrichment failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const raw = data.output_text || data.output?.flatMap((o) => o.content || []).map((c) => c.text).join("") || "{}";
  return parseJson(raw, { tags: [] }).tags || [];
}

function openaiHeaders() {
  return {
    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json"
  };
}

function contactFromGooglePerson(person) {
  const name = first((person.names || []).map((n) => n.displayName));
  const orgs = unique((person.organizations || []).map((o) => o.name).filter(Boolean));
  const titles = unique((person.organizations || []).map((o) => o.title).filter(Boolean));
  const locations = unique((person.locations || []).map((l) => l.value).filter(Boolean));
  const links = unique((person.urls || []).map((u) => u.value).filter(Boolean));
  const bio = first((person.biographies || []).map((b) => b.value));
  return cleanContact({
    id: person.resourceName ? `google-${sha(person.resourceName)}` : "",
    name,
    emails: (person.emailAddresses || []).map((e) => e.value),
    phones: (person.phoneNumbers || []).map((p) => p.value),
    orgs,
    titles,
    locations,
    links,
    bio,
    sources: { google: true },
    warmth: { contacts: { present: true } },
    evidence: [{ source: "Google Contacts", text: "Imported through the local Google People API connector." }]
  });
}

function contactsFromGmailMessage(message) {
  const headers = Object.fromEntries((message.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
  const fromEmails = extractEmails(headers.from);
  const toEmails = extractEmails([headers.to, headers.cc].filter(Boolean).join(", "));
  const subject = headers.subject || "(no subject)";
  const date = normalizeDate(headers.date);
  return unique([...fromEmails, ...toEmails]).map((email) => cleanContact({
    name: displayNameForEmail(email, [headers.from, headers.to, headers.cc].filter(Boolean).join(", ")) || email,
    emails: [email],
    bio: subject,
    sources: { gmail: true },
    warmth: {
      gmail: {
        sent: fromEmails.includes(email) ? 0 : 1,
        received: fromEmails.includes(email) ? 1 : 0,
        last: date
      }
    },
    evidence: [{ source: "Gmail", text: `Subject: ${subject}` }]
  }));
}

function importSample() {
  const samples = [
    {
      name: "Ana Morales",
      emails: ["ana.morales@example.org"],
      orgs: ["Salud Comunitaria Colombia"],
      titles: ["Digital health implementation lead"],
      locations: ["Bogota, Colombia"],
      links: ["https://www.linkedin.com/in/ana-morales-example"],
      bio: "Ships community health tools with CHWs, M&E routines, DHIS2 integrations, and Spanish-language training.",
      notes: "Strong fit for practical digital health and Colombia work. Ask before sharing email.",
      tags: ["digital health", "Colombia", "M&E", "community health", "Spanish"],
      sources: { google: true, linkedin: true, gmail: true },
      consent: "ask-first",
      warmth: { gmail: { sent: 7, received: 11, last: "2026-06-24" }, linkedin: { messages: 2, last: "2026-05-12" }, contacts: { present: true } },
      evidence: [{ source: "Sample", text: "Representative local sample. Delete before using your real data." }]
    }
  ];
  samples.forEach((sample) => mergeContact(cleanContact(sample)));
  return { imported: samples.length };
}

function exportPublicShortlist(res, params) {
  const q = params.get("q") || "";
  const rows = listContacts(new URLSearchParams({ q })).contacts.slice(0, 50).map(({ contact, score, warmth }) => ({
    name: contact.name,
    title: first(contact.titles),
    organization: first(contact.orgs),
    location: first(contact.locations),
    fit: score.fit,
    warmth: warmth.bucket,
    consent: contact.consent,
    why: explainMatch(contact, q, score).join(" "),
    link: first(contact.links)
  }));
  const csv = toCsv(rows);
  res.writeHead(200, {
    "Content-Type": "text/csv",
    "Content-Disposition": `attachment; filename="network-radar-shortlist-${dateStamp()}.csv"`
  });
  res.end(csv);
}

function scoreContact(contact, query, evidenceHits = 0) {
  const terms = tokenize(query);
  if (!terms.length) return { fit: 100, hits: [] };
  const fields = [
    ["name", contact.name, 8], ["title", contact.titles.join(" "), 10], ["organization", contact.orgs.join(" "), 8],
    ["location", contact.locations.join(" "), 6], ["tag", contact.tags.join(" "), 12], ["bio", contact.bio, 6],
    ["note", contact.notes, 5], ["evidence", contact.evidence.map((e) => e.text).join(" "), 3]
  ];
  let raw = 0;
  const hits = [];
  fields.forEach(([field, value, weight]) => {
    const text = normalizeText(value);
    const tokens = tokenize(text);
    terms.forEach((term) => {
      if (tokens.includes(term) && !isNegated(text, term)) {
        raw += weight;
        hits.push(`${field}: ${term}`);
      }
    });
    const phrase = normalizeText(query);
    if (phrase.includes(" ") && text.includes(phrase) && !isNegated(text, phrase)) {
      raw += weight * 2;
      hits.push(`${field}: ${phrase}`);
    }
  });
  if (evidenceHits > 0) {
    raw += Math.min(24, evidenceHits * 4);
    hits.push(`evidence: ${evidenceHits} match${evidenceHits === 1 ? "" : "es"}`);
  }
  return { fit: Math.min(100, Math.round(raw)), hits: unique(hits).slice(0, 12) };
}

function warmthProfile(contact) {
  const gmail = contact.warmth.gmail || { sent: 0, received: 0, last: "" };
  const linkedin = contact.warmth.linkedin || { messages: 0, last: "" };
  const last = latestDate(gmail.last, linkedin.last);
  const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
  let points = Math.min(45, gmail.sent * 5) + Math.min(20, gmail.received * 1.5) + Math.min(20, linkedin.messages * 4);
  if (contact.warmth.contacts?.present) points += 5;
  if (days < 45) points += 25;
  else if (days < 180) points += 14;
  else if (days < 540) points += 6;
  points = Math.min(100, Math.round(points));
  if (points >= 75) return { points, bucket: "Active", last };
  if (points >= 45) return { points, bucket: "Recent", last };
  if (points >= 15) return { points, bucket: "Cool", last };
  return { points, bucket: "Cold", last };
}

function explainMatch(contact, query, score) {
  const warmth = warmthProfile(contact);
  return [
    score.hits.length ? `Matched ${score.hits.slice(0, 6).join(", ")}.` : "",
    `Warmth is ${warmth.bucket}: ${contact.warmth.gmail?.sent || 0} sent Gmail, ${contact.warmth.gmail?.received || 0} received Gmail, ${contact.warmth.linkedin?.messages || 0} LinkedIn messages.`,
    contact.consent === "do-not-share" ? "Consent gate: marked do not share." : "",
    contact.consent === "ask-first" ? "Consent gate: ask before sharing externally." : ""
  ].filter(Boolean);
}

function cleanContact(input) {
  const contact = {
    id: input.id || "",
    name: String(input.name || "").trim(),
    emails: unique((input.emails || []).flatMap(extractEmails)),
    phones: unique(input.phones || []),
    orgs: unique(input.orgs || []),
    titles: unique(input.titles || []),
    locations: unique(input.locations || []),
    links: unique(input.links || []),
    bio: String(input.bio || "").trim(),
    notes: String(input.notes || "").trim(),
    tags: unique(input.tags || []),
    sources: { google: false, gmail: false, linkedin: false, ...(input.sources || {}) },
    consent: input.consent || "unknown",
    warmth: { ...defaultWarmth(), ...(input.warmth || {}) },
    embedding: input.embedding || [],
    evidence: input.evidence || [],
    shortlisted: Boolean(input.shortlisted)
  };
  contact.tags = unique([...contact.tags, ...inferTags(contact)]);
  contact.id = contact.id || `person-${sha(first(contact.links) || first(contact.emails) || `${contact.name}-${first(contact.orgs)}`).slice(0, 20)}`;
  return contact;
}

function defaultWarmth() {
  return { gmail: { sent: 0, received: 0, last: "" }, linkedin: { messages: 0, connectedOn: "", last: "" }, contacts: { present: false } };
}

function mergeWarmth(a = defaultWarmth(), b = defaultWarmth()) {
  return {
    gmail: {
      sent: Number(a.gmail?.sent || 0) + Number(b.gmail?.sent || 0),
      received: Number(a.gmail?.received || 0) + Number(b.gmail?.received || 0),
      last: latestDate(a.gmail?.last, b.gmail?.last)
    },
    linkedin: {
      messages: Number(a.linkedin?.messages || 0) + Number(b.linkedin?.messages || 0),
      connectedOn: a.linkedin?.connectedOn || b.linkedin?.connectedOn || "",
      last: latestDate(a.linkedin?.last, b.linkedin?.last)
    },
    contacts: { present: Boolean(a.contacts?.present || b.contacts?.present) }
  };
}

function inferTags(contact) {
  const lexicon = ["AI", "ICT4D", "M&E", "MEL", "digital health", "global health", "community health", "fundraising", "grants", "philanthropy", "USAID", "UNICEF", "data quality", "safeguarding", "community accountability", "humanitarian", "education", "climate", "gender", "agriculture", "CRM", "Salesforce", "DHIS2", "open source", "Spanish", "French", "francophone", "Colombia", "Kenya", "Nigeria", "Uganda", "Ethiopia", "India", "Nairobi", "Bogota", "Washington"];
  const corpus = normalizeText(contactCorpus(contact));
  return lexicon.filter((tag) => hasConcept(corpus, tag) && !isNegated(corpus, normalizeText(tag)));
}

function contactCorpus(contact) {
  return [contact.name, contact.emails?.join(" "), contact.orgs?.join(" "), contact.titles?.join(" "), contact.locations?.join(" "), contact.bio, contact.notes, contact.tags?.join(" "), contact.evidence?.map((e) => e.text).join(" ")].join(" ");
}

async function googleFetch(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Google API failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function postForm(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) throw new Error(`OAuth request failed: ${response.status} ${await response.text()}`);
  return response.json();
}

function requireGoogleConfig() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first.");
  }
}

function googleRedirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || `http://127.0.0.1:${PORT}/auth/google/callback`;
}

function chromePath() {
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return fs.existsSync(mac) ? mac : undefined;
}

function recordImport(source, detail, imported) {
  db.prepare("INSERT INTO imports (id, source, detail, imported_count) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), source, detail, imported);
}

function serveStatic(res, pathname) {
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  const full = path.join(__dirname, file);
  const types = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".png": "image/png" };
  res.writeHead(200, { "Content-Type": types[path.extname(full)] || "text/plain" });
  fs.createReadStream(full).pipe(res);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function json(res, body, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

function notFound(res) {
  json(res, { error: "Not found" }, 404);
}

function extractEmails(text) {
  return unique((String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((email) => email.toLowerCase()));
}

function displayNameForEmail(email, text) {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text || "").match(new RegExp(`([^,<"]+?)\\s*<?${escaped}>?`, "i"));
  return match ? match[1].replace(/["']/g, "").trim() : "";
}

function tokenize(text) {
  return unique((String(text || "").match(/[a-z0-9+#&]+(?:[./-][a-z0-9+#&]+)*/gi) || []).map((token) => token.toLowerCase()).filter((token) => token.length > 1));
}

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}+#&./-]+/gu, " ").replace(/\s+/g, " ").trim();
}

function isNegated(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(no|not|without|non)\\b(?:\\s+[a-z0-9+#&./-]+){0,3}\\s+${escaped}\\b`, "i").test(text);
}

function hasConcept(corpus, topic) {
  const normalized = normalizeText(topic);
  if (!normalized) return false;
  if (normalized.includes(" ")) return corpus.includes(normalized);
  return tokenize(corpus).includes(normalized);
}

function latestDate(a, b) {
  const da = a ? new Date(a) : null;
  const db = b ? new Date(b) : null;
  if (!da || Number.isNaN(da.getTime())) return b || "";
  if (!db || Number.isNaN(db.getTime())) return a || "";
  return da > db ? a : b;
}

function normalizeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function normalizeLink(link) {
  return String(link || "").replace(/\/$/, "").toLowerCase();
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(","))].join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function unique(values) {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function first(values) {
  return (values || []).find(Boolean) || "";
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function j(value) {
  return JSON.stringify(value ?? null);
}

function sha(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
