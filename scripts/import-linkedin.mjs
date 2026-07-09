import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "network-radar.sqlite");

const args = parseArgs(process.argv.slice(2));
if (!args.connections && !args.messages) {
  console.error("Usage: npm run import:linkedin -- --connections /path/Connections.csv --messages /path/messages.csv");
  process.exit(1);
}

await fsp.mkdir(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
initDb();

let connectionRows = 0;
let messageRows = 0;
const seenContacts = new Set();

if (args.connections) {
  const rows = parseLinkedInCsv(await fsp.readFile(args.connections, "utf8"));
  connectionRows = rows.length;
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const contact = cleanContact({
        name: [row["First Name"], row["Last Name"]].filter(Boolean).join(" ") || row.Name || "",
        emails: extractEmails(row["Email Address"]),
        orgs: splitList(row.Company),
        titles: row.Position ? [row.Position] : [],
        links: splitList(row.URL),
        bio: [row.Position, row.Company].filter(Boolean).join(". "),
        sources: { linkedin: true },
        warmth: { linkedin: { messages: 0, connectedOn: row["Connected On"] || "", last: "" } },
        evidence: [{ source: "LinkedIn connection export", text: `Connected on ${row["Connected On"] || "unknown date"}.` }]
      });
      mergeContact(contact);
      seenContacts.add(contact.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

if (args.messages) {
  const rows = parseLinkedInCsv(await fsp.readFile(args.messages, "utf8"));
  messageRows = rows.length;
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      for (const participant of participantsFromMessage(row)) {
        if (isSelf(participant.name, participant.url)) continue;
        const contact = cleanContact({
          name: participant.name,
          links: participant.url ? [participant.url] : [],
          bio: [row["CONVERSATION TITLE"], row.SUBJECT].filter(Boolean).join(". "),
          sources: { linkedin: true },
          warmth: { linkedin: { messages: 1, connectedOn: "", last: normalizeDate(row.DATE) } },
          evidence: [{
            source: "LinkedIn message export",
            text: `${row["CONVERSATION TITLE"] || "Conversation"}: ${snippet(row.CONTENT || row.SUBJECT || "Message metadata imported.")}`
          }]
        });
        mergeContact(contact);
        seenContacts.add(contact.id);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

recordImport("linkedin-export", [args.connections, args.messages].filter(Boolean).join(" | "), seenContacts.size);

console.log(JSON.stringify({
  dbPath: DB_PATH,
  connectionRows,
  messageRows,
  contactsTouched: seenContacts.size,
  totalContacts: db.prepare("SELECT COUNT(*) AS count FROM contacts").get().count
}, null, 2));

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

function parseLinkedInCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const firstCsvLine = lines.findIndex((line) => line.includes(",") && !line.startsWith("Notes:") && !line.startsWith("\"When exporting"));
  return parseCsv(lines.slice(Math.max(0, firstCsvLine)).join("\n"));
}

function parseCsv(text) {
  const matrix = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "\"" && quoted && next === "\"") {
      value += "\"";
      i += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      matrix.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    matrix.push(row);
  }
  const headers = (matrix.shift() || []).map((header) => header.trim());
  return matrix.map((cells) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = (cells[index] || "").trim();
    });
    return obj;
  }).filter((obj) => Object.values(obj).some(Boolean));
}

function participantsFromMessage(row) {
  const names = splitPeople([row.FROM, row.TO].filter(Boolean).join(","));
  const urls = splitPeople([row["SENDER PROFILE URL"], row["RECIPIENT PROFILE URLS"]].filter(Boolean).join(","));
  return names.map((name, index) => ({ name, url: urls[index] || "" }));
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
    bio: snippet(unique([existing.bio, incoming.bio]).join(" "), 2000),
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
  const email = contact.emails[0] || "";
  if (email) {
    const rows = db.prepare("SELECT * FROM contacts WHERE emails_json LIKE ?").all(`%${email}%`).map(rowToContact);
    const match = rows.find((row) => row.emails.includes(email));
    if (match) return match;
  }
  for (const link of contact.links) {
    const rows = db.prepare("SELECT * FROM contacts WHERE links_json LIKE ?").all(`%${normalizeLink(link)}%`).map(rowToContact);
    const match = rows.find((row) => row.links.map(normalizeLink).includes(normalizeLink(link)));
    if (match) return match;
  }
  const nameOrg = normalizeText(`${contact.name} ${first(contact.orgs)}`);
  if (!nameOrg) return null;
  const rows = db.prepare("SELECT * FROM contacts WHERE name = ?").all(contact.name).map(rowToContact);
  return rows.find((row) => normalizeText(`${row.name} ${first(row.orgs)}`) === nameOrg) || null;
}

function writeContact(contact) {
  db.prepare(`
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
  `).run(
    contact.id, contact.name, j(contact.emails), j(contact.phones), j(contact.orgs), j(contact.titles),
    j(contact.locations), j(contact.links), contact.bio, contact.notes, j(contact.tags), j(contact.sources),
    contact.consent, j(contact.warmth), j(contact.embedding || []), contact.shortlisted ? 1 : 0,
    new Date().toISOString()
  );
}

function writeEvidence(contactId, evidence) {
  const stmt = db.prepare("INSERT OR IGNORE INTO evidence (id, contact_id, source, text) VALUES (?, ?, ?, ?)");
  evidence.forEach((item) => {
    stmt.run(sha(`${contactId}:${item.source}:${item.text}`), contactId, item.source || "Unknown", item.text || "");
  });
}

function rowToContact(row) {
  return {
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
    shortlisted: Boolean(row.shortlisted)
  };
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
  const corpus = normalizeText([contact.name, contact.bio, contact.notes, contact.orgs.join(" "), contact.titles.join(" "), contact.locations.join(" ")].join(" "));
  return lexicon.filter((tag) => hasConcept(corpus, tag) && !isNegated(corpus, normalizeText(tag)));
}

function hasConcept(corpus, topic) {
  const normalized = normalizeText(topic);
  if (!normalized) return false;
  if (normalized.includes(" ")) return corpus.includes(normalized);
  return tokenize(corpus).includes(normalized);
}

function recordImport(source, detail, imported) {
  db.prepare("INSERT INTO imports (id, source, detail, imported_count) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), source, detail, imported);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      out[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function extractEmails(text) {
  return unique((String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((email) => email.toLowerCase()));
}

function splitList(text) {
  return String(text || "").split(/[;|]/).map((item) => item.trim()).filter(Boolean);
}

function splitPeople(text) {
  return String(text || "").split(/[;,|]/).map((item) => item.trim()).filter(Boolean);
}

function isSelf(name, url) {
  return normalizeText(name) === "wayan vota" || normalizeLink(url).includes("linkedin.com/in/wayan");
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

function snippet(text, length = 220) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length - 3)}...` : clean;
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
