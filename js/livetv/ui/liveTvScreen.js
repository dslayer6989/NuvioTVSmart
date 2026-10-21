// The Live TV screen: program guide and On Now views, category chips, favorites,
// recently watched and a channel options menu. Every control works with the remote's
// arrows, OK and Back; colour and channel keys are shortcuts on top.

import { Router } from "../../ui/navigation/routerState.js";
import { ScreenUtils } from "../../ui/navigation/screen.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import { Platform } from "../../platform/index.js";
import { allowDpadRepeat, resetDpadRepeat } from "../../ui/navigation/dpadRepeatThrottle.js";
import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  focusWithoutAutoScroll,
  getRootSidebarNodes,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  isRootSidebarNode,
  isSelectedSidebarAction,
  renderRootSidebar,
  setLegacySidebarExpanded,
  setModernSidebarExpanded,
  setModernSidebarPillIconOnly
} from "../../ui/components/sidebarNavigation.js";
import {
  LIVE_TV_FAVORITES_GROUP_ID,
  LIVE_TV_RECENT_GROUP_ID,
  LiveTvRepository
} from "../liveTvRepository.js";
import { LiveTvPlayback } from "../liveTvPlayback.js";
import { guideChannel, guideWindow, onNowEntries, programAt } from "../liveTvGuide.js";
import { HALF_HOUR_MS, HOUR_MS, floorToHalfHour, formatClock } from "../liveTvTime.js";
import { escapeHtml, liveBadge } from "./liveTvMarkup.js";
import { patchRegion } from "./liveTvDomPatch.js";
import {
  GUIDE_CHANNEL_COLUMN_PX,
  GUIDE_ROW_HEIGHT_PX,
  GUIDE_TIME_BAR_PX,
  cellIndexAt,
  pxToMs,
  renderGuideDetails,
  renderGuideGrid,
  rowCells
} from "./liveTvGuideView.js";
import {
  ON_NOW_CARD_HEIGHT_PX,
  ON_NOW_COLUMNS,
  ON_NOW_SORT_OPTIONS,
  renderOnNowCards,
  renderOnNowSortRow,
  renderRecentStrip
} from "./liveTvOnNowView.js";

export const LIVE_TV_ROUTE = "liveTv";

const LONG_PRESS_MS = 600;
const TICK_MS = 30 * 1000;
const RECENT_STRIP_LIMIT = 10;
const TIME_JUMP_MS = 2 * HOUR_MS;
const DETAILS_BLOCK_PX = 182;

const KEY = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  ENTER: 13,
  PAGE_UP: 33,
  PAGE_DOWN: 34,
  CHANNEL_UP: 427,
  CHANNEL_DOWN: 428,
  RED: 403,
  GREEN: 404,
  YELLOW: 405,
  BLUE: 406,
  F: 70,
  G: 71
};

const HEADER_ACTIONS = [
  { id: "viewGuide", label: "Guide", icon: "grid_view" },
  { id: "viewOnNow", label: "On Now", icon: "live_tv" },
  { id: "lastChannel", label: "Last channel", icon: "history" },
  { id: "refresh", label: "Refresh", icon: "refresh" },
  { id: "settings", label: "Settings", icon: "settings" }
];

function keyCodeOf(event) {
  return Number(event?.keyCode || 0);
}

function isLongPressCapable(zone) {
  return zone === "grid" || zone === "channel" || zone === "cards" || zone === "recents";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export const LiveTvScreen = {
  ui: null,

  resetUi() {
    this.ui = {
      zone: "content",
      headerIndex: 0,
      chipIndex: 0,
      sortIndex: 0,
      recentIndex: 0,
      stateIndex: 0,
      row: 0,
      cell: 0,
      cursorTimeMs: Date.now(),
      topRow: 0,
      viewStartMs: null,
      cardIndex: 0,
      cardTopRow: 0,
      lastContentZone: "grid"
    };
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById(LIVE_TV_ROUTE);
    ScreenUtils.show(this.container);
    this.layoutPrefs = LayoutPreferences.get();
    this.mountToken = (this.mountToken || 0) + 1;
    const mountToken = this.mountToken;
    if (!this.ui || !navigationContext?.isBackNavigation) this.resetUi();
    this.menu = null;
    this.pendingEnter = null;
    this.sidebarExpanded = false;
    this.pillIconOnly = false;
    this.focusZone = "content";
    this.routeEnterPending = true;
    try {
      this.sidebarProfile = await getSidebarProfileState({ cacheOnly: true });
    } catch (_) {
      this.sidebarProfile = null;
    }
    if (mountToken !== this.mountToken) return;
    LiveTvRepository.ensureLoaded();
    this.unsubscribe?.();
    this.unsubscribe = LiveTvRepository.subscribe(() => this.onRepositoryChange());
    this.unsubscribeTuning?.();
    this.unsubscribeTuning = LiveTvPlayback.onTuningChange(() =>
      this.renderContent({ keepFocus: true })
    );
    this.renderShell();
    this.renderContent();
    clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => this.onTick(), TICK_MS);
    void getSidebarProfileState()
      .then((profile) => {
        if (profile && mountToken === this.mountToken && Router.getCurrent() === LIVE_TV_ROUTE)
          this.sidebarProfile = profile;
      })
      .catch(() => {});
    if (params?.jumpToNow) this.jumpToNow();
  },

  cleanup() {
    this.mountToken = (this.mountToken || 0) + 1;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeTuning?.();
    this.unsubscribeTuning = null;
    this.menu = null;
    this.pendingEnter = null;
    resetDpadRepeat(this);
    ScreenUtils.hide(this.container);
  },

  onRepositoryChange() {
    if (Router.getCurrent() !== LIVE_TV_ROUTE) return;
    this.renderContent({ keepFocus: true });
  },

  onTick() {
    if (Router.getCurrent() !== LIVE_TV_ROUTE) return;
    LiveTvRepository.refreshIfStale();
    this.renderContent({ keepFocus: true });
  },

  onSidebarReselect() {
    this.jumpToNow();
  },

  get state() {
    return LiveTvRepository.state;
  },

  // --- Layout -----------------------------------------------------------------------

  renderShell() {
    const enterClass = ScreenUtils.routeEnterClass(
      this,
      this.routeEnterPending,
      " nuvio-route-slide-enter"
    );
    this.routeEnterPending = false;
    this.container.innerHTML = `
      <div class="home-shell livetv-shell${this.layoutPrefs?.modernSidebar ? " has-modern-sidebar" : ""}">
        ${renderRootSidebar({
          selectedRoute: LIVE_TV_ROUTE,
          profile: this.sidebarProfile,
          layout: this.layoutPrefs,
          expanded: Boolean(this.sidebarExpanded),
          pillIconOnly: Boolean(this.pillIconOnly)
        })}
        <main class="home-main livetv-main${enterClass}">
          <header class="ltv-header" id="ltvHeader"></header>
          <nav class="ltv-chips" id="ltvChips" aria-label="Channel categories"></nav>
          <section class="ltv-body" id="ltvBody"></section>
          <div class="ltv-menu-layer" id="ltvMenu"></div>
        </main>
      </div>`;
    bindRootSidebarEvents(this.container, {
      currentRoute: LIVE_TV_ROUTE,
      onSelectedAction: () => this.closeSidebarToContent(),
      onExpandSidebar: () => this.openSidebar()
    });
    this.bindPointerEvents();
  },

  chips() {
    const state = this.state;
    const chips = [{ id: null, label: "All channels" }];
    if (state.favoriteIds.length)
      chips.push({ id: LIVE_TV_FAVORITES_GROUP_ID, label: "★ Favorites" });
    if (state.recentIds.length) chips.push({ id: LIVE_TV_RECENT_GROUP_ID, label: "Recent" });
    LiveTvRepository.addonChips().forEach((group) =>
      chips.push({ id: group.id, label: group.name })
    );
    return chips;
  },

  status() {
    const state = this.state;
    if (!LiveTvRepository.isConfigured()) return "setup";
    if (state.guide) return "ready";
    if (state.errorMessage) return "error";
    return "loading";
  },

  stateButtons() {
    const status = this.status();
    if (status === "setup") {
      return [
        { id: "setupPhone", label: "Set up with your phone", icon: "qr_code_2" },
        { id: "setupType", label: "Type the link", icon: "keyboard" }
      ];
    }
    if (status === "error") {
      return [
        { id: "retry", label: "Try again", icon: "refresh" },
        { id: "settings", label: "Live TV settings", icon: "settings" }
      ];
    }
    return [];
  },

  visibleChannels() {
    return LiveTvRepository.channelsFor(this.state.selectedGroupId);
  },

  isOnNow() {
    return this.state.viewMode === "OnNow";
  },

  /** Zones the arrows can reach right now, top to bottom. */
  verticalZones() {
    const status = this.status();
    const zones = ["header"];
    if (status !== "ready") {
      if (this.stateButtons().length) zones.push("state");
      return zones;
    }
    zones.push("chips");
    if (!this.visibleChannels().length) return zones;
    if (this.isOnNow()) {
      zones.push("sort");
      if (this.recentChannels().length) zones.push("recents");
      zones.push("cards");
    } else {
      zones.push("grid");
    }
    return zones;
  },

  recentChannels() {
    const guide = this.state.guide;
    return this.state.recentIds
      .map((id) => guideChannel(guide, id))
      .filter(Boolean)
      .slice(0, RECENT_STRIP_LIMIT);
  },

  headerActions() {
    return HEADER_ACTIONS.filter((action) => {
      if (this.status() !== "ready") return action.id === "settings" || action.id === "refresh";
      if (action.id === "lastChannel") return Boolean(LiveTvRepository.previousChannelId(null));
      return true;
    });
  },

  renderHeader() {
    const header = this.container?.querySelector("#ltvHeader");
    if (!header) return;
    const state = this.state;
    const guide = state.guide;
    const actions = this.headerActions();
    this.ui.headerIndex = clamp(this.ui.headerIndex, 0, Math.max(0, actions.length - 1));
    const statusText = guide
      ? `${guide.addonName} · ${guide.lineupIds.length} channels${state.isRefreshing ? " · Refreshing…" : ` · Updated ${formatClock(guide.loadedAtMs)}`}`
      : state.isLoading
        ? "Loading the guide…"
        : "";
    patchRegion(
      header,
      `
      <div class="ltv-title-block" data-ltv-key="title">
        <h1 class="ltv-title">${liveBadge("LIVE")}<span class="ltv-title-text">Live TV</span></h1>
        <div class="ltv-subtitle">${escapeHtml(statusText)}</div>
      </div>
      <div class="ltv-actions" role="toolbar" data-ltv-key="actions" data-ltv-deep="1">
        ${actions
          .map((action, index) => {
            const selected =
              (action.id === "viewGuide" && !this.isOnNow()) ||
              (action.id === "viewOnNow" && this.isOnNow());
            const focused =
              this.focusZone === "content" &&
              this.ui.zone === "header" &&
              this.ui.headerIndex === index;
            return `
            <button class="ltv-action focusable${selected ? " is-selected" : ""}${focused ? " focused" : ""}"
                    data-ltv-zone="header" data-ltv-index="${index}" data-ltv-action="${action.id}" tabindex="-1"
                    data-ltv-key="action:${action.id}">
              <span class="material-icons ltv-action-icon" aria-hidden="true">${action.icon}</span>
              <span class="ltv-action-label">${escapeHtml(action.label)}</span>
            </button>`;
          })
          .join("")}
      </div>`
    );
  },

  renderChips() {
    const nav = this.container?.querySelector("#ltvChips");
    if (!nav) return;
    if (this.status() !== "ready") {
      patchRegion(nav, "");
      nav.classList.add("is-hidden");
      return;
    }
    nav.classList.remove("is-hidden");
    const chips = this.chips();
    const selectedIndex = Math.max(
      0,
      chips.findIndex((chip) => chip.id === (this.state.selectedGroupId || null))
    );
    if (this.ui.zone !== "chips") this.ui.chipIndex = selectedIndex;
    this.ui.chipIndex = clamp(this.ui.chipIndex, 0, chips.length - 1);
    patchRegion(
      nav,
      `
      <div class="ltv-chip-track" id="ltvChipTrack" data-ltv-key="track" data-ltv-deep="1">
        ${chips
          .map((chip, index) => {
            const focused =
              this.focusZone === "content" &&
              this.ui.zone === "chips" &&
              this.ui.chipIndex === index;
            return `
            <button class="ltv-pill ltv-chip focusable${index === selectedIndex ? " is-selected" : ""}${focused ? " focused" : ""}"
                    data-ltv-zone="chips" data-ltv-index="${index}" tabindex="-1"
                    data-ltv-key="chip:${escapeHtml(chip.id || "all")}">${escapeHtml(chip.label)}</button>`;
          })
          .join("")}
      </div>`
    );
    this.scrollChipIntoView();
  },

  scrollChipIntoView() {
    const nav = this.container?.querySelector("#ltvChips");
    const track = nav?.querySelector("#ltvChipTrack");
    const chip = track?.querySelector(`[data-ltv-index="${this.ui.chipIndex}"]`);
    if (!nav || !track || !chip) return;
    const navWidth = nav.clientWidth;
    const chipLeft = chip.offsetLeft;
    const chipRight = chipLeft + chip.offsetWidth;
    let offset = this.chipOffset || 0;
    if (chipRight - offset > navWidth - 24) offset = chipRight - navWidth + 24;
    if (chipLeft - offset < 0) offset = Math.max(0, chipLeft - 24);
    this.chipOffset = offset;
    track.style.transform = `translateX(${-offset}px)`;
  },

  renderStatePanel() {
    const status = this.status();
    const buttons = this.stateButtons();
    this.ui.stateIndex = clamp(this.ui.stateIndex, 0, Math.max(0, buttons.length - 1));
    const buttonHtml = buttons
      .map((button, index) => {
        const focused =
          this.focusZone === "content" && this.ui.zone === "state" && this.ui.stateIndex === index;
        return `
        <button class="ltv-state-button focusable${focused ? " focused" : ""}" data-ltv-zone="state" data-ltv-index="${index}"
                data-ltv-action="${button.id}" tabindex="-1">
          <span class="material-icons" aria-hidden="true">${button.icon}</span>
          <span>${escapeHtml(button.label)}</span>
        </button>`;
      })
      .join("");
    if (status === "setup") {
      return `
        <div class="ltv-state-panel is-setup">
          <div class="ltv-state-icon material-icons" aria-hidden="true">live_tv</div>
          <h2 class="ltv-state-title">Set up Live TV</h2>
          <p class="ltv-state-message">Add the link of a Stremio addon with live channels. Its program guide loads automatically.</p>
          <p class="ltv-state-message is-small">The easiest way: scan a QR code with your phone and type or paste the link there.</p>
          <div class="ltv-state-buttons">${buttonHtml}</div>
        </div>`;
    }
    if (status === "error") {
      return `
        <div class="ltv-state-panel is-error">
          <div class="ltv-state-icon material-icons" aria-hidden="true">signal_cellular_connected_no_internet_4_bar</div>
          <h2 class="ltv-state-title">Couldn't load Live TV</h2>
          <p class="ltv-state-message">${escapeHtml(this.state.errorMessage)}</p>
          <div class="ltv-state-buttons">${buttonHtml}</div>
        </div>`;
    }
    return `
      <div class="ltv-state-panel is-loading">
        <div class="ltv-spinner" aria-hidden="true"></div>
        <p class="ltv-state-message">Loading the guide…</p>
      </div>`;
  },

  renderEmptyGroup() {
    const isFavorites = this.state.selectedGroupId === LIVE_TV_FAVORITES_GROUP_ID;
    return `
      <div class="ltv-state-panel is-empty">
        <h2 class="ltv-state-title">${isFavorites ? "No favorites yet" : "No channels here yet"}</h2>
        <p class="ltv-state-message">${
          isFavorites
            ? "Star a channel to pin it here: hold OK on a channel, or press the red button."
            : "Pick another category above."
        }</p>
      </div>`;
  },

  /** Re-renders everything below the sidebar. Focus follows `this.ui`. */
  renderContent({ keepFocus = false } = {}) {
    if (!this.container?.querySelector("#ltvBody")) return;
    void keepFocus;
    this.normalizeZone();
    this.renderHeader();
    this.renderChips();
    const body = this.container.querySelector("#ltvBody");
    const status = this.status();
    body.classList.toggle("is-onnow", status === "ready" && this.isOnNow());
    body.classList.toggle("is-guide", status === "ready" && !this.isOnNow());
    if (status !== "ready") {
      patchRegion(body, this.renderStatePanel());
    } else if (!this.visibleChannels().length) {
      patchRegion(body, this.renderEmptyGroup());
    } else if (this.isOnNow()) {
      this.renderOnNow(body);
    } else {
      this.renderGuide(body);
    }
    this.renderMenu();
    this.applyDomFocus();
  },

  normalizeZone() {
    if (this.focusZone !== "content") return;
    const zones = this.verticalZones();
    const zone = this.ui.zone === "channel" ? "grid" : this.ui.zone;
    if (!zones.includes(zone)) {
      const preferred = zones.includes(this.ui.lastContentZone) ? this.ui.lastContentZone : null;
      this.ui.zone =
        preferred ||
        (zones.includes("state")
          ? "state"
          : zones.includes("grid")
            ? "grid"
            : zones.includes("cards")
              ? "cards"
              : zones[zones.length - 1]);
    }
  },

  // --- Guide ------------------------------------------------------------------------

  guideMetrics(body) {
    const width = Math.max(600, (body?.clientWidth || 1500) - GUIDE_CHANNEL_COLUMN_PX);
    // The details panel (168px + 14px gap) and the guide's border sit above the rows.
    const height = Math.max(
      GUIDE_ROW_HEIGHT_PX * 3,
      (body?.clientHeight || 820) - DETAILS_BLOCK_PX - GUIDE_TIME_BAR_PX - 4
    );
    return {
      spanMs: pxToMs(width),
      visibleRows: Math.max(3, Math.floor(height / GUIDE_ROW_HEIGHT_PX))
    };
  },

  ensureGuideView(body) {
    const nowMs = Date.now();
    const guide = this.state.guide;
    const window = guideWindow(guide, nowMs);
    const channels = this.visibleChannels();
    const { spanMs, visibleRows } = this.guideMetrics(body);
    this.guideVisibleRows = visibleRows;
    const maxStart = Math.max(window.startMs, window.endMs - spanMs);
    if (this.ui.viewStartMs == null) this.ui.viewStartMs = floorToHalfHour(nowMs) - HALF_HOUR_MS;
    this.ui.viewStartMs = clamp(this.ui.viewStartMs, window.startMs, maxStart);
    this.ui.row = clamp(this.ui.row, 0, channels.length - 1);
    const cells = rowCells(guide, channels[this.ui.row], window);
    if (
      this.ui.cell >= cells.length ||
      this.ui.cellRow !== this.ui.row ||
      this.ui.cellChannelId !== channels[this.ui.row].id
    ) {
      this.ui.cell = cellIndexAt(cells, this.ui.cursorTimeMs);
    }
    this.ui.cell = clamp(this.ui.cell, 0, cells.length - 1);
    this.ui.cellRow = this.ui.row;
    this.ui.cellChannelId = channels[this.ui.row].id;
    // Keep the focused row on screen.
    if (this.ui.row < this.ui.topRow) this.ui.topRow = this.ui.row;
    if (this.ui.row >= this.ui.topRow + visibleRows) this.ui.topRow = this.ui.row - visibleRows + 1;
    this.ui.topRow = clamp(this.ui.topRow, 0, Math.max(0, channels.length - visibleRows));
    return { nowMs, guide, window, channels, spanMs, visibleRows, cells };
  },

  /** Scrolls the time span so the focused programme's start (or the cursor) is visible. */
  scrollViewToCell(cell, window, spanMs) {
    const start = this.ui.viewStartMs;
    const end = start + spanMs;
    const margin = HALF_HOUR_MS / 2;
    let next = start;
    const focusTime = Math.max(cell.startMs, window.startMs);
    if (focusTime < start) next = floorToHalfHour(focusTime);
    else if (focusTime > end - margin) next = floorToHalfHour(focusTime) - HALF_HOUR_MS;
    const maxStart = Math.max(window.startMs, window.endMs - spanMs);
    this.ui.viewStartMs = clamp(next, window.startMs, maxStart);
  },

  renderGuide(body) {
    const { nowMs, guide, window, channels, spanMs, visibleRows, cells } =
      this.ensureGuideView(body);
    const view = { startMs: this.ui.viewStartMs, endMs: this.ui.viewStartMs + spanMs };
    const focusedChannel = channels[this.ui.row];
    const focusedCell = cells[this.ui.cell];
    const inGrid =
      this.focusZone === "content" && (this.ui.zone === "grid" || this.ui.zone === "channel");
    const detailsProgram =
      this.ui.zone === "channel"
        ? programAt(guide, focusedChannel.id, nowMs) || focusedCell
        : focusedCell;
    const favorites = new Set(this.state.favoriteIds);
    patchRegion(
      body,
      `
      ${renderGuideDetails({
        channel: focusedChannel,
        program: detailsProgram,
        nowMs,
        favorite: favorites.has(focusedChannel.id),
        tuning: LiveTvPlayback.tuningChannelId === focusedChannel.id
      })}
      <div class="ltv-guide" id="ltvGuide" data-ltv-key="guide" data-ltv-deep="1">
        ${renderGuideGrid({
          guide,
          channels,
          window,
          view,
          topRow: this.ui.topRow,
          visibleRows,
          nowMs,
          focus: { zone: inGrid ? this.ui.zone : "", row: this.ui.row, cell: this.ui.cell },
          favorites,
          tuningChannelId: LiveTvPlayback.tuningChannelId
        })}
      </div>`
    );
  },

  moveGuideRow(delta, { page = false } = {}) {
    const channels = this.visibleChannels();
    if (!channels.length) return;
    const step = page ? Math.max(1, (this.guideVisibleRows || 6) - 1) : 1;
    const next = this.ui.row + delta * step;
    if (next < 0) {
      if (page) {
        this.ui.row = 0;
      } else {
        this.setZone(this.previousZone("grid"));
        return;
      }
    } else if (next > channels.length - 1) {
      if (!page) return;
      this.ui.row = channels.length - 1;
    } else {
      this.ui.row = next;
    }
    if (page)
      this.ui.topRow = clamp(
        this.ui.topRow + delta * step,
        0,
        Math.max(0, channels.length - (this.guideVisibleRows || 6))
      );
    this.ui.cellRow = -1; // re-pick the programme at the cursor time on the new row
  },

  moveGuideCell(delta) {
    const body = this.container.querySelector("#ltvBody");
    const { window, channels, spanMs } = this.ensureGuideView(body);
    const cells = rowCells(this.state.guide, channels[this.ui.row], window);
    const next = this.ui.cell + delta;
    if (next < 0) {
      // Nothing earlier in the guide window: the channel column is next.
      this.ui.zone = "channel";
      return;
    }
    if (next >= cells.length) {
      // Past the last programme: scroll later if the window allows it.
      const maxStart = Math.max(window.startMs, window.endMs - spanMs);
      this.ui.viewStartMs = clamp(this.ui.viewStartMs + HALF_HOUR_MS, window.startMs, maxStart);
      return;
    }
    this.ui.cell = next;
    const cell = cells[next];
    this.scrollViewToCell(cell, window, spanMs);
    this.ui.cursorTimeMs = Math.max(cell.startMs, this.ui.viewStartMs);
  },

  shiftGuideTime(deltaMs) {
    const body = this.container.querySelector("#ltvBody");
    const { window, channels, spanMs } = this.ensureGuideView(body);
    const maxStart = Math.max(window.startMs, window.endMs - spanMs);
    this.ui.viewStartMs = clamp(
      floorToHalfHour(this.ui.viewStartMs + deltaMs),
      window.startMs,
      maxStart
    );
    this.ui.cursorTimeMs = this.ui.viewStartMs + Math.min(spanMs / 3, HOUR_MS);
    const cells = rowCells(this.state.guide, channels[this.ui.row], window);
    this.ui.cell = cellIndexAt(cells, this.ui.cursorTimeMs);
  },

  jumpToNow() {
    if (!this.ui) return;
    const nowMs = Date.now();
    this.ui.viewStartMs = floorToHalfHour(nowMs) - HALF_HOUR_MS;
    this.ui.cursorTimeMs = nowMs;
    this.ui.cellRow = -1;
    if (Router.getCurrent() === LIVE_TV_ROUTE && this.container?.querySelector("#ltvBody"))
      this.renderContent();
  },

  // --- On Now -----------------------------------------------------------------------

  onNowEntries() {
    return onNowEntries(this.state.guide, this.visibleChannels(), Date.now(), this.state.onNowSort);
  },

  renderOnNow(body) {
    const entries = this.onNowEntries();
    const recents = this.recentChannels();
    this.ui.sortIndex = clamp(this.ui.sortIndex, 0, ON_NOW_SORT_OPTIONS.length - 1);
    this.ui.recentIndex = clamp(this.ui.recentIndex, 0, Math.max(0, recents.length - 1));
    this.ui.cardIndex = clamp(this.ui.cardIndex, 0, Math.max(0, entries.length - 1));
    const zone = this.focusZone === "content" ? this.ui.zone : "";
    // The sort row (64px) and the recently watched strip (92px) sit above the cards.
    const toolbarHeight = 64 + (recents.length ? 92 : 0);
    const visibleRows = Math.max(
      1,
      Math.floor(((body.clientHeight || 820) - toolbarHeight) / ON_NOW_CARD_HEIGHT_PX)
    );
    this.onNowVisibleRows = visibleRows;
    const focusedRow = Math.floor(this.ui.cardIndex / ON_NOW_COLUMNS);
    if (focusedRow < this.ui.cardTopRow) this.ui.cardTopRow = focusedRow;
    if (focusedRow >= this.ui.cardTopRow + visibleRows)
      this.ui.cardTopRow = focusedRow - visibleRows + 1;
    const totalRows = Math.ceil(entries.length / ON_NOW_COLUMNS);
    this.ui.cardTopRow = clamp(this.ui.cardTopRow, 0, Math.max(0, totalRows - visibleRows));
    patchRegion(
      body,
      `
      <div class="ltv-onnow-toolbar" data-ltv-key="toolbar" data-ltv-deep="1">
        ${renderOnNowSortRow(this.state.onNowSort, zone === "sort" ? this.ui.sortIndex : -1)}
        ${renderRecentStrip(recents, zone === "recents" ? this.ui.recentIndex : -1)}
      </div>
      <div class="ltv-onnow" id="ltvOnNow" data-ltv-key="onnow" data-ltv-deep="1">
        ${renderOnNowCards({
          entries,
          topRow: this.ui.cardTopRow,
          visibleRows,
          focusedIndex: zone === "cards" ? this.ui.cardIndex : -1,
          favorites: new Set(this.state.favoriteIds),
          tuningChannelId: LiveTvPlayback.tuningChannelId,
          nowMs: Date.now()
        })}
      </div>`
    );
  },

  // --- Channel options menu ---------------------------------------------------------

  openChannelMenu(channelId) {
    const channel = guideChannel(this.state.guide, channelId);
    if (!channel) return;
    this.menu = { channelId, index: 0 };
    this.renderMenu();
    this.applyDomFocus();
  },

  menuOptions() {
    if (!this.menu) return [];
    const favorite = LiveTvRepository.isFavorite(this.menu.channelId);
    return [
      { id: "watch", label: "Watch now", icon: "play_arrow" },
      {
        id: "favorite",
        label: favorite ? "Remove from favorites" : "Add to favorites",
        icon: favorite ? "star" : "star_border"
      },
      { id: "close", label: "Cancel", icon: "close" }
    ];
  },

  renderMenu() {
    const layer = this.container?.querySelector("#ltvMenu");
    if (!layer) return;
    if (!this.menu) {
      layer.innerHTML = "";
      layer.classList.remove("is-open");
      return;
    }
    const channel = guideChannel(this.state.guide, this.menu.channelId);
    const program = programAt(this.state.guide, this.menu.channelId, Date.now());
    const options = this.menuOptions();
    this.menu.index = clamp(this.menu.index, 0, options.length - 1);
    layer.classList.add("is-open");
    layer.innerHTML = `
      <div class="ltv-menu" role="dialog" aria-label="${escapeHtml(channel?.name || "Channel")}">
        <div class="ltv-menu-title">${channel?.number ? `${channel.number} · ` : ""}${escapeHtml(channel?.name || "")}</div>
        <div class="ltv-menu-subtitle">${escapeHtml(program?.title || "")}</div>
        ${options
          .map(
            (option, index) => `
          <button class="ltv-menu-option focusable${index === this.menu.index ? " focused" : ""}" data-ltv-zone="menu"
                  data-ltv-index="${index}" tabindex="-1">
            <span class="material-icons" aria-hidden="true">${option.icon}</span>
            <span>${escapeHtml(option.label)}</span>
          </button>`
          )
          .join("")}
      </div>`;
  },

  closeMenu() {
    this.menu = null;
    this.renderContent({ keepFocus: true });
  },

  activateMenu() {
    const option = this.menuOptions()[this.menu?.index || 0];
    const channelId = this.menu?.channelId;
    if (!option || !channelId) return;
    if (option.id === "watch") {
      this.menu = null;
      this.renderMenu();
      void this.playChannel(channelId);
      return;
    }
    if (option.id === "favorite") {
      LiveTvRepository.toggleFavorite(channelId);
    }
    this.closeMenu();
  },

  // --- Focus ------------------------------------------------------------------------

  applyDomFocus() {
    if (!this.container || this.focusZone !== "content") return;
    let target = null;
    if (this.menu) {
      target = this.container.querySelector(".ltv-menu-option.focused");
    } else {
      target = this.container.querySelector(
        "#ltvHeader .focused, #ltvChips .focused, #ltvBody .focused"
      );
    }
    if (!target) return;
    this.container
      .querySelectorAll(
        ".home-sidebar .focusable.focused, .modern-sidebar-panel .focusable.focused"
      )
      .forEach((node) => {
        node.classList.remove("focused");
      });
    focusWithoutAutoScroll(target);
  },

  setZone(zone) {
    if (!zone) return;
    if (zone === "grid" || zone === "cards") this.ui.lastContentZone = zone;
    this.ui.zone = zone;
  },

  previousZone(zone) {
    const zones = this.verticalZones();
    const index = zones.indexOf(zone);
    return index > 0 ? zones[index - 1] : null;
  },

  nextZone(zone) {
    const zones = this.verticalZones();
    const index = zones.indexOf(zone);
    return index >= 0 && index < zones.length - 1 ? zones[index + 1] : null;
  },

  // --- Sidebar ----------------------------------------------------------------------

  focusSidebarNode(preferredNode = null) {
    const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
    const target =
      preferredNode ||
      getRootSidebarSelectedNode(this.container, this.layoutPrefs) ||
      nodes[0] ||
      null;
    if (!target) return false;
    this.container.querySelectorAll(".focusable.focused").forEach((node) => {
      if (node !== target) node.classList.remove("focused");
    });
    target.classList.add("focused");
    focusWithoutAutoScroll(target);
    this.focusZone = "sidebar";
    return true;
  },

  openSidebar() {
    this.focusZone = "sidebar";
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      this.sidebarExpanded = true;
      setModernSidebarExpanded(this.container, true);
    } else if (!this.layoutPrefs?.modernSidebar) {
      setLegacySidebarExpanded(this.container, true);
    }
    this.renderContent();
    return this.focusSidebarNode();
  },

  closeSidebarToContent() {
    this.focusZone = "content";
    if (this.layoutPrefs?.modernSidebar && this.sidebarExpanded) {
      this.sidebarExpanded = false;
      setModernSidebarExpanded(this.container, false);
    } else if (!this.layoutPrefs?.modernSidebar) {
      setLegacySidebarExpanded(this.container, false);
    }
    this.renderContent();
    return true;
  },

  // --- Actions ----------------------------------------------------------------------

  async playChannel(channelId) {
    const groupId = this.state.selectedGroupId;
    await LiveTvPlayback.play(channelId, { groupId });
  },

  focusedChannelId() {
    const zone = this.ui.zone;
    if (zone === "grid" || zone === "channel")
      return this.visibleChannels()[this.ui.row]?.id || null;
    if (zone === "cards") return this.onNowEntries()[this.ui.cardIndex]?.channel?.id || null;
    if (zone === "recents") return this.recentChannels()[this.ui.recentIndex]?.id || null;
    return null;
  },

  activateHeader(actionId) {
    if (actionId === "viewGuide") {
      LiveTvRepository.setViewMode("Guide");
    } else if (actionId === "viewOnNow") {
      LiveTvRepository.setViewMode("OnNow");
    } else if (actionId === "lastChannel") {
      const channelId = LiveTvRepository.previousChannelId(null);
      if (channelId) void this.playChannel(channelId);
    } else if (actionId === "refresh") {
      void LiveTvRepository.refresh({ force: true });
    } else if (actionId === "settings") {
      Router.navigate("settings", { section: "liveTv" });
    } else if (actionId === "setupPhone") {
      Router.navigate("settings", { section: "liveTv", liveTvAction: "phone" });
    } else if (actionId === "setupType") {
      Router.navigate("settings", { section: "liveTv", liveTvAction: "type" });
    } else if (actionId === "retry") {
      void LiveTvRepository.refresh({ force: true });
    }
  },

  selectChip(index) {
    const chip = this.chips()[index];
    if (!chip) return;
    this.ui.chipIndex = index;
    if ((chip.id || null) !== (this.state.selectedGroupId || null)) {
      this.ui.row = 0;
      this.ui.topRow = 0;
      this.ui.cardIndex = 0;
      this.ui.cardTopRow = 0;
      this.ui.cellRow = -1;
      LiveTvRepository.selectGroup(chip.id);
    }
  },

  activateFocused() {
    const zone = this.ui.zone;
    if (zone === "header") {
      const action = this.headerActions()[this.ui.headerIndex];
      if (action) this.activateHeader(action.id);
      return;
    }
    if (zone === "state") {
      const button = this.stateButtons()[this.ui.stateIndex];
      if (button) this.activateHeader(button.id);
      return;
    }
    if (zone === "chips") {
      this.selectChip(this.ui.chipIndex);
      return;
    }
    if (zone === "sort") {
      const option = ON_NOW_SORT_OPTIONS[this.ui.sortIndex];
      if (option) LiveTvRepository.setOnNowSort(option.id);
      return;
    }
    if (zone === "channel") {
      const channelId = this.focusedChannelId();
      if (channelId) this.openChannelMenu(channelId);
      return;
    }
    const channelId = this.focusedChannelId();
    if (channelId) void this.playChannel(channelId);
  },

  toggleFavoriteFocused() {
    const channelId = this.focusedChannelId();
    if (channelId) LiveTvRepository.toggleFavorite(channelId);
  },

  // --- Keys -------------------------------------------------------------------------

  consumeBackRequest() {
    if (this.menu) {
      this.closeMenu();
      return true;
    }
    if (this.focusZone === "sidebar") return false;
    this.openSidebar();
    return true;
  },

  async onKeyDown(event) {
    const code = keyCodeOf(event);
    if (this.menu) {
      event?.preventDefault?.();
      if (code === KEY.UP || code === KEY.DOWN) {
        const options = this.menuOptions();
        this.menu.index = clamp(
          this.menu.index + (code === KEY.UP ? -1 : 1),
          0,
          options.length - 1
        );
        this.renderMenu();
        this.applyDomFocus();
      } else if (code === KEY.ENTER && !event?.repeat) {
        this.menuEnterArmed = true;
      }
      return;
    }

    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      if (code === KEY.DOWN) {
        this.pillIconOnly = true;
        setModernSidebarPillIconOnly(this.container, true);
      } else if (code === KEY.UP) {
        this.pillIconOnly = false;
        setModernSidebarPillIconOnly(this.container, false);
      }
    }

    if (this.focusZone === "sidebar") {
      this.handleSidebarKey(event, code);
      return;
    }

    if ([KEY.LEFT, KEY.UP, KEY.RIGHT, KEY.DOWN].includes(code)) {
      event?.preventDefault?.();
      if (!allowDpadRepeat(this, event, { horizontalMs: 90, verticalMs: 120 })) return;
      this.handleArrow(code);
      return;
    }

    if (code === KEY.ENTER) {
      event?.preventDefault?.();
      if (isLongPressCapable(this.ui.zone)) {
        if (!event?.repeat) {
          this.pendingEnter = { zone: this.ui.zone, startedAt: Date.now(), handled: false };
        } else if (this.pendingEnter && !this.pendingEnter.handled) {
          this.pendingEnter.handled = true;
          const channelId = this.focusedChannelId();
          if (channelId) this.openChannelMenu(channelId);
        }
        return;
      }
      if (!event?.repeat) this.activateFocused();
      return;
    }

    if (code === KEY.RED || code === KEY.F) {
      this.toggleFavoriteFocused();
      return;
    }
    if (code === KEY.GREEN || code === KEY.G) {
      LiveTvRepository.setViewMode(this.isOnNow() ? "Guide" : "OnNow");
      return;
    }
    if (
      this.status() === "ready" &&
      !this.isOnNow() &&
      (this.ui.zone === "grid" || this.ui.zone === "channel")
    ) {
      if (code === KEY.YELLOW) {
        this.shiftGuideTime(-TIME_JUMP_MS);
        this.renderContent();
        return;
      }
      if (code === KEY.BLUE) {
        this.shiftGuideTime(TIME_JUMP_MS);
        this.renderContent();
        return;
      }
      if (
        code === KEY.CHANNEL_UP ||
        code === KEY.PAGE_UP ||
        code === KEY.CHANNEL_DOWN ||
        code === KEY.PAGE_DOWN
      ) {
        event?.preventDefault?.();
        this.moveGuideRow(code === KEY.CHANNEL_UP || code === KEY.PAGE_UP ? -1 : 1, { page: true });
        this.renderContent();
      }
    }
  },

  onKeyUp(event) {
    const code = keyCodeOf(event);
    if ([KEY.LEFT, KEY.UP, KEY.RIGHT, KEY.DOWN].includes(code)) resetDpadRepeat(this);
    if (code !== KEY.ENTER) return;
    if (this.menu) {
      if (this.menuEnterArmed) {
        this.menuEnterArmed = false;
        this.activateMenu();
      }
      return;
    }
    const pending = this.pendingEnter;
    this.pendingEnter = null;
    if (
      !pending ||
      pending.handled ||
      pending.zone !== this.ui.zone ||
      this.focusZone !== "content"
    )
      return;
    const heldMs = Number(event?.keyDownDurationMs || Date.now() - pending.startedAt);
    if (heldMs >= LONG_PRESS_MS) {
      const channelId = this.focusedChannelId();
      if (channelId) this.openChannelMenu(channelId);
      return;
    }
    this.activateFocused();
  },

  handleSidebarKey(event, code) {
    const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
    const current = this.container.querySelector(".focusable.focused");
    if (code === KEY.UP || code === KEY.DOWN) {
      event?.preventDefault?.();
      const index = Math.max(0, nodes.indexOf(current));
      const next = clamp(index + (code === KEY.UP ? -1 : 1), 0, nodes.length - 1);
      this.focusSidebarNode(nodes[next] || current);
      return;
    }
    if (code === KEY.RIGHT) {
      event?.preventDefault?.();
      this.closeSidebarToContent();
      return;
    }
    if (code === KEY.ENTER && current && isRootSidebarNode(current)) {
      event?.preventDefault?.();
      const action = String(current.dataset.action || "");
      activateLegacySidebarAction(action, LIVE_TV_ROUTE);
      if (isSelectedSidebarAction(action, LIVE_TV_ROUTE)) this.closeSidebarToContent();
    }
  },

  handleArrow(code) {
    const zone = this.ui.zone;
    const up = code === KEY.UP;
    const down = code === KEY.DOWN;
    const left = code === KEY.LEFT;
    const right = code === KEY.RIGHT;

    if (zone === "grid" || zone === "channel") {
      if (up || down) {
        this.moveGuideRow(up ? -1 : 1);
      } else if (zone === "channel") {
        if (left) {
          this.openSidebar();
          return;
        }
        this.ui.zone = "grid";
        this.ui.cellRow = -1;
        this.ui.cursorTimeMs = Math.max(this.ui.cursorTimeMs, this.ui.viewStartMs || 0);
      } else {
        this.moveGuideCell(left ? -1 : 1);
      }
      this.renderContent();
      return;
    }

    if (zone === "cards") {
      const entries = this.onNowEntries();
      const column = this.ui.cardIndex % ON_NOW_COLUMNS;
      if (left) {
        if (column === 0) {
          this.openSidebar();
          return;
        }
        this.ui.cardIndex -= 1;
      } else if (right) {
        if (column < ON_NOW_COLUMNS - 1 && this.ui.cardIndex + 1 < entries.length)
          this.ui.cardIndex += 1;
      } else if (up) {
        if (this.ui.cardIndex - ON_NOW_COLUMNS < 0) {
          this.setZone(this.previousZone("cards"));
        } else {
          this.ui.cardIndex -= ON_NOW_COLUMNS;
        }
      } else if (down) {
        if (this.ui.cardIndex + ON_NOW_COLUMNS < entries.length) {
          this.ui.cardIndex += ON_NOW_COLUMNS;
        } else if (
          Math.floor(this.ui.cardIndex / ON_NOW_COLUMNS) <
          Math.floor((entries.length - 1) / ON_NOW_COLUMNS)
        ) {
          this.ui.cardIndex = entries.length - 1;
        }
      }
      this.renderContent();
      return;
    }

    const horizontal = {
      header: { key: "headerIndex", count: () => this.headerActions().length },
      chips: { key: "chipIndex", count: () => this.chips().length },
      sort: { key: "sortIndex", count: () => ON_NOW_SORT_OPTIONS.length },
      recents: { key: "recentIndex", count: () => this.recentChannels().length },
      state: { key: "stateIndex", count: () => this.stateButtons().length }
    }[zone];

    if (horizontal && (left || right)) {
      const index = this.ui[horizontal.key];
      if (left && index === 0) {
        this.openSidebar();
        return;
      }
      this.ui[horizontal.key] = clamp(
        index + (left ? -1 : 1),
        0,
        Math.max(0, horizontal.count() - 1)
      );
      this.renderContent();
      return;
    }

    if (up || down) {
      const target = up ? this.previousZone(zone) : this.nextZone(zone);
      if (target) {
        this.setZone(target);
        if (target === "grid") this.ui.cellRow = -1;
        this.renderContent();
      }
    }
  },

  // --- Magic Remote / mouse ---------------------------------------------------------

  /** Points `this.ui` at a Live TV element (Magic Remote pointer or mouse). */
  syncUiFromTarget(target) {
    const node = target?.closest?.("[data-ltv-zone]");
    if (!node || !this.container?.contains(node)) return null;
    const zone = node.dataset.ltvZone;
    if (zone === "menu") {
      if (this.menu) this.menu.index = Number(node.dataset.ltvIndex || 0);
      return zone;
    }
    if (this.menu) return null;
    this.focusZone = "content";
    this.ui.zone = zone;
    if (zone === "grid") {
      this.ui.row = Number(node.dataset.ltvRow || 0);
      this.ui.cell = Number(node.dataset.ltvCell || 0);
      this.ui.cellRow = this.ui.row;
      this.ui.cellChannelId = this.visibleChannels()[this.ui.row]?.id;
    } else if (zone === "channel") {
      const channelId = node.dataset.ltvChannelId;
      this.ui.row = Math.max(
        0,
        this.visibleChannels().findIndex((channel) => channel.id === channelId)
      );
    } else {
      const key = {
        header: "headerIndex",
        chips: "chipIndex",
        sort: "sortIndex",
        recents: "recentIndex",
        state: "stateIndex",
        cards: "cardIndex"
      }[zone];
      if (key) this.ui[key] = Number(node.dataset.ltvIndex || 0);
    }
    return zone;
  },

  activatePointerTarget(target) {
    const zone = this.syncUiFromTarget(target);
    if (!zone) return false;
    if (zone === "menu") {
      this.activateMenu();
      return true;
    }
    this.activateFocused();
    this.renderContent();
    return true;
  },

  // LG Magic Remote: hovering moves the remote's focus; clicking acts like OK.
  onPointerFocus(target) {
    // Keep the details panel in step with the programme under the pointer.
    if (this.syncUiFromTarget(target) === "grid") this.renderContent();
  },

  onPointerActivate(target) {
    return this.activatePointerTarget(target);
  },

  bindPointerEvents() {
    const root = this.container;
    if (!root || root.__ltvPointerBound) return;
    root.__ltvPointerBound = true;
    // Mouse clicks outside webOS (webOS clicks arrive through onPointerActivate).
    root.addEventListener("click", (event) => {
      if (Number(event?.detail || 0) === 0) return; // keyboard-generated click; keys are handled already
      this.activatePointerTarget(event.target);
    });
  },

  isPerformanceConstrained() {
    return Boolean(
      globalThis.document?.documentElement?.classList?.contains("performance-constrained")
    );
  },

  exitApp() {
    Platform.exitApp();
  }
};
