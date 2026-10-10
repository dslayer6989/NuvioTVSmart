#!/usr/bin/env python3
"""Generate the Nuvio Live TV Smart TV patch (Model B).

Writes js/livetv/** and applies the minimal surgical edits to existing files.
The patch is a CUMULATIVE diff from the pinned upstream SHA. This script is the
single source of truth for the Live TV tree; the js/livetv files are generated
artifacts, not hand-edited.

Usage:
    python .github/livetv-tools/livetv_smarttv.py --root <repo-root>
    python .github/livetv-tools/livetv_smarttv.py --root <repo-root> --check
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PINNED_BASE_SHA = "72473523c18a3fb4bef3a0dba8fb8f91548b3baa"

FILES: dict[str, str] = {}

FILES["js/livetv/model/liveChannel.js"] = r"""// Live TV channel model.
//
// A LiveChannel is the normalized form of a Stremio catalog `meta` entry that
// the Stremio-TV addon returns from /catalog/tv/*.json. The addon is a
// spec-compliant Stremio addon: Nuvio only sends HTTP and parses JSON, so this
// module is a pure normalizer with no network access.

const LIVE_CHANNEL_TYPE = "tv";

function normalizeText(value) {
  return String(value ?? "").trim();
}

export function normalizeLiveChannel(raw = {}, { addonBaseUrl = "" } = {}) {
  const id = normalizeText(raw.id || raw._id);
  if (!id) {
    return null;
  }
  const behaviorHints =
    raw.behaviorHints && typeof raw.behaviorHints === "object" ? raw.behaviorHints : {};
  const poster = normalizeText(raw.poster || raw.background || raw.logo);
  return Object.freeze({
    id,
    type: normalizeText(raw.type) || LIVE_CHANNEL_TYPE,
    name: normalizeText(raw.name) || id,
    poster,
    posterShape: normalizeText(raw.posterShape) || "square",
    isLive: behaviorHints.isLive === true,
    category: normalizeText(raw.category || raw.genre),
    addonBaseUrl: normalizeText(addonBaseUrl),
    raw
  });
}

export function normalizeLiveChannelList(metas = [], options = {}) {
  if (!Array.isArray(metas)) {
    return [];
  }
  const seen = new Set();
  const channels = [];
  metas.forEach((meta) => {
    const channel = normalizeLiveChannel(meta, options);
    if (!channel || seen.has(channel.id)) {
      return;
    }
    seen.add(channel.id);
    channels.push(channel);
  });
  return channels;
}

export function liveChannelKey(channel) {
  return `${normalizeText(channel?.addonBaseUrl)}::${normalizeText(channel?.id)}`;
}

export function isLiveChannel(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      normalizeText(value.id) &&
      normalizeText(value.type) === LIVE_CHANNEL_TYPE
  );
}

export const LIVE_CHANNEL_TYPE_NAME = LIVE_CHANNEL_TYPE;
"""

FILES["js/livetv/model/liveEpgProgram.js"] = r"""// Live TV EPG programme model.
//
// The Stremio-TV addon returns a `videos[]` programme array inside `meta` on
// /meta/tv/{id}.json whenever stremioTvDiagnostics.epg_status === "matched".
// Unmatched channels omit the key entirely.
//
// Each videos[] entry uses EXACTLY these fields:
//   id, title, released, startTime, endTime, runtime, overview, thumbnail,
//   genres[], releaseInfo
// There is no season/episode/description/name field and no `poster`; the image
// field is `thumbnail` and the synopsis field is `overview`.

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeGenres(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
      .join(", ");
  }
  return normalizeText(value);
}

const DEFAULT_PROGRAM_DURATION_MS = 30 * 60 * 1000;

export function toEpochMs(value) {
  if (value == null || value === "") {
    return 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

// "60 min", "1 h 30 m", "90" -> milliseconds. Returns 0 when unparseable.
export function parseRuntimeMs(value) {
  const text = normalizeText(value);
  if (!text) {
    return 0;
  }
  const hours = text.match(/(\d+(?:\.\d+)?)\s*h/i);
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*m/i);
  if (hours || minutes) {
    const totalMinutes = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
    return Number.isFinite(totalMinutes) && totalMinutes > 0 ? Math.round(totalMinutes * 60000) : 0;
  }
  const bare = Number(text);
  return Number.isFinite(bare) && bare > 0 ? Math.round(bare * 60000) : 0;
}

export function normalizeLiveEpgProgram(raw = {}, { channelId = "" } = {}) {
  const start = toEpochMs(raw.start ?? raw.startTime ?? raw.start_time ?? raw.begin);
  const end = toEpochMs(raw.end ?? raw.endTime ?? raw.end_time ?? raw.stop);
  const title = normalizeText(raw.title || raw.name || raw.programme);
  if (!title && !start) {
    return null;
  }
  const resolvedEnd = end > start ? end : start + DEFAULT_PROGRAM_DURATION_MS;
  const runtimeMs = parseRuntimeMs(raw.runtime ?? raw.duration ?? raw.length);
  const category = normalizeGenres(raw.genres) || normalizeText(raw.category || raw.genre);
  return Object.freeze({
    id: normalizeText(raw.id) || `${channelId}:${start}`,
    channelId: normalizeText(channelId),
    title: title || "Untitled",
    description: normalizeText(raw.overview || raw.description || raw.desc || raw.plot),
    start,
    end: resolvedEnd,
    durationMs: runtimeMs > 0 ? runtimeMs : Math.max(0, resolvedEnd - start),
    category,
    poster: normalizeText(raw.thumbnail || raw.poster || raw.icon),
    releaseInfo: normalizeText(raw.releaseInfo)
  });
}

export function normalizeLiveEpgProgramList(programs = [], options = {}) {
  if (!Array.isArray(programs)) {
    return [];
  }
  return programs
    .map((program) => normalizeLiveEpgProgram(program, options))
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
}

export function hasUsableEpg(programs = []) {
  return Array.isArray(programs) && programs.length > 0;
}

export const LIVE_EPG_DEFAULT_PROGRAM_DURATION_MS = DEFAULT_PROGRAM_DURATION_MS;
"""

FILES["js/livetv/model/liveSource.js"] = r"""// Live TV source model.
//
// A LiveSource is the normalized form of a Stremio `stream` entry returned by
// /stream/tv/{id}.json. Streams may carry behaviorHints.notWebReady and
// behaviorHints.proxyHeaders.request.Referer; both are preserved verbatim so
// TizenPlaybackProxy.resolve() can decide whether to proxy.

function normalizeText(value) {
  return String(value ?? "").trim();
}

export function normalizeLiveSourceHeaders(headers) {
  if (!headers || typeof headers !== "object") {
    return {};
  }
  const result = {};
  Object.entries(headers).forEach(([key, value]) => {
    const cleanKey = normalizeText(key);
    const cleanValue = normalizeText(value);
    if (cleanKey && cleanValue) {
      result[cleanKey] = cleanValue;
    }
  });
  return result;
}

export function normalizeLiveSource(raw = {}, { addonBaseUrl = "", channelId = "" } = {}) {
  const url = normalizeText(raw.url || raw.externalUrl || raw.link);
  if (!url) {
    return null;
  }
  const behaviorHints =
    raw.behaviorHints && typeof raw.behaviorHints === "object" ? raw.behaviorHints : {};
  const proxyHeaders =
    behaviorHints.proxyHeaders && typeof behaviorHints.proxyHeaders === "object"
      ? behaviorHints.proxyHeaders
      : {};
  const headers = normalizeLiveSourceHeaders(proxyHeaders.request || {});
  return Object.freeze({
    id: normalizeText(raw.id) || `${channelId}:${url}`,
    channelId: normalizeText(channelId),
    addonBaseUrl: normalizeText(addonBaseUrl),
    name: normalizeText(raw.name) || "Source",
    description: normalizeText(raw.description),
    url,
    notWebReady: behaviorHints.notWebReady === true,
    headers,
    hasHeaders: Object.keys(headers).length > 0,
    raw
  });
}

export function normalizeLiveSourceList(streams = [], options = {}) {
  if (!Array.isArray(streams)) {
    return [];
  }
  return streams.map((stream) => normalizeLiveSource(stream, options)).filter(Boolean);
}

export function liveSourceRequiresProxy(source) {
  return Boolean(source && (source.notWebReady === true || source.hasHeaders === true));
}

export function liveSourceLabel(source) {
  if (!source) {
    return "";
  }
  return [source.name, source.description].filter(Boolean).join(" · ");
}
"""

FILES["js/livetv/playback/livePlaybackStrategy.js"] = r"""// Live TV playback engine selection.
//
// This module is PURE. It never opens a player, never touches the DOM, never
// sets headers and never performs network I/O. It answers exactly one
// question: given the platform, the runtime capabilities and the source, which
// engine should decode this stream, and does it need the EngineFS proxy?
//
// The actual AVPlay wrapper, the hls.js/dash.js instances and the
// TizenPlaybackProxy.resolve() call live in the screen/player layer. Upstream
// already implements AVPlay track enrichment (commit 19f29242) and AIOStreams
// redirect repair (commit fca008d7); Live TV must reuse them.

export const LIVE_PLAYBACK_ENGINES = Object.freeze({
  AVPLAY: "avplay",
  HLSJS: "hlsjs",
  DASHJS: "dashjs",
  VIDEO: "video"
});

export const LIVE_SOURCE_KINDS = Object.freeze({
  HLS: "hls",
  DASH: "dash",
  PROGRESSIVE: "progressive",
  UNKNOWN: "unknown"
});

const HLS_PATTERN = /\.m3u8(?:$|[?#])/i;
const DASH_PATTERN = /\.mpd(?:$|[?#])/i;
const PROGRESSIVE_PATTERN = /\.(?:mkv|mp4|m4v|webm|mov|avi|ts|m2ts)(?:$|[?#])/i;

export function classifyLiveSource(url = "") {
  const value = String(url || "").trim();
  if (!value) {
    return LIVE_SOURCE_KINDS.UNKNOWN;
  }
  if (HLS_PATTERN.test(value)) {
    return LIVE_SOURCE_KINDS.HLS;
  }
  if (DASH_PATTERN.test(value)) {
    return LIVE_SOURCE_KINDS.DASH;
  }
  if (PROGRESSIVE_PATTERN.test(value)) {
    return LIVE_SOURCE_KINDS.PROGRESSIVE;
  }
  return LIVE_SOURCE_KINDS.UNKNOWN;
}

export function liveSourceNeedsProxy(source = {}) {
  const headers = source?.headers && typeof source.headers === "object" ? source.headers : {};
  return source?.notWebReady === true || Object.keys(headers).length > 0;
}

export function selectLivePlaybackEngine({
  platform = "browser",
  capabilities = {},
  source = {},
  options = {}
} = {}) {
  const normalizedPlatform = String(platform || "browser")
    .trim()
    .toLowerCase();
  const url = String(source?.url || "").trim();
  const sourceKind = classifyLiveSource(url);
  const needsProxy = liveSourceNeedsProxy(source);
  const proxyAvailable = options?.proxyAvailable !== false;
  const tizenAvplay = Boolean(capabilities?.tizenAvplay);
  const webosAvplay = Boolean(capabilities?.webosAvplay);
  const hlsJs = Boolean(capabilities?.hlsJs);
  const dashJs = Boolean(capabilities?.dashJs);
  const nativeVideo = capabilities?.nativeVideo !== false;

  const decide = (engine, requiresProxy, reason) => ({
    engine,
    requiresProxy: Boolean(requiresProxy),
    reason,
    sourceKind,
    platform: normalizedPlatform
  });

  // Rung 1/2: hardware decode via the platform native player. AVPlay handles
  // HLS, DASH and progressive containers, so it always wins when present.
  if (normalizedPlatform === "tizen" && tizenAvplay) {
    return decide(
      LIVE_PLAYBACK_ENGINES.AVPLAY,
      needsProxy,
      needsProxy ? "tizen-avplay-proxy" : "tizen-avplay"
    );
  }
  if (normalizedPlatform === "webos" && webosAvplay) {
    return decide(
      LIVE_PLAYBACK_ENGINES.AVPLAY,
      needsProxy,
      needsProxy ? "webos-avplay-proxy" : "webos-avplay"
    );
  }

  // Rung 3: a header-bearing stream cannot be played by <video> or hls.js
  // without the EngineFS proxy. The proxy is orthogonal to the engine, so pick
  // the best remaining engine for the container.
  if (needsProxy && proxyAvailable) {
    if (sourceKind === LIVE_SOURCE_KINDS.HLS && hlsJs) {
      return decide(LIVE_PLAYBACK_ENGINES.HLSJS, true, "proxy-hlsjs");
    }
    if (sourceKind === LIVE_SOURCE_KINDS.DASH && dashJs) {
      return decide(LIVE_PLAYBACK_ENGINES.DASHJS, true, "proxy-dashjs");
    }
    if (nativeVideo) {
      return decide(LIVE_PLAYBACK_ENGINES.VIDEO, true, "proxy-video");
    }
    return decide(LIVE_PLAYBACK_ENGINES.VIDEO, true, "proxy-video-fallback");
  }

  // Rung 4: software HLS.
  if (sourceKind === LIVE_SOURCE_KINDS.HLS && hlsJs) {
    return decide(LIVE_PLAYBACK_ENGINES.HLSJS, false, "hlsjs");
  }
  // Rung 5: software DASH.
  if (sourceKind === LIVE_SOURCE_KINDS.DASH && dashJs) {
    return decide(LIVE_PLAYBACK_ENGINES.DASHJS, false, "dashjs");
  }
  // Rung 6: progressive files play natively; hls.js is meaningless here.
  if (sourceKind === LIVE_SOURCE_KINDS.PROGRESSIVE && nativeVideo) {
    return decide(LIVE_PLAYBACK_ENGINES.VIDEO, false, "progressive-video");
  }
  // Native HLS (Safari-like engines) before giving up.
  if (sourceKind === LIVE_SOURCE_KINDS.HLS && nativeVideo) {
    return decide(LIVE_PLAYBACK_ENGINES.VIDEO, false, "native-hls-video");
  }
  // Rung 7: last resort.
  return decide(LIVE_PLAYBACK_ENGINES.VIDEO, needsProxy && proxyAvailable, "fallback-video");
}

export function buildLivePlaybackPlan(input = {}) {
  const decision = selectLivePlaybackEngine(input);
  const chain = [];
  if (decision.engine !== LIVE_PLAYBACK_ENGINES.AVPLAY) {
    chain.push(LIVE_PLAYBACK_ENGINES.AVPLAY);
  }
  chain.push(decision.engine);
  if (decision.engine !== LIVE_PLAYBACK_ENGINES.VIDEO) {
    chain.push(LIVE_PLAYBACK_ENGINES.VIDEO);
  }
  return { ...decision, fallbackChain: Array.from(new Set(chain)) };
}

export function describeLivePlaybackDecision(decision = {}) {
  const engine = String(decision.engine || "video");
  const proxy = decision.requiresProxy ? " + EngineFS proxy" : "";
  return `${engine}${proxy} (${decision.reason || "unknown"})`;
}
"""

FILES["js/livetv/core/liveTvState.js"] = r"""// Live TV state container.
//
// A tiny observable store. It holds the channel list, the selected channel,
// the EPG cache and the current guide window. It is deliberately free of DOM
// and network concerns so it can be unit-tested in Node.

export const LIVE_TV_STATE_EVENTS = Object.freeze({
  CHANNELS_CHANGED: "channels-changed",
  SELECTION_CHANGED: "selection-changed",
  EPG_CHANGED: "epg-changed",
  WINDOW_CHANGED: "window-changed",
  STATUS_CHANGED: "status-changed"
});

function createInitialState() {
  return {
    status: "idle",
    error: "",
    addonBaseUrl: "",
    catalogId: "channels",
    channels: [],
    channelNumbers: {},
    selectedChannelId: "",
    sourcesByChannel: {},
    epgByChannel: {},
    epgDiagnosticsByChannel: {},
    windowStartMs: 0,
    windowMinutes: 180
  };
}

export function createLiveTvState(initial = {}) {
  let state = { ...createInitialState(), ...(initial || {}) };
  const listeners = new Map();

  const emit = (event, payload) => {
    const handlers = listeners.get(event);
    if (!handlers) {
      return;
    }
    handlers.forEach((handler) => {
      try {
        handler(payload, state);
      } catch (error) {
        console.warn("Live TV state listener failed", error);
      }
    });
  };

  return {
    getState() {
      return state;
    },

    subscribe(event, handler) {
      if (typeof handler !== "function") {
        return () => {};
      }
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(handler);
      return () => {
        listeners.get(event)?.delete(handler);
      };
    },

    setStatus(status, error = "") {
      state = { ...state, status: String(status || "idle"), error: String(error || "") };
      emit(LIVE_TV_STATE_EVENTS.STATUS_CHANGED, { status: state.status, error: state.error });
    },

    setChannels(channels = [], channelNumbers = {}) {
      state = {
        ...state,
        channels: Array.isArray(channels) ? channels : [],
        channelNumbers: channelNumbers && typeof channelNumbers === "object" ? channelNumbers : {}
      };
      emit(LIVE_TV_STATE_EVENTS.CHANNELS_CHANGED, state.channels);
    },

    setSelectedChannel(channelId = "") {
      state = { ...state, selectedChannelId: String(channelId || "") };
      emit(LIVE_TV_STATE_EVENTS.SELECTION_CHANGED, state.selectedChannelId);
    },

    setSources(channelId, sources = []) {
      const key = String(channelId || "");
      state = {
        ...state,
        sourcesByChannel: { ...state.sourcesByChannel, [key]: Array.isArray(sources) ? sources : [] }
      };
    },

    setEpg(channelId, programs = [], diagnostics = null) {
      const key = String(channelId || "");
      state = {
        ...state,
        epgByChannel: { ...state.epgByChannel, [key]: Array.isArray(programs) ? programs : [] },
        epgDiagnosticsByChannel: {
          ...state.epgDiagnosticsByChannel,
          [key]: diagnostics && typeof diagnostics === "object" ? diagnostics : {}
        }
      };
      emit(LIVE_TV_STATE_EVENTS.EPG_CHANGED, { channelId: key, programs: state.epgByChannel[key] });
    },

    setWindow({ startMs, minutes } = {}) {
      state = {
        ...state,
        windowStartMs: Number.isFinite(Number(startMs)) ? Number(startMs) : state.windowStartMs,
        windowMinutes: Number.isFinite(Number(minutes)) ? Number(minutes) : state.windowMinutes
      };
      emit(LIVE_TV_STATE_EVENTS.WINDOW_CHANGED, {
        startMs: state.windowStartMs,
        minutes: state.windowMinutes
      });
    },

    reset() {
      state = createInitialState();
    }
  };
}

export const liveTvState = createLiveTvState();
"""

FILES["js/livetv/core/liveChannelNumbering.js"] = r"""// Deterministic channel numbering.
//
// Channel numbers are derived from the catalog order so they are stable across
// reloads. A pinned map lets the user override a specific channel number
// without renumbering everything else.

function normalizeText(value) {
  return String(value ?? "").trim();
}

export function assignChannelNumbers(channels = [], { start = 1, pinned = {} } = {}) {
  const list = Array.isArray(channels) ? channels : [];
  const pinnedMap = pinned && typeof pinned === "object" ? pinned : {};
  const numbers = {};
  const used = new Set();
  let cursor = Math.max(1, Math.trunc(Number(start) || 1));

  list.forEach((channel) => {
    const id = normalizeText(channel?.id);
    if (!id) {
      return;
    }
    const pinnedValue = Math.trunc(Number(pinnedMap[id]));
    if (Number.isFinite(pinnedValue) && pinnedValue > 0 && !used.has(pinnedValue)) {
      numbers[id] = pinnedValue;
      used.add(pinnedValue);
    }
  });

  list.forEach((channel) => {
    const id = normalizeText(channel?.id);
    if (!id || numbers[id]) {
      return;
    }
    while (used.has(cursor)) {
      cursor += 1;
    }
    numbers[id] = cursor;
    used.add(cursor);
    cursor += 1;
  });

  return numbers;
}

export function formatChannelNumber(value) {
  const numeric = Math.trunc(Number(value));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }
  return String(numeric).padStart(3, "0");
}

export function parseChannelNumberQuery(query = "") {
  const match = String(query || "")
    .trim()
    .match(/^(\d{1,4})$/);
  if (!match) {
    return 0;
  }
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function findChannelByNumber(channels = [], channelNumbers = {}, number = 0) {
  const target = Math.trunc(Number(number));
  if (!Number.isFinite(target) || target <= 0) {
    return null;
  }
  return (
    (Array.isArray(channels) ? channels : []).find(
      (channel) => Math.trunc(Number(channelNumbers?.[channel?.id])) === target
    ) || null
  );
}
"""

FILES["js/livetv/core/liveEpgNowNext.js"] = r"""// Now / Next computation for the guide.
//
// Pure functions over a sorted programme list. When the addon returns no
// programme array (the current Stremio-TV behaviour) these functions return
// empty results and the guide renders a "no guide data" placeholder.

export function findProgramAt(programs = [], atMs = Date.now()) {
  const list = Array.isArray(programs) ? programs : [];
  const at = Number(atMs);
  if (!Number.isFinite(at) || !list.length) {
    return null;
  }
  return list.find((program) => program.start <= at && program.end > at) || null;
}

export function findNextProgram(programs = [], atMs = Date.now()) {
  const list = Array.isArray(programs) ? programs : [];
  const at = Number(atMs);
  if (!Number.isFinite(at) || !list.length) {
    return null;
  }
  return list.find((program) => program.start > at) || null;
}

export function computeNowNext(programs = [], atMs = Date.now()) {
  return {
    now: findProgramAt(programs, atMs),
    next: findNextProgram(programs, atMs)
  };
}

export function computeProgressFraction(program, atMs = Date.now()) {
  if (!program || !Number.isFinite(Number(program.start)) || !Number.isFinite(Number(program.end))) {
    return 0;
  }
  const duration = Number(program.end) - Number(program.start);
  if (duration <= 0) {
    return 0;
  }
  const elapsed = Number(atMs) - Number(program.start);
  return Math.max(0, Math.min(1, elapsed / duration));
}

export function formatProgramTimeRange(program, locale = undefined) {
  if (!program) {
    return "";
  }
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit"
  });
  try {
    return `${formatter.format(new Date(program.start))} – ${formatter.format(new Date(program.end))}`;
  } catch (_) {
    return "";
  }
}
"""

FILES["js/livetv/core/liveGuideWindow.js"] = r"""// Windowed EPG slicing.
//
// The full EPG for 84 channels can be large on a Tizen 4 (Chromium 56) device.
// This module slices the programme list to the visible time window BEFORE the
// grid virtualizer mounts anything, so the DOM never sees more than the
// window plus overscan.

import { computeNowNext } from "./liveEpgNowNext.js";

export const GUIDE_DEFAULT_WINDOW_MINUTES = 180;

export function sliceGuideWindow(programs = [], { startMs = 0, endMs = 0 } = {}) {
  const list = Array.isArray(programs) ? programs : [];
  const from = Number(startMs);
  const to = Number(endMs);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return [];
  }
  return list.filter((program) => program.end > from && program.start < to);
}

export function buildGuideRows(
  channels = [],
  programsByChannel = {},
  { startMs = 0, endMs = 0, nowMs = Date.now() } = {}
) {
  const list = Array.isArray(channels) ? channels : [];
  return list.map((channel) => {
    const programs = programsByChannel?.[channel?.id] || [];
    const windowed = sliceGuideWindow(programs, { startMs, endMs });
    const { now, next } = computeNowNext(programs, nowMs);
    return {
      channel,
      programs: windowed,
      now,
      next,
      hasEpg: windowed.length > 0
    };
  });
}

export function computeGuideWindowBounds({ nowMs = Date.now(), minutes = GUIDE_DEFAULT_WINDOW_MINUTES } = {}) {
  const safeMinutes = Math.max(30, Math.trunc(Number(minutes) || GUIDE_DEFAULT_WINDOW_MINUTES));
  const anchor = Math.floor(Number(nowMs) / (30 * 60 * 1000)) * (30 * 60 * 1000);
  return {
    startMs: anchor,
    endMs: anchor + safeMinutes * 60 * 1000,
    minutes: safeMinutes
  };
}
"""

FILES["js/livetv/data/liveSourceRepository.js"] = r"""// Live TV addon client.
//
// This is a Stremio-protocol ADDON client, NOT an M3U parser. The Stremio-TV
// addon (com.stremiotv.philly) runs entirely on its own remote server; Nuvio
// only sends HTTP and parses JSON. No QuickJS, no PluginService, no plugin
// runtime is involved — addons work identically on Tizen 4, 5.5, 6+ and
// webOS 5+.

import { normalizeLiveChannelList } from "../model/liveChannel.js";
import { normalizeLiveSourceList } from "../model/liveSource.js";

export const STREMIO_TV_ADDON_BASE_URL = "https://dslayer6989.github.io/Stremio-TV";
export const STREMIO_TV_ADDON_ID = "com.stremiotv.philly";

// The 'local-test' catalog ("Local Test - Runner Blocked") is intentionally
// excluded. Only real catalogs are exposed.
export const LIVE_TV_CATALOGS = Object.freeze([
  { id: "channels", label: "All Channels" },
  { id: "favorites", label: "Favorites" },
  { id: "sports", label: "Sports" },
  { id: "news", label: "News" },
  { id: "entertainment", label: "Entertainment" },
  { id: "home", label: "Home" },
  { id: "documentary", label: "Documentary" },
  { id: "kids", label: "Kids" },
  { id: "movies", label: "Movies" }
]);

const DEFAULT_TIMEOUT_MS = 12000;

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || STREMIO_TV_ADDON_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
}

async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, signal = null } = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer =
    controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: signal || controller?.signal
    });
    if (!response.ok) {
      return { status: "error", message: `HTTP ${response.status}`, url };
    }
    const data = await response.json();
    return { status: "success", data, url };
  } catch (error) {
    return { status: "error", message: error?.message || String(error), url };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function buildCatalogUrl(baseUrl, catalogId, { genre = "", skip = 0 } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const id = String(catalogId || "channels").trim() || "channels";
  const cleanGenre = String(genre || "").trim();
  const suffix = cleanGenre ? `/genre=${encodeURIComponent(cleanGenre)}` : "";
  const skipParam = Number(skip) > 0 ? `/skip=${Math.trunc(Number(skip))}` : "";
  return `${base}/catalog/tv/${id}${suffix}${skipParam}.json`;
}

export function buildMetaUrl(baseUrl, channelId) {
  return `${normalizeBaseUrl(baseUrl)}/meta/tv/${encodeURIComponent(String(channelId || ""))}.json`;
}

export function buildStreamUrl(baseUrl, channelId) {
  return `${normalizeBaseUrl(baseUrl)}/stream/tv/${encodeURIComponent(String(channelId || ""))}.json`;
}

export const liveSourceRepository = {
  async fetchChannels({ baseUrl = STREMIO_TV_ADDON_BASE_URL, catalogId = "channels", genre = "", skip = 0, timeoutMs } = {}) {
    const url = buildCatalogUrl(baseUrl, catalogId, { genre, skip });
    const result = await fetchJson(url, { timeoutMs });
    if (result.status !== "success") {
      return { status: "error", message: result.message, url, channels: [] };
    }
    const metas = Array.isArray(result.data?.metas) ? result.data.metas : [];
    const channels = normalizeLiveChannelList(metas, { addonBaseUrl: normalizeBaseUrl(baseUrl) });
    return { status: "success", url, channels };
  },

  async fetchMeta({ baseUrl = STREMIO_TV_ADDON_BASE_URL, channelId = "", timeoutMs } = {}) {
    const url = buildMetaUrl(baseUrl, channelId);
    const result = await fetchJson(url, { timeoutMs });
    if (result.status !== "success") {
      return { status: "error", message: result.message, url, meta: null };
    }
    return { status: "success", url, meta: result.data?.meta || null };
  },

  async fetchSources({ baseUrl = STREMIO_TV_ADDON_BASE_URL, channelId = "", timeoutMs } = {}) {
    const url = buildStreamUrl(baseUrl, channelId);
    const result = await fetchJson(url, { timeoutMs });
    if (result.status !== "success") {
      return { status: "error", message: result.message, url, sources: [] };
    }
    const streams = Array.isArray(result.data?.streams) ? result.data.streams : [];
    const sources = normalizeLiveSourceList(streams, {
      addonBaseUrl: normalizeBaseUrl(baseUrl),
      channelId
    });
    return { status: "success", url, sources };
  }
};

export { normalizeBaseUrl as normalizeLiveTvBaseUrl };
"""

FILES["js/livetv/data/epgRepository.js"] = r"""// EPG repository.
//
// The Stremio-TV addon is a spec-compliant Stremio native EPG provider. Its
// /meta/tv/{id}.json response currently exposes `stremioTvDiagnostics`
// (epg_status, epg_matched, source_count, category, service_type, philly) but
// NOT a `videos[]` programme array. This repository therefore:
//   1. reads `videos[]` when present (future-proof),
//   2. always surfaces `stremioTvDiagnostics` for the settings/debug surface,
//   3. returns an empty programme list rather than throwing when absent.

import { normalizeLiveEpgProgramList } from "../model/liveEpgProgram.js";
import { liveSourceRepository } from "./liveSourceRepository.js";

export function extractEpgDiagnostics(meta = {}) {
  const diagnostics = meta?.stremioTvDiagnostics;
  return diagnostics && typeof diagnostics === "object" ? { ...diagnostics } : {};
}

export function extractEpgPrograms(meta = {}, { channelId = "" } = {}) {
  const videos = Array.isArray(meta?.videos) ? meta.videos : [];
  return normalizeLiveEpgProgramList(videos, { channelId });
}

export const epgRepository = {
  async fetchEpg({ baseUrl, channelId, timeoutMs } = {}) {
    const result = await liveSourceRepository.fetchMeta({ baseUrl, channelId, timeoutMs });
    if (result.status !== "success" || !result.meta) {
      return {
        status: "error",
        message: result.message || "EPG meta unavailable",
        programs: [],
        diagnostics: {}
      };
    }
    const programs = extractEpgPrograms(result.meta, { channelId });
    const diagnostics = extractEpgDiagnostics(result.meta);
    return {
      status: "success",
      programs,
      diagnostics,
      hasProgrammes: programs.length > 0
    };
  }
};
"""

FILES["js/livetv/data/liveEpgCacheStore.js"] = r"""// Profile-scoped EPG cache.
//
// Built on the existing profileScopedStore so the cache follows the active
// profile and participates in the same cloud-sync envelope as the rest of the
// app's per-profile settings.

import { createProfileScopedStore } from "../../data/local/profileScopedStore.js";

const LIVE_EPG_CACHE_KEY = "liveTvEpgCacheV1";
const LIVE_EPG_CACHE_TTL_MS = 15 * 60 * 1000;
const LIVE_EPG_CACHE_MAX_CHANNELS = 200;

function normalizeCacheEntry(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  const entries = value.entries && typeof value.entries === "object" ? value.entries : {};
  const normalized = {};
  Object.entries(entries).forEach(([channelId, entry]) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const cachedAtMs = Number(entry.cachedAtMs || 0);
    if (!Number.isFinite(cachedAtMs) || cachedAtMs <= 0) {
      return;
    }
    normalized[String(channelId)] = {
      cachedAtMs,
      programs: Array.isArray(entry.programs) ? entry.programs : [],
      diagnostics: entry.diagnostics && typeof entry.diagnostics === "object" ? entry.diagnostics : {}
    };
  });
  return { entries: normalized };
}

const store = createProfileScopedStore({
  key: LIVE_EPG_CACHE_KEY,
  normalize: normalizeCacheEntry
});

function pruneEntries(entries) {
  const sorted = Object.entries(entries).sort(
    (left, right) => Number(right[1].cachedAtMs || 0) - Number(left[1].cachedAtMs || 0)
  );
  return Object.fromEntries(sorted.slice(0, LIVE_EPG_CACHE_MAX_CHANNELS));
}

export const liveEpgCacheStore = {
  read(channelId) {
    const cache = store.get();
    const entry = cache.entries?.[String(channelId || "")];
    if (!entry) {
      return null;
    }
    if (Date.now() - Number(entry.cachedAtMs || 0) > LIVE_EPG_CACHE_TTL_MS) {
      return null;
    }
    return entry;
  },

  write(channelId, programs = [], diagnostics = {}) {
    const cache = store.get();
    const entries = {
      ...(cache.entries || {}),
      [String(channelId || "")]: {
        cachedAtMs: Date.now(),
        programs: Array.isArray(programs) ? programs : [],
        diagnostics: diagnostics && typeof diagnostics === "object" ? diagnostics : {}
      }
    };
    store.set({ entries: pruneEntries(entries) });
  },

  clear() {
    store.set({ entries: {} });
  }
};

export const LIVE_EPG_CACHE_TTL = LIVE_EPG_CACHE_TTL_MS;
"""

FILES["js/livetv/data/liveFavoritesStore.js"] = r"""// Profile-scoped Live TV favorites store.
//
// Favorites are a set of channel ids scoped to the active profile, stored in
// the same cloud-sync envelope as the rest of the app's per-profile settings.

import { createProfileScopedStore } from "../../data/local/profileScopedStore.js";

const LIVE_FAVORITES_KEY = "liveTvFavoritesV1";

function normalizeFavorites(value) {
  const source = value && typeof value === "object" ? value : {};
  const ids = Array.isArray(source.ids) ? source.ids : [];
  const seen = new Set();
  const normalized = [];
  ids.forEach((id) => {
    const clean = String(id ?? "").trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      normalized.push(clean);
    }
  });
  return { ids: normalized };
}

const store = createProfileScopedStore({
  key: LIVE_FAVORITES_KEY,
  normalize: normalizeFavorites
});

export const liveFavoritesStore = {
  list() {
    return store.get().ids.slice();
  },

  has(channelId) {
    return store.get().ids.includes(String(channelId ?? "").trim());
  },

  add(channelId) {
    const clean = String(channelId ?? "").trim();
    if (!clean) {
      return false;
    }
    const current = store.get().ids;
    if (current.includes(clean)) {
      return false;
    }
    store.set({ ids: [...current, clean] });
    return true;
  },

  remove(channelId) {
    const clean = String(channelId ?? "").trim();
    const current = store.get().ids;
    if (!current.includes(clean)) {
      return false;
    }
    store.set({ ids: current.filter((id) => id !== clean) });
    return true;
  },

  toggle(channelId) {
    return this.has(channelId) ? (this.remove(channelId), false) : (this.add(channelId), true);
  },

  clear() {
    store.set({ ids: [] });
  }
};

export { LIVE_FAVORITES_KEY };
"""

FILES["js/livetv/data/liveRecentsStore.js"] = r"""// Profile-scoped Live TV recents store.
//
// Records the most recently watched channel ids (most recent first), capped at
// LIVE_RECENTS_MAX entries, scoped to the active profile.

import { createProfileScopedStore } from "../../data/local/profileScopedStore.js";

const LIVE_RECENTS_KEY = "liveTvRecentsV1";
export const LIVE_RECENTS_MAX = 50;

function normalizeRecents(value) {
  const source = value && typeof value === "object" ? value : {};
  const ids = Array.isArray(source.ids) ? source.ids : [];
  const seen = new Set();
  const normalized = [];
  ids.forEach((id) => {
    const clean = String(id ?? "").trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      normalized.push(clean);
    }
  });
  return { ids: normalized.slice(0, LIVE_RECENTS_MAX) };
}

const store = createProfileScopedStore({
  key: LIVE_RECENTS_KEY,
  normalize: normalizeRecents
});

export const liveRecentsStore = {
  list() {
    return store.get().ids.slice();
  },

  record(channelId) {
    const clean = String(channelId ?? "").trim();
    if (!clean) {
      return false;
    }
    const current = store.get().ids.filter((id) => id !== clean);
    store.set({ ids: [clean, ...current].slice(0, LIVE_RECENTS_MAX) });
    return true;
  },

  clear() {
    store.set({ ids: [] });
  }
};

export { LIVE_RECENTS_KEY };
"""

FILES["js/livetv/ui/guideGridVirtualizer.js"] = r"""// Guide grid virtualization.
//
// Mirrors the pure-function design of js/ui/screens/stream/streamVirtualizer.js
// so the same reasoning applies: the full channel list stays in JavaScript,
// only a bounded window is mounted in the DOM. All calculations are pure and
// can be exercised without a TV DOM or an IntersectionObserver.
//
// The guide is a 2D grid (channels × time). Vertical virtualization uses the
// same prefix-offset model as the stream list; horizontal windowing is a
// separate pure function over the time axis.

export const GUIDE_VIRTUALIZATION_THRESHOLD = 40;
export const GUIDE_VIRTUALIZATION_MIN_WINDOW = 12;
export const GUIDE_VIRTUALIZATION_OVERSCAN_ROWS = 6;
export const GUIDE_VIRTUALIZATION_DEFAULT_ROW_EXTENT = 96;
export const GUIDE_DEFAULT_PIXELS_PER_MINUTE = 260 / 30;
export const GUIDE_DEFAULT_WINDOW_MINUTES = 180;

function finitePositive(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function finiteNonNegative(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function getMeasuredExtent(measuredExtents, key) {
  if (!measuredExtents) {
    return 0;
  }
  if (typeof measuredExtents.get === "function") {
    return Number(measuredExtents.get(key) || 0);
  }
  return Number(measuredExtents[key] || 0);
}

export function buildGuideVirtualModel(
  keys = [],
  measuredExtents = null,
  estimatedExtent = GUIDE_VIRTUALIZATION_DEFAULT_ROW_EXTENT,
  { rowGap = 0, lastRowGap = rowGap } = {}
) {
  const normalizedKeys = Array.isArray(keys) ? keys.map((key) => String(key)) : [];
  const fallbackExtent = finitePositive(estimatedExtent, GUIDE_VIRTUALIZATION_DEFAULT_ROW_EXTENT);
  const safeRowGap = finiteNonNegative(rowGap);
  const safeLastRowGap = finiteNonNegative(lastRowGap, safeRowGap);
  const fallbackHeight = Math.max(1, fallbackExtent - safeRowGap);
  const extents = normalizedKeys.map((key, index) => {
    const measuredHeight = getMeasuredExtent(measuredExtents, key);
    const contentHeight = finitePositive(measuredHeight, fallbackHeight);
    const trailingGap = index === normalizedKeys.length - 1 ? safeLastRowGap : safeRowGap;
    return contentHeight + trailingGap;
  });
  const offsets = new Array(extents.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < extents.length; index += 1) {
    offsets[index + 1] = offsets[index] + extents[index];
  }
  return {
    keys: normalizedKeys,
    extents,
    offsets,
    totalExtent: offsets[offsets.length - 1] || 0,
    estimatedExtent: fallbackExtent
  };
}

export function findGuideVirtualIndex(offsets = [], offset = 0) {
  const count = Math.max(0, offsets.length - 1);
  if (!count) {
    return -1;
  }
  const target = finiteNonNegative(offset);
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (Number(offsets[middle + 1] || 0) <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return Math.max(0, Math.min(count - 1, low));
}

function clampIndex(index, count) {
  return Math.max(0, Math.min(Math.max(0, count - 1), Math.trunc(Number(index) || 0)));
}

export function getGuideVirtualWindow(
  model,
  {
    scrollTop = 0,
    viewportHeight = 0,
    overscanRows = GUIDE_VIRTUALIZATION_OVERSCAN_ROWS,
    minWindow = GUIDE_VIRTUALIZATION_MIN_WINDOW,
    preferredIndex = null
  } = {}
) {
  const count = Array.isArray(model?.keys) ? model.keys.length : 0;
  if (!count) {
    return { start: 0, end: -1, topSpacer: 0, bottomSpacer: 0, totalExtent: 0 };
  }

  const offsets = Array.isArray(model.offsets) ? model.offsets : [0];
  const totalExtent = finiteNonNegative(model.totalExtent, offsets[count] || 0);
  const estimatedExtent = finitePositive(
    model.estimatedExtent,
    GUIDE_VIRTUALIZATION_DEFAULT_ROW_EXTENT
  );
  const safeScrollTop = Math.max(0, Math.min(finiteNonNegative(scrollTop), totalExtent));
  const safeViewportHeight = finitePositive(
    viewportHeight,
    estimatedExtent * Math.max(1, minWindow)
  );
  const safeOverscan = finiteNonNegative(overscanRows) * estimatedExtent;
  const safeMinWindow = Math.max(1, Math.min(count, Math.trunc(Number(minWindow) || 1)));
  const preferredValue = Number(preferredIndex);
  const preferred =
    preferredIndex != null && preferredIndex !== "" && Number.isFinite(preferredValue)
      ? clampIndex(preferredValue, count)
      : -1;

  let start = findGuideVirtualIndex(offsets, Math.max(0, safeScrollTop - safeOverscan));
  let end = findGuideVirtualIndex(
    offsets,
    Math.min(totalExtent, safeScrollTop + safeViewportHeight + safeOverscan)
  );

  if (preferred >= 0) {
    if (preferred < start) {
      start = preferred;
    }
    if (preferred > end) {
      end = preferred;
    }
  }

  if (end - start + 1 < safeMinWindow) {
    const anchor = preferred >= 0 ? preferred : Math.floor((start + end) / 2);
    const centeredStart = anchor - Math.floor(safeMinWindow / 2);
    start = Math.max(0, Math.min(count - safeMinWindow, centeredStart));
    end = Math.min(count - 1, start + safeMinWindow - 1);
  }

  return {
    start,
    end,
    topSpacer: Math.max(0, Number(offsets[start] || 0)),
    bottomSpacer: Math.max(0, totalExtent - Number(offsets[end + 1] || totalExtent)),
    totalExtent
  };
}

export function getGuideScrollTopForIndex(
  model,
  index,
  { currentScrollTop = 0, viewportHeight = 0, padding = 16 } = {}
) {
  const count = Array.isArray(model?.keys) ? model.keys.length : 0;
  if (!count || !Array.isArray(model?.offsets)) {
    return 0;
  }
  const rowIndex = clampIndex(index, count);
  const current = finiteNonNegative(currentScrollTop);
  const viewport = finitePositive(viewportHeight, model.estimatedExtent || 1);
  const safePadding = finiteNonNegative(padding);
  const rowTop = Number(model.offsets[rowIndex] || 0);
  const rowBottom = Number(model.offsets[rowIndex + 1] || rowTop);
  const viewBottom = current + viewport;
  if (rowTop < current + safePadding) {
    return Math.max(0, rowTop - safePadding);
  }
  if (rowBottom > viewBottom - safePadding) {
    return Math.max(0, rowBottom - viewport + safePadding);
  }
  return current;
}

export function getGuideTimeWindow({
  nowMs = Date.now(),
  windowMinutes = GUIDE_DEFAULT_WINDOW_MINUTES,
  pixelsPerMinute = GUIDE_DEFAULT_PIXELS_PER_MINUTE,
  scrollLeft = 0,
  viewportWidth = 0,
  overscanPx = 240
} = {}) {
  const safePixelsPerMinute = finitePositive(pixelsPerMinute, GUIDE_DEFAULT_PIXELS_PER_MINUTE);
  const safeWindowMinutes = finitePositive(windowMinutes, GUIDE_DEFAULT_WINDOW_MINUTES);
  const totalWidth = safeWindowMinutes * safePixelsPerMinute;
  const safeScrollLeft = Math.max(0, Math.min(finiteNonNegative(scrollLeft), totalWidth));
  const safeViewportWidth = finitePositive(viewportWidth, totalWidth);
  const safeOverscan = finiteNonNegative(overscanPx);
  const startPx = Math.max(0, safeScrollLeft - safeOverscan);
  const endPx = Math.min(totalWidth, safeScrollLeft + safeViewportWidth + safeOverscan);
  const anchorMs = Math.floor(Number(nowMs) / (30 * 60 * 1000)) * (30 * 60 * 1000);
  return {
    startMs: anchorMs + (startPx / safePixelsPerMinute) * 60 * 1000,
    endMs: anchorMs + (endPx / safePixelsPerMinute) * 60 * 1000,
    totalWidth,
    pixelsPerMinute: safePixelsPerMinute,
    anchorMs
  };
}
"""

FILES["js/livetv/ui/guideGridMetrics.js"] = r"""// Guide grid geometry helpers. Pure functions only.

import { GUIDE_DEFAULT_PIXELS_PER_MINUTE } from "./guideGridVirtualizer.js";

export const GUIDE_ROW_HEIGHT_PX = 96;
export const GUIDE_CHANNEL_COLUMN_WIDTH_PX = 300;
export const GUIDE_MIN_PROGRAM_WIDTH_PX = 48;

function finitePositive(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function computeGuideColumnWidth(pixelsPerMinute, minutes) {
  const safePixels = finitePositive(pixelsPerMinute, GUIDE_DEFAULT_PIXELS_PER_MINUTE);
  const safeMinutes = finitePositive(minutes, 30);
  return Math.max(GUIDE_MIN_PROGRAM_WIDTH_PX, safePixels * safeMinutes);
}

export function computeGuideProgramGeometry(
  program,
  windowStartMs,
  pixelsPerMinute = GUIDE_DEFAULT_PIXELS_PER_MINUTE
) {
  if (!program) {
    return { left: 0, width: 0, visible: false };
  }
  const safePixels = finitePositive(pixelsPerMinute, GUIDE_DEFAULT_PIXELS_PER_MINUTE);
  const offsetMinutes = (Number(program.start) - Number(windowStartMs)) / 60000;
  const durationMinutes = Math.max(0, (Number(program.end) - Number(program.start)) / 60000);
  const left = offsetMinutes * safePixels;
  const width = Math.max(GUIDE_MIN_PROGRAM_WIDTH_PX, durationMinutes * safePixels);
  return { left, width, visible: width > 0 };
}

export function computeGuideNowOffset(nowMs, windowStartMs, pixelsPerMinute = GUIDE_DEFAULT_PIXELS_PER_MINUTE) {
  const safePixels = finitePositive(pixelsPerMinute, GUIDE_DEFAULT_PIXELS_PER_MINUTE);
  return ((Number(nowMs) - Number(windowStartMs)) / 60000) * safePixels;
}

export function formatGuideTimeLabel(epochMs, locale = undefined) {
  try {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
      new Date(Number(epochMs))
    );
  } catch (_) {
    return "";
  }
}

export function buildGuideTimeTicks({ startMs, endMs, stepMinutes = 30, locale = undefined } = {}) {
  const from = Number(startMs);
  const to = Number(endMs);
  const step = Math.max(5, Math.trunc(Number(stepMinutes) || 30));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return [];
  }
  const ticks = [];
  const stepMs = step * 60 * 1000;
  const first = Math.ceil(from / stepMs) * stepMs;
  for (let at = first; at <= to; at += stepMs) {
    ticks.push({ atMs: at, label: formatGuideTimeLabel(at, locale) });
  }
  return ticks;
}
"""

FILES["js/livetv/ui/liveTvRows.js"] = r"""// Live TV home row builder.
//
// There is no androidx.tvprovider equivalent on Tizen or webOS. Live TV rows
// are IN-APP rows that feed the existing home row pipeline
// (homeRowMerge.js -> catalogRow.js). This module produces a row descriptor in
// the same shape the home screen already consumes.

import { formatChannelNumber } from "../core/liveChannelNumbering.js";
import { liveTvState } from "../core/liveTvState.js";

export const LIVE_TV_HOME_ROW_KEY = "livetv:channels";
export const LIVE_TV_HOME_ROW_MAX_ITEMS = 20;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function rowKey(row) {
  return normalizeText(row?.homeCatalogKey || row?.key);
}

export function buildLiveTvHomeRow(channels = [], { channelNumbers = {}, maxItems = LIVE_TV_HOME_ROW_MAX_ITEMS } = {}) {
  const list = Array.isArray(channels) ? channels : [];
  const limit = Math.max(1, Math.trunc(Number(maxItems) || LIVE_TV_HOME_ROW_MAX_ITEMS));
  const items = list.slice(0, limit).map((channel) => ({
    id: channel.id,
    type: "livetv",
    title: channel.name,
    subtitle: formatChannelNumber(channelNumbers?.[channel.id]),
    poster: channel.poster,
    posterShape: channel.posterShape || "square",
    isLive: channel.isLive === true,
    route: "livetv",
    routeParams: { channelId: channel.id }
  }));
  return {
    homeCatalogKey: LIVE_TV_HOME_ROW_KEY,
    rowKind: "livetv",
    title: "Live TV",
    source: "livetv",
    result: { data: { items } }
  };
}

export function buildLiveTvHomeRowFromState({ maxItems = LIVE_TV_HOME_ROW_MAX_ITEMS } = {}) {
  const state = liveTvState.getState();
  return buildLiveTvHomeRow(state.channels, { channelNumbers: state.channelNumbers, maxItems });
}

export function mergeLiveTvHomeRow(rows = [], liveTvRow = null, { position = "start" } = {}) {
  const list = Array.isArray(rows) ? rows.filter((row) => rowKey(row) !== LIVE_TV_HOME_ROW_KEY) : [];
  if (!liveTvRow || !Array.isArray(liveTvRow?.result?.data?.items) || liveTvRow.result.data.items.length === 0) {
    return list;
  }
  if (position === "end") {
    return [...list, liveTvRow];
  }
  return [liveTvRow, ...list];
}

export function isLiveTvRow(row) {
  return rowKey(row) === LIVE_TV_HOME_ROW_KEY;
}
"""

FILES["js/livetv/integration/tizenAppControl.js"] = r"""// Tizen app-control / voice-search integration.
//
// config.xml declares (emitted by the pinned buildConfigXml + patch_tizen_manifest.py):
//   <tizen:privilege name="http://tizen.org/privilege/application.launch"/>
//   <tizen:app-control>
//     <tizen:src name="index.html" reload="disable"/>
//     <tizen:operation name="http://samsung.com/appcontrol/operation/eden_resume"/>
//   </tizen:app-control>
//
// The query arrives under the extra-data key
// http://tizen.org/appcontrol/data/text. SmartHub Preview delivers a PAYLOAD
// key in ApplicationControlData.
//
// This handler is read on resume. It CANNOT be validated in a browser
// simulator — it must be validated on real hardware with the remote's voice
// key.

export const TIZEN_SEARCH_ACTION = "http://tizen.org/appcontrol/operation/search";
export const TIZEN_SEARCH_TEXT_KEY = "http://tizen.org/appcontrol/data/text";
export const TIZEN_SEARCH_PAYLOAD_KEY = "PAYLOAD";

function normalizeText(value) {
  return String(value ?? "").trim();
}

export function extractTizenSearchQuery(applicationControlData = {}) {
  const data = applicationControlData && typeof applicationControlData === "object" ? applicationControlData : {};
  const direct = normalizeText(data[TIZEN_SEARCH_TEXT_KEY]);
  if (direct) {
    return direct;
  }
  const payload = normalizeText(data[TIZEN_SEARCH_PAYLOAD_KEY]);
  if (payload) {
    try {
      const parsed = JSON.parse(payload);
      const nested = normalizeText(parsed?.[TIZEN_SEARCH_TEXT_KEY] || parsed?.query || parsed?.text);
      if (nested) {
        return nested;
      }
    } catch (_) {
      return payload;
    }
  }
  return "";
}

export function readTizenLaunchPayload() {
  const appControl = globalThis.tizen?.application?.getCurrentApplication?.()?.getRequestedAppControl?.();
  if (!appControl) {
    return { query: "", raw: null };
  }
  const data = appControl?.appControlData || {};
  return { query: extractTizenSearchQuery(data), raw: data };
}

export function createTizenAppControlHandler({ onSearch = () => {} } = {}) {
  let lastQuery = "";
  return {
    handleResume() {
      const { query, raw } = readTizenLaunchPayload();
      if (!query || query === lastQuery) {
        return false;
      }
      lastQuery = query;
      onSearch(query, raw);
      return true;
    },
    reset() {
      lastQuery = "";
    }
  };
}
"""

FILES["js/livetv/integration/webosLaunchParams.js"] = r"""// webOS launch-parameter integration.
//
// appinfo.json declares static launchPoints for app launch. Dynamic
// addLaunchPoint goes through luna://com.webos.service.applicationmanager
// (ACG application.launcher is already declared in the fork's appinfo.json).
// Deep links use ssap://system.launcher/launch with { id, params }.
//
// Incoming params are read from PalmSystem.launchParams. As with Tizen, this
// CANNOT be validated in a browser simulator.

function normalizeText(value) {
  return String(value ?? "").trim();
}

export function parseWebOsLaunchParams(raw) {
  if (!raw) {
    return {};
  }
  if (typeof raw === "object") {
    return raw;
  }
  const text = normalizeText(raw);
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

export function readWebOsLaunchPayload() {
  const raw = globalThis.PalmSystem?.launchParams;
  const params = parseWebOsLaunchParams(raw);
  const query = normalizeText(params.query || params.search || params.text);
  return { query, params, raw };
}

export function createWebOsLaunchHandler({ onSearch = () => {} } = {}) {
  let lastQuery = "";
  return {
    handleResume() {
      const { query, params } = readWebOsLaunchPayload();
      if (!query || query === lastQuery) {
        return false;
      }
      lastQuery = query;
      onSearch(query, params);
      return true;
    },
    reset() {
      lastQuery = "";
    }
  };
}

export function buildWebOsLaunchParams({ query = "", channelId = "" } = {}) {
  const params = {};
  const cleanQuery = normalizeText(query);
  const cleanChannelId = normalizeText(channelId);
  if (cleanQuery) {
    params.query = cleanQuery;
  }
  if (cleanChannelId) {
    params.channelId = cleanChannelId;
  }
  return params;
}
"""

FILES["js/livetv/liveTvSettings.js"] = r"""// Live TV settings model + markup.
//
// Registered into the existing settings layout via settingsLayoutMarkup.js.
// The section is only rendered on TV runtimes.

import { createProfileScopedStore } from "../data/local/profileScopedStore.js";
import { LIVE_TV_CATALOGS, STREMIO_TV_ADDON_BASE_URL } from "./data/liveSourceRepository.js";
import { liveTvState } from "./core/liveTvState.js";
import { appThemeLabel } from "./ui/liveTvTheme.js";

const LIVE_TV_SETTINGS_KEY = "liveTvSettingsV1";

function normalizeSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: source.enabled !== false,
    addonConfigured: source.addonConfigured !== false,
    addonBaseUrl: String(source.addonBaseUrl || STREMIO_TV_ADDON_BASE_URL).trim(),
    catalogId: String(source.catalogId || "channels").trim() || "channels",
    showHomeRow: source.showHomeRow !== false,
    guideWindowMinutes: Math.max(30, Math.trunc(Number(source.guideWindowMinutes) || 180)),
    pixelsPerMinute: Math.max(2, Number(source.pixelsPerMinute) || 260 / 30),
    channelNumbers: source.channelNumbers && typeof source.channelNumbers === "object" ? source.channelNumbers : {}
  };
}

const store = createProfileScopedStore({
  key: LIVE_TV_SETTINGS_KEY,
  normalize: normalizeSettings
});

export const liveTvSettings = {
  get() {
    return store.get();
  },

  set(partial) {
    return store.set(partial);
  },

  reset() {
    return store.replaceForProfile(null, normalizeSettings({}));
  }
};

export function renderLiveTvSettingsSection(ctx = {}) {
  const { t = (key, _params, fallback) => fallback || key, renderToggleRow, renderActionRow, renderCollapsibleRow, expanded = {} } = ctx;
  if (typeof renderToggleRow !== "function" || typeof renderCollapsibleRow !== "function") {
    return "";
  }
  const settings = liveTvSettings.get();
  const channelCount = Array.isArray(liveTvState.getState().channels) ? liveTvState.getState().channels.length : 0;
  const addonLabel = settings.addonConfigured ? "Addon configured" : "No addon";
  const countLine = settings.addonConfigured
    ? `${addonLabel} · ${channelCount} channels`
    : `${channelCount} channels`;
  const catalogLabel =
    LIVE_TV_CATALOGS.find((catalog) => catalog.id === settings.catalogId)?.label || settings.catalogId;
  const actionRow = typeof renderActionRow === "function" ? renderActionRow.bind(ctx) : null;
  const bodyHtml = `
          <div class="settings-stack">
            ${renderToggleRow({
              focusKey: "livetv:enabled",
              title: t("livetv.settings.enabled.title", {}, "Enable Live TV"),
              subtitle: t("livetv.settings.enabled.subtitle", {}, "Show Live TV in the sidebar and on Home."),
              checked: settings.enabled
            })}
            ${
              typeof renderActionRow === "function"
                ? renderActionRow({
                    focusKey: "livetv:theme",
                    title: t("livetv.settings.theme.title", {}, "App theme"),
                    subtitle: t("livetv.settings.theme.subtitle", {}, "Applies to the whole app."),
                    value: appThemeLabel()
                  })
                : ""
            }
            ${renderToggleRow({
              focusKey: "livetv:homeRow",
              title: t("livetv.settings.homeRow.title", {}, "Live TV row on Home"),
              subtitle: t("livetv.settings.homeRow.subtitle", {}, "Show a Live TV row on the Home screen."),
              checked: settings.showHomeRow
            })}
            ${
              actionRow
                ? actionRow({
                    focusKey: "livetv:addon",
                    title: t("livetv.settings.addon.title", {}, "Addon"),
                    subtitle: settings.addonConfigured
                      ? countLine
                      : t("livetv.settings.addon.subtitle", {}, "Set up Live TV"),
                    value: settings.addonConfigured ? settings.addonBaseUrl : ""
                  })
                : ""
            }
            ${
              actionRow
                ? actionRow({
                    focusKey: "livetv:channels",
                    title: t("livetv.settings.channels.title", {}, "Your channels"),
                    subtitle: countLine
                  })
                : ""
            }
            ${
              actionRow
                ? actionRow({
                    focusKey: "livetv:refresh",
                    title: t("livetv.settings.refresh.title", {}, "Refresh guide now")
                  })
                : ""
            }
            ${
              actionRow
                ? actionRow({
                    focusKey: "livetv:remove",
                    title: t("livetv.settings.remove.title", {}, "Remove addon"),
                    subtitle: t("livetv.settings.remove.subtitle", {}, "Live TV will ask for an addon link again.")
                  })
                : ""
            }
            ${
              actionRow
                ? actionRow({
                    focusKey: "livetv:clearFavorites",
                    title: t("livetv.settings.clearFavorites.title", {}, "Clear favorites")
                  })
                : ""
            }
            ${
              actionRow
                ? actionRow({
                    focusKey: "livetv:clearRecents",
                    title: t("livetv.settings.clearRecents.title", {}, "Clear recently watched")
                  })
                : ""
            }
            ${
              actionRow
                ? actionRow({
                    focusKey: "livetv:catalog",
                    title: t("livetv.settings.catalog.title", {}, "Channel catalog"),
                    subtitle: t("livetv.settings.catalog.subtitle", {}, "Choose which Stremio-TV catalog to load."),
                    value: catalogLabel
                  })
                : ""
            }
          </div>
        `;
  return renderCollapsibleRow({
    focusKey: "livetv:toggle:section",
    title: t("livetv.settings.section.title", {}, "Live TV"),
    subtitle: t("livetv.settings.section.subtitle", {}, "Addon link, guide refresh, favorites"),
    expanded: Boolean(expanded.liveTv),
    bodyHtml
  });
}

export { LIVE_TV_SETTINGS_KEY };
"""

FILES["js/livetv/ui/liveTvScreen.js"] = r"""// Live TV screen — unified guide grid.
//
// Screen contract: mount(params, navigationContext), render(), cleanup(),
// getRouteStateKey(params), captureRouteState(), handleKey(event),
// getCapabilities(), unmount(), isMounted().
//
// Layout mirrors the desktop guide: ONE horizontal scroller holds a sticky
// time header and a vertically virtualized row list; each row is
// [sticky channel cell][programme lane]; programme cells are absolutely
// positioned inside the lane; a single now-marker spans the row list.

import { Platform } from "../../platform/index.js";
import { ScreenUtils } from "../../ui/navigation/screen.js";
import { liveTvState } from "../core/liveTvState.js";
import { assignChannelNumbers, formatChannelNumber } from "../core/liveChannelNumbering.js";
import { buildGuideRows, computeGuideWindowBounds } from "../core/liveGuideWindow.js";
import { liveSourceRepository } from "../data/liveSourceRepository.js";
import { epgRepository } from "../data/epgRepository.js";
import { liveEpgCacheStore } from "../data/liveEpgCacheStore.js";
import { liveFavoritesStore } from "../data/liveFavoritesStore.js";
import { liveRecentsStore } from "../data/liveRecentsStore.js";
import { liveTvSettings } from "../liveTvSettings.js";
import { applyAppTheme } from "./liveTvTheme.js";
import { buildGuideVirtualModel, getGuideVirtualWindow } from "./guideGridVirtualizer.js";
import {
  buildGuideTimeTicks,
  computeGuideNowOffset,
  computeGuideProgramGeometry,
  GUIDE_CHANNEL_COLUMN_WIDTH_PX,
  GUIDE_ROW_HEIGHT_PX
} from "./guideGridMetrics.js";

const LIVE_TV_ROUTE = "livetv";
const LIVE_TV_HOST_ID = "livetv";
const LIVE_TV_EPG_PREFETCH_LIMIT = 20;
const LIVE_TV_ROW_EXTENT_PX = GUIDE_ROW_HEIGHT_PX;
const LIVE_TV_CHANNEL_COLUMN_PX = GUIDE_CHANNEL_COLUMN_WIDTH_PX;
const BACK_KEY_CODES = new Set([8, 27, 461, 10009]);
const PROGRAM_FOCUS_SELECTOR = ".livetv-guide-program.focusable";
const CHANNEL_FOCUS_SELECTOR = ".livetv-guide-channel.focusable";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatClock(epochMs) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
      new Date(Number(epochMs))
    );
  } catch (_) {
    return "";
  }
}

export function resolveLiveTvHost() {
  let host = document.getElementById(LIVE_TV_HOST_ID);
  if (host) {
    return host;
  }
  host = document.createElement("div");
  host.id = LIVE_TV_HOST_ID;
  host.className = "screen";
  const appRoot = document.getElementById("app") || document.body;
  appRoot.appendChild(host);
  return host;
}

export function createLiveTvScreen() {
  let mounted = false;
  let container = null;
  let scrollTop = 0;
  let viewportHeight = 0;
  let focusChannelId = "";
  let focusProgramIndex = 0;

  const settings = liveTvSettings.get();

  async function loadChannels() {
    liveTvState.setStatus("loading");
    const result = await liveSourceRepository.fetchChannels({
      baseUrl: settings.addonBaseUrl,
      catalogId: settings.catalogId
    });
    if (result.status !== "success") {
      liveTvState.setStatus("error", result.message || "Failed to load channels");
      return;
    }
    const channelNumbers = assignChannelNumbers(result.channels, { pinned: settings.channelNumbers });
    liveTvState.setChannels(result.channels, channelNumbers);
    liveTvState.setStatus("ready");
  }

  async function loadEpgForVisible(channels) {
    const list = Array.isArray(channels) ? channels : [];
    await Promise.all(
      list.slice(0, LIVE_TV_EPG_PREFETCH_LIMIT).map(async (channel) => {
        const cached = liveEpgCacheStore.read(channel.id);
        if (cached) {
          liveTvState.setEpg(channel.id, cached.programs, cached.diagnostics);
          return;
        }
        const result = await epgRepository.fetchEpg({
          baseUrl: settings.addonBaseUrl,
          channelId: channel.id
        });
        if (result.status === "success") {
          liveEpgCacheStore.write(channel.id, result.programs, result.diagnostics);
          liveTvState.setEpg(channel.id, result.programs, result.diagnostics);
        }
      })
    );
  }

  function renderTimeHeader(bounds, ticks) {
    const dayLabel = formatClock(bounds.startMs);
    return `
      <div class="livetv-guide-header">
        <div class="livetv-guide-header-day">${escapeHtml(dayLabel)}</div>
        ${ticks
          .map((tick) => {
            const left = ((tick.atMs - bounds.startMs) / 60000) * settings.pixelsPerMinute;
            return `<div class="livetv-guide-tick" style="left:${Math.round(left)}px">${escapeHtml(tick.label)}</div>`;
          })
          .join("")}
      </div>
    `;
  }

  function renderChannelCell(row, state) {
    const channel = row.channel;
    const number = formatChannelNumber(state.channelNumbers[channel.id]);
    const favorite = liveFavoritesStore.has(channel.id);
    const highlighted = state.selectedChannelId === channel.id;
    const logo = channel.poster
      ? `<img class="livetv-guide-channel-logo" src="${escapeHtml(channel.poster)}" alt="" />`
      : `<span class="livetv-guide-channel-logo"></span>`;
    return `
      <button class="livetv-guide-channel focusable${highlighted ? " is-highlighted" : ""}"
              type="button"
              data-channel-id="${escapeHtml(channel.id)}"
              data-nav-zone="livetv-channels">
        <span class="livetv-guide-channel-number">${escapeHtml(number)}</span>
        ${logo}
        <span class="livetv-guide-channel-name">${escapeHtml(channel.name)}</span>
        <span class="livetv-guide-channel-star${favorite ? " is-favorite" : ""}">${favorite ? "\u2605" : "\u2606"}</span>
      </button>
    `;
  }

  function renderProgramCell(program, row, bounds, index) {
    const geometry = computeGuideProgramGeometry(program, bounds.startMs, settings.pixelsPerMinute);
    if (!geometry.visible) {
      return "";
    }
    const nowMs = Date.now();
    const airing = program.start <= nowMs && program.end > nowMs;
    const past = program.end <= nowMs;
    const stateClass = airing ? " is-airing" : past ? " is-past" : "";
    const progress = airing
      ? Math.max(0, Math.min(1, (nowMs - program.start) / Math.max(1, program.end - program.start)))
      : 0;
    return `
      <button class="livetv-guide-program focusable${stateClass}"
              type="button"
              style="left:${Math.round(geometry.left)}px;width:${Math.round(geometry.width)}px"
              data-channel-id="${escapeHtml(row.channel.id)}"
              data-program-index="${index}"
              data-program-id="${escapeHtml(program.id)}"
              data-nav-zone="livetv-programs">
        <span class="livetv-guide-program-fill">
          ${airing ? `<span class="livetv-guide-program-progress" style="width:${Math.round(progress * 100)}%"></span>` : ""}
        </span>
        <span class="livetv-guide-program-title">${escapeHtml(program.title)}</span>
        <span class="livetv-guide-program-time">${escapeHtml(formatClock(program.start))}</span>
      </button>
    `;
  }

  function renderRow(row, bounds, state) {
    const focused = state.selectedChannelId === row.channel.id;
    return `
      <div class="livetv-guide-row${focused ? " is-focused" : ""}" data-channel-id="${escapeHtml(row.channel.id)}">
        ${renderChannelCell(row, state)}
        <div class="livetv-guide-programs">
          ${
            row.hasEpg
              ? row.programs.map((program, index) => renderProgramCell(program, row, bounds, index)).join("")
              : `<span class="livetv-guide-empty">No guide data</span>`
          }
        </div>
      </div>
    `;
  }

  function renderGuide(state) {
    const bounds = computeGuideWindowBounds({
      nowMs: Date.now(),
      minutes: state.windowMinutes || settings.guideWindowMinutes
    });
    const rows = buildGuideRows(state.channels, state.epgByChannel, {
      startMs: bounds.startMs,
      endMs: bounds.endMs,
      nowMs: Date.now()
    });
    if (!rows.length) {
      return `<div class="livetv-guide"><div class="livetv-guide-empty">No channels</div></div>`;
    }
    const model = buildGuideVirtualModel(
      rows.map((row) => row.channel.id),
      null,
      LIVE_TV_ROW_EXTENT_PX
    );
    const preferredIndex = rows.findIndex((row) => row.channel.id === state.selectedChannelId);
    const window = getGuideVirtualWindow(model, {
      scrollTop,
      viewportHeight,
      preferredIndex
    });
    const visibleRows = rows.slice(window.start, window.end + 1);
    const ticks = buildGuideTimeTicks({
      startMs: bounds.startMs,
      endMs: bounds.endMs,
      stepMinutes: 30
    });
    const nowOffset = computeGuideNowOffset(Date.now(), bounds.startMs, settings.pixelsPerMinute);
    const laneWidth = Math.round(((bounds.endMs - bounds.startMs) / 60000) * settings.pixelsPerMinute);
    return `
      <div class="livetv-guide" data-window-start="${bounds.startMs}">
        <div class="livetv-guide-scroll">
          <div class="livetv-guide-inner" style="width:${LIVE_TV_CHANNEL_COLUMN_PX + laneWidth}px">
            ${renderTimeHeader(bounds, ticks)}
            <div class="livetv-guide-body">
              <div class="livetv-guide-spacer" style="height:${window.topSpacer}px"></div>
              ${visibleRows.map((row) => renderRow(row, bounds, state)).join("")}
              <div class="livetv-guide-spacer" style="height:${window.bottomSpacer}px"></div>
              <div class="livetv-guide-now"
                   style="left:${LIVE_TV_CHANNEL_COLUMN_PX + Math.round(nowOffset)}px;height:${model.totalExtent}px"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function restoreFocus() {
    if (!container) {
      return;
    }
    const target =
      container.querySelector(
        `${PROGRAM_FOCUS_SELECTOR}[data-channel-id="${focusChannelId}"][data-program-index="${focusProgramIndex}"]`
      ) ||
      container.querySelector(`${PROGRAM_FOCUS_SELECTOR}[data-channel-id="${focusChannelId}"]`) ||
      container.querySelector(PROGRAM_FOCUS_SELECTOR) ||
      container.querySelector(CHANNEL_FOCUS_SELECTOR);
    if (target && typeof target.focus === "function") {
      target.focus();
    }
  }

  function syncViewport() {
    const body = container?.querySelector(".livetv-guide-body");
    viewportHeight = Number(body?.clientHeight || viewportHeight || 0);
  }

  return {
    route: LIVE_TV_ROUTE,

    getRouteStateKey() {
      return LIVE_TV_ROUTE;
    },

    captureRouteState() {
      const state = liveTvState.getState();
      return {
        channelId: String(state.selectedChannelId || ""),
        scrollTop: Number(scrollTop || 0),
        windowStartMs: Number(state.windowStartMs || 0)
      };
    },

    renderSetupPrompt() {
      if (!container) {
        return;
      }
      container.innerHTML = `
        <div class="livetv-setup">
          <h2 class="livetv-setup-title">Set up Live TV</h2>
          <p class="livetv-setup-body">Paste the manifest link of a Stremio addon with live channels. Guide data from the addon is loaded automatically.</p>
          <button class="livetv-setup-action focusable" data-nav-zone="livetv-setup" type="button">Add addon link</button>
        </div>
      `;
      ScreenUtils.indexFocusables(container, ".livetv-setup-action.focusable");
      ScreenUtils.setInitialFocus(container, ".livetv-setup-action.focusable");
    },

    async submitSetupPrompt(addonBaseUrl = "") {
      const normalized = String(addonBaseUrl || "")
        .trim()
        .replace(/\/manifest\.json$/i, "")
        .replace(/\/+$/, "");
      if (!normalized) {
        return false;
      }
      liveTvSettings.set({ addonBaseUrl: normalized, addonConfigured: true });
      await loadChannels();
      this.render();
      return true;
    },

    async mount(params = {}, navigationContext = {}) {
      applyAppTheme();
      container = resolveLiveTvHost();
      mounted = true;
      scrollTop = 0;
      ScreenUtils.show(container);
      if (liveTvSettings.get().addonConfigured === false && liveTvSettings.get().forceSetupPrompt === true) {
        this.renderSetupPrompt();
        return;
      }
      const restored = navigationContext?.restoredState || null;
      if (restored && Number.isFinite(Number(restored.scrollTop))) {
        scrollTop = Number(restored.scrollTop);
      }
      const requestedChannelId = String(params?.channelId || restored?.channelId || "");
      const state = liveTvState.getState();
      if (!state.channels.length) {
        await loadChannels();
      }
      if (requestedChannelId) {
        liveTvState.setSelectedChannel(requestedChannelId);
        liveRecentsStore.record(requestedChannelId);
      }
      focusChannelId = String(liveTvState.getState().selectedChannelId || requestedChannelId || "");
      await loadEpgForVisible(liveTvState.getState().channels);
      this.render();
    },

    render() {
      if (!container) {
        return;
      }
      const state = liveTvState.getState();
      container.innerHTML = `<div class="livetv-shell">${renderGuide(state)}</div>`;
      ScreenUtils.indexFocusables(container, `${PROGRAM_FOCUS_SELECTOR}, ${CHANNEL_FOCUS_SELECTOR}`);
      restoreFocus();
      syncViewport();
    },

    handleKey(event) {
      const keyCode = Number(event?.keyCode || 0);
      if (BACK_KEY_CODES.has(keyCode)) {
        return false;
      }
      if (keyCode === 38 || keyCode === 40) {
        syncViewport();
        scrollTop = Math.max(
          0,
          scrollTop + (keyCode === 40 ? LIVE_TV_ROW_EXTENT_PX : -LIVE_TV_ROW_EXTENT_PX)
        );
        this.render();
        return true;
      }
      const focusedNode = container?.querySelector(`${PROGRAM_FOCUS_SELECTOR}.focused, ${PROGRAM_FOCUS_SELECTOR}:focus`);
      if (focusedNode) {
        focusChannelId = String(focusedNode.dataset.channelId || focusChannelId);
        focusProgramIndex = Number(focusedNode.dataset.programIndex || 0);
      }
      return ScreenUtils.handleDpadNavigation(event, container, `${PROGRAM_FOCUS_SELECTOR}, ${CHANNEL_FOCUS_SELECTOR}`);
    },

    getCapabilities() {
      const capabilities = Platform.getCapabilities();
      return { ...capabilities, liveTv: true };
    },

    cleanup() {
      mounted = false;
      if (container) {
        container.innerHTML = "";
        ScreenUtils.hide(container);
      }
      container = null;
    },

    unmount() {
      this.cleanup();
    },

    isMounted() {
      return mounted;
    }
  };
}

export const liveTvScreen = createLiveTvScreen();
"""

FILES["js/livetv/ui/liveTvTheme.js"] = r"""// App-wide theme controller.
//
// The three themes are pure CSS custom-property blocks in css/themes.css,
// selected by a data-theme attribute on <html>. This module is the only
// writer of that attribute, so the whole app re-skins without a reload.

import { createProfileScopedStore } from "../../data/local/profileScopedStore.js";

const APP_THEME_KEY = "appThemeV1";
const DEFAULT_THEME_ID = "default";

export const APP_THEMES = Object.freeze([
  { id: "default", label: "Nuvio Dark" },
  { id: "neon", label: "Neon" },
  { id: "retrocable", label: "Retro Cable" },
  { id: "teletext", label: "Teletext" }
]);

function normalizeTheme(value) {
  const source = value && typeof value === "object" ? value : {};
  const id = String(source.id || DEFAULT_THEME_ID).trim();
  return { id: APP_THEMES.some((theme) => theme.id === id) ? id : DEFAULT_THEME_ID };
}

const store = createProfileScopedStore({
  key: APP_THEME_KEY,
  normalize: normalizeTheme
});

export function getAppTheme() {
  return store.get().id;
}

export function appThemeLabel() {
  const id = getAppTheme();
  return APP_THEMES.find((theme) => theme.id === id)?.label || id;
}

export function applyAppTheme(id = getAppTheme()) {
  if (typeof document === "undefined" || !document.documentElement) {
    return id;
  }
  const resolved = APP_THEMES.some((theme) => theme.id === id) ? id : DEFAULT_THEME_ID;
  if (resolved === DEFAULT_THEME_ID) {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", resolved);
  }
  return resolved;
}

export function setAppTheme(id) {
  const resolved = applyAppTheme(id);
  store.set({ id: resolved });
  return resolved;
}

export function cycleAppTheme() {
  const current = getAppTheme();
  const index = APP_THEMES.findIndex((theme) => theme.id === current);
  const next = APP_THEMES[(index + 1) % APP_THEMES.length];
  return setAppTheme(next.id);
}

// Apply the persisted theme as soon as this module is first imported.
applyAppTheme();

export { APP_THEME_KEY, DEFAULT_THEME_ID };
"""

FILES["css/themes.css"] = r"""/* App-wide theme tokens.
   The default theme is :root in css/base.css — no block here.
   Every other stylesheet consumes these properties, so setting
   <html data-theme="..."> re-themes the whole app without a reload. */

html[data-theme="neon"] {
  --nuvio-bg: #07060D;
  --nuvio-surface: #0F0C1A;
  --nuvio-surface-raised: #171329;
  --nuvio-panel: rgba(18, 15, 34, 0.8);
  --nuvio-grid-line: #231E3A;
  --nuvio-grid-line-strong: #342C57;
  --nuvio-accent: #00E5FF;
  --nuvio-accent-soft: #5CF2FF;
  --nuvio-highlight: #FF2BD6;
  --nuvio-accent-deep: #7C4DFF;
  --nuvio-live: #FF3B6B;
  --nuvio-on-accent: #05040A;
  --nuvio-text-primary: #F4F2FF;
  --nuvio-text-secondary: #B9B3D9;
  --nuvio-text-muted: #7D7699;
  --nuvio-past-cell: #0D0B17;
  --nuvio-future-cell: #15122A;
  --nuvio-airing-cell: #1B1840;
  --nuvio-accent-gradient: linear-gradient(90deg, #7C4DFF, #00E5FF, #FF2BD6);
  --nuvio-airing-gradient: linear-gradient(180deg, #1E2A55, #2A1745);
  --nuvio-screen-gradient: linear-gradient(180deg, #0B0917, #07060D, #05040A);
  --nuvio-now-gradient: linear-gradient(180deg, #00E5FF, #FF2BD6);
  --nuvio-progress-gradient: linear-gradient(90deg, #00E5FF, #FF2BD6);
  --nuvio-logo-tile: linear-gradient(180deg, #1B1733, #100D1E);
  --nuvio-corner-scale: 1;
  --nuvio-glow: 1;
  --nuvio-heading-font: "Inter", "Segoe UI", Arial, sans-serif;

  --bg-color: #07060D;
  --bg-color-rgb: 7 6 13;
  --bg-elevated: #0F0C1A;
  --bg-elevated-rgb: 15 12 26;
  --card-bg: #171329;
  --card-bg-rgb: 23 19 41;
  --secondary-color: #00E5FF;
  --secondary-color-rgb: 0 229 255;
  --text-color: #F4F2FF;
  --text-secondary: #B9B3D9;
  --text-tertiary: #7D7699;
  --border-color: #231E3A;
  --focus-color: #00E5FF;
  --focus-color-rgb: 0 229 255;
  --focus-bg: #171329;
  --error-color: #FF3B6B;
}

html[data-theme="retrocable"] {
  --nuvio-bg: #06123F;
  --nuvio-surface: #0E2266;
  --nuvio-surface-raised: #16307F;
  --nuvio-panel: rgba(11, 27, 85, 0.9);
  --nuvio-grid-line: #2A4596;
  --nuvio-grid-line-strong: #4262B8;
  --nuvio-accent: #FFD83D;
  --nuvio-accent-soft: #FFE680;
  --nuvio-highlight: #7FD4FF;
  --nuvio-accent-deep: #FF9F1C;
  --nuvio-live: #FF4D4D;
  --nuvio-on-accent: #0A1440;
  --nuvio-text-primary: #F4F7FF;
  --nuvio-text-secondary: #C3D0F2;
  --nuvio-text-muted: #8A9BD0;
  --nuvio-past-cell: #0A1A52;
  --nuvio-future-cell: #12297A;
  --nuvio-airing-cell: #2446B4;
  --nuvio-accent-gradient: linear-gradient(90deg, #FF9F1C, #FFD83D, #7FD4FF);
  --nuvio-airing-gradient: linear-gradient(180deg, #2446B4, #16307F);
  --nuvio-screen-gradient: linear-gradient(180deg, #0E2266, #06123F, #040C2B);
  --nuvio-now-gradient: linear-gradient(180deg, #FFD83D, #FF9F1C);
  --nuvio-progress-gradient: linear-gradient(90deg, #FFD83D, #7FD4FF);
  --nuvio-logo-tile: linear-gradient(180deg, #16307F, #0E2266);
  --nuvio-corner-scale: 0.15;
  --nuvio-glow: 0;
  --nuvio-heading-font: "DM Sans", "Inter", Arial, sans-serif;

  --bg-color: #06123F;
  --bg-color-rgb: 6 18 63;
  --bg-elevated: #0E2266;
  --bg-elevated-rgb: 14 34 102;
  --card-bg: #16307F;
  --card-bg-rgb: 22 48 127;
  --secondary-color: #FFD83D;
  --secondary-color-rgb: 255 216 61;
  --text-color: #F4F7FF;
  --text-secondary: #C3D0F2;
  --text-tertiary: #8A9BD0;
  --border-color: #2A4596;
  --focus-color: #FFD83D;
  --focus-color-rgb: 255 216 61;
  --focus-bg: #16307F;
  --error-color: #FF4D4D;
}

html[data-theme="teletext"] {
  --nuvio-bg: #000000;
  --nuvio-surface: #000000;
  --nuvio-surface-raised: #0000AA;
  --nuvio-panel: rgba(0, 0, 0, 0.94);
  --nuvio-grid-line: #2E2E2E;
  --nuvio-grid-line-strong: #5A5A5A;
  --nuvio-accent: #FFFF00;
  --nuvio-accent-soft: #00FFFF;
  --nuvio-highlight: #FF00FF;
  --nuvio-accent-deep: #FF0000;
  --nuvio-live: #FF0000;
  --nuvio-on-accent: #000000;
  --nuvio-text-primary: #FFFFFF;
  --nuvio-text-secondary: #00FFFF;
  --nuvio-text-muted: #B0B0B0;
  --nuvio-past-cell: #0A0A0A;
  --nuvio-future-cell: #141414;
  --nuvio-airing-cell: #0000AA;
  --nuvio-accent-gradient: linear-gradient(90deg, #FFFF00, #00FFFF);
  --nuvio-airing-gradient: linear-gradient(180deg, #0000AA, #000066);
  --nuvio-screen-gradient: linear-gradient(180deg, #000000, #000000, #000000);
  --nuvio-now-gradient: linear-gradient(180deg, #00FFFF, #FFFF00);
  --nuvio-progress-gradient: linear-gradient(90deg, #00FF00, #FFFF00);
  --nuvio-logo-tile: linear-gradient(180deg, #0000AA, #000000);
  --nuvio-corner-scale: 0;
  --nuvio-glow: 0;
  --nuvio-heading-font: "Open Sans", "Inter", Arial, sans-serif;

  --bg-color: #000000;
  --bg-color-rgb: 0 0 0;
  --bg-elevated: #000000;
  --bg-elevated-rgb: 0 0 0;
  --card-bg: #0000AA;
  --card-bg-rgb: 0 0 170;
  --secondary-color: #FFFF00;
  --secondary-color-rgb: 255 255 0;
  --text-color: #FFFFFF;
  --text-secondary: #00FFFF;
  --text-tertiary: #B0B0B0;
  --border-color: #2E2E2E;
  --focus-color: #FFFF00;
  --focus-color-rgb: 255 255 0;
  --focus-bg: #0000AA;
  --error-color: #FF0000;
}
"""

FILES["css/livetv.css"] = r"""/* Live TV unified guide grid — Smart TV (Tizen / webOS).
   Every colour is a css/themes.css custom property, so the three themes
   re-skin this file with no additional selectors. */

.livetv-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--nuvio-screen-gradient, var(--nuvio-bg));
  color: var(--nuvio-text-primary);
  font-family: var(--app-font-family);
}

.livetv-guide { display: flex; flex-direction: column; width: 100%; height: 100%; }

.livetv-guide-scroll { position: relative; flex: 1 1 auto; overflow-x: auto; overflow-y: hidden; }
.livetv-guide-inner { display: flex; flex-direction: column; height: 100%; min-width: 100%; }

.livetv-guide-header {
  position: relative;
  flex: 0 0 56px;
  height: 56px;
  background: var(--nuvio-surface);
  border-bottom: 1px solid var(--nuvio-grid-line-strong);
  z-index: 5;
}
.livetv-guide-header-day {
  position: sticky;
  left: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  width: 300px;
  min-width: 300px;
  height: 100%;
  padding-left: 14px;
  box-sizing: border-box;
  background: var(--nuvio-surface);
  border-right: 1px solid var(--nuvio-grid-line-strong);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--nuvio-text-secondary);
}
.livetv-guide-tick {
  position: absolute;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  padding-left: 10px;
  box-sizing: border-box;
  border-left: 1px solid var(--nuvio-grid-line);
  font-size: 12px;
  font-weight: 600;
  color: var(--nuvio-text-muted);
}

.livetv-guide-body { position: relative; flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; }
.livetv-guide-spacer { width: 100%; }

.livetv-guide-row {
  position: relative;
  display: flex;
  width: 100%;
  height: 96px;
  background: transparent;
  border-bottom: 1px solid var(--nuvio-grid-line);
}
.livetv-guide-row.is-focused { background: var(--nuvio-surface-raised); }

.livetv-guide-channel {
  position: sticky;
  left: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 300px;
  min-width: 300px;
  height: 100%;
  padding: 0 12px;
  box-sizing: border-box;
  border: 0;
  border-right: 1px solid var(--nuvio-grid-line-strong);
  border-left: 3px solid transparent;
  background: var(--nuvio-surface);
  color: inherit;
  font: inherit;
  text-align: left;
}
.livetv-guide-channel.is-highlighted { border-left-color: var(--nuvio-accent); }
.livetv-guide-channel.focused,
.livetv-guide-channel:focus { border-left-color: var(--nuvio-accent); background: var(--nuvio-surface-raised); }
.livetv-guide-channel-number { width: 22px; font-size: 12px; font-weight: 700; color: var(--nuvio-text-muted); }
.livetv-guide-channel-logo {
  width: 46px;
  height: 46px;
  object-fit: contain;
  border-radius: 8px;
  background: var(--nuvio-logo-tile);
}
.livetv-guide-channel-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--nuvio-text-primary);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.livetv-guide-channel-star { width: 20px; font-size: 20px; line-height: 1; color: var(--nuvio-text-muted); }
.livetv-guide-channel-star.is-favorite { color: var(--nuvio-accent); }

.livetv-guide-programs { position: relative; flex: 1 1 auto; height: 100%; }

.livetv-guide-program {
  position: absolute;
  top: 4px;
  bottom: 4px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  overflow: visible;
  border-radius: 10px;
}
.livetv-guide-program-fill {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  border-radius: 10px;
  background: var(--nuvio-future-cell);
  border: 1px solid var(--nuvio-grid-line);
  overflow: hidden;
}
.livetv-guide-program.is-past .livetv-guide-program-fill { background: var(--nuvio-past-cell); }
.livetv-guide-program.is-airing .livetv-guide-program-fill {
  background: var(--nuvio-airing-gradient);
  border-color: var(--nuvio-accent-soft);
}
.livetv-guide-program.is-airing .livetv-guide-program-fill::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  background: var(--nuvio-now-gradient);
}
.livetv-guide-program.focused .livetv-guide-program-fill,
.livetv-guide-program:focus .livetv-guide-program-fill {
  border: 3px solid var(--nuvio-accent);
  box-shadow: 0 0 0 3px var(--nuvio-highlight);
}
.livetv-guide-program-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  background: var(--nuvio-progress-gradient);
}
.livetv-guide-program-title {
  position: sticky;
  left: 300px;
  z-index: 2;
  display: block;
  max-width: 100%;
  padding: 6px 8px 0 9px;
  box-sizing: border-box;
  font-size: 14px;
  font-weight: 600;
  color: var(--nuvio-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}
.livetv-guide-program.is-airing .livetv-guide-program-title { font-weight: 700; padding-left: 11px; }
.livetv-guide-program-time {
  position: sticky;
  left: 300px;
  z-index: 2;
  display: block;
  max-width: 100%;
  padding: 0 8px 0 9px;
  box-sizing: border-box;
  font-size: 11px;
  font-weight: 500;
  color: var(--nuvio-text-muted);
  white-space: nowrap;
  overflow: hidden;
  pointer-events: none;
}
.livetv-guide-empty {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 13px;
  color: var(--nuvio-text-muted);
}

.livetv-guide-now {
  position: absolute;
  top: 0;
  width: 12px;
  z-index: 4;
  pointer-events: none;
}
.livetv-guide-now::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 5px;
  width: 2px;
  background: var(--nuvio-now-gradient);
}
.livetv-guide-now::after {
  content: "";
  position: absolute;
  top: -4px;
  left: 2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--nuvio-accent);
}

.livetv-sidebar { display: none; }
.livetv-main { display: flex; flex: 1 1 auto; min-width: 0; }
.livetv-channel {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--nuvio-text-primary);
  font: inherit;
  text-align: left;
}
.livetv-channel.is-selected { border-left-color: var(--nuvio-accent); background: var(--nuvio-surface-raised); }
.livetv-channel-number { width: 22px; font-size: 12px; font-weight: 700; color: var(--nuvio-text-muted); }
.livetv-channel-name { flex: 1 1 auto; font-size: 14px; font-weight: 600; }
.livetv-setup {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  width: 100%;
  height: 100%;
  padding: 0 80px;
  box-sizing: border-box;
  text-align: center;
  background: var(--nuvio-screen-gradient, var(--nuvio-bg));
}
.livetv-setup-title { margin: 0; font-size: 32px; font-weight: 900; letter-spacing: 2px; color: var(--nuvio-text-primary); }
.livetv-setup-body { margin: 0; max-width: 900px; font-size: 18px; color: var(--nuvio-text-secondary); }
.livetv-setup-action {
  min-height: 60px;
  padding: 0 28px;
  border: 3px solid transparent;
  border-radius: 10px;
  background: var(--nuvio-surface-raised);
  color: var(--nuvio-text-primary);
  font: inherit;
  font-size: 18px;
  font-weight: 700;
}
.livetv-setup-action.focused,
.livetv-setup-action:focus { border-color: var(--nuvio-accent); }
"""

# --- Surgical edits -------------------------------------------------------
# Each entry is (relative path, anchor, replacement). The anchor MUST appear
# exactly once or the run aborts.

SURGICAL_EDITS: list[tuple[str, str, str]] = [
    (
        "js/ui/navigation/router.js",
        'import { FolderDetailScreen } from "../screens/collection/folderDetailScreen.js";\n',
        'import { FolderDetailScreen } from "../screens/collection/folderDetailScreen.js";\n'
        'import { liveTvScreen } from "../../livetv/ui/liveTvScreen.js";\n',
    ),
    (
        "js/ui/navigation/router.js",
        "  FolderDetailScreen,\n  Platform,\n",
        "  FolderDetailScreen,\n  liveTvScreen,\n  Platform,\n",
    ),
    (
        "js/ui/navigation/router.js",
        "    folderDetail: FolderDetailScreen\n  },",
        "    folderDetail: FolderDetailScreen,\n    livetv: liveTvScreen,\n    guide: liveTvScreen\n  },",
    ),
    (
        "js/ui/screens/home/homeScreenContextDependenciesSources.js",
        'export { createPosterCardMarkup } from "./homeScreenHelpers-15-create-poster-card-markup.js";\n',
        'export { createPosterCardMarkup } from "./homeScreenHelpers-15-create-poster-card-markup.js";\n'
        "\n"
        "export {\n"
        "  buildLiveTvHomeRow,\n"
        "  buildLiveTvHomeRowFromState,\n"
        "  mergeLiveTvHomeRow,\n"
        "  isLiveTvRow,\n"
        "  LIVE_TV_HOME_ROW_KEY\n"
        '} from "../../../livetv/ui/liveTvRows.js";\n',
    ),
    (
        "js/ui/screens/settings/settingsLayoutMarkup.js",
        'import { getTvPerformanceMode, getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";\n',
        'import { getTvPerformanceMode, getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";\n'
        'import { renderLiveTvSettingsSection } from "../../../livetv/liveTvSettings.js";\n',
    ),
    (
        "js/platform/adapters/tizenAdapter.js",
        "  prepareVideoElement() {}\n};",
        "  getLaunchPayload() {\n"
        "    try {\n"
        "      const appControl = globalThis.tizen?.application\n"
        "        ?.getCurrentApplication?.()\n"
        "        ?.getRequestedAppControl?.();\n"
        "      const data = appControl?.appControlData || {};\n"
        '      const query = String(\n'
        '        data["http://tizen.org/appcontrol/data/text"] || data.PAYLOAD || ""\n'
        '      ).trim();\n'
        "      return { query, raw: data };\n"
        "    } catch (_) {\n"
        '      return { query: "", raw: null };\n'
        "    }\n"
        "  },\n"
        "\n"
        "  prepareVideoElement() {}\n};",
    ),
    (
        "js/platform/adapters/webosAdapter.js",
        "  prepareVideoElement(videoElement) {\n    WebOSPlayerExtensions.apply(videoElement);\n  }\n};",
        "  getLaunchPayload() {\n"
        "    try {\n"
        "      const raw = globalThis.PalmSystem?.launchParams;\n"
        "      let params = {};\n"
        '      if (raw && typeof raw === "object") {\n'
        "        params = raw;\n"
        "      } else if (raw) {\n"
        "        params = JSON.parse(String(raw));\n"
        "      }\n"
        '      const query = String(params?.query || params?.search || params?.text || "").trim();\n'
        "      return { query, raw: params };\n"
        "    } catch (_) {\n"
        '      return { query: "", raw: null };\n'
        "    }\n"
        "  },\n"
        "\n"
        "  prepareVideoElement(videoElement) {\n    WebOSPlayerExtensions.apply(videoElement);\n  }\n};",
    ),
    (
        "js/platform/index.js",
        "  getCapabilities() {\n    return getAdapter().getCapabilities();\n  },\n",
        "  getCapabilities() {\n    return getAdapter().getCapabilities();\n  },\n"
        "\n"
        "  getLaunchPayload() {\n"
        '    return getAdapter().getLaunchPayload?.() || { query: "", raw: null };\n'
        "  },\n",
    ),
    (
        "js/ui/components/sidebarNavigationHelpers-01-root-sidebar-items.js",
        "      '<path d=\"M12 3.2 3.5 10v10.25c0 .69.56 1.25 1.25 1.25h5.5v-6.5h3.5v6.5h5.5c.69 0 1.25-.56 1.25-1.25V10L12 3.2Zm0 1.92 7 5.6v9.53h-4v-6.5H9v6.5H5v-9.53l7-5.6Z\"/>'\n"
        "  },\n"
        "  {\n"
        '    action: "gotoSearch",\n',
        "      '<path d=\"M12 3.2 3.5 10v10.25c0 .69.56 1.25 1.25 1.25h5.5v-6.5h3.5v6.5h5.5c.69 0 1.25-.56 1.25-1.25V10L12 3.2Zm0 1.92 7 5.6v9.53h-4v-6.5H9v6.5H5v-9.53l7-5.6Z\"/>'\n"
        "  },\n"
        "  {\n"
        '    action: "gotoLiveTv",\n'
        '    route: "livetv",\n'
        '    labelKey: "sidebar.livetv",\n'
        '    label: "Live TV",\n'
        '    iconType: "svg",\n'
        '    viewBox: "0 0 24 24",\n'
        "    iconMarkup:\n"
        r"""      '<path d="M3.5 4A2.5 2.5 0 0 0 1 6.5v8A2.5 2.5 0 0 0 3.5 17h17a2.5 2.5 0 0 0 2.5-2.5v-8A2.5 2.5 0 0 0 20.5 4h-17Zm0 2h17a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-17a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5ZM8.5 19a1 1 0 0 1 1-1h5a1 1 0 1 1 0 2h-5a1 1 0 0 1-1-1Z"/><path d="M10.4 7.61a.6.6 0 0 1 .91-.51l3.9 2.4a.6.6 0 0 1 0 1.02l-3.9 2.4a.6.6 0 0 1-.91-.51V7.61Z"/>'""" + "\n"
        "  },\n"
        "  {\n"
        '    action: "gotoSearch",\n',
    ),
    (
        "js/ui/screens/settings/settingsLayoutMarkup.js",
        "              ${\n                getTvRuntimePerformanceProfile().isTvRuntime\n                  ? this.renderActionRow({\n                      focusKey: \"layout:performanceMode\",\n",
        "              ${\n                getTvRuntimePerformanceProfile().isTvRuntime\n                  ? renderLiveTvSettingsSection({\n"
        "                      t,\n"
        "                      renderToggleRow: this.renderToggleRow.bind(this),\n"
        "                      renderActionRow: this.renderActionRow.bind(this),\n"
        "                      renderCollapsibleRow: this.renderCollapsibleRow.bind(this),\n"
        "                      expanded: { ...(this.expandedSections || {}), liveTv: Boolean(this.expandedSections?.layout?.liveTv) }\n"
        "                    })\n"
        "                  : \"\"\n"
        "              }\n"
        "              ${\n"
        "                getTvRuntimePerformanceProfile().isTvRuntime\n                  ? this.renderActionRow({\n"
        "                      focusKey: \"layout:performanceMode\",\n",
    ),
    (
        "js/ui/screens/settings/settingsScreenHelpers-10-create-default-expanded-state.js",
        '  if (sectionId === "layout") {\n'
        "    return {\n"
        "      homeLayout: false,\n"
        "      homeContent: false,\n"
        "      continueWatching: false,\n"
        "      detailPage: false,\n"
        "      focusedPoster: false,\n"
        "      cardAppearance: false\n"
        "    };\n"
        "  }",
        '  if (sectionId === "layout") {\n'
        "    return {\n"
        "      homeLayout: false,\n"
        "      homeContent: false,\n"
        "      continueWatching: false,\n"
        "      detailPage: false,\n"
        "      focusedPoster: false,\n"
        "      cardAppearance: false,\n"
        "      liveTv: false\n"
        "    };\n"
        "  }",
    ),
    (
        "js/ui/screens/home/homeScreenMethods-21-load-data.js",
        "      this.rows = this.sortAndFilterRows(nextInitialRows, this.collections);",
        "      this.rows = this.sortAndFilterRows(nextInitialRows, this.collections);\n"
        "      this.rows = this.sortAndFilterRows(\n"
        "        mergeLiveTvHomeRow(this.rows, buildLiveTvHomeRowFromState()),\n"
        "        this.collections\n"
        "      );",
    ),
    (
        "js/ui/screens/settings/settingsLayoutActions.js",
        '  this.actionMap.set("layout:toggle:homeLayout", () => {',
        '  this.actionMap.set("livetv:toggle:section", () => {\n'
        '      this.toggleExpandedSection("layout", "liveTv");\n'
        "    });\n"
        "\n"
        '    this.actionMap.set("livetv:addon", () => {\n'
        "      const current = liveTvSettings.get();\n"
        "      this.openTextDialog({\n"
        '        title: "Live TV settings",\n'
        '        placeholder: "https://…/manifest.json",\n'
        '        value: current.addonConfigured ? current.addonBaseUrl : "",\n'
        "        onSubmit: (value) => {\n"
        '          const normalized = String(value || "")\n'
        "            .trim()\n"
        '            .replace(/\\/manifest\\.json$/i, "")\n'
        '            .replace(/\\/+$/, "");\n'
        "          if (!normalized) {\n"
        "            return false;\n"
        "          }\n"
        "          liveTvSettings.set({ addonBaseUrl: normalized, addonConfigured: true });\n"
        "          return true;\n"
        "        }\n"
        "      });\n"
        "    });\n"
        "\n"
        '    this.actionMap.set("livetv:refresh", () => {\n'
        "      liveTvState.setChannels([], {});\n"
        "    });\n"
        "\n"
        '    this.actionMap.set("livetv:remove", () => {\n'
        "      liveTvSettings.set({\n"
        "        addonBaseUrl: STREMIO_TV_ADDON_BASE_URL,\n"
        "        addonConfigured: false\n"
        "      });\n"
        "      liveTvState.setChannels([], {});\n"
        "    });\n"
        "\n"
        '    this.actionMap.set("livetv:clearFavorites", () => {\n'
        "      liveFavoritesStore.clear();\n"
        "    });\n"
        "\n"
        '    this.actionMap.set("livetv:clearRecents", () => {\n'
        "      liveRecentsStore.clear();\n"
        "    });\n"
        "\n"
        '  this.actionMap.set("layout:toggle:homeLayout", () => {',
    ),
    (
        "index.html",
        '    <link rel="stylesheet" href="css/themes.css?v=20260509s" />\n',
        '    <link rel="stylesheet" href="css/themes.css?v=20260509s" />\n'
        '    <link rel="stylesheet" href="css/livetv.css?v=20260701d" />\n',
    ),
]


def validate_bodies() -> None:
    for path, body in FILES.items():
        if '"""' in body:
            raise SystemExit(f"{path}: body contains a triple quote")
        if body.rstrip().endswith("\\"):
            raise SystemExit(f"{path}: body ends with a backslash")
        if not body.strip():
            raise SystemExit(f"{path}: body is empty")


def write_files(root: Path) -> int:
    written = 0
    for rel, body in FILES.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body, encoding="utf-8")
        written += 1
    return written


def apply_surgical_edits(root: Path) -> int:
    applied = 0
    for rel, anchor, replacement in SURGICAL_EDITS:
        target = root / rel
        if not target.exists():
            raise SystemExit(f"surgical edit target missing: {rel}")
        text = target.read_text(encoding="utf-8")
        count = text.count(anchor)
        if count != 1:
            raise SystemExit(f"{rel}: anchor matched {count} times (expected 1)")
        target.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")
        applied += 1
    return applied


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    validate_bodies()
    if args.check:
        missing = [rel for rel in FILES if not (root / rel).exists()]
        if missing:
            print("missing generated files:", missing, file=sys.stderr)
            return 1
        print(f"check ok: {len(FILES)} generated files present")
        return 0
    written = write_files(root)
    applied = apply_surgical_edits(root)
    print(f"wrote {written} files, applied {applied} surgical edits")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
