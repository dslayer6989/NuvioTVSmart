// Loads a full guide (lineup, schedule, chips) from a Stremio Live TV addon.

import {
  LiveTvGuideBuilder,
  LIVE_TV_GUIDE_MAX_SPAN_MS,
  buildAddonResourceUrl,
  buildCatalogUrl,
  guideWindow,
  normalizeManifestUrl,
  planCatalogs
} from "./liveTvGuide.js";
import {
  LIVE_TV_EXTRA_DATE,
  LIVE_TV_EXTRA_SKIP,
  addonSupportsResource,
  catalogSupportsExtra,
  parseCatalog,
  parseManifest,
  parseMetaResponse,
  requiredExtraDefaults
} from "./liveTvParser.js";
import { utcDatesBetween } from "./liveTvTime.js";

export const LIVE_TV_MAX_CATALOG_PAGES = 20;
export const LIVE_TV_MAX_GROUP_PAGES = 5;
export const LIVE_TV_MAX_META_FALLBACK_CHANNELS = 250;
export const LIVE_TV_META_FALLBACK_CONCURRENCY = 6;

async function settle(promise) {
  try {
    return await promise;
  } catch (_) {
    return null;
  }
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length).fill(null);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await settle(task(items[index], index));
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchAllPages(fetchJson, manifestUrl, catalog, baseExtras, maxPages) {
  const results = [];
  const seen = new Set();
  let skip = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const extras = skip > 0 ? { ...baseExtras, [LIVE_TV_EXTRA_SKIP]: String(skip) } : baseExtras;
    let items;
    try {
      items = parseCatalog(
        await fetchJson(buildCatalogUrl(manifestUrl, catalog, extras)),
        catalog.type
      );
    } catch (error) {
      // The first page must work; a failing later page (often a missing last page) ends paging.
      if (page === 0) throw error;
      break;
    }
    if (!items.length) break;
    const fresh = items.filter((item) => {
      if (seen.has(item.channel.id)) return false;
      seen.add(item.channel.id);
      return true;
    });
    if (!fresh.length) break; // the addon ignored `skip`
    results.push(...fresh);
    if (!catalogSupportsExtra(catalog, LIVE_TV_EXTRA_SKIP)) break;
    skip += items.length;
  }
  return results;
}

/**
 * @param {string} manifestUrl any form the user typed; normalized here
 * @param {{ nowMs?: number, fetchJson: (url: string) => Promise<any> }} options
 */
export async function loadLiveTvGuide(manifestUrl, { nowMs = Date.now(), fetchJson }) {
  const normalizedUrl = normalizeManifestUrl(manifestUrl);
  const info = parseManifest(await fetchJson(normalizedUrl));
  const plan = planCatalogs(info);
  if (!plan) throw new Error("This addon has no channel catalogs Nuvio can read.");
  const builder = new LiveTvGuideBuilder();
  const lineupBase = requiredExtraDefaults(plan.lineup) || {};

  if (plan.usesDateEpg) {
    // Stremio's native EPG serves one page set per UTC day; fetch every day the guide can show.
    const window = guideWindow(null, nowMs);
    const dates = utcDatesBetween(window.startMs, window.startMs + LIVE_TV_GUIDE_MAX_SPAN_MS);
    const pages = await Promise.all(
      dates.map((date) =>
        settle(
          fetchAllPages(
            fetchJson,
            normalizedUrl,
            plan.lineup,
            { ...lineupBase, [LIVE_TV_EXTRA_DATE]: date },
            LIVE_TV_MAX_CATALOG_PAGES
          )
        )
      )
    );
    // Today's page decides the lineup order; later days only add programmes (and new channels).
    pages.filter(Boolean).forEach((items) => builder.addLineup(items));
  }

  if (builder.lineupSize === 0) {
    builder.addLineup(
      await fetchAllPages(
        fetchJson,
        normalizedUrl,
        plan.lineup,
        lineupBase,
        LIVE_TV_MAX_CATALOG_PAGES
      )
    );
  }

  const groupsPromise = Promise.all(
    plan.groups.map(async (catalog) => {
      const items = await settle(
        fetchAllPages(
          fetchJson,
          normalizedUrl,
          catalog,
          requiredExtraDefaults(catalog) || {},
          LIVE_TV_MAX_GROUP_PAGES
        )
      );
      return items ? { catalog, items } : null;
    })
  );

  // Addons without the date extra may still carry schedules on their meta endpoint.
  if (!plan.usesDateEpg && addonSupportsResource(info, "meta")) {
    const missing = builder
      .lineupIds()
      .filter((id) => !builder.hasPrograms(id))
      .slice(0, LIVE_TV_MAX_META_FALLBACK_CHANNELS);
    const parsed = await mapWithConcurrency(
      missing,
      LIVE_TV_META_FALLBACK_CONCURRENCY,
      async (channelId) => {
        const channel = builder.channel(channelId);
        if (!channel) return null;
        const url = buildAddonResourceUrl(normalizedUrl, "meta", channel.type, channel.id);
        return parseMetaResponse(await fetchJson(url), channel.type);
      }
    );
    parsed
      .filter(Boolean)
      .forEach((entry) => builder.addPrograms(entry.channel.id, entry.programs));
  }

  (await groupsPromise).filter(Boolean).forEach(({ catalog, items }) => {
    builder.addGroup(catalog.id, catalog.name, items);
  });

  if (builder.lineupSize === 0) throw new Error("The addon returned no channels.");
  return builder.build(info, normalizedUrl, nowMs);
}

/** Raw stream objects for a channel, in the addon's order (Primary first). */
export async function loadChannelStreams(manifestUrl, channel, { fetchJson }) {
  const url = buildAddonResourceUrl(manifestUrl, "stream", channel.type, channel.id);
  const payload = await fetchJson(url);
  const streams = Array.isArray(payload?.streams) ? payload.streams : [];
  // Only streams with a direct link can play; torrents and external links are skipped.
  return streams.filter(
    (stream) => stream && typeof stream.url === "string" && /^https?:\/\//i.test(stream.url.trim())
  );
}
