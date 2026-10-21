// Live TV phone setup service tests. Run with: node --test scripts/test-livetv-phone.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const controlService = require("../services/tizen/runtime/livetv-phone-service.cjs");

const token = "ab".repeat(32);

async function control(body) {
  const response = await fetch(`http://127.0.0.1:${controlService.port}/livetv-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test("a phone can send the addon link to the TV", async () => {
  controlService.start();
  await new Promise((resolve) => setTimeout(resolve, 100));
  try {
    const started = await control({
      action: "start",
      token,
      link: "https://old.example/manifest.json"
    });
    assert.equal(started.status, 200);
    assert.ok(started.body.port >= 8110 && started.body.port <= 8119);
    const base = `http://127.0.0.1:${started.body.port}/${token}/`;

    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Send to TV/);
    assert.deepEqual(await (await fetch(`${base}api/link`)).json(), {
      link: "https://old.example/manifest.json"
    });

    const wrongToken = await fetch(`http://127.0.0.1:${started.body.port}/${"cd".repeat(32)}/`);
    assert.equal(wrongToken.status, 404);

    const bad = await fetch(`${base}api/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link: "not a link at all" })
    });
    assert.equal(bad.status, 400);

    const saved = await fetch(`${base}api/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link: "https://dslayer6989.github.io/Stremio-TV" })
    });
    assert.equal(saved.status, 200);

    const state = await control({ action: "read", token });
    assert.equal(state.body.link, "https://dslayer6989.github.io/Stremio-TV");
    assert.equal(state.body.revision, 1);

    assert.equal((await control({ action: "stop", token })).body.stopped, true);
    assert.equal((await control({ action: "read", token })).status, 410);
  } finally {
    controlService.stop();
  }
});
