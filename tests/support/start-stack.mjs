import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "network-radar-e2e-"));
await fsp.writeFile(
  path.join(dataDir, "google-token.json"),
  JSON.stringify({ access_token: "synthetic-google-token", expires_at: Date.now() + 3600000 })
);

const fixture = spawn(process.execPath, ["tests/fixtures/connectors.mjs"], {
  cwd: process.cwd(),
  stdio: ["ignore", "inherit", "inherit"]
});

await waitFor("http://127.0.0.1:5180/not-found", [404]);

const app = spawn(process.execPath, ["server.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: "5178",
    NETWORK_RADAR_DATA_DIR: dataDir,
    NETWORK_RADAR_EXPORT_DIR: path.join(dataDir, "exports"),
    OPENAI_API_KEY: "synthetic-e2e-key",
    OPENAI_BASE_URL: "http://127.0.0.1:5180/v1",
    GOOGLE_CLIENT_ID: "synthetic-google-client",
    GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
    GOOGLE_PEOPLE_BASE_URL: "http://127.0.0.1:5180/people/v1",
    GMAIL_BASE_URL: "http://127.0.0.1:5180/gmail/v1",
    GOOGLE_TOKEN_URL: "http://127.0.0.1:5180/token"
  },
  stdio: ["ignore", "inherit", "inherit"]
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  app.kill("SIGTERM");
  fixture.kill("SIGTERM");
  await fsp.rm(dataDir, { recursive: true, force: true });
  process.exit(0);
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
app.on("exit", close);

async function waitFor(url, accepted = [200]) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (accepted.includes(response.status)) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
