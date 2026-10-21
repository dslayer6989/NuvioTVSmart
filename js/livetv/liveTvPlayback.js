// Starts watching a channel from any screen (guide, On Now, Home row, the player itself):
// fetches the channel's streams fresh, puts the source that worked last time first, and
// opens the regular player with the rest as automatic backups.

import { Router } from "../ui/navigation/routerState.js";
import { streamRepository } from "../data/repository/streamRepository.js";
import { LiveTvRepository } from "./liveTvRepository.js";
import { guideChannel, normalizeManifestUrl, programAt } from "./liveTvGuide.js";
import { showLiveTvToast } from "./ui/liveTvToast.js";

import { LIVE_TV_ITEM_TYPE, isLiveTvItemType } from "./liveTvItemType.js";

export { LIVE_TV_ITEM_TYPE, isLiveTvItemType };

/** "Primary" for the first source, "Backup 1", "Backup 2"... after it, unless the addon names it. */
export function liveSourceLabel(stream, index) {
  const name = String(stream?.name || "").trim();
  if (name) return name.replace(/\s*\n\s*/g, " · ");
  return index === 0 ? "Primary" : `Backup ${index}`;
}

function addonRoot(manifestUrl) {
  return normalizeManifestUrl(manifestUrl).replace(/\/manifest\.json(\?.*)?$/i, "");
}

let tuningChannelId = null;
let tuneToken = 0;
const tuningListeners = new Set();

function setTuning(channelId) {
  tuningChannelId = channelId || null;
  tuningListeners.forEach((listener) => {
    try {
      listener(tuningChannelId);
    } catch (_) {
      /* A screen that went away. */
    }
  });
}

/**
 * Resolves a channel's streams. Never throws.
 * @returns {Promise<{ ok: true, channel, program, candidates } | { ok: false, message: string }>}
 */
export async function tuneLiveTvChannel(channelId) {
  const state = LiveTvRepository.ensureLoaded();
  const guide = state.guide;
  if (!guide) return { ok: false, message: "Live TV is still loading. Try again in a moment." };
  const channel = guideChannel(guide, channelId);
  if (!channel) return { ok: false, message: "That channel is no longer in the lineup." };
  let streams;
  try {
    streams = await LiveTvRepository.loadStreams(channel);
  } catch (error) {
    const reason = error?.status ? `error ${error.status}` : "network error";
    return { ok: false, message: `Couldn't reach ${channel.name} (${reason}).` };
  }
  if (!streams.length) return { ok: false, message: `${channel.name} has no working streams right now.` };
  const baseUrl = addonRoot(state.manifestUrl);
  const candidates = streams.map((raw, index) => ({
    ...streamRepository.mapStream(raw),
    id: `livetv:${channel.id}:${index}:${raw.url}`,
    addonId: guide.addonId,
    addonBaseUrl: baseUrl,
    addonName: guide.addonName,
    addonLogo: guide.addonLogo || null,
    liveSourceIndex: index
  }));
  return { ok: true, channel, program: programAt(guide, channel.id, Date.now()), candidates };
}

export function buildLiveTvPlayerParams({ channel, program, candidates }, { groupId = null } = {}) {
  const first = candidates[0];
  return {
    streamUrl: first.url,
    itemId: channel.id,
    itemType: LIVE_TV_ITEM_TYPE,
    imdbId: null,
    tmdbId: null,
    traktId: null,
    videoId: null,
    resumePositionMs: 0,
    resumeProgressPercent: null,
    resumeDurationMs: 0,
    startFromBeginning: true,
    episodeLabel: null,
    playerTitle: channel.name,
    playerSubtitle: program?.title || "",
    playerEpisodeTitle: "",
    playerReleaseYear: "",
    playerBackdropUrl: program?.thumbnail || null,
    playerLogoUrl: channel.logo || null,
    season: null,
    episode: null,
    episodes: [],
    streamCandidates: candidates,
    preferredStreamId: first.id,
    playbackSourceContext: {
      addonId: first.addonId || "",
      addonBaseUrl: first.addonBaseUrl || "",
      addonName: first.addonName || "",
      addonOrderIndex: 0,
      sourceProviderId: "",
      sourceIds: [],
      selectedStreamId: first.id
    },
    liveTv: {
      channelId: channel.id,
      groupId: groupId || null
    }
  };
}

export const LiveTvPlayback = {
  get tuningChannelId() {
    return tuningChannelId;
  },

  onTuningChange(listener) {
    tuningListeners.add(listener);
    return () => tuningListeners.delete(listener);
  },

  /**
   * Plays a channel. `groupId` is the chip the user was browsing, so channel up/down stays
   * inside it. From the player itself, `replace` swaps the channel without growing history.
   */
  async play(channelId, { groupId = null, replace = false } = {}) {
    const token = ++tuneToken;
    setTuning(channelId);
    const channelName = guideChannel(LiveTvRepository.state.guide, channelId)?.name || "channel";
    showLiveTvToast(`Tuning to ${channelName}…`, { durationMs: 8000 });
    try {
      const result = await tuneLiveTvChannel(channelId);
      if (token !== tuneToken) return false;
      if (!result.ok) {
        showLiveTvToast(result.message, { durationMs: 4000 });
        return false;
      }
      LiveTvRepository.recordWatched(result.channel.id);
      showLiveTvToast(`Tuning to ${result.channel.name}…`, { durationMs: 2500 });
      await Router.navigate("player", buildLiveTvPlayerParams(result, { groupId }), replace ? { replaceHistory: true } : {});
      return true;
    } finally {
      if (token === tuneToken) setTuning(null);
    }
  }
};
