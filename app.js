const DB_NAME = "network-radar";
const DB_VERSION = 1;
const STORE = "state";

const SAMPLE_CONTACTS = [
  {
    id: "sample-ana",
    name: "Ana Morales",
    emails: ["ana.morales@example.org"],
    orgs: ["Salud Comunitaria Colombia"],
    titles: ["Digital health implementation lead"],
    locations: ["Bogota, Colombia"],
    links: ["https://www.linkedin.com/in/ana-morales-example"],
    bio: "Ships community health tools with CHWs, M&E routines, DHIS2 integrations, and Spanish-language training.",
    notes: "Strong fit for practical digital health and Colombia work. Ask before sharing email.",
    tags: ["digital health", "colombia", "M&E", "community health", "Spanish"],
    sources: { google: true, linkedin: true, gmail: true },
    consent: "ask-first",
    warmth: {
      gmail: { sent: 7, received: 11, last: "2026-06-24" },
      linkedin: { messages: 2, connectedOn: "2024-02-09", last: "2026-05-12" },
      contacts: { present: true }
    },
    evidence: [
      { source: "LinkedIn", text: "Position mentions digital health implementation and CHW systems in Colombia." },
      { source: "Gmail", text: "Recent exchange about M&E dashboard rollout and partner training." }
    ],
    shortlisted: false
  },
  {
    id: "sample-james",
    name: "James Okello",
    emails: ["james.okello@example.net"],
    orgs: ["Open Learning Africa"],
    titles: ["Monitoring, evaluation, and learning director"],
    locations: ["Nairobi, Kenya"],
    links: [],
    bio: "Leads MEL and adaptive learning for education and youth livelihood programs across East Africa.",
    notes: "High evaluator fit, weaker digital health fit.",
    tags: ["M&E", "MEL", "education", "youth livelihoods", "East Africa"],
    sources: { google: true, linkedin: true, gmail: false },
    consent: "unknown",
    warmth: {
      gmail: { sent: 0, received: 0, last: "" },
      linkedin: { messages: 0, connectedOn: "2022-11-18", last: "" },
      contacts: { present: true }
    },
    evidence: [{ source: "LinkedIn", text: "Profile centers on monitoring, evaluation, learning, and adaptive management." }],
    shortlisted: false
  },
  {
    id: "sample-lina",
    name: "Lina Haddad",
    emails: ["lina.haddad@example.com"],
    orgs: ["Humanitarian Feedback Lab"],
    titles: ["Community accountability specialist"],
    locations: ["Amman, Jordan"],
    links: [],
    bio: "Works on community feedback mechanisms, humanitarian accountability, safeguarding, and qualitative field research.",
    notes: "Good for accountability, not digital health.",
    tags: ["community accountability", "humanitarian", "safeguarding", "qualitative research"],
    sources: { google: false, linkedin: true, gmail: true },
    consent: "share-ok",
    warmth: {
      gmail: { sent: 3, received: 5, last: "2026-04-08" },
      linkedin: { messages: 1, connectedOn: "2021-07-10", last: "2025-12-03" },
      contacts: { present: false }
    },
    evidence: [{ source: "Gmail", text: "Thread subject: community feedback case study and safeguarding review." }],
    shortlisted: false
  },
  {
    id: "sample-maya",
    name: "Maya Chen",
    emails: ["maya.chen@example.org"],
    orgs: ["Grant Systems Lab"],
    titles: ["AI grants operations advisor"],
    locations: ["Washington, DC"],
    links: [],
    bio: "Focuses on AI-assisted grants, funder operations, CRM cleanup, and nonprofit data workflows.",
    notes: "Useful for funder AI, not Colombia.",
    tags: ["AI", "fundraising", "grants", "CRM", "nonprofit operations"],
    sources: { google: true, linkedin: false, gmail: true },
    consent: "share-ok",
    warmth: {
      gmail: { sent: 14, received: 19, last: "2026-07-01" },
      linkedin: { messages: 0, connectedOn: "", last: "" },
      contacts: { present: true }
    },
    evidence: [{ source: "Gmail", text: "Multiple recent planning threads about AI grants operations and CRM data quality." }],
    shortlisted: false
  }
];

const TOPIC_LEXICON = [
  "AI", "ICT4D", "M&E", "MEL", "digital health", "global health", "community health", "fundraising",
  "grants", "philanthropy", "USAID", "World Bank", "UNICEF", "data quality", "safeguarding",
  "community accountability", "humanitarian", "education", "climate", "gender", "agriculture",
  "CRM", "Salesforce", "DHIS2", "open source", "Spanish", "French", "francophone", "Colombia",
  "Kenya", "Nigeria", "Uganda", "Ethiopia", "India", "Nairobi", "Bogota", "Washington"
];

const state = {
  contacts: [],
  serverAvailable: false,
  query: "digital health Colombia M&E",
  filters: {
    org: "",
    location: "",
    topic: "",
    minWarmth: 0,
    consentGate: false
  },
  aliases: [],
  selectedId: "",
  currentImportKind: ""
};

const el = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  bindEvents();
  await loadState();
  await loadServerContacts();
  render();
});

function bindElements() {
  [
    "queryInput", "saveSearchBtn", "loadSampleBtn", "exportDbBtn", "clearBtn", "totalCount",
    "googleCount", "linkedinCount", "gmailCount", "fileInput", "orgFilter", "locationFilter",
    "topicFilter", "warmthFilter", "consentGate", "aliasInput", "resetFiltersBtn",
    "resultsList", "resultSummary", "detailPanel", "googleAuthBtn", "openToolsBtn", "toolsPanel",
    "syncGoogleBtn", "syncGmailBtn", "enrichBtn", "linkedinSearchBtn", "serverStatus"
  ].forEach((id) => {
    el[id] = document.getElementById(id);
  });
}

function bindEvents() {
  el.queryInput.addEventListener("input", () => {
    state.query = el.queryInput.value;
    renderResults();
  });

  ["orgFilter", "locationFilter", "topicFilter"].forEach((id) => {
    el[id].addEventListener("input", () => {
      state.filters[id.replace("Filter", "")] = el[id].value;
      renderResults();
    });
  });

  el.warmthFilter.addEventListener("change", () => {
    state.filters.minWarmth = Number(el.warmthFilter.value);
    renderResults();
  });

  el.consentGate.addEventListener("change", () => {
    state.filters.consentGate = el.consentGate.checked;
    renderResults();
  });

  el.aliasInput.addEventListener("change", async () => {
    state.aliases = splitList(el.aliasInput.value).map((v) => v.toLowerCase());
    await persist();
    toast("Email aliases saved.");
  });

  document.querySelectorAll("[data-import]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentImportKind = button.dataset.import;
      el.fileInput.value = "";
      el.fileInput.accept = state.currentImportKind === "gmail" ? ".mbox,.txt,.csv" : ".csv,.vcf,.txt";
      el.fileInput.click();
    });
  });

  el.fileInput.addEventListener("change", handleFiles);
  el.loadSampleBtn.addEventListener("click", loadSample);
  el.exportDbBtn.addEventListener("click", exportDatabase);
  el.saveSearchBtn.addEventListener("click", exportShortlist);
  el.resetFiltersBtn.addEventListener("click", resetFilters);
  el.googleAuthBtn.addEventListener("click", () => {
    window.location.href = "/auth/google/start";
  });
  el.openToolsBtn.addEventListener("click", () => {
    el.toolsPanel.hidden = !el.toolsPanel.hidden;
  });
  el.syncGoogleBtn.addEventListener("click", () => serverAction("/api/google/sync-contacts", {}, "Google Contacts synced."));
  el.syncGmailBtn.addEventListener("click", () => {
    const query = window.prompt("Gmail query", "newer_than:365d");
    if (query !== null) serverAction("/api/google/sync-gmail", { query, max: 300 }, "Gmail synced.");
  });
  el.enrichBtn.addEventListener("click", () => serverAction("/api/openai/enrich", { limit: 50 }, "OpenAI enrichment complete."));
  el.linkedinSearchBtn.addEventListener("click", () => {
    const query = window.prompt("LinkedIn people search", state.query || "digital health Colombia");
    if (query) serverAction("/api/linkedin/search", { query, loginWaitMs: 12000 }, "LinkedIn search imported.");
  });

  el.clearBtn.addEventListener("click", async () => {
    if (!window.confirm("Clear all locally stored Network Radar data?")) return;
    if (state.serverAvailable) await fetchJson("/api/contacts", { method: "DELETE" });
    state.contacts = [];
    state.selectedId = "";
    await persist();
    render();
    toast("Local database cleared.");
  });
}

async function handleFiles(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  let added = 0;
  const allImported = [];
  for (const file of files) {
    const text = await file.text();
    let imported = [];
    if (state.currentImportKind === "contacts") imported = parseGoogleContacts(text, file.name);
    if (state.currentImportKind === "linkedin") imported = parseLinkedIn(text, file.name);
    if (state.currentImportKind === "gmail") imported = parseGmail(text, file.name);
    added += imported.length;
    allImported.push(...imported);
    mergeContacts(imported);
  }
  enrichAll();
  await persist();
  await pushContactsToServer(allImported);
  render();
  toast(`Imported ${added} records from ${files.length} file${files.length === 1 ? "" : "s"}.`);
}

async function loadServerContacts() {
  try {
    const health = await fetchJson("/api/health");
    state.serverAvailable = true;
    if (el.serverStatus) el.serverStatus.textContent = health.googleAuthorized ? "Google ready" : "Local ready";
    const data = await fetchJson(`/api/contacts?q=${encodeURIComponent(state.query)}`);
    if (data.contacts?.length) state.contacts = data.contacts.map((row) => cleanContact(row.contact));
  } catch {
    state.serverAvailable = false;
    if (el.serverStatus) el.serverStatus.textContent = "Static only";
  }
}

async function pushContactsToServer(contacts) {
  if (!state.serverAvailable) return;
  for (const contact of contacts) {
    await fetchJson("/api/contacts", { method: "POST", body: JSON.stringify(contact) });
  }
}

async function serverAction(path, body, doneMessage) {
  try {
    await fetchJson(path, { method: "POST", body: JSON.stringify(body || {}) });
    await loadServerContacts();
    render();
    toast(doneMessage);
  } catch (error) {
    toast(error.message);
  }
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function parseGoogleContacts(text, fileName) {
  if (fileName.toLowerCase().endsWith(".vcf")) return parseVCard(text);
  const rows = parseCsv(text);
  return rows.map((row) => {
    const name = firstValue(row, ["Name", "Full Name", "Given Name"]) || [row["Given Name"], row["Family Name"]].filter(Boolean).join(" ");
    const emails = Object.entries(row)
      .filter(([key, value]) => key.toLowerCase().includes("email") && value)
      .flatMap(([, value]) => extractEmails(value));
    const phones = Object.entries(row)
      .filter(([key, value]) => key.toLowerCase().includes("phone") && value)
      .map(([, value]) => value.trim());
    const orgs = splitList(firstValue(row, ["Organization 1 - Name", "Organization", "Company"]));
    const titles = splitList(firstValue(row, ["Organization 1 - Title", "Job Title", "Title"]));
    const locations = splitList(firstValue(row, ["Address 1 - Formatted", "Location", "City"]));
    const notes = firstValue(row, ["Notes", "Note", "Biography", "Bio"]);
    return cleanContact({
      name,
      emails,
      phones,
      orgs,
      titles,
      locations,
      notes,
      bio: notes,
      links: [],
      sources: { google: true },
      warmth: { contacts: { present: true } },
      evidence: [{ source: "Google Contacts", text: "Imported from Google Contacts export." }]
    });
  }).filter((contact) => contact.name || contact.emails.length);
}

function parseVCard(text) {
  return text.split(/END:VCARD/i).map((card) => {
    const lines = card.split(/\r?\n/);
    const name = readVcf(lines, "FN") || readVcf(lines, "N").split(";").filter(Boolean).join(" ");
    const emails = lines.filter((line) => line.toUpperCase().startsWith("EMAIL")).flatMap(extractEmails);
    const phones = lines.filter((line) => line.toUpperCase().startsWith("TEL")).map((line) => valueAfterColon(line));
    const orgs = splitList(readVcf(lines, "ORG"));
    const titles = splitList(readVcf(lines, "TITLE"));
    const locations = splitList(readVcf(lines, "ADR").replace(/;/g, " "));
    const notes = readVcf(lines, "NOTE");
    return cleanContact({
      name,
      emails,
      phones,
      orgs,
      titles,
      locations,
      notes,
      bio: notes,
      sources: { google: true },
      warmth: { contacts: { present: true } },
      evidence: [{ source: "Google Contacts", text: "Imported from vCard export." }]
    });
  }).filter((contact) => contact.name || contact.emails.length);
}

function parseLinkedIn(text, fileName) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]).map((h) => h.toLowerCase());
  const looksLikeMessages = headers.some((h) => h.includes("content") || h.includes("message")) &&
    headers.some((h) => h === "from" || h.includes("sender"));
  return looksLikeMessages ? parseLinkedInMessages(rows) : parseLinkedInConnections(rows, fileName);
}

function parseLinkedInConnections(rows) {
  return rows.map((row) => {
    const first = firstValue(row, ["First Name", "FirstName"]);
    const last = firstValue(row, ["Last Name", "LastName"]);
    const name = firstValue(row, ["Name", "Full Name"]) || [first, last].filter(Boolean).join(" ");
    const company = firstValue(row, ["Company", "Current Company"]);
    const position = firstValue(row, ["Position", "Title", "Current Position"]);
    const url = firstValue(row, ["URL", "Profile URL", "LinkedIn Profile", "LinkedIn Profile URL"]);
    const connectedOn = firstValue(row, ["Connected On", "Connected"]);
    const email = firstValue(row, ["Email Address", "Email"]);
    return cleanContact({
      name,
      emails: extractEmails(email),
      orgs: splitList(company),
      titles: splitList(position),
      locations: splitList(firstValue(row, ["Location", "Geo Location"])),
      links: splitList(url),
      bio: [position, company, firstValue(row, ["Summary", "Description"])].filter(Boolean).join(". "),
      sources: { linkedin: true },
      warmth: { linkedin: { connectedOn, messages: 0, last: "" } },
      evidence: [{ source: "LinkedIn", text: `Imported connection${connectedOn ? ` connected on ${connectedOn}` : ""}.` }]
    });
  }).filter((contact) => contact.name || contact.links.length || contact.emails.length);
}

function parseLinkedInMessages(rows) {
  const contacts = [];
  rows.forEach((row) => {
    const from = firstValue(row, ["FROM", "From", "Sender", "Sender Name"]);
    const to = firstValue(row, ["TO", "To", "Recipients"]);
    const date = firstValue(row, ["DATE", "Date", "Sent Date"]);
    const content = firstValue(row, ["CONTENT", "Content", "Message", "Body"]);
    const participants = splitPeople([from, to].filter(Boolean).join(", "));
    participants.forEach((name) => {
      if (!name || isLikelySelf(name)) return;
      contacts.push(cleanContact({
        name,
        bio: content.slice(0, 220),
        sources: { linkedin: true },
        warmth: { linkedin: { messages: 1, connectedOn: "", last: normalizeDate(date) } },
        evidence: [{ source: "LinkedIn Message", text: snippet(content || "LinkedIn message exchange imported.") }]
      }));
    });
  });
  return contacts;
}

function parseGmail(text) {
  const chunks = text.includes("\nFrom ") ? text.split(/\nFrom /g) : text.split(/\n(?=From: )/g);
  const contacts = [];
  chunks.slice(0, 8000).forEach((chunk) => {
    const headers = readHeaders(chunk);
    const body = chunk.slice(Math.min(chunk.length, 2200));
    const from = headers.from || "";
    const to = [headers.to, headers.cc, headers.bcc].filter(Boolean).join(", ");
    const subject = headers.subject || "(no subject)";
    const date = normalizeDate(headers.date);
    const fromEmails = extractEmails(from);
    const toEmails = extractEmails(to);
    const allEmails = unique([...fromEmails, ...toEmails]).filter(Boolean);
    const sentByMe = fromEmails.some((email) => state.aliases.includes(email.toLowerCase()));
    allEmails.forEach((email) => {
      if (state.aliases.includes(email.toLowerCase())) return;
      const display = displayNameForEmail(email, from, to);
      contacts.push(cleanContact({
        name: display || email,
        emails: [email],
        bio: [subject, body].join(" "),
        sources: { gmail: true },
        warmth: {
          gmail: {
            sent: sentByMe ? 1 : 0,
            received: sentByMe ? 0 : 1,
            last: date
          }
        },
        evidence: [{ source: "Gmail", text: `Subject: ${subject}. ${snippet(body)}` }]
      }));
    });
  });
  return contacts;
}

function parseCsv(text) {
  const rows = [];
  const matrix = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
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
  const headers = (matrix.shift() || []).map((h) => h.trim());
  matrix.forEach((cells) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = (cells[index] || "").trim();
    });
    if (Object.values(obj).some(Boolean)) rows.push(obj);
  });
  return rows;
}

function mergeContacts(imported) {
  imported.forEach((incoming) => {
    if (!incoming.name && !incoming.emails.length) return;
    const key = findExistingKey(incoming);
    if (key) {
      const existing = state.contacts.find((contact) => contact.id === key);
      mergeContact(existing, incoming);
    } else {
      incoming.id = incoming.id || makeId(incoming);
      state.contacts.push(incoming);
    }
  });
}

function findExistingKey(contact) {
  const emailSet = new Set(contact.emails.map((email) => email.toLowerCase()));
  const linkSet = new Set(contact.links.map(normalizeLink));
  const nameKey = normalizeText([contact.name, first(contact.orgs)].filter(Boolean).join(" "));
  const match = state.contacts.find((existing) => {
    if (existing.emails.some((email) => emailSet.has(email.toLowerCase()))) return true;
    if (existing.links.some((link) => linkSet.has(normalizeLink(link)))) return true;
    const existingNameKey = normalizeText([existing.name, first(existing.orgs)].filter(Boolean).join(" "));
    return nameKey && existingNameKey && nameKey === existingNameKey;
  });
  return match ? match.id : "";
}

function mergeContact(target, incoming) {
  target.name = target.name || incoming.name;
  target.emails = unique([...target.emails, ...incoming.emails]);
  target.phones = unique([...target.phones, ...incoming.phones]);
  target.orgs = unique([...target.orgs, ...incoming.orgs]);
  target.titles = unique([...target.titles, ...incoming.titles]);
  target.locations = unique([...target.locations, ...incoming.locations]);
  target.links = unique([...target.links, ...incoming.links]);
  target.tags = unique([...target.tags, ...incoming.tags]);
  target.bio = [target.bio, incoming.bio].filter(Boolean).join(" ");
  target.notes = [target.notes, incoming.notes].filter(Boolean).join("\n");
  target.consent = target.consent === "unknown" ? incoming.consent : target.consent;
  target.sources = { ...target.sources, ...incoming.sources };
  target.evidence = [...target.evidence, ...incoming.evidence].slice(-30);
  mergeWarmth(target.warmth, incoming.warmth);
}

function mergeWarmth(target, incoming) {
  target.gmail = target.gmail || { sent: 0, received: 0, last: "" };
  target.linkedin = target.linkedin || { messages: 0, connectedOn: "", last: "" };
  target.contacts = target.contacts || { present: false };
  if (incoming.gmail) {
    target.gmail.sent += Number(incoming.gmail.sent || 0);
    target.gmail.received += Number(incoming.gmail.received || 0);
    target.gmail.last = latestDate(target.gmail.last, incoming.gmail.last);
  }
  if (incoming.linkedin) {
    target.linkedin.messages += Number(incoming.linkedin.messages || 0);
    target.linkedin.connectedOn = target.linkedin.connectedOn || incoming.linkedin.connectedOn || "";
    target.linkedin.last = latestDate(target.linkedin.last, incoming.linkedin.last);
  }
  if (incoming.contacts) target.contacts.present = target.contacts.present || Boolean(incoming.contacts.present);
}

function enrichAll() {
  state.contacts.forEach((contact) => {
    contact.tags = unique([...contact.tags, ...inferTags(contact)]);
    contact.updatedAt = new Date().toISOString();
  });
}

function inferTags(contact) {
  const corpus = normalizeText([
    contact.name, contact.bio, contact.notes, contact.orgs.join(" "), contact.titles.join(" "), contact.locations.join(" ")
  ].join(" "));
  return TOPIC_LEXICON.filter((topic) => {
    const normalizedTopic = normalizeText(topic);
    return hasConcept(corpus, topic) && !isNegated(corpus, normalizedTopic);
  });
}

function render() {
  el.queryInput.value = state.query;
  el.orgFilter.value = state.filters.org;
  el.locationFilter.value = state.filters.location;
  el.topicFilter.value = state.filters.topic;
  el.warmthFilter.value = String(state.filters.minWarmth);
  el.consentGate.checked = state.filters.consentGate;
  el.aliasInput.value = state.aliases.join(", ");
  renderCounts();
  renderResults();
}

function renderCounts() {
  el.totalCount.textContent = `${state.contacts.length} people`;
  el.googleCount.textContent = String(state.contacts.filter((c) => c.sources.google).length);
  el.linkedinCount.textContent = String(state.contacts.filter((c) => c.sources.linkedin).length);
  el.gmailCount.textContent = String(state.contacts.filter((c) => c.sources.gmail).length);
}

function renderResults() {
  const scored = getScoredContacts();
  el.resultSummary.textContent = scored.length
    ? `${scored.length} matches from ${state.contacts.length} people.`
    : state.contacts.length ? "No matches. Try loosening the query or filters." : "No contacts loaded yet.";
  el.resultsList.innerHTML = "";
  scored.slice(0, 120).forEach(({ contact, score }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `result-card${contact.id === state.selectedId ? " active" : ""}`;
    button.innerHTML = resultTemplate(contact, score);
    button.addEventListener("click", () => {
      state.selectedId = contact.id;
      renderResults();
      renderDetail(contact, score);
    });
    el.resultsList.appendChild(button);
  });

  if (!scored.length) {
    state.selectedId = "";
    renderEmptyDetail();
    return;
  }

  const scoredIds = new Set(scored.map(({ contact }) => contact.id));
  const selected = state.contacts.find((contact) => contact.id === state.selectedId && scoredIds.has(contact.id));
  if (!selected && scored[0]) {
    state.selectedId = scored[0].contact.id;
    renderResults();
    return;
  }
  if (selected) renderDetail(selected, scoreContact(selected, state.query));
}

function resultTemplate(contact, score) {
  const title = [first(contact.titles), first(contact.orgs)].filter(Boolean).join(", ");
  const location = first(contact.locations);
  const warmth = warmthProfile(contact);
  const chips = unique([...contact.tags.slice(0, 5), ...Object.keys(contact.sources).filter((s) => contact.sources[s])]);
  return `
    <div class="result-top">
      <div>
        <div class="person-name">${escapeHtml(contact.name || first(contact.emails) || "Unnamed contact")}</div>
        <div class="person-meta">${escapeHtml([title, location].filter(Boolean).join(" - "))}</div>
      </div>
      <div class="chip">${warmth.bucket}</div>
    </div>
    <div class="score-grid">
      <div class="metric">
        <label>Fit ${score.fit}</label>
        <div class="bar"><span style="width:${score.fit}%"></span></div>
      </div>
      <div class="metric">
        <label>Warmth ${warmth.points}</label>
        <div class="bar warm"><span style="width:${Math.min(100, warmth.points)}%"></span></div>
      </div>
    </div>
    <div class="chip-row">${chips.map((chip) => `<span class="chip ${["google", "gmail", "linkedin"].includes(chip) ? "source" : ""}">${escapeHtml(chip)}</span>`).join("")}</div>
  `;
}

function renderDetail(contact, score) {
  const warmth = warmthProfile(contact);
  const evidence = explainMatch(contact, state.query, score);
  el.detailPanel.innerHTML = `
    <div class="detail-stack">
      <div class="detail-header">
        <div>
          <div class="detail-name">${escapeHtml(contact.name || first(contact.emails) || "Unnamed contact")}</div>
          <div class="detail-meta">${escapeHtml([first(contact.titles), first(contact.orgs), first(contact.locations)].filter(Boolean).join(" - "))}</div>
        </div>
        <button id="toggleShortlistBtn" class="button ${contact.shortlisted ? "primary" : "secondary"}" type="button">${contact.shortlisted ? "Saved" : "Save"}</button>
      </div>

      <section class="detail-section">
        <h2>Why this match</h2>
        <div class="score-grid">
          <div class="metric"><label>Fit ${score.fit}</label><div class="bar"><span style="width:${score.fit}%"></span></div></div>
          <div class="metric"><label>Warmth ${warmth.points}</label><div class="bar warm"><span style="width:${Math.min(100, warmth.points)}%"></span></div></div>
        </div>
        <div class="evidence-list">${evidence.map((item) => `<div class="evidence-item">${escapeHtml(item)}</div>`).join("")}</div>
      </section>

      <section class="detail-section">
        <h2>Warmth</h2>
        <div class="warmth-grid">
          <div class="warmth-tile"><span>Gmail sent</span><strong>${contact.warmth.gmail.sent}</strong></div>
          <div class="warmth-tile"><span>Gmail received</span><strong>${contact.warmth.gmail.received}</strong></div>
          <div class="warmth-tile"><span>LinkedIn messages</span><strong>${contact.warmth.linkedin.messages}</strong></div>
          <div class="warmth-tile"><span>Last touched</span><strong>${escapeHtml(warmth.last || "None")}</strong></div>
        </div>
      </section>

      <section class="detail-section">
        <h2>Consent</h2>
        <select id="consentSelect" class="consent-select">
          ${consentOption("unknown", contact.consent, "Unknown")}
          ${consentOption("ask-first", contact.consent, "Ask first")}
          ${consentOption("share-ok", contact.consent, "Share OK")}
          ${consentOption("do-not-share", contact.consent, "Do not share")}
        </select>
      </section>

      <section class="detail-section">
        <h2>Interests</h2>
        <div class="chip-row">${contact.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("") || "<span class='small-copy'>No tags yet.</span>"}</div>
      </section>

      <section class="detail-section">
        <h2>Evidence</h2>
        <div class="evidence-list">${contact.evidence.slice(-8).reverse().map((item) => `<div class="evidence-item"><strong>${escapeHtml(item.source)}:</strong> ${escapeHtml(item.text)}</div>`).join("")}</div>
      </section>

      <section class="detail-section">
        <h2>Private note</h2>
        <textarea id="noteEditor" class="note-editor" placeholder="Add correction, caveat, or sharing rule.">${escapeHtml(contact.notes || "")}</textarea>
      </section>

      <section class="detail-section small-copy">
        <div><span class="field-label">Emails</span><br>${escapeHtml(contact.emails.join(", ") || "None")}</div>
        <div><span class="field-label">Links</span><br>${contact.links.map((link) => `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(link)}</a>`).join("<br>") || "None"}</div>
      </section>
    </div>
  `;

  document.getElementById("toggleShortlistBtn").addEventListener("click", async () => {
    contact.shortlisted = !contact.shortlisted;
    await persist();
    renderResults();
  });
  document.getElementById("consentSelect").addEventListener("change", async (event) => {
    contact.consent = event.target.value;
    await persist();
    renderResults();
  });
  document.getElementById("noteEditor").addEventListener("change", async (event) => {
    contact.notes = event.target.value;
    contact.tags = unique([...contact.tags, ...inferTags(contact)]);
    await persist();
    renderResults();
    toast("Note saved.");
  });
}

function renderEmptyDetail() {
  el.detailPanel.innerHTML = `
    <div class="empty-state">
      <h2>Evidence</h2>
      <p>Select a person to inspect why they matched, where the signals came from, and whether they are safe to share.</p>
    </div>
  `;
}

function getScoredContacts() {
  return state.contacts
    .filter(passesFilters)
    .map((contact) => ({ contact, score: scoreContact(contact, state.query) }))
    .filter(({ score }) => score.fit > 0 || !state.query.trim())
    .sort((a, b) => (b.score.fit - a.score.fit) || (warmthProfile(b.contact).points - warmthProfile(a.contact).points));
}

function passesFilters(contact) {
  if (state.filters.consentGate && contact.consent === "do-not-share") return false;
  if (state.filters.minWarmth && warmthProfile(contact).level < state.filters.minWarmth) return false;
  const corpus = normalizeText(contactCorpus(contact));
  return ["org", "location", "topic"].every((key) => {
    const filter = normalizeText(state.filters[key]);
    return !filter || corpus.includes(filter);
  });
}

function scoreContact(contact, query) {
  const q = expandQuery(query);
  if (!q.terms.length && !q.phrases.length) return { fit: 100, hits: [] };
  const weighted = [
    { text: contact.name, weight: 8, field: "name" },
    { text: contact.titles.join(" "), weight: 10, field: "title" },
    { text: contact.orgs.join(" "), weight: 8, field: "organization" },
    { text: contact.locations.join(" "), weight: 6, field: "location" },
    { text: contact.tags.join(" "), weight: 12, field: "tag" },
    { text: contact.bio, weight: 6, field: "bio" },
    { text: contact.notes, weight: 5, field: "note" },
    { text: contact.evidence.map((e) => e.text).join(" "), weight: 3, field: "evidence" }
  ];
  let raw = 0;
  const hits = [];
  weighted.forEach((field) => {
    const text = normalizeText(field.text || "");
    q.phrases.forEach((phrase) => {
      if (phrase && text.includes(phrase) && !isNegated(text, phrase)) {
        raw += field.weight * 2.2;
        hits.push(`${field.field}: ${phrase}`);
      }
    });
    const tokens = tokenize(text);
    q.terms.forEach((term) => {
      if (tokens.includes(term) && !isNegated(text, term)) {
        raw += field.weight;
        hits.push(`${field.field}: ${term}`);
      }
    });
  });
  const fit = Math.min(100, Math.round(raw));
  return { fit, hits: unique(hits).slice(0, 12) };
}

function expandQuery(query) {
  const quoted = Array.from(query.matchAll(/"([^"]+)"/g)).map((m) => normalizeText(m[1]));
  const base = normalizeText(query.replace(/"[^"]+"/g, " "));
  const phraseCandidates = TOPIC_LEXICON
    .map(normalizeText)
    .filter((topic) => topic.includes(" ") && base.includes(topic));
  const terms = tokenize(base);
  const expansions = [];
  if (terms.includes("me") || terms.includes("m&e")) expansions.push("monitoring", "evaluation", "M&E");
  if (terms.includes("mel")) expansions.push("monitoring", "evaluation", "learning", "MEL");
  if (terms.includes("ict4d")) expansions.push("technology", "development", "ICT4D");
  if (terms.includes("ai")) expansions.push("AI", "artificial", "intelligence");
  if (terms.includes("francophone")) expansions.push("french", "French");
  return {
    phrases: unique([...quoted, ...phraseCandidates]).map(normalizeText),
    terms: unique([...terms, ...expansions.map(normalizeText).flatMap(tokenize)])
  };
}

function warmthProfile(contact) {
  const gmail = contact.warmth.gmail || { sent: 0, received: 0, last: "" };
  const linkedin = contact.warmth.linkedin || { messages: 0, connectedOn: "", last: "" };
  const last = latestDate(gmail.last, linkedin.last);
  const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
  let points = 0;
  points += Math.min(45, gmail.sent * 5);
  points += Math.min(20, gmail.received * 1.5);
  points += Math.min(20, linkedin.messages * 4);
  if (contact.warmth.contacts?.present) points += 5;
  if (days < 45) points += 25;
  else if (days < 180) points += 14;
  else if (days < 540) points += 6;
  points = Math.min(100, Math.round(points));
  let bucket = "Cold";
  let level = 1;
  if (points >= 75) {
    bucket = "Active";
    level = 4;
  } else if (points >= 45) {
    bucket = "Recent";
    level = 3;
  } else if (points >= 15) {
    bucket = "Cool";
    level = 2;
  }
  return { points, bucket, level, last };
}

function explainMatch(contact, query, score) {
  const notes = [];
  if (score.hits.length) notes.push(`Matched ${score.hits.slice(0, 6).join(", ")}.`);
  const warmth = warmthProfile(contact);
  notes.push(`Warmth is ${warmth.bucket}: ${contact.warmth.gmail.sent} sent Gmail, ${contact.warmth.gmail.received} received Gmail, ${contact.warmth.linkedin.messages} LinkedIn messages.`);
  if (contact.consent === "do-not-share") notes.push("Consent gate: marked do not share.");
  if (contact.consent === "ask-first") notes.push("Consent gate: ask before sharing externally.");
  if (!score.hits.length && query.trim()) notes.push("No strong text hit. This person may be visible because filters are broad.");
  return notes;
}

async function loadSample() {
  if (state.serverAvailable) {
    await serverAction("/api/sample", {}, "Sample contacts loaded.");
    return;
  }
  mergeContacts(SAMPLE_CONTACTS.map((contact) => cleanContact(structuredClone(contact))));
  enrichAll();
  await persist();
  render();
  toast("Sample contacts loaded.");
}

function resetFilters() {
  state.filters = { org: "", location: "", topic: "", minWarmth: 0, consentGate: false };
  render();
}

function exportDatabase() {
  download(`network-radar-export-${dateStamp()}.json`, JSON.stringify({
    exportedAt: new Date().toISOString(),
    contacts: state.contacts
  }, null, 2), "application/json");
}

function exportShortlist() {
  const rows = getScoredContacts()
    .filter(({ contact }) => contact.shortlisted || state.query.trim())
    .slice(0, 50)
    .map(({ contact, score }) => {
      const warmth = warmthProfile(contact);
      return {
        name: contact.name,
        title: first(contact.titles),
        organization: first(contact.orgs),
        location: first(contact.locations),
        fit: score.fit,
        warmth: warmth.bucket,
        consent: contact.consent,
        why: explainMatch(contact, state.query, score).join(" "),
        public_note: contact.consent === "share-ok" ? snippet(contact.bio || contact.notes, 180) : "Ask before sharing private details.",
        linkedin_or_link: first(contact.links)
      };
    });
  if (!rows.length) {
    toast("No shortlist rows to export.");
    return;
  }
  download(`network-radar-shortlist-${dateStamp()}.csv`, toCsv(rows), "text/csv");
}

function cleanContact(contact) {
  return {
    id: contact.id || "",
    name: (contact.name || "").trim(),
    emails: unique((contact.emails || []).flatMap(extractEmails)),
    phones: unique(contact.phones || []),
    orgs: unique(splitAny(contact.orgs)),
    titles: unique(splitAny(contact.titles)),
    locations: unique(splitAny(contact.locations)),
    links: unique(splitAny(contact.links)),
    bio: (contact.bio || "").trim(),
    notes: (contact.notes || "").trim(),
    tags: unique(splitAny(contact.tags)),
    sources: { google: false, linkedin: false, gmail: false, ...(contact.sources || {}) },
    consent: contact.consent || "unknown",
    warmth: {
      gmail: { sent: 0, received: 0, last: "", ...(contact.warmth?.gmail || {}) },
      linkedin: { messages: 0, connectedOn: "", last: "", ...(contact.warmth?.linkedin || {}) },
      contacts: { present: false, ...(contact.warmth?.contacts || {}) }
    },
    evidence: contact.evidence || [],
    shortlisted: Boolean(contact.shortlisted),
    updatedAt: contact.updatedAt || new Date().toISOString()
  };
}

function contactCorpus(contact) {
  return [
    contact.name, contact.emails.join(" "), contact.orgs.join(" "), contact.titles.join(" "),
    contact.locations.join(" "), contact.bio, contact.notes, contact.tags.join(" "),
    contact.evidence.map((item) => item.text).join(" ")
  ].join(" ");
}

function tokenize(text) {
  return unique((text.match(/[a-z0-9+#&]+(?:[./-][a-z0-9+#&]+)*/gi) || [])
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 1 || ["r", "c"].includes(token)));
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, "&")
    .replace(/[^\p{L}\p{N}+#&./-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function splitAny(value) {
  if (Array.isArray(value)) return value.flatMap(splitAny);
  return splitList(value);
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row[key]) return row[key];
    const found = Object.keys(row).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (found && row[found]) return row[found];
  }
  return "";
}

function readHeaders(chunk) {
  const headerText = chunk.split(/\r?\n\r?\n/)[0] || chunk.slice(0, 2400);
  const headers = {};
  let current = "";
  headerText.split(/\r?\n/).forEach((line) => {
    if (/^\s/.test(line) && current) {
      headers[current] += ` ${line.trim()}`;
      return;
    }
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      current = match[1].toLowerCase();
      headers[current] = match[2].trim();
    }
  });
  return headers;
}

function displayNameForEmail(email, from, to) {
  const haystack = `${from}, ${to}`;
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = haystack.match(new RegExp(`([^,<"]+?)\\s*<?${escaped}>?`, "i"));
  return match ? match[1].replace(/["']/g, "").trim() : "";
}

function readVcf(lines, key) {
  const line = lines.find((item) => item.toUpperCase().startsWith(`${key}`));
  return line ? valueAfterColon(line) : "";
}

function valueAfterColon(line) {
  return String(line || "").split(":").slice(1).join(":").replace(/\\n/g, " ").trim();
}

function isLikelySelf(name) {
  const normalized = normalizeText(name);
  return state.aliases.some((alias) => normalized.includes(alias)) || normalized.includes("wayan vota");
}

function first(values) {
  return (values || []).find(Boolean) || "";
}

function unique(values) {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
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

function isNegated(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactPhrase = new RegExp(`\\b(no|not|without|non)\\s+(a\\s+|an\\s+|strong\\s+|real\\s+)?${escaped}\\b`, "i");
  const nearbyTerm = new RegExp(`\\b(no|not|without|non)\\b(?:\\s+[a-z0-9+#&./-]+){0,3}\\s+${escaped}\\b`, "i");
  return exactPhrase.test(text) || nearbyTerm.test(text);
}

function hasConcept(corpus, topic) {
  const normalized = normalizeText(topic);
  if (!normalized) return false;
  if (normalized.includes(" ")) return corpus.includes(normalized);
  return tokenize(corpus).includes(normalized);
}

function makeId(contact) {
  const basis = first(contact.links) || first(contact.emails) || `${contact.name}-${first(contact.orgs)}` || crypto.randomUUID();
  return `person-${normalizeText(basis).replace(/[^a-z0-9]+/g, "-").slice(0, 72)}`;
}

function snippet(text, length = 180) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length - 3)}...` : clean;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function consentOption(value, current, label) {
  return `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`;
}

function toCsv(rows) {
  const headers = Object.keys(rows[0] || {});
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  });
  return lines.join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 3200);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadState() {
  const saved = await idbGet("network");
  if (!saved) return;
  state.contacts = (saved.contacts || []).map(cleanContact);
  state.aliases = saved.aliases || [];
  state.query = saved.query || state.query;
}

async function persist() {
  await idbSet("network", {
    contacts: state.contacts,
    aliases: state.aliases,
    query: state.query,
    savedAt: new Date().toISOString()
  });
}
