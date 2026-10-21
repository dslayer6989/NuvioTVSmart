// Parses Stremio addon responses for Live TV, including Stremio's native EPG protocol:
// `behaviorHints.epgProvider` in the manifest, a `date` catalog extra, and `metasDetailed`
// entries whose `videos` carry `startTime`/`endTime`.

import { MINUTE_MS, parseInstant, parseRuntimeMinutes } from "./liveTvTime.js";

export const LIVE_TV_EXTRA_DATE = "date";
export const LIVE_TV_EXTRA_SKIP = "skip";

/** Stremio content types that describe live channels. */
export const LIVE_TV_CHANNEL_TYPES = new Set(["tv", "channel", "live", "livetv", "events"]);

function text(value) {
  if (value == null || typeof value === "object") return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function textList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const single = text(value);
  return single ? [single] : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameName(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

export function createCatalogInfo({ type, id, name, extras = [] }) {
  return { type, id, name: name || id, extras };
}

export function catalogSupportsExtra(catalog, name) {
  return (catalog?.extras || []).some((extra) => sameName(extra.name, name));
}

/**
 * Values for required extras we can fill in automatically (the first declared option).
 * `date` and `skip` are supplied by the loader, so they never block a catalog.
 * Returns null when a required extra has no options (for example `search`).
 */
export function requiredExtraDefaults(catalog) {
  const values = {};
  for (const extra of catalog?.extras || []) {
    if (!extra.isRequired) continue;
    if (sameName(extra.name, LIVE_TV_EXTRA_DATE) || sameName(extra.name, LIVE_TV_EXTRA_SKIP))
      continue;
    const option = extra.options?.[0];
    if (option == null) return null;
    values[extra.name] = option;
  }
  return values;
}

export function isCatalogRequestable(catalog) {
  return requiredExtraDefaults(catalog) != null;
}

function parseExtras(catalog) {
  const declared = (Array.isArray(catalog.extra) ? catalog.extra : [])
    .filter(isObject)
    .map((extra) => ({
      name: text(extra.name),
      isRequired: extra.isRequired === true,
      options: textList(extra.options)
    }))
    .filter((extra) => extra.name);
  if (declared.length) return declared;
  // Legacy manifests: extraSupported / extraRequired string arrays.
  const required = new Set(textList(catalog.extraRequired));
  const names = Array.from(new Set([...textList(catalog.extraSupported), ...required]));
  return names.map((name) => ({ name, isRequired: required.has(name), options: [] }));
}

export function parseManifest(payload) {
  const root = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!isObject(root)) throw new Error("The addon manifest is not a JSON object.");
  const catalogs = (Array.isArray(root.catalogs) ? root.catalogs : [])
    .filter(isObject)
    .map((catalog) => {
      const type = text(catalog.type);
      const id = text(catalog.id);
      if (!type || !id) return null;
      return createCatalogInfo({
        type,
        id,
        name: text(catalog.name) || id,
        extras: parseExtras(catalog)
      });
    })
    .filter(Boolean);
  const resources = (Array.isArray(root.resources) ? root.resources : [])
    .map((resource) => (isObject(resource) ? text(resource.name) : text(resource)))
    .filter(Boolean);
  return {
    id: text(root.id) || "",
    name: text(root.name) || "Live TV",
    logo: text(root.logo) || text(root.icon),
    description: text(root.description),
    epgProvider: isObject(root.behaviorHints) && root.behaviorHints.epgProvider === true,
    types: textList(root.types),
    resources,
    catalogs
  };
}

export function addonSupportsResource(info, name) {
  return !info.resources.length || info.resources.some((resource) => sameName(resource, name));
}

function parseProgram(video, channelId, hasScheduledVideos) {
  const explicitStart = parseInstant(text(video.startTime) || text(video.start));
  // `released` alone only means "schedule" when the addon says so; otherwise it's an upload date.
  const start = explicitStart ?? (hasScheduledVideos ? parseInstant(text(video.released)) : null);
  if (start == null) return null;
  const explicitEnd = parseInstant(text(video.endTime) || text(video.end) || text(video.stop));
  const runtimeMinutes = parseRuntimeMinutes(text(video.runtime));
  const runtimeEnd = runtimeMinutes ? start + runtimeMinutes * MINUTE_MS : null;
  const end = explicitEnd ?? runtimeEnd;
  return {
    id: text(video.id) || `${channelId}:${start}`,
    title: text(video.title) || text(video.name) || "Untitled",
    startMs: start,
    endMs: end != null && end > start ? end : null,
    description: text(video.overview) || text(video.description),
    thumbnail: text(video.thumbnail) || text(video.poster),
    genres: textList(video.genres).length ? textList(video.genres) : textList(video.genre),
    releaseInfo: text(video.releaseInfo)
  };
}

function parseMeta(meta, fallbackType) {
  const id = text(meta?.id);
  if (!id) return null;
  const hasScheduledVideos =
    isObject(meta.behaviorHints) && meta.behaviorHints.hasScheduledVideos === true;
  const genres = textList(meta.genres);
  const channel = {
    id,
    type: text(meta.type) || fallbackType,
    name: text(meta.name) || id,
    logo: text(meta.logo) || text(meta.poster) || text(meta.background),
    genres: genres.length ? genres : textList(meta.genre),
    description: text(meta.description),
    number: 0
  };
  const programs = (Array.isArray(meta.videos) ? meta.videos : [])
    .filter(isObject)
    .map((video) => parseProgram(video, id, hasScheduledVideos))
    .filter(Boolean);
  return { channel, programs };
}

/** Parses `catalog` responses (`metasDetailed` for EPG pages, `metas` otherwise). */
export function parseCatalog(payload, fallbackType) {
  const root = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!isObject(root)) return [];
  const metas = Array.isArray(root.metasDetailed)
    ? root.metasDetailed
    : Array.isArray(root.metas)
      ? root.metas
      : [];
  return metas
    .filter(isObject)
    .map((meta) => parseMeta(meta, fallbackType))
    .filter(Boolean);
}

/** Parses a `meta` response. */
export function parseMetaResponse(payload, fallbackType) {
  const root = typeof payload === "string" ? JSON.parse(payload) : payload;
  return isObject(root?.meta) ? parseMeta(root.meta, fallbackType) : null;
}
