// Home → "Live Now": what's airing on this profile's favorite channels, as a regular Home
// row. OK plays the channel (channel up/down stays inside Favorites); the last card opens
// the guide. Hidden when there are no favorites or no guide yet.

import { Router } from "../ui/navigation/routerState.js";
import { LIVE_TV_FAVORITES_GROUP_ID, LiveTvRepository } from "./liveTvRepository.js";
import { LiveTvPlayback } from "./liveTvPlayback.js";
import { guideChannel, nextProgram, programAt } from "./liveTvGuide.js";
import { formatClock } from "./liveTvTime.js";

export const LIVE_TV_HOME_ROW_KEY = "livetv:now";
const ITEM_PREFIX = "livetv:";
const OPEN_GUIDE_ID = "livetv:open-guide";
const MAX_ITEMS = 20;

function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cssVar(name, fallback) {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  } catch (_) {
    return fallback;
  }
}

function wrap(text, maxChars, maxLines) {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    if (lines.length >= maxLines) return;
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return lines;
}

/** A card image drawn from text, so it looks right in any poster shape without loading anything. */
function cardImage({ width, height, channel, title, subtitle, live }) {
  const bg = cssVar("--ltv-raised", "#222222");
  const surface = cssVar("--ltv-surface", "#141414");
  const accent = cssVar("--ltv-accent", "#f5f5f5");
  const text = cssVar("--ltv-text", "#ffffff");
  const muted = cssVar("--ltv-text-2", "#b3b3b3");
  const portrait = height > width;
  const nameSize = portrait ? 30 : 30;
  const titleSize = portrait ? 34 : 30;
  const nameLines = wrap(channel, portrait ? 14 : 24, 2);
  const titleLines = wrap(title, portrait ? 13 : 24, portrait ? 4 : 2);
  let y = portrait ? 120 : 92;
  const parts = [];
  nameLines.forEach((line) => {
    parts.push(
      `<text x="24" y="${y}" font-size="${nameSize}" font-weight="800" fill="${accent}">${xml(line)}</text>`
    );
    y += nameSize + 6;
  });
  y += portrait ? 24 : 10;
  titleLines.forEach((line) => {
    parts.push(
      `<text x="24" y="${y}" font-size="${titleSize}" font-weight="700" fill="${text}">${xml(line)}</text>`
    );
    y += titleSize + 6;
  });
  if (subtitle) {
    parts.push(
      `<text x="24" y="${height - 28}" font-size="22" fill="${muted}">${xml(subtitle)}</text>`
    );
  }
  const badge = live
    ? `<rect x="24" y="24" width="92" height="34" rx="8" fill="#ff3b6b"/><circle cx="42" cy="41" r="6" fill="#fff"/><text x="56" y="49" font-size="20" font-weight="800" fill="#fff">LIVE</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${surface}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/><rect y="${height - 8}" width="${width}" height="8" fill="${accent}"/><g font-family="Arial, Helvetica, sans-serif">${badge}${parts.join("")}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function channelItem(channel, program, upNext, nowMs) {
  const title = program?.title || "No guide information";
  const subtitle = program ? `Until ${formatClock(program.endMs)}` : "";
  return {
    id: `${ITEM_PREFIX}${channel.id}`,
    type: "channel",
    name: `${channel.name} · ${title}`,
    poster: cardImage({
      width: 300,
      height: 450,
      channel: channel.name,
      title,
      subtitle,
      live: Boolean(program)
    }),
    // The wide card gets the channel logo drawn over its corner, so it skips the end time.
    landscapePoster: cardImage({
      width: 480,
      height: 270,
      channel: channel.name,
      title,
      subtitle: "",
      live: Boolean(program)
    }),
    background: program?.thumbnail || channel.logo || "",
    logo: channel.logo || "",
    description: [
      program
        ? `Now: ${title} (${formatClock(program.startMs)} – ${formatClock(program.endMs)})`
        : "",
      upNext ? `Up next: ${upNext.title} at ${formatClock(upNext.startMs)}` : "",
      program?.description || ""
    ]
      .filter(Boolean)
      .join(" · "),
    releaseInfo: program ? "LIVE" : "",
    genres: channel.genres || [],
    liveTvChannelId: channel.id,
    liveTvAiring: Boolean(program && nowMs < program.endMs)
  };
}

/** The "Live Now" row, or null when it shouldn't show. */
export function buildLiveTvHomeRow(nowMs = Date.now()) {
  if (!LiveTvRepository.isConfigured()) return null;
  const state = LiveTvRepository.ensureLoaded();
  const guide = state.guide;
  if (!guide || !state.favoriteIds.length) return null;
  const items = state.favoriteIds
    .map((id) => guideChannel(guide, id))
    .filter(Boolean)
    .slice(0, MAX_ITEMS)
    .map((channel) => {
      const program = programAt(guide, channel.id, nowMs);
      return channelItem(
        channel,
        program,
        nextProgram(guide, channel.id, program?.endMs ?? nowMs),
        nowMs
      );
    });
  if (!items.length) return null;
  items.push({
    id: OPEN_GUIDE_ID,
    type: "channel",
    name: "Open guide",
    poster: cardImage({
      width: 300,
      height: 450,
      channel: "Live TV",
      title: "Open the full guide",
      subtitle: "",
      live: false
    }),
    landscapePoster: cardImage({
      width: 480,
      height: 270,
      channel: "Live TV",
      title: "Open the full guide",
      subtitle: "",
      live: false
    }),
    description: "See every channel and what's on later."
  });
  return {
    rowKind: "livetv",
    homeCatalogKey: LIVE_TV_HOME_ROW_KEY,
    homeCatalogDisableKey: LIVE_TV_HOME_ROW_KEY,
    catalogId: "livetv-now",
    catalogName: "Live Now",
    addonName: "Live TV",
    addonId: "",
    addonBaseUrl: "",
    type: "channel",
    supportsSkip: false,
    pinToTop: true,
    result: { status: "success", data: { items } }
  };
}

export function isLiveTvHomeRow(row) {
  return row?.rowKind === "livetv";
}

/** Handles OK on a Live Now card. Returns true when the item belonged to the row. */
export function activateLiveTvHomeItem(itemId) {
  const id = String(itemId || "");
  if (!id.startsWith(ITEM_PREFIX)) return false;
  if (id === OPEN_GUIDE_ID) {
    Router.navigate("liveTv", { jumpToNow: true });
    return true;
  }
  void LiveTvPlayback.play(id.slice(ITEM_PREFIX.length), { groupId: LIVE_TV_FAVORITES_GROUP_ID });
  return true;
}
