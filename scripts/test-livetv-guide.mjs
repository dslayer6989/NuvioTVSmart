// Live TV guide tests. Run with: node --test scripts/test-livetv-guide.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCatalogUrl,
  finalizePrograms,
  guideChannelsFor,
  guideWindow,
  neighborOf,
  normalizeManifestUrl,
  onNowEntries,
  planCatalogs,
  programAt
} from "../js/livetv/liveTvGuide.js";
import { loadChannelStreams, loadLiveTvGuide } from "../js/livetv/liveTvLoader.js";
import { parseManifest } from "../js/livetv/liveTvParser.js";
import {
  HOUR_MS,
  MINUTE_MS,
  parseInstant,
  parseRuntimeMinutes,
  utcDate
} from "../js/livetv/liveTvTime.js";

// A static GitHub Pages addon like Stremio-TV, which pre-renders every catalog URL.
const base = "https://example.github.io/Stremio-TV";
const manifestUrl = `${base}/manifest.json`;
const now = Date.UTC(2026, 8, 29, 12, 30); // 2026-09-29T12:30:00Z

const manifest = {
  id: "com.stremiotv.philly",
  name: "Stremio TV",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  catalogs: [
    { type: "tv", id: "channels", name: "Stremio TV", extra: [{ name: "skip" }, { name: "date" }] },
    {
      type: "tv",
      id: "favorites",
      name: "★ Favorites",
      extra: [{ name: "genre", isRequired: true, options: ["All"] }, { name: "skip" }]
    },
    {
      type: "tv",
      id: "sports",
      name: "Sports",
      extra: [{ name: "genre", isRequired: true, options: ["All"] }, { name: "skip" }]
    },
    { type: "tv", id: "kids", name: "Kids & Family", extra: [{ name: "skip" }] },
    { type: "tv", id: "search", name: "Search", extra: [{ name: "search", isRequired: true }] }
  ],
  behaviorHints: { epgProvider: true }
};

function meta(id, name, programs) {
  return {
    id,
    type: "tv",
    name,
    genres: ["News"],
    poster: `${base}/${id}.png`,
    behaviorHints: { isLive: true, hasScheduledVideos: true },
    videos: programs.map(([start, title]) => ({
      title,
      startTime: start,
      endTime: new Date(parseInstant(start) + HOUR_MS).toISOString()
    }))
  };
}

function responses() {
  const day1 = "2026-09-29";
  const day2 = "2026-09-30";
  return {
    [manifestUrl]: manifest,
    [`${base}/catalog/tv/channels/date=${day1}.json`]: {
      metasDetailed: [
        meta("stremiotv_cnn", "CNN", [
          [`${day1}T12:00:00Z`, "News Central"],
          [`${day1}T13:00:00Z`, "Situation Room"]
        ])
      ]
    },
    [`${base}/catalog/tv/channels/skip=1&date=${day1}.json`]: {
      metasDetailed: [meta("stremiotv_espn", "ESPN", [[`${day1}T12:00:00Z`, "SportsCenter"]])]
    },
    [`${base}/catalog/tv/channels/skip=2&date=${day1}.json`]: { metasDetailed: [] },
    [`${base}/catalog/tv/channels/date=${day2}.json`]: {
      metasDetailed: [meta("stremiotv_cnn", "CNN", [[`${day2}T00:00:00Z`, "Overnight"]])]
    },
    [`${base}/catalog/tv/channels/skip=1&date=${day2}.json`]: { metasDetailed: [] },
    // Day 3 is missing (404); the loader must tolerate it.
    [`${base}/catalog/tv/favorites/genre=All.json`]: {
      metas: [{ id: "stremiotv_espn", type: "tv", name: "ESPN" }]
    },
    [`${base}/catalog/tv/favorites/genre=All&skip=1.json`]: { metas: [] },
    [`${base}/catalog/tv/sports/genre=All.json`]: {
      metas: [{ id: "stremiotv_espn", type: "tv", name: "ESPN" }]
    },
    [`${base}/catalog/tv/kids.json`]: {
      metas: [{ id: "stremiotv_cartoons", type: "tv", name: "Cartoons" }]
    },
    [`${base}/stream/tv/stremiotv_cnn.json`]: {
      streams: [
        { name: "Primary • 720p", url: "https://cdn.example/cnn.m3u8" },
        { name: "Magnet", url: "magnet:?xt=urn:btih:abc" },
        {
          name: "Backup 1 • 1080p",
          url: "https://backup.example/cnn.m3u8",
          behaviorHints: {
            notWebReady: true,
            proxyHeaders: { request: { Referer: "https://example" } }
          }
        }
      ]
    }
  };
}

function fetcher(map = responses(), log = []) {
  return async (url) => {
    log.push(url);
    if (!(url in map)) throw new Error(`HTTP 404 for ${url}`);
    return JSON.parse(JSON.stringify(map[url]));
  };
}

test("loads lineup, schedule and chips from a static addon", async () => {
  const requested = [];
  const guide = await loadLiveTvGuide(manifestUrl, {
    nowMs: now,
    fetchJson: fetcher(responses(), requested)
  });
  assert.equal(guide.addonName, "Stremio TV");
  assert.deepEqual(guide.lineupIds, ["stremiotv_cnn", "stremiotv_espn"]);
  assert.deepEqual(
    guide.programsByChannel.stremiotv_cnn.map((program) => program.title),
    ["News Central", "Situation Room", "Overnight"]
  );
  assert.equal(programAt(guide, "stremiotv_espn", now)?.title, "SportsCenter");
  assert.deepEqual(
    guide.groups.map((group) => group.id),
    ["favorites", "sports", "kids"]
  );
  assert.deepEqual(
    guideChannelsFor(guide, "kids").map((channel) => channel.id),
    ["stremiotv_cartoons"]
  );
  assert.equal(guide.channelsById.stremiotv_cartoons.number, 0);
  assert.equal(guide.channelsById.stremiotv_espn.number, 2);
  // Native EPG addons never need the per-channel meta fallback, and search is never requested.
  assert.ok(requested.every((url) => !url.includes("/meta/") && !url.includes("/search")));
});

test("streams keep addon order and drop unplayable links", async () => {
  const streams = await loadChannelStreams(
    manifestUrl,
    { id: "stremiotv_cnn", type: "tv" },
    { fetchJson: fetcher() }
  );
  assert.deepEqual(
    streams.map((stream) => stream.name),
    ["Primary • 720p", "Backup 1 • 1080p"]
  );
  assert.deepEqual(streams[1].behaviorHints.proxyHeaders.request, { Referer: "https://example" });
});

test("falls back to the meta endpoint without the date extra", async () => {
  const map = {
    [manifestUrl]: {
      id: "x",
      name: "Plain",
      resources: ["catalog", "meta", "stream"],
      catalogs: [{ type: "tv", id: "all", name: "All" }]
    },
    [`${base}/catalog/tv/all.json`]: { metas: [{ id: "c1", type: "tv", name: "One" }] },
    [`${base}/meta/tv/c1.json`]: { meta: meta("c1", "One", [["2026-09-29T12:00:00Z", "Show"]]) }
  };
  const guide = await loadLiveTvGuide(manifestUrl, { nowMs: now, fetchJson: fetcher(map) });
  assert.equal(programAt(guide, "c1", now)?.title, "Show");
});

test("fails clearly when the manifest is unreachable", async () => {
  await assert.rejects(loadLiveTvGuide(manifestUrl, { nowMs: now, fetchJson: fetcher({}) }), /404/);
});

test("normalizes manifest links", () => {
  assert.equal(
    normalizeManifestUrl("stremio://example.github.io/Stremio-TV/manifest.json"),
    manifestUrl
  );
  assert.equal(normalizeManifestUrl("example.github.io/Stremio-TV/"), manifestUrl);
  assert.equal(
    normalizeManifestUrl("https://dslayer6989.github.io/Stremio-TV"),
    "https://dslayer6989.github.io/Stremio-TV/manifest.json"
  );
  assert.equal(normalizeManifestUrl(`${base}?token=1`), `${manifestUrl}?token=1`);
  assert.equal(
    normalizeManifestUrl("http://192.168.1.20:7000"),
    "http://192.168.1.20:7000/manifest.json"
  );
});

test("catalog URLs follow the manifest's extra order", () => {
  const info = parseManifest(manifest);
  const plan = planCatalogs(info);
  assert.equal(plan.lineup.id, "channels");
  assert.equal(plan.usesDateEpg, true);
  assert.equal(
    buildCatalogUrl(manifestUrl, plan.lineup, { date: "2026-09-29", skip: "100" }),
    `${base}/catalog/tv/channels/skip=100&date=2026-09-29.json`
  );
  assert.ok(!plan.groups.some((catalog) => catalog.id === "search"));
});

test("parses ISO, XMLTV and runtime formats", () => {
  assert.equal(parseInstant("2026-09-29T20:00:00Z"), Date.UTC(2026, 8, 29, 20));
  assert.equal(parseInstant("2026-09-29T16:00:00-04:00"), Date.UTC(2026, 8, 29, 20));
  assert.equal(parseInstant("2026-09-29T20:00:00.250+0000"), Date.UTC(2026, 8, 29, 20, 0, 0, 250));
  assert.equal(parseInstant("20260929200000 +0100"), Date.UTC(2026, 8, 29, 19));
  assert.equal(parseInstant("not a date"), null);
  assert.equal(parseRuntimeMinutes("60 min"), 60);
  assert.equal(parseRuntimeMinutes("1h 30m"), 90);
  assert.equal(parseRuntimeMinutes("1:30"), 90);
  assert.equal(parseRuntimeMinutes("PT1H30M"), 90);
  assert.equal(utcDate(Date.UTC(2026, 0, 2, 23, 59)), "2026-01-02");
});

test("fills missing end times and trims overlaps", () => {
  const start = Date.UTC(2026, 8, 29, 12);
  const programs = finalizePrograms("c", [
    { id: "a", title: "A", startMs: start, endMs: null },
    { id: "b", title: "B", startMs: start + 30 * MINUTE_MS, endMs: start + 3 * HOUR_MS },
    { id: "c", title: "C", startMs: start + HOUR_MS, endMs: null }
  ]);
  assert.deepEqual(
    programs.map((program) => [program.id, (program.endMs - program.startMs) / MINUTE_MS]),
    [
      ["a", 30],
      ["b", 30],
      ["c", 60]
    ]
  );
});

test("guide window spans 6 to 48 hours from an hour ago", () => {
  const window = guideWindow(null, now);
  assert.equal(window.startMs, Date.UTC(2026, 8, 29, 11, 30));
  assert.equal(window.endMs - window.startMs, 6 * HOUR_MS);
  assert.equal(window.slots.length, 12);
});

test("channel up/down wraps around and On Now sorts", async () => {
  const guide = await loadLiveTvGuide(manifestUrl, { nowMs: now, fetchJson: fetcher() });
  const lineup = guideChannelsFor(guide, null);
  assert.equal(neighborOf(lineup, "stremiotv_espn", 1).id, "stremiotv_cnn");
  assert.equal(neighborOf(lineup, "stremiotv_cnn", -1).id, "stremiotv_espn");
  const ending = onNowEntries(guide, lineup, now, "EndingSoon");
  assert.equal(ending.length, 2);
  assert.ok(ending.every((entry) => entry.current));
});
