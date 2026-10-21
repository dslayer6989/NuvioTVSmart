// "On Now": a card for every channel showing what's airing, how long is left and what's next.

import { escapeHtml, liveBadge, logoTile, progressBar, starIcon } from "./liveTvMarkup.js";
import { programProgress } from "../liveTvGuide.js";
import { formatClock, formatDuration } from "../liveTvTime.js";

export const ON_NOW_COLUMNS = 4;
export const ON_NOW_CARD_HEIGHT_PX = 216;
export const ON_NOW_SORT_OPTIONS = [
  { id: "Channel", label: "Channel order" },
  { id: "EndingSoon", label: "Ending soon" },
  { id: "JustStarted", label: "Just started" }
];

export function renderOnNowSortRow(selectedSort, focusedIndex) {
  return `
    <div class="ltv-sort-row" data-ltv-key="sort" role="toolbar" aria-label="Sort">
      <span class="ltv-sort-label">Sort</span>
      ${ON_NOW_SORT_OPTIONS.map(
        (option, index) => `
        <button class="ltv-pill focusable${option.id === selectedSort ? " is-selected" : ""}${focusedIndex === index ? " focused" : ""}"
                data-ltv-zone="sort" data-ltv-index="${index}" tabindex="-1">${escapeHtml(option.label)}</button>`
      ).join("")}
    </div>`;
}

export function renderRecentStrip(channels, focusedIndex) {
  if (!channels.length) return "";
  return `
    <div class="ltv-recent-strip" data-ltv-key="recents">
      <span class="ltv-recent-label">Recently watched</span>
      ${channels
        .map(
          (channel, index) => `
        <button class="ltv-recent-item focusable${focusedIndex === index ? " focused" : ""}"
                data-ltv-zone="recents" data-ltv-index="${index}" tabindex="-1" aria-label="${escapeHtml(channel.name)}">
          ${logoTile(channel, "ltv-recent-logo")}
        </button>`
        )
        .join("")}
    </div>`;
}

function renderCard(entry, index, { focused, favorite, tuning, nowMs }) {
  const { channel, current, next } = entry;
  return `
    <div class="ltv-onnow-card focusable${focused ? " focused" : ""}" data-ltv-zone="cards" data-ltv-index="${index}" tabindex="-1"
         data-ltv-key="card:${escapeHtml(channel.id)}">
      <div class="ltv-onnow-top">
        ${logoTile(channel, "ltv-onnow-logo")}
        <div class="ltv-onnow-channel">
          <span class="ltv-onnow-number">${channel.number ? escapeHtml(String(channel.number)) : ""}</span>
          <span class="ltv-onnow-name">${escapeHtml(channel.name)}</span>
        </div>
        ${favorite ? starIcon(true) : ""}
        ${current ? liveBadge() : ""}
      </div>
      <div class="ltv-onnow-title">${escapeHtml(tuning ? "Tuning…" : current?.title || "No guide information")}</div>
      ${
        current
          ? `${progressBar(programProgress(current, nowMs), "ltv-onnow-progress")}
             <div class="ltv-onnow-meta">Ends in ${escapeHtml(formatDuration(current.endMs - nowMs))}</div>`
          : `<div class="ltv-onnow-meta">&nbsp;</div>`
      }
      <div class="ltv-onnow-next">${next ? `Up next · ${escapeHtml(formatClock(next.startMs))} ${escapeHtml(next.title)}` : "&nbsp;"}</div>
    </div>`;
}

export function renderOnNowCards({
  entries,
  topRow,
  visibleRows,
  focusedIndex,
  favorites,
  tuningChannelId,
  nowMs
}) {
  const start = topRow * ON_NOW_COLUMNS;
  const end = Math.min(entries.length, (topRow + visibleRows) * ON_NOW_COLUMNS);
  const cards = [];
  for (let index = start; index < end; index += 1) {
    const entry = entries[index];
    cards.push(
      renderCard(entry, index, {
        focused: focusedIndex === index,
        favorite: favorites.has(entry.channel.id),
        tuning: tuningChannelId === entry.channel.id,
        nowMs
      })
    );
  }
  const canScrollUp = topRow > 0;
  const canScrollDown = end < entries.length;
  return `
    <div class="ltv-onnow-grid" data-ltv-key="grid" data-ltv-deep="1">
      ${cards.join("")}
      ${canScrollUp ? `<span class="ltv-scroll-hint is-up" data-ltv-key="hint-up" aria-hidden="true">▲</span>` : ""}
      ${canScrollDown ? `<span class="ltv-scroll-hint is-down" data-ltv-key="hint-down" aria-hidden="true">▼</span>` : ""}
    </div>`;
}
