// Remote-control test for every Live TV screen. It drives the built app (dist/) in a
// headless browser with only the keys a TV remote has (arrows, OK, Back, plus the
// colour and channel keys as extras) against a fake copy of the Stremio-TV addon, and
// fails if a screen has nothing focused, focus gets stuck, OK does nothing or Back
// doesn't close/return.
//
//   node livetv/remote-test/remote-nav.mjs <dist dir> [screenshot dir]
//
// Needs the `playwright` package and its Chromium (see .github/workflows/livetv-smarttv-build.yml).
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { startFakeAddon } from "./fake-addon.mjs";
import { startStaticServer } from "./static-server.mjs";

const distDir = path.resolve(process.argv[2] || "dist");
const shotDir = path.resolve(process.argv[3] || "livetv-test-screens");
const APP_PORT = 8080;
const ADDON_PORT = 7000;
const MANIFEST = `http://127.0.0.1:${ADDON_PORT}/manifest.json`;

// Keys as the TV app sees them (Back is Escape in a browser; the app maps 10009/461 too).
const KEYS = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  ok: "Enter",
  back: "Escape",
  pageUp: "PageUp",
  pageDown: "PageDown"
};

const failures = [];
let step = 0;

async function main() {
  await mkdir(shotDir, { recursive: true });
  const addon = await startFakeAddon({ port: ADDON_PORT });
  const server = await startStaticServer({ root: distDir, port: APP_PORT });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    await runConfigured(browser);
    await runSetup(browser);
  } finally {
    await browser.close();
    server.close();
    addon.server.close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} remote-control check(s) failed:`);
    failures.forEach((failure) => console.error(` - ${failure}`));
    process.exit(1);
  }
  console.log("\nAll remote-control checks passed.");
}

async function newPage(browser, { configured }) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (error) => failures.push(`Page error: ${error.message}`));
  await page.addInitScript(
    ({ manifest, configured: withAddon }) => {
      if (withAddon && !localStorage.getItem("liveTv.manifestUrl")) {
        localStorage.setItem("liveTv.manifestUrl", JSON.stringify(manifest));
      }
    },
    { manifest: MANIFEST, configured }
  );
  await page.goto(`http://127.0.0.1:${APP_PORT}/`);
  await page.waitForTimeout(3500);
  return page;
}

function helpers(page, label) {
  const route = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll(".screen"))
        .filter((node) => node.style.display === "block")
        .map((node) => node.id)
        .join(",")
    );
  // The element the remote is on: the active element, or the visible `.focused` one.
  const focused = () =>
    page.evaluate(() => {
      const visible = (node) => {
        if (!node || !(node instanceof HTMLElement)) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== "hidden";
      };
      const candidates = [document.activeElement, ...document.querySelectorAll(".focused")].filter(
        (node) => node && node !== document.body && visible(node)
      );
      // Prefer what sits on top (dialogs and menus over the screen behind them).
      const node = candidates.reverse().find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return top && (candidate === top || candidate.contains(top) || top.contains(candidate));
      }) || candidates[0];
      if (!node) return null;
      return {
        className: String(node.className || ""),
        text: String(node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
        key: node.dataset?.ltvKey || node.dataset?.focusKey || node.dataset?.action || node.id || ""
      };
    });
  const press = async (key, waitMs = 350) => {
    await page.keyboard.press(KEYS[key] || key);
    await page.waitForTimeout(waitMs);
  };
  const hold = async (key, holdMs = 900) => {
    await page.keyboard.down(KEYS[key] || key);
    await page.waitForTimeout(holdMs);
    await page.keyboard.up(KEYS[key] || key);
    await page.waitForTimeout(400);
  };
  const shot = async (name) => {
    step += 1;
    await page.screenshot({ path: path.join(shotDir, `${label}-${String(step).padStart(2, "0")}-${name}.png`) });
  };
  const fail = async (message) => {
    failures.push(`[${label}] ${message}`);
    console.error(`FAIL [${label}] ${message}`);
    await shot("failure");
  };
  const expectRoute = async (expected, what) => {
    const current = await route();
    if (!current.split(",").includes(expected)) await fail(`${what}: expected the ${expected} screen, got "${current}"`);
    else console.log(`ok   ${what}`);
  };
  const expectFocus = async (pattern, what) => {
    const info = await focused();
    if (!info) return fail(`${what}: nothing is focused`);
    const haystack = `${info.className} ${info.text} ${info.key}`;
    if (!pattern.test(haystack)) return fail(`${what}: focus is on "${haystack}"`);
    console.log(`ok   ${what}  →  ${info.text || info.key}`);
    return info;
  };
  /** Presses `key` up to `max` times; every press must move focus until `until` matches. */
  const walk = async (key, until, what, max = 30) => {
    let previous = await focused();
    for (let index = 0; index < max; index += 1) {
      const info = previous && `${previous.className} ${previous.text} ${previous.key}`;
      if (info && until.test(info)) {
        console.log(`ok   ${what}`);
        return true;
      }
      await press(key);
      const next = await focused();
      if (!next) return fail(`${what}: focus disappeared after ${key}`);
      if (previous && next.key === previous.key && next.text === previous.text && next.className === previous.className) {
        return fail(`${what}: ${key} did not move focus (stuck on "${next.text || next.key}")`);
      }
      previous = next;
    }
    return fail(`${what}: never reached the target after ${max} presses`);
  };
  return { route, focused, press, hold, shot, fail, expectRoute, expectFocus, walk };
}

async function passSignIn(t) {
  // "Continue without account" on the sign-in screen.
  if ((await t.route()) === "account") {
    await t.press("right");
    await t.press("ok", 2500);
  }
}

async function openLiveTvFromSidebar(t) {
  await t.press("left", 500);
  await t.walk("down", /gotoLiveTv|Live TV/, "sidebar reaches Live TV");
  await t.press("ok", 3000);
  await t.expectRoute("liveTv", "OK on the sidebar item opens Live TV");
}

async function runConfigured(browser) {
  const page = await newPage(browser, { configured: true });
  const t = helpers(page, "guide");
  await passSignIn(t);
  await t.expectRoute("home", "app reaches Home");
  await page.waitForTimeout(2500);
  await t.expectFocus(/livetv:|Live Now|CNN|home-content-card/, "Home starts on the Live Now row");
  await openLiveTvFromSidebar(t);
  await t.shot("guide");

  // Guide grid
  await t.expectFocus(/ltv-program-cell/, "guide opens on a programme");
  await t.walk("right", /ltv-program-cell is-future/, "Right moves through programmes");
  await t.walk("left", /ltv-channel-cell/, "Left goes back to the channel column");
  await t.press("down");
  await t.expectFocus(/ltv-channel-cell/, "Down moves along the channel column");
  await t.press("right");
  await t.expectFocus(/ltv-program-cell/, "Right goes back into the grid");
  for (let index = 0; index < 9; index += 1) await t.press("down", 200);
  await t.expectFocus(/ltv-program-cell/, "Down scrolls the guide past the first screen");
  await t.press("pageUp", 500);
  await t.press("pageUp", 500);
  await t.press("up", 300);
  await t.walk("up", /ltv-chip/, "Up from the top row reaches the category chips");
  await t.walk("right", /Sports/, "Right moves along the chips");
  await t.press("ok", 1200);
  await t.press("down");
  await t.expectFocus(/ESPN|FOX|Golf|NFL/, "the Sports chip shows sports channels");
  await t.walk("up", /ltv-chip/, "back up to the chips");
  await t.walk("left", /All channels/, "Left returns to All channels");
  await t.press("ok", 800);
  await t.press("up");
  await t.expectFocus(/ltv-action/, "Up from the chips reaches the header buttons");
  await t.walk("right", /Settings/, "Right moves along the header buttons");
  await t.walk("left", /Guide/, "Left moves back along the header buttons");
  await t.press("left", 500);
  await t.expectFocus(/home-nav-item|modern-sidebar/, "Left from the first header button opens the sidebar");
  await t.press("right", 500);
  await t.expectFocus(/ltv-/, "Right closes the sidebar and returns to the screen");

  // Channel options menu: hold OK on a programme
  await t.press("down");
  await t.press("down");
  await t.hold("ok");
  await t.shot("channel-menu");
  await t.expectFocus(/ltv-menu-option/, "holding OK opens the channel menu");
  await t.walk("down", /favorites/i, "Down moves through the menu");
  await t.press("back", 600);
  await t.expectFocus(/ltv-program-cell/, "Back closes the menu");
  await t.press("left");
  await t.walk("left", /ltv-channel-cell/, "reach the channel column");
  await t.press("ok", 600);
  await t.expectFocus(/ltv-menu-option/, "OK on a channel opens its menu");
  await t.walk("down", /Cancel/, "reach Cancel");
  await t.press("ok", 600);
  await t.expectFocus(/ltv-channel-cell/, "Cancel closes the menu");

  // On Now (green key toggles; the header button too)
  await t.press("right");
  await t.walk("up", /ltv-chip/, "up to the chips");
  await t.press("up");
  await t.walk("right", /On Now/, "reach the On Now button");
  await t.press("ok", 1000);
  await t.shot("on-now");
  await t.press("down");
  await t.press("down");
  await t.expectFocus(/ltv-pill|Channel order/, "On Now has the sort row");
  await t.walk("right", /Ending soon/, "Right moves along the sort options");
  await t.press("ok", 600);
  await t.walk("down", /ltv-onnow-card/, "Down reaches the channel cards");
  await t.walk("right", /ltv-onnow-card[^]*4|NBC/, "Right moves across the cards");
  await t.press("down");
  await t.expectFocus(/ltv-onnow-card/, "Down moves to the next row of cards");
  await t.press("ok", 3500);
  await t.expectRoute("player", "OK on a card starts the channel");

  // Player
  await page.waitForTimeout(2500);
  await t.shot("player");
  const banner = await page.evaluate(() => Boolean(document.querySelector(".ltv-player-banner")));
  if (!banner) await t.fail("the channel banner is missing after tuning");
  else console.log("ok   the player shows the channel banner after tuning");
  const controlsShowing = () =>
    page.evaluate(() => {
      const overlay = document.getElementById("playerControlsOverlay");
      return Boolean(overlay && !overlay.classList.contains("hidden"));
    });
  // Wait for the controls to hide on their own, then Left opens the channel list.
  for (let index = 0; index < 20 && (await controlsShowing()); index += 1) await page.waitForTimeout(500);
  if (await controlsShowing()) await t.fail("the player controls never hid");
  await t.press("left", 700);
  await t.shot("channel-list");
  await t.expectFocus(/ltv-player-list-row/, "Left opens the channel list");
  await t.press("down");
  await t.expectFocus(/ltv-player-list-row/, "Down moves through the channel list");
  await t.press("back", 600);
  const listClosed = await page.evaluate(() => !document.querySelector(".ltv-player-list"));
  if (!listClosed) await t.fail("Back did not close the channel list");
  else console.log("ok   Back closes the channel list");
  await t.expectRoute("player", "closing the list keeps playing");
  await t.press("g", 700);
  await t.expectFocus(/ltv-player-list-row/, "the green button (G) opens the channel list");
  await t.press("right", 600);
  await t.expectRoute("player", "Right closes the channel list");
  const channelName = () =>
    page.evaluate(() => document.getElementById("ltvPlayerOverlay")?.dataset?.channelId || "");
  const before = await channelName();
  await t.press("pageUp", 4500);
  const after = await channelName();
  if (!after || after === before) await t.fail(`CH▲ did not change the channel (still "${after}")`);
  else console.log(`ok   CH▲ changes the channel: ${before} → ${after}`);
  // Up shows the controls; Left on the first button opens the channel list too.
  await t.press("up", 600);
  if (await controlsShowing()) {
    await t.press("down", 400); // from the progress bar to the buttons
    await t.walk("left", /ltv-player-list-row/, "Left from the first player button opens the channel list", 8);
    await t.press("back", 600);
  }
  // Back hides the controls first if they're up, then leaves the player.
  for (let index = 0; index < 3 && (await t.route()) === "player"; index += 1) await t.press("back", 1200);
  await t.expectRoute("liveTv", "Back from the player returns to Live TV");
  await t.expectFocus(/ltv-/, "focus comes back to Live TV");

  // Settings → Live TV
  await t.walk("up", /ltv-action/, "up to the header", 8);
  await t.walk("right", /Settings/, "reach the Settings button");
  await t.press("ok", 2500);
  await t.expectRoute("settings", "the Settings button opens Settings");
  await t.shot("settings");
  await t.expectFocus(/liveTv:phone|Set up with your phone/, "Settings opens on Live TV");
  await t.press("down");
  await t.expectFocus(/liveTv:link|Addon link/, "Down reaches the addon link");
  await t.press("ok", 800);
  await t.expectFocus(/settings-text-dialog|input/, "OK opens the link editor");
  await t.press("back", 800);
  await t.expectFocus(/liveTv:link|Addon link/, "Back closes the link editor");
  await t.walk("down", /liveTv:clearRecents|recently watched/i, "Down reaches the end of the Live TV settings", 10);
  for (let index = 0; index < 3 && (await t.route()) === "settings"; index += 1) await t.press("back", 1200);
  await t.expectRoute("liveTv", "Back leaves Settings");

  // Home row
  await t.press("back", 500); // sidebar
  await t.walk("up", /gotoHome|Home/, "sidebar up to Home");
  await t.press("ok", 3000);
  await t.expectRoute("home", "Home opens from the sidebar");
  await t.press("right", 500);
  await t.expectFocus(/livetv:|Live Now|home-content-card/, "focus is in Home's rows");
  await page.close();
}

async function runSetup(browser) {
  const page = await newPage(browser, { configured: false });
  const t = helpers(page, "setup");
  await passSignIn(t);
  await openLiveTvFromSidebar(t);
  await t.shot("setup");
  await t.expectFocus(/Set up with your phone/, "the setup screen starts on 'Set up with your phone'");
  await t.press("right");
  await t.expectFocus(/Type the link/, "Right reaches 'Type the link'");
  await t.press("ok", 2500);
  await t.expectRoute("settings", "'Type the link' opens Settings");
  await t.expectFocus(/settings-text-dialog|input/, "the link editor is open and focused");
  await page.keyboard.type(MANIFEST);
  await t.press("down");
  await t.expectFocus(/Save/, "Down reaches Save");
  await t.press("ok", 1500);
  for (let index = 0; index < 3 && (await t.route()) === "settings"; index += 1) await t.press("back", 1500);
  await t.expectRoute("liveTv", "Back returns to Live TV");
  await page.waitForTimeout(2500);
  await t.expectFocus(/ltv-program-cell|ltv-action|ltv-chip/, "the guide loads with the saved link");
  await t.shot("after-setup");

  // Appearance → the Live TV themes are in the theme picker
  await t.press("back", 500);
  await t.walk("down", /gotoSettings|Settings/, "sidebar down to Settings");
  await t.press("ok", 2500);
  const themes = await page.evaluate(() => {
    const names = Array.from(document.querySelectorAll(".settings-theme-name")).map((node) => node.textContent.trim());
    return names;
  });
  const missing = ["Neon Broadcast", "Retro Cable Guide", "Teletext", "CRT Phosphor", "Synthwave Sunset", "Game Day", "Drive-In Marquee", "Aurora"].filter(
    (name) => themes.length && !themes.includes(name)
  );
  if (themes.length && missing.length) await t.fail(`theme picker is missing: ${missing.join(", ")}`);
  else if (themes.length) console.log("ok   all eight Live TV themes are in the theme picker");
  await page.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
