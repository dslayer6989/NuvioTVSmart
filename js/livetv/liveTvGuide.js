// The Live TV guide model: which catalogs to read, how their pages combine into one
// lineup with schedules, and the helpers the screens use to read it.

import {
  LIVE_TV_CHANNEL_TYPES,
  LIVE_TV_EXTRA_DATE,
  catalogSupportsExtra,
  isCatalogRequestable,
  requiredExtraDefaults
} from "./liveTvParser.js";
import { HALF_HOUR_MS, HOUR_MS, MINUTE_MS, floorToHalfHour, halfHourSlots } from "./liveTvTime.js";

export const LIVE_TV_MAX_GROUP_CATALOGS = 24;
export const LIVE_TV_DEFAULT_PROGRAM_MS = 60 * MINUTE_MS;
export const LIVE_TV_GUIDE_LOOK_BACK_MS = HOUR_MS;
export const LIVE_TV_GUIDE_MAX_SPAN_MS = 48 * HOUR_MS;
export const LIVE_TV_GUIDE_MIN_SPAN_MS = 6 * HOUR_MS;

/** Accepts `stremio://` links and bare addon roots, like the addon manager does. */
export function normalizeManifestUrl(raw) {
  let url = String(raw || "").trim();
  if (!url) return "";
  if (/^stremio:\/\//i.test(url)) url = `https://${url.slice("stremio://".length)}`;
  if (!url.includes("://")) url = `https://${url}`;
  const queryIndex = url.indexOf("?");
  const query = queryIndex >= 0 ? url.slice(queryIndex + 1) : "";
  const base = (queryIndex >= 0 ? url.slice(0, queryIndex) : url).replace(/\/+$/, "");
  const withManifest = /\/manifest\.json$/i.test(base) ? base : `${base}/manifest.json`;
  return query ? `${withManifest}?${query}` : withManifest;
}

/** True when the text looks like a web address we can try. */
export function isPlausibleManifestUrl(raw) {
  const normalized = normalizeManifestUrl(raw);
  return (
    /^https?:\/\/[^/\s?#]+\.[^/\s?#]+/i.test(normalized) ||
    /^https?:\/\/(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?\//i.test(normalized)
  );
}

function encodeSegment(value) {
  return encodeURIComponent(String(value ?? "")).replace(/\+/g, "%20");
}

/** `<addon root>/<resource>/<type>/<id>[/<extra>].json[?query]` for a manifest URL. */
export function buildAddonResourceUrl(manifestUrl, resource, type, id, extraPathSegment = "") {
  const normalized = normalizeManifestUrl(manifestUrl);
  const queryIndex = normalized.indexOf("?");
  const query = queryIndex >= 0 ? normalized.slice(queryIndex) : "";
  const base = (queryIndex >= 0 ? normalized.slice(0, queryIndex) : normalized).replace(
    /\/manifest\.json$/i,
    ""
  );
  const extra = extraPathSegment ? `/${extraPathSegment}` : "";
  return `${base}/${resource}/${encodeSegment(type)}/${encodeSegment(id)}${extra}.json${query}`;
}

/**
 * Builds a Stremio catalog URL. Extras follow the manifest's declaration order (how Stremio
 * itself orders them), which matters for static addons that pre-render each combination.
 */
export function buildCatalogUrl(manifestUrl, catalog, extras = {}) {
  const remaining = new Map(
    Object.entries(extras).filter(([, value]) => value != null && String(value).trim() !== "")
  );
  const ordered = [];
  (catalog.extras || []).forEach((declared) => {
    const key = Array.from(remaining.keys()).find(
      (name) => name.toLowerCase() === String(declared.name).toLowerCase()
    );
    if (key == null) return;
    ordered.push([declared.name, remaining.get(key)]);
    remaining.delete(key);
  });
  remaining.forEach((value, key) => ordered.push([key, value]));
  const segment = ordered.map(([key, value]) => `${key}=${encodeSegment(value)}`).join("&");
  return buildAddonResourceUrl(manifestUrl, "catalog", catalog.type, catalog.id, segment);
}

/** Which catalogs to read for the lineup, the schedule and the filter chips. */
export function planCatalogs(info) {
  const typed = info.catalogs.filter((catalog) =>
    LIVE_TV_CHANNEL_TYPES.has(String(catalog.type).toLowerCase())
  );
  const live = typed.length ? typed : info.catalogs;
  const requestable = live.filter(isCatalogRequestable);
  const guide = requestable.find((catalog) => catalogSupportsExtra(catalog, LIVE_TV_EXTRA_DATE));
  const lineup =
    guide ||
    requestable.find((catalog) => Object.keys(requiredExtraDefaults(catalog) || {}).length === 0) ||
    requestable[0];
  if (!lineup) return null;
  const groups = requestable
    .filter((catalog) => catalog.type !== lineup.type || catalog.id !== lineup.id)
    .slice(0, LIVE_TV_MAX_GROUP_CATALOGS);
  return { lineup, usesDateEpg: Boolean(guide), groups };
}

function isLessComplete(existing, candidate) {
  if (existing.endMs == null && candidate.endMs != null) return true;
  if (existing.description == null && candidate.description != null) return true;
  return (
    existing.thumbnail == null &&
    candidate.thumbnail != null &&
    existing.description === candidate.description
  );
}

/** Sorts a channel's schedule, fills missing end times and trims overlaps. */
export function finalizePrograms(channelId, parsed) {
  const sorted = Array.from(parsed).sort((left, right) => left.startMs - right.startMs);
  const result = [];
  sorted.forEach((program, index) => {
    const next = sorted[index + 1];
    let end = program.endMs ?? next?.startMs ?? program.startMs + LIVE_TV_DEFAULT_PROGRAM_MS;
    if (next && next.startMs > program.startMs && end > next.startMs) end = next.startMs;
    if (end <= program.startMs) return;
    result.push({
      id: program.id,
      channelId,
      title: program.title,
      startMs: program.startMs,
      endMs: end,
      description: program.description || null,
      thumbnail: program.thumbnail || null,
      genres: program.genres || [],
      releaseInfo: program.releaseInfo || null
    });
  });
  return result;
}

/** Accumulates catalog pages into a guide. */
export class LiveTvGuideBuilder {
  constructor() {
    this.channels = new Map();
    this.lineup = [];
    this.lineupSet = new Set();
    this.programs = new Map();
    this.groups = [];
  }

  get lineupSize() {
    return this.lineup.length;
  }

  lineupIds() {
    return this.lineup.slice();
  }

  hasPrograms(channelId) {
    return (this.programs.get(channelId)?.size || 0) > 0;
  }

  channel(channelId) {
    return this.channels.get(channelId) || null;
  }

  addLineup(items) {
    items.forEach((item) => {
      if (!this.lineupSet.has(item.channel.id)) {
        this.lineupSet.add(item.channel.id);
        this.lineup.push(item.channel.id);
      }
      this.mergeChannel(item.channel);
      this.addPrograms(item.channel.id, item.programs);
    });
  }

  addGroup(id, name, items) {
    items.forEach((item) => {
      this.mergeChannel(item.channel);
      this.addPrograms(item.channel.id, item.programs);
    });
    const ids = Array.from(new Set(items.map((item) => item.channel.id)));
    if (!ids.length) return;
    const existing = this.groups.find((group) => group.id === id);
    if (existing) {
      existing.channelIds = Array.from(new Set([...existing.channelIds, ...ids]));
    } else {
      this.groups.push({ id, name, channelIds: ids });
    }
  }

  addPrograms(channelId, items) {
    if (!items?.length) return;
    let byStart = this.programs.get(channelId);
    if (!byStart) {
      byStart = new Map();
      this.programs.set(channelId, byStart);
    }
    items.forEach((program) => {
      const existing = byStart.get(program.startMs);
      if (!existing || isLessComplete(existing, program)) byStart.set(program.startMs, program);
    });
  }

  mergeChannel(channel) {
    const existing = this.channels.get(channel.id);
    if (!existing) {
      this.channels.set(channel.id, { ...channel });
      return;
    }
    this.channels.set(channel.id, {
      ...existing,
      logo: existing.logo || channel.logo,
      genres: existing.genres?.length ? existing.genres : channel.genres,
      description: existing.description || channel.description
    });
  }

  deriveGenreGroups(channelsById) {
    const byGenre = new Map();
    this.lineup.forEach((id) => {
      const genre = channelsById[id]?.genres?.[0];
      if (!genre) return;
      if (!byGenre.has(genre)) byGenre.set(genre, []);
      byGenre.get(genre).push(id);
    });
    if (byGenre.size < 2) return [];
    return Array.from(byGenre.entries()).map(([genre, ids]) => ({
      id: `genre:${genre}`,
      name: genre,
      channelIds: ids
    }));
  }

  build(info, manifestUrl, loadedAtMs) {
    const channelsById = {};
    this.lineup.forEach((id, index) => {
      const channel = this.channels.get(id);
      if (channel) channelsById[id] = { ...channel, number: index + 1 };
    });
    this.channels.forEach((channel, id) => {
      if (!channelsById[id]) channelsById[id] = { ...channel, number: 0 };
    });
    const programsByChannel = {};
    this.programs.forEach((byStart, channelId) => {
      const finalized = finalizePrograms(channelId, byStart.values());
      if (finalized.length) programsByChannel[channelId] = finalized;
    });
    return {
      manifestUrl,
      addonId: info.id,
      addonName: info.name,
      addonLogo: info.logo,
      lineupIds: this.lineup.slice(),
      channelsById,
      programsByChannel,
      groups: this.groups.length
        ? this.groups.map((group) => ({ ...group }))
        : this.deriveGenreGroups(channelsById),
      hasGuideData: Object.keys(programsByChannel).length > 0,
      loadedAtMs
    };
  }
}

export function guideLineup(guide) {
  return (guide?.lineupIds || []).map((id) => guide.channelsById[id]).filter(Boolean);
}

export function guideChannel(guide, id) {
  return guide?.channelsById?.[id] || null;
}

export function guidePrograms(guide, channelId) {
  return guide?.programsByChannel?.[channelId] || [];
}

export function programAt(guide, channelId, atMs) {
  return (
    guidePrograms(guide, channelId).find(
      (program) => atMs >= program.startMs && atMs < program.endMs
    ) || null
  );
}

export function nextProgram(guide, channelId, afterMs) {
  return guidePrograms(guide, channelId).find((program) => program.startMs >= afterMs) || null;
}

export function programProgress(program, nowMs) {
  const duration = program.endMs - program.startMs;
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(1, (nowMs - program.startMs) / duration));
}

export function guideChannelsFor(guide, groupId) {
  if (!groupId) return guideLineup(guide);
  const group = (guide?.groups || []).find((entry) => entry.id === groupId);
  if (!group) return guideLineup(guide);
  return group.channelIds.map((id) => guide.channelsById[id]).filter(Boolean);
}

export function isAddonFavoritesGroup(group) {
  return /favorite/i.test(String(group?.id || "")) || /favorite/i.test(String(group?.name || ""));
}

/**
 * The visible time range of the guide grid: one hour before the current half hour to the
 * last scheduled programme (clamped to 6–48 hours), rounded up to a half-hour boundary.
 */
export function guideWindow(guide, nowMs) {
  const start = floorToHalfHour(nowMs) - LIVE_TV_GUIDE_LOOK_BACK_MS;
  let lastEnd = 0;
  Object.values(guide?.programsByChannel || {}).forEach((list) => {
    const end = list[list.length - 1]?.endMs || 0;
    if (end > lastEnd) lastEnd = end;
  });
  const span = Math.max(
    LIVE_TV_GUIDE_MIN_SPAN_MS,
    Math.min(LIVE_TV_GUIDE_MAX_SPAN_MS, lastEnd - start)
  );
  const end = floorToHalfHour(start + span + HALF_HOUR_MS - 1);
  return { startMs: start, endMs: end, slots: halfHourSlots(start, end) };
}

/** Channel up/down with wrap-around. */
export function neighborOf(channels, channelId, delta) {
  if (!channels?.length) return null;
  const index = channels.findIndex((channel) => channel.id === channelId);
  if (index < 0) return channels[0];
  const size = channels.length;
  return channels[(((index + delta) % size) + size) % size];
}

export const ON_NOW_SORTS = ["Channel", "EndingSoon", "JustStarted"];

export function onNowEntries(guide, channels, nowMs, sort = "Channel") {
  const entries = channels.map((channel) => {
    const current = programAt(guide, channel.id, nowMs);
    return { channel, current, next: nextProgram(guide, channel.id, current?.endMs ?? nowMs) };
  });
  const airingFirst = (left, right) => (left.current ? 0 : 1) - (right.current ? 0 : 1);
  if (sort === "EndingSoon") {
    return entries.slice().sort((left, right) => {
      const byAiring = airingFirst(left, right);
      if (byAiring || !left.current) return byAiring;
      return left.current.endMs - right.current.endMs;
    });
  }
  if (sort === "JustStarted") {
    return entries.slice().sort((left, right) => {
      const byAiring = airingFirst(left, right);
      if (byAiring || !left.current) return byAiring;
      return right.current.startMs - left.current.startMs;
    });
  }
  return entries;
}
