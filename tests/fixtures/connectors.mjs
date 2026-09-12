import http from "node:http";

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:5180");

  if (request.method === "POST" && url.pathname === "/v1/embeddings") {
    const payload = await readJson(request);
    if (String(payload.input).includes("Rate Limited AI Fixture")) {
      return send(response, 429, { error: { message: "Synthetic rate limit." } });
    }
    return send(response, 200, { data: [{ embedding: [0.1, 0.2, 0.3] }] });
  }

  if (request.method === "POST" && url.pathname === "/v1/responses") {
    const payload = await readJson(request);
    const input = JSON.stringify(payload.input || "");
    const tags = input.includes("Malformed AI Fixture")
      ? { tags: "not-an-array" }
      : { tags: ["synthetic-enrichment", "digital health"] };
    return send(response, 200, { output_text: JSON.stringify(tags) });
  }

  if (request.method === "GET" && url.pathname === "/people/v1/people/me/connections") {
    return send(response, 200, {
      connections: [
        {
          resourceName: "people/synthetic-google-contact",
          names: [{ displayName: "Google Fixture Contact" }],
          emailAddresses: [{ value: "google.fixture@example.invalid" }],
          organizations: [
            { name: "Synthetic Health Network", title: "Program Director" }
          ],
          locations: [{ value: "Raleigh, North Carolina" }],
          biographies: [{ value: "Synthetic connector record." }],
          urls: [{ value: "https://example.invalid/google-fixture" }]
        }
      ]
    });
  }

  if (request.method === "GET" && url.pathname === "/gmail/v1/users/me/messages") {
    return send(response, 200, { messages: [{ id: "synthetic-message-1" }] });
  }

  if (
    request.method === "GET" &&
    url.pathname === "/gmail/v1/users/me/messages/synthetic-message-1"
  ) {
    return send(response, 200, {
      payload: {
        headers: [
          { name: "From", value: "Gmail Fixture <gmail.fixture@example.invalid>" },
          { name: "To", value: "Synthetic Self <self@example.invalid>" },
          { name: "Subject", value: "Synthetic digital health introduction" },
          { name: "Date", value: "Tue, 1 Sep 2026 12:00:00 +0000" }
        ]
      }
    });
  }

  return send(response, 404, { error: { message: "Fixture route not found." } });
});

server.listen(5180, "127.0.0.1", () => {
  console.log("synthetic connector fixture listening on 127.0.0.1:5180");
});
