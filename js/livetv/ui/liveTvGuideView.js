// The program guide grid: a channel column, a half-hour time bar and programme cells.
// Only the rows and the time span on screen are drawn, so even 2019 TVs stay smooth.

import { escapeHtml, liveBadge, logoTile, progressBar, starIcon } from "./liveTvMarkup.js";
import { guidePrograms, programProgress } from "../liveTvGuide.js";
import { HALF_HOUR_MS, formatClock, formatDayLabel } from "../liveTvTime.js";

export const GUIDE_ROW_HEIGHT_PX = 84;
export const GUIDE_CHANNEL_COLUMN_PX = 300;
export const GUIDE_HALF_HOUR_PX = 300;
export const GUIDE_TIME_BAR_PX = 48;
const PX_PER_MS = GUIDE_HALF_HOUR_PX / HALF_HOUR_MS;

export function msToPx(ms) {
  return ms * PX_PER_MS;
}

export function pxToMs(px) {
  return px / PX_PER_MS;
}

/** The programmes a row can focus, limited to the guide window. Channels without data get one "no guide" cell. */
export function rowCells(guide, channel, window) {
  const programs = guidePrograms(guide, channel.id).filter(
    (program) => program.endMs > window.startMs && program.startMs < window.endMs
  );
  if (programs.length) return programs;
  return [
    {
      id: `nodata:${channel.id}`,
      channelId: channel.id,
      title: "No guide information",
      startMs: window.startMs,
      endMs: window.endMs,
      noData: true
    }
  ];
}

/** Index of the cell airing at `timeMs`, or the closest one. */
export function cellIndexAt(cells, timeMs) {
  if (!cells.length) return -1;
  const airing = cells.findIndex((cell) => timeMs >= cell.startMs && timeMs < cell.endMs);
  if (airing >= 0) return airing;
  let best = 0;
  let bestDistance = Infinity;
  cells.forEach((cell, index) => {
    const distance = timeMs < cell.startMs ? cell.startMs - timeMs : timeMs - cell.endMs;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function cellState(cell, nowMs) {
  if (cell.noData) return "nodata";
  if (nowMs >= cell.endMs) return "past";
  if (nowMs >= cell.startMs) return "airing";
  return "future";
}

function renderTimeBar(view, nowMs, dayLabel) {
  const slots = [];
  for (let slot = view.startMs; slot < view.endMs; slot += HALF_HOUR_MS) {
    slots.push(
      `<span class="ltv-time-slot" style="left:${Math.round(msToPx(slot - view.startMs))}px">${escapeHtml(formatClock(slot))}</span>`
    );
  }
  const nowInView = nowMs >= view.startMs && nowMs < view.endMs;
  return `
    <div class="ltv-time-bar" data-ltv-key="timebar" style="height:${GUIDE_TIME_BAR_PX}px">
      <div class="ltv-time-day" style="width:${GUIDE_CHANNEL_COLUMN_PX}px">${escapeHtml(dayLabel)}</div>
      <div class="ltv-time-track">
        ${slots.join("")}
        ${
          nowInView
            ? `<span class="ltv-time-now" style="left:${Math.round(msToPx(nowMs - view.startMs))}px">${escapeHtml(formatClock(nowMs))}</span>`
            : ""
        }
      </div>
    </div>`;
}

function renderChannelCell(channel, { focused, favorite, tuning }) {
  return `
    <div class="ltv-channel-cell focusable${focused ? " focused" : ""}"
         data-ltv-zone="channel" data-ltv-channel-id="${escapeHtml(channel.id)}" tabindex="-1"
         style="width:${GUIDE_CHANNEL_COLUMN_PX}px">
      ${logoTile(channel, "ltv-channel-logo")}
      <span class="ltv-channel-copy">
        <span class="ltv-channel-number">${channel.number ? escapeHtml(String(channel.number)) : ""}</span>
        <span class="ltv-channel-name">${escapeHtml(channel.name)}</span>
        ${tuning ? `<span class="ltv-channel-tuning">Tuning…</span>` : ""}
      </span>
      ${favorite ? starIcon(true) : ""}
    </div>`;
}

function renderProgramCell(cell, view, nowMs, { focused, rowIndex, cellIndex }) {
  const visibleStart = Math.max(cell.startMs, view.startMs);
  const visibleEnd = Math.min(cell.endMs, view.endMs);
  if (visibleEnd <= visibleStart) return "";
  const left = Math.round(msToPx(visibleStart - view.startMs));
  const width = Math.max(8, Math.round(msToPx(visibleEnd - visibleStart)) - 4);
  const state = cellState(cell, nowMs);
  const continues = cell.startMs < view.startMs;
  const time = cell.noData ? "" : `${formatClock(cell.startMs)} – ${formatClock(cell.endMs)}`;
  return `
    <div class="ltv-program-cell is-${state}${focused ? " focused" : ""}${continues ? " continues" : ""} focusable"
         data-ltv-zone="grid" data-ltv-row="${rowIndex}" data-ltv-cell="${cellIndex}" tabindex="-1"
         style="left:${left}px;width:${width}px">
      <span class="ltv-program-title">${continues ? "‹ " : ""}${escapeHtml(cell.title)}</span>
      ${time && width > 150 ? `<span class="ltv-program-time">${escapeHtml(time)}</span>` : ""}
      ${state === "airing" ? progressBar(programProgress(cell, nowMs), "ltv-program-progress") : ""}
    </div>`;
}

/**
 * @param {object} options
 * @param {object} options.guide
 * @param {Array} options.channels  channels of the selected chip
 * @param {{startMs:number,endMs:number}} options.view  visible time span
 * @param {number} options.topRow  first row on screen
 * @param {number} options.visibleRows
 * @param {object} options.focus  { zone: "grid" | "channel" | other, row, cell }
 */
export function renderGuideGrid({
  guide,
  channels,
  window,
  view,
  topRow,
  visibleRows,
  nowMs,
  focus,
  favorites,
  tuningChannelId
}) {
  const rows = [];
  const lastRow = Math.min(channels.length, topRow + visibleRows);
  for (let rowIndex = topRow; rowIndex < lastRow; rowIndex += 1) {
    const channel = channels[rowIndex];
    const cells = rowCells(guide, channel, window);
    const rowFocused = focus.row === rowIndex;
    const programHtml = cells
      .map((cell, cellIndex) =>
        renderProgramCell(cell, view, nowMs, {
          focused: rowFocused && focus.zone === "grid" && focus.cell === cellIndex,
          rowIndex,
          cellIndex
        })
      )
      .join("");
    rows.push(`
      <div class="ltv-guide-row${rowFocused ? " is-focused-row" : ""}" style="height:${GUIDE_ROW_HEIGHT_PX}px" data-ltv-row="${rowIndex}"
           data-ltv-key="row:${escapeHtml(channel.id)}">
        ${renderChannelCell(channel, {
          focused: rowFocused && focus.zone === "channel",
          favorite: favorites.has(channel.id),
          tuning: tuningChannelId === channel.id
        })}
        <div class="ltv-program-track">${programHtml}</div>
      </div>`);
  }
  const nowInView = nowMs >= view.startMs && nowMs < view.endMs;
  const nowLeft = GUIDE_CHANNEL_COLUMN_PX + Math.round(msToPx(nowMs - view.startMs));
  const canScrollUp = topRow > 0;
  const canScrollDown = lastRow < channels.length;
  return `
    ${renderTimeBar(view, nowMs, formatDayLabel(Math.max(view.startMs, nowMs), nowMs))}
    <div class="ltv-guide-body" data-ltv-key="body" data-ltv-deep="1">
      ${rows.join("")}
      ${nowInView ? `<span class="ltv-now-line" data-ltv-key="now" style="left:${nowLeft}px"></span>` : ""}
      ${canScrollUp ? `<span class="ltv-scroll-hint is-up" data-ltv-key="hint-up" aria-hidden="true">▲</span>` : ""}
      ${canScrollDown ? `<span class="ltv-scroll-hint is-down" data-ltv-key="hint-down" aria-hidden="true">▼</span>` : ""}
    </div>`;
}

/** Details for the focused programme (or channel) above the grid. */
export function renderGuideDetails({ channel, program, nowMs, favorite, tuning }) {
  if (!channel) return `<div class="ltv-details is-empty" data-ltv-key="details"></div>`;
  const airing = program && !program.noData && nowMs >= program.startMs && nowMs < program.endMs;
  const future = program && !program.noData && program.startMs > nowMs;
  const meta = [];
  if (program && !program.noData) {
    meta.push(`${formatClock(program.startMs)} – ${formatClock(program.endMs)}`);
    if (airing) {
      const minutes = Math.max(1, Math.round((program.endMs - nowMs) / 60000));
      meta.push(
        minutes >= 60
          ? `Ends in ${Math.floor(minutes / 60)}h ${minutes % 60}m`
          : `Ends in ${minutes} min`
      );
    } else if (future) {
      meta.push(`${formatDayLabel(program.startMs, nowMs)}`);
    }
  }
  meta.push(`${channel.number ? `${channel.number} · ` : ""}${channel.name}`);
  const action = tuning
    ? "Tuning…"
    : future
      ? "Starts later · OK watches the channel now"
      : "OK to watch";
  return `
    <div class="ltv-details" data-ltv-key="details">
      ${logoTile(channel, "ltv-details-logo")}
      <div class="ltv-details-copy">
        <div class="ltv-details-title-row">
          ${airing ? liveBadge() : ""}
          <span class="ltv-details-title">${escapeHtml(program?.title || channel.name)}</span>
          ${favorite ? starIcon(true) : ""}
        </div>
        <div class="ltv-details-meta">${escapeHtml(meta.join("  ·  "))}</div>
        ${
          program?.description
            ? `<div class="ltv-details-description">${escapeHtml(program.description)}</div>`
            : `<div class="ltv-details-description is-muted">${escapeHtml(channel.description || "")}</div>`
        }
      </div>
      <div class="ltv-details-hints">
        <span class="ltv-hint">${escapeHtml(action)}</span>
        <span class="ltv-hint">Hold OK · channel options</span>
        <span class="ltv-hint"><span class="ltv-key-dot is-red"></span>Favorite <span class="ltv-key-dot is-yellow"></span>−2h <span class="ltv-key-dot is-blue"></span>+2h</span>
      </div>
    </div>`;
}
