// Pure-logic tests for the Live TV Smart TV patch.
// No DOM, no network, no TV APIs. Run with: node .github/livetv-tools/LiveTvSmartTvTest.mjs

import assert from "node:assert/strict";
import { selectLivePlaybackEngine, classifyLiveSource, liveSourceNeedsProxy } from "../../js/livetv/playback/livePlaybackStrategy.js";
import { assignChannelNumbers, formatChannelNumber, findChannelByNumber } from "../../js/livetv/core/liveChannelNumbering.js";
import { computeNowNext, computeProgressFraction } from "../../js/livetv/core/liveEpgNowNext.js";
import { sliceGuideWindow, computeGuideWindowBounds } from "../../js/livetv/core/liveGuideWindow.js";
import { buildGuideVirtualModel, getGuideVirtualWindow } from "../../js/livetv/ui/guideGridVirtualizer.js";
import { normalizeLiveSource } from "../../js/livetv/model/liveSource.js";
import { normalizeLiveChannelList } from "../../js/livetv/model/liveChannel.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const TIZEN_AVPLAY = { tizenAvplay: true, webosAvplay: false, hlsJs: true, dashJs: true, nativeVideo: true };
const TIZEN_NO_AVPLAY = { tizenAvplay: false, webosAvplay: false, hlsJs: true, dashJs: true, nativeVideo: true };
const WEBOS_AVPLAY = { tizenAvplay: false, webosAvplay: true, hlsJs: true, dashJs: true, nativeVideo: true };
const BROWSER = { tizenAvplay: false, webosAvplay: false, hlsJs: true, dashJs: true, nativeVideo: true };

test("classifyLiveSource detects HLS", () => {
  assert.equal(classifyLiveSource("https://tvsen7.aynascope.net/hgtv/index.m3u8"), "hls");
});
test("classifyLiveSource detects progressive MKV", () => {
  assert.equal(classifyLiveSource("http://1.2.3.4:8888/_t_/proxy/stream/x.mkv"), "progressive");
});
test("classifyLiveSource detects DASH", () => {
  assert.equal(classifyLiveSource("https://x/y.mpd"), "dash");
});
test("liveSourceNeedsProxy honours notWebReady", () => {
  assert.equal(liveSourceNeedsProxy({ notWebReady: true }), true);
});
test("liveSourceNeedsProxy honours headers", () => {
  assert.equal(liveSourceNeedsProxy({ headers: { Referer: "https://tvnow.st/" } }), true);
});
test("rung 1: tizen + avplay wins for HLS", () => {
  const d = selectLivePlaybackEngine({ platform: "tizen", capabilities: TIZEN_AVPLAY, source: { url: "https://x/y.m3u8" } });
  assert.equal(d.engine, "avplay");
  assert.equal(d.requiresProxy, false);
});
test("rung 1: tizen + avplay + headers requires proxy", () => {
  const d = selectLivePlaybackEngine({ platform: "tizen", capabilities: TIZEN_AVPLAY, source: { url: "https://x/y.m3u8", headers: { Referer: "r" } } });
  assert.equal(d.engine, "avplay");
  assert.equal(d.requiresProxy, true);
});
test("rung 2: webos + avplay wins", () => {
  const d = selectLivePlaybackEngine({ platform: "webos", capabilities: WEBOS_AVPLAY, source: { url: "https://x/y.m3u8" } });
  assert.equal(d.engine, "avplay");
});
test("rung 3a: no avplay + headers + HLS -> hlsjs via proxy", () => {
  const d = selectLivePlaybackEngine({ platform: "tizen", capabilities: TIZEN_NO_AVPLAY, source: { url: "https://x/y.m3u8", headers: { Referer: "r" } } });
  assert.equal(d.engine, "hlsjs");
  assert.equal(d.requiresProxy, true);
});
test("rung 3c: no avplay + headers + progressive -> video via proxy", () => {
  const d = selectLivePlaybackEngine({ platform: "tizen", capabilities: TIZEN_NO_AVPLAY, source: { url: "http://1.2.3.4:8888/x.mkv", notWebReady: true } });
  assert.equal(d.engine, "video");
  assert.equal(d.requiresProxy, true);
});
test("rung 4: browser + HLS -> hlsjs", () => {
  const d = selectLivePlaybackEngine({ platform: "browser", capabilities: BROWSER, source: { url: "https://x/y.m3u8" } });
  assert.equal(d.engine, "hlsjs");
});
test("rung 6: progressive -> video direct", () => {
  const d = selectLivePlaybackEngine({ platform: "browser", capabilities: BROWSER, source: { url: "http://1.2.3.4:8888/x.mkv" } });
  assert.equal(d.engine, "video");
  assert.equal(d.requiresProxy, false);
});
test("rung 8: unknown -> video fallback", () => {
  const d = selectLivePlaybackEngine({ platform: "browser", capabilities: BROWSER, source: { url: "https://x/stream" } });
  assert.equal(d.engine, "video");
  assert.equal(d.reason, "fallback-video");
});
test("channel numbering is stable and pinned wins", () => {
  const channels = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const numbers = assignChannelNumbers(channels, { pinned: { b: 7 } });
  assert.equal(numbers.b, 7);
  assert.equal(numbers.a, 1);
  assert.equal(numbers.c, 2);
});
test("formatChannelNumber pads to three digits", () => {
  assert.equal(formatChannelNumber(7), "007");
});
test("findChannelByNumber resolves", () => {
  const channels = [{ id: "a" }, { id: "b" }];
  const numbers = { a: 1, b: 2 };
  assert.equal(findChannelByNumber(channels, numbers, 2).id, "b");
});
test("computeNowNext finds now and next", () => {
  const programs = [
    { start: 0, end: 1000, title: "A" },
    { start: 1000, end: 2000, title: "B" }
  ];
  const { now, next } = computeNowNext(programs, 500);
  assert.equal(now.title, "A");
  assert.equal(next.title, "B");
});
test("computeProgressFraction clamps", () => {
  assert.equal(computeProgressFraction({ start: 0, end: 100 }, 50), 0.5);
  assert.equal(computeProgressFraction({ start: 0, end: 100 }, 500), 1);
});
test("sliceGuideWindow filters to the window", () => {
  const programs = [
    { start: 0, end: 100, title: "A" },
    { start: 200, end: 300, title: "B" }
  ];
  assert.equal(sliceGuideWindow(programs, { startMs: 150, endMs: 400 }).length, 1);
});
test("computeGuideWindowBounds snaps to 30 minutes", () => {
  const bounds = computeGuideWindowBounds({ nowMs: 31 * 60 * 1000, minutes: 180 });
  assert.equal(bounds.startMs % (30 * 60 * 1000), 0);
  assert.equal(bounds.minutes, 180);
});
test("guide virtual window mounts a bounded slice", () => {
  const keys = Array.from({ length: 84 }, (_, i) => `c${i}`);
  const model = buildGuideVirtualModel(keys, null, 96);
  const win = getGuideVirtualWindow(model, { scrollTop: 0, viewportHeight: 1080 });
  assert.ok(win.end - win.start + 1 <= 84);
  assert.ok(win.end - win.start + 1 >= 12);
});
test("normalizeLiveSource preserves proxy headers", () => {
  const source = normalizeLiveSource(
    { name: "S", url: "https://x/y.m3u8", behaviorHints: { notWebReady: true, proxyHeaders: { request: { Referer: "https://tvnow.st/" } } } },
    { channelId: "c1" }
  );
  assert.equal(source.headers.Referer, "https://tvnow.st/");
  assert.equal(source.notWebReady, true);
});
test("normalizeLiveChannelList dedupes by id", () => {
  const channels = normalizeLiveChannelList([{ id: "a", name: "A" }, { id: "a", name: "A2" }]);
  assert.equal(channels.length, 1);
});

console.log(`\n${passed} tests passed`);
