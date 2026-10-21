// Live TV additions to the player: automatic failover to backup sources (on errors and a
// 20-second startup watchdog), remembering the source that worked, a channel banner,
// channel up/down, and a slide-out channel list with a Sources section.
// Every action works with arrows, OK and Back: Left (while the controls are hidden) opens
// the channel list. CH▲/▼ and the green button are shortcuts.

import { Router } from "../ui/navigation/routerState.js";
import { LiveTvRepository } from "./liveTvRepository.js";
import { LiveTvPlayback, isLiveTvItemType, liveSourceLabel } from "./liveTvPlayback.js";
import {
  guideChannel,
  neighborOf,
  nextProgram,
  programAt,
  programProgress
} from "./liveTvGuide.js";
import { formatClock } from "./liveTvTime.js";
import { escapeHtml, liveBadge, logoTile, progressBar } from "./ui/liveTvMarkup.js";
import { hideLiveTvToast, showLiveTvToast } from "./ui/liveTvToast.js";

/** How long a live source may sit on "loading" before the next backup is tried. */
export const LIVE_TV_STARTUP_TIMEOUT_MS = 20 * 1000;
/** How long a source must play before it becomes the channel's first choice. */
export const LIVE_TV_REMEMBER_AFTER_MS = 8 * 1000;
const BANNER_AFTER_TUNE_MS = 6000;
const DEAD_SOURCE_AFTER_MS = 4000;
const TICK_MS = 1000;
const PROGRAM_REFRESH_MS = 30 * 1000;
const LIST_WINDOW = 9;

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
  GREEN: 404,
  G: 71
};

function isChannelUp(code, event) {
  return code === KEY.CHANNEL_UP || code === KEY.PAGE_UP || event?.key === "ChannelUp";
}

function isChannelDown(code, event) {
  return code === KEY.CHANNEL_DOWN || code === KEY.PAGE_DOWN || event?.key === "ChannelDown";
}

export function createPlayerLiveTvMethods() {
  return {
    isLiveTvPlayback() {
      return Boolean(this.liveTvSession) && isLiveTvItemType(this.params?.itemType);
    },

    liveTvOnMount(params = {}) {
      this.liveTvOnCleanup();
      document.documentElement?.classList?.add("ltv-player-active");
      if (!params?.liveTv?.channelId || !isLiveTvItemType(params.itemType)) {
        this.liveTvSession = null;
        return;
      }
      const now = Date.now();
      this.liveTvSession = {
        channelId: params.liveTv.channelId,
        groupId: params.liveTv.groupId || null,
        mountToken: this.playerMountToken,
        sourceStartedAt: now,
        bannerUntil: now + BANNER_AFTER_TUNE_MS,
        frameSince: 0,
        remembered: false,
        exhausted: false,
        lastProgramRefresh: now,
        toastHidden: false
      };
      this.liveTvListOpen = false;
      this.liveTvListIndex = 0;
      this.liveTvTimer = setInterval(() => this.liveTvTick(), TICK_MS);
      this.liveTvTick();
    },

    liveTvOnCleanup() {
      clearInterval(this.liveTvTimer);
      this.liveTvTimer = null;
      this.liveTvSession = null;
      this.liveTvListOpen = false;
      this.container?.querySelector?.("#ltvPlayerOverlay")?.remove();
      document.documentElement?.classList?.remove("ltv-player-active");
    },

    liveTvChannel() {
      return guideChannel(LiveTvRepository.state.guide, this.liveTvSession?.channelId);
    },

    liveTvSessionChannels() {
      return LiveTvRepository.channelsForSession(this.liveTvSession?.groupId);
    },

    liveTvCurrentSourceIndex() {
      return Math.max(0, Number(this.currentStreamIndex || 0));
    },

    liveTvTick() {
      const session = this.liveTvSession;
      if (!session || session.mountToken !== this.playerMountToken || !this.playerRouteActive)
        return;
      const now = Date.now();
      if (this.hasPresentedPlaybackFrame) {
        if (!session.frameSince) session.frameSince = now;
        if (!session.toastHidden) {
          session.toastHidden = true;
          hideLiveTvToast();
        }
        if (!session.remembered && now - session.frameSince >= LIVE_TV_REMEMBER_AFTER_MS) {
          session.remembered = true;
          const candidate = this.getCurrentStreamCandidate?.();
          if (candidate)
            LiveTvRepository.rememberWorkingStream(session.channelId, candidate.raw || candidate);
        }
      } else {
        session.frameSince = 0;
        // A link that's gone (404, DNS failure) leaves the video element with no source;
        // don't wait the full watchdog for it.
        const video = globalThis.document?.getElementById?.("videoPlayer");
        const deadSource =
          video &&
          video.networkState === 3 &&
          video.readyState === 0 &&
          now - session.sourceStartedAt >= DEAD_SOURCE_AFTER_MS;
        if (deadSource && !session.exhausted && !this.isStartupErrorVisible?.()) {
          console.warn("Live TV source has no media; trying the next one");
          if (!this.liveTvTryNextSource("no-source")) {
            session.exhausted = true;
            this.showStartupError?.(
              `Every source for ${this.liveTvChannel()?.name || "this channel"} failed.`,
              {
                reason: "live-tv-sources-exhausted"
              }
            );
          }
        } else if (
          !session.exhausted &&
          !this.isStartupErrorVisible?.() &&
          now - session.sourceStartedAt >= LIVE_TV_STARTUP_TIMEOUT_MS
        ) {
          console.warn("Live TV source did not start in time; trying the next one");
          if (!this.liveTvTryNextSource("startup-timeout")) {
            session.exhausted = true;
            this.showStartupError?.(
              `Every source for ${this.liveTvChannel()?.name || "this channel"} failed.`,
              {
                reason: "live-tv-sources-exhausted"
              }
            );
          }
        }
      }
      if (now - session.lastProgramRefresh >= PROGRAM_REFRESH_MS) {
        session.lastProgramRefresh = now;
        LiveTvRepository.refreshIfStale(now);
      }
      this.liveTvRenderOverlay();
    },

    /**
     * Called when the active live source fails (playback error or startup timeout).
     * Moves to the next backup of the same channel; returns false once every source failed.
     */
    liveTvTryNextSource(reason = "error") {
      const session = this.liveTvSession;
      if (!session || !this.isLiveTvPlayback() || session.mountToken !== this.playerMountToken)
        return false;
      const nextIndex = this.liveTvCurrentSourceIndex() + 1;
      const next = this.streamCandidates?.[nextIndex];
      const channelName = this.liveTvChannel()?.name || this.params?.playerTitle || "this channel";
      if (!next) {
        session.exhausted = true;
        showLiveTvToast(`Every source for ${channelName} failed`, { durationMs: 5000 });
        return false;
      }
      console.warn("Live TV: switching to backup source", { reason, index: nextIndex });
      showLiveTvToast(`Switching to ${liveSourceLabel(next, nextIndex)}…`, { durationMs: 4000 });
      this.liveTvPlaySource(nextIndex);
      return true;
    },

    liveTvPlaySource(index) {
      const session = this.liveTvSession;
      const candidate = this.streamCandidates?.[index];
      if (!session || !candidate) return;
      session.sourceStartedAt = Date.now();
      session.frameSince = 0;
      session.remembered = false;
      session.exhausted = false;
      session.toastHidden = false;
      this.currentStreamIndex = index;
      this.sourcesError = null;
      this.loadingVisible = true;
      this.updateLoadingVisibility?.();
      void this.playStreamCandidate(candidate, { mountToken: this.playerMountToken });
    },

    liveTvSwitchChannel(delta) {
      const session = this.liveTvSession;
      if (!session) return;
      const next = neighborOf(this.liveTvSessionChannels(), session.channelId, delta);
      if (!next || next.id === session.channelId) return;
      this.liveTvTuneChannel(next.id);
    },

    liveTvTuneChannel(channelId) {
      const session = this.liveTvSession;
      if (!session) return;
      this.liveTvListOpen = false;
      if (channelId === session.channelId) {
        this.liveTvRenderOverlay();
        return;
      }
      session.bannerUntil = Date.now() + BANNER_AFTER_TUNE_MS;
      void LiveTvPlayback.play(channelId, { groupId: session.groupId, replace: true });
    },

    liveTvOpenList() {
      const channels = this.liveTvSessionChannels();
      this.liveTvListOpen = true;
      this.liveTvListIndex = Math.max(
        0,
        channels.findIndex((channel) => channel.id === this.liveTvSession?.channelId)
      );
      this.setControlsVisible?.(false);
      this.liveTvRenderOverlay();
    },

    liveTvCloseList() {
      this.liveTvListOpen = false;
      this.liveTvRenderOverlay();
    },

    /** Rows in the channel list: every channel of the chip, then the channel's sources. */
    liveTvListRows() {
      const rows = this.liveTvSessionChannels().map((channel) => ({ kind: "channel", channel }));
      if ((this.streamCandidates || []).length > 1) {
        this.streamCandidates.forEach((candidate, index) =>
          rows.push({ kind: "source", candidate, index })
        );
      }
      return rows;
    },

    liveTvActivateListRow() {
      const row = this.liveTvListRows()[this.liveTvListIndex];
      if (!row) return;
      if (row.kind === "channel") {
        this.liveTvTuneChannel(row.channel.id);
        return;
      }
      this.liveTvListOpen = false;
      if (row.index !== this.liveTvCurrentSourceIndex()) {
        showLiveTvToast(`Switching to ${liveSourceLabel(row.candidate, row.index)}…`);
        this.liveTvPlaySource(row.index);
      }
      this.liveTvRenderOverlay();
    },

    /** Handles Live TV keys before the regular player. Returns true when consumed. */
    liveTvHandleKey(event) {
      if (!this.isLiveTvPlayback()) return false;
      const code = Number(event?.keyCode || 0);
      const stop = () => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
        return true;
      };
      if (this.liveTvListOpen) {
        const rows = this.liveTvListRows();
        if (code === KEY.UP || code === KEY.DOWN) {
          this.liveTvListIndex = Math.max(
            0,
            Math.min(rows.length - 1, this.liveTvListIndex + (code === KEY.UP ? -1 : 1))
          );
          this.liveTvRenderOverlay();
          return stop();
        }
        if (code === KEY.ENTER) {
          if (!event?.repeat) this.liveTvActivateListRow();
          return stop();
        }
        if (code === KEY.RIGHT || code === KEY.LEFT || code === KEY.GREEN || code === KEY.G) {
          this.liveTvCloseList();
          return stop();
        }
        if (isChannelUp(code, event) || isChannelDown(code, event)) {
          this.liveTvSwitchChannel(isChannelUp(code, event) ? 1 : -1);
          return stop();
        }
        return stop();
      }
      if (isChannelUp(code, event) || isChannelDown(code, event)) {
        if (!event?.repeat) this.liveTvSwitchChannel(isChannelUp(code, event) ? 1 : -1);
        return stop();
      }
      if (code === KEY.GREEN || code === KEY.G) {
        this.liveTvOpenList();
        return stop();
      }
      const otherPanelOpen =
        this.isStartupErrorVisible?.() ||
        this.sourcesPanelVisible ||
        this.subtitleDialogVisible ||
        this.audioDialogVisible ||
        this.speedDialogVisible ||
        this.episodePanelVisible ||
        this.moreActionsVisible ||
        this.streamInfoVisible ||
        this.partyPanelVisible ||
        this.pauseOverlayVisible;
      if (
        code === KEY.LEFT &&
        this.controlsVisible &&
        !otherPanelOpen &&
        this.liveTvIsFirstControlFocused()
      ) {
        // Left from the first player button opens the channel list too.
        this.liveTvOpenList();
        return stop();
      }
      if (code === KEY.LEFT && !this.controlsVisible && !otherPanelOpen) {
        // Live channels can't seek back far; Left opens the channel list instead.
        this.liveTvOpenList();
        return stop();
      }
      return false;
    },

    /** Where Back from a live channel goes: the screen it was started from. */
    liveTvReturnRoute() {
      if (!this.isLiveTvPlayback()) return null;
      const stack = Array.isArray(Router.stack) ? Router.stack : [];
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const entry = stack[index];
        const route = typeof entry === "string" ? entry : String(entry?.route || "");
        if (route && route !== "player") {
          return { route, params: typeof entry === "string" ? {} : entry?.params || {} };
        }
      }
      return { route: "liveTv", params: {} };
    },

    liveTvIsFirstControlFocused() {
      const active = globalThis.document?.activeElement;
      if (!active?.classList?.contains("player-control-btn")) return false;
      const buttons = Array.from(
        this.container?.querySelectorAll?.(".player-control-btn") || []
      ).filter(
        (node) =>
          node.offsetParent !== null &&
          node.getBoundingClientRect().top >= active.getBoundingClientRect().top - 4 &&
          node.getBoundingClientRect().top <= active.getBoundingClientRect().top + 4
      );
      return buttons[0] === active;
    },

    liveTvConsumeBack() {
      if (!this.isLiveTvPlayback() || !this.liveTvListOpen) return false;
      this.liveTvCloseList();
      return true;
    },

    liveTvEnsureOverlay() {
      let overlay = this.container?.querySelector?.("#ltvPlayerOverlay");
      if (!overlay && this.container) {
        overlay = document.createElement("div");
        overlay.id = "ltvPlayerOverlay";
        overlay.className = "ltv-player-overlay";
        this.container.appendChild(overlay);
        overlay.addEventListener("click", (event) => {
          const rowNode = event.target?.closest?.("[data-ltv-list-index]");
          if (!rowNode) return;
          this.liveTvListIndex = Number(rowNode.dataset.ltvListIndex || 0);
          this.liveTvActivateListRow();
        });
      }
      return overlay;
    },

    liveTvRenderOverlay() {
      const session = this.liveTvSession;
      if (!session) return;
      const overlay = this.liveTvEnsureOverlay();
      if (!overlay) return;
      const now = Date.now();
      const guide = LiveTvRepository.state.guide;
      const channel = this.liveTvChannel() || {
        id: session.channelId,
        name: this.params?.playerTitle || "",
        logo: this.params?.playerLogoUrl
      };
      const program = programAt(guide, channel.id, now);
      const upNext = nextProgram(guide, channel.id, program?.endMs ?? now);
      const showBanner =
        !this.liveTvListOpen && (this.controlsVisible || now < session.bannerUntil);
      const sourceIndex = this.liveTvCurrentSourceIndex();
      const sourceCount = (this.streamCandidates || []).length;
      const signature = JSON.stringify([
        showBanner,
        this.liveTvListOpen,
        this.liveTvListIndex,
        channel.id,
        program?.id,
        Math.floor(now / 15000),
        sourceIndex,
        LiveTvPlayback.tuningChannelId
      ]);
      if (overlay.dataset.signature === signature) return;
      overlay.dataset.signature = signature;
      const banner = showBanner
        ? `
        <div class="ltv-player-banner">
          ${logoTile(channel, "ltv-player-banner-logo")}
          <div class="ltv-player-banner-copy">
            <div class="ltv-player-banner-channel">
              ${liveBadge()}
              <span class="ltv-player-banner-number">${channel.number ? escapeHtml(String(channel.number)) : ""}</span>
              <span class="ltv-player-banner-name">${escapeHtml(channel.name)}</span>
            </div>
            <div class="ltv-player-banner-title">${escapeHtml(program?.title || this.params?.playerSubtitle || "")}</div>
            ${
              program
                ? `<div class="ltv-player-banner-time">${escapeHtml(`${formatClock(program.startMs)} – ${formatClock(program.endMs)}`)}</div>
                   ${progressBar(programProgress(program, now), "ltv-player-banner-progress")}`
                : ""
            }
            ${upNext ? `<div class="ltv-player-banner-next">Up next · ${escapeHtml(formatClock(upNext.startMs))} ${escapeHtml(upNext.title)}</div>` : ""}
            <div class="ltv-player-banner-hints">
              <span>◀ Channels</span><span>CH ▲▼ Change channel</span>
              ${sourceCount > 1 ? `<span>Source: ${escapeHtml(liveSourceLabel(this.streamCandidates[sourceIndex], sourceIndex))}</span>` : ""}
            </div>
          </div>
        </div>`
        : "";
      overlay.innerHTML = `${banner}${this.liveTvListOpen ? this.liveTvRenderList(now) : ""}`;
      overlay.classList.toggle("is-list-open", Boolean(this.liveTvListOpen));
      if (this.liveTvListOpen) {
        overlay.querySelector(".ltv-player-list-row.focused")?.focus?.({ preventScroll: true });
      }
    },

    liveTvRenderList(now) {
      const guide = LiveTvRepository.state.guide;
      const rows = this.liveTvListRows();
      const index = Math.max(0, Math.min(rows.length - 1, this.liveTvListIndex));
      const start = Math.max(
        0,
        Math.min(index - Math.floor(LIST_WINDOW / 2), rows.length - LIST_WINDOW)
      );
      const visible = rows.slice(start, start + LIST_WINDOW);
      const sourceIndex = this.liveTvCurrentSourceIndex();
      const items = visible
        .map((row, offset) => {
          const rowIndex = start + offset;
          const focused = rowIndex === index;
          if (row.kind === "source") {
            const previous = rows[rowIndex - 1];
            const header =
              previous?.kind !== "source"
                ? `<div class="ltv-player-list-section">Sources</div>`
                : "";
            return `${header}
              <div class="ltv-player-list-row is-source focusable${focused ? " focused" : ""}${row.index === sourceIndex ? " is-current" : ""}"
                   data-ltv-list-index="${rowIndex}" tabindex="-1">
                <span class="material-icons" aria-hidden="true">${row.index === sourceIndex ? "radio_button_checked" : "radio_button_unchecked"}</span>
                <span class="ltv-player-list-name">${escapeHtml(liveSourceLabel(row.candidate, row.index))}</span>
              </div>`;
          }
          const channel = row.channel;
          const current = programAt(guide, channel.id, now);
          const playing = channel.id === this.liveTvSession?.channelId;
          return `
            <div class="ltv-player-list-row focusable${focused ? " focused" : ""}${playing ? " is-current" : ""}"
                 data-ltv-list-index="${rowIndex}" tabindex="-1">
              <span class="ltv-player-list-number">${channel.number ? escapeHtml(String(channel.number)) : ""}</span>
              ${logoTile(channel, "ltv-player-list-logo")}
              <span class="ltv-player-list-copy">
                <span class="ltv-player-list-name">${escapeHtml(channel.name)}${playing ? " · Watching" : ""}</span>
                <span class="ltv-player-list-program">${escapeHtml(
                  LiveTvPlayback.tuningChannelId === channel.id
                    ? "Tuning…"
                    : current?.title || "No guide information"
                )}</span>
                ${current ? progressBar(programProgress(current, now), "ltv-player-list-progress") : ""}
              </span>
            </div>`;
        })
        .join("");
      return `
        <aside class="ltv-player-list" aria-label="Channels">
          <div class="ltv-player-list-title">Channels</div>
          <div class="ltv-player-list-hint">OK watch · ▶ or Back close</div>
          ${start > 0 ? `<div class="ltv-player-list-more">▲</div>` : ""}
          ${items}
          ${start + LIST_WINDOW < rows.length ? `<div class="ltv-player-list-more">▼</div>` : ""}
        </aside>`;
    }
  };
}
