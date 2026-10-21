// Live TV state shared by the guide screen, the Home row, Settings and the player:
// the addon link, the loaded guide, and each profile's favorites, recents and chip.

import { httpRequest } from "../core/network/httpClient.js";
import { LocalStore } from "../core/storage/localStore.js";
import { ProfileManager } from "../core/profile/profileManager.js";
import {
  guideChannel,
  guideChannelsFor,
  isAddonFavoritesGroup,
  guideLineup,
  normalizeManifestUrl
} from "./liveTvGuide.js";
import { loadChannelStreams, loadLiveTvGuide } from "./liveTvLoader.js";
import { MINUTE_MS } from "./liveTvTime.js";

export const LIVE_TV_FAVORITES_GROUP_ID = "local:favorites";
export const LIVE_TV_RECENT_GROUP_ID = "local:recent";
export const LIVE_TV_MAX_RECENTS = 12;
export const LIVE_TV_STALE_AFTER_MS = 30 * MINUTE_MS;
export const LIVE_TV_MAX_REMEMBERED_STREAMS = 200;
export const LIVE_TV_REQUEST_TIMEOUT_MS = 15000;

const KEY_MANIFEST_URL = "liveTv.manifestUrl";
const KEY_VIEW_MODE = "liveTv.viewMode";
const KEY_ON_NOW_SORT = "liveTv.onNowSort";
const KEY_WORKING_STREAMS = "liveTv.workingStreams";
// Favorites, recents and the selected chip are saved per profile.
const KEY_FAVORITES = "liveTv.favorites";
const KEY_RECENTS = "liveTv.recents";
const KEY_SELECTED_GROUP = "liveTv.selectedGroup";

function profileKey(key, profileId) {
  return `${key}.${profileId}`;
}

function activeProfileId() {
  try {
    return ProfileManager.getActiveProfileId();
  } catch (_) {
    return "1";
  }
}

function readIdList(value) {
  return Array.isArray(value) ? value.map((id) => String(id || "")).filter(Boolean) : [];
}

async function defaultFetchJson(url) {
  return httpRequest(url, { includeSessionAuth: false, timeoutMs: LIVE_TV_REQUEST_TIMEOUT_MS });
}

function streamLabelKey(stream) {
  return [stream?.name, stream?.title, stream?.description]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("|");
}

/** Moves the remembered source to the front; everything else keeps its order for failover. */
export function orderStreamsByPreference(streams, preferred) {
  if (!preferred || streams.length < 2) return streams;
  let index = preferred.url ? streams.findIndex((stream) => stream.url === preferred.url) : -1;
  if (index < 0 && preferred.label)
    index = streams.findIndex((stream) => streamLabelKey(stream) === preferred.label);
  if (index <= 0) return streams;
  return [streams[index], ...streams.filter((_, position) => position !== index)];
}

const listeners = new Set();
let fetchJson = defaultFetchJson;
let loadToken = 0;

const state = {
  manifestUrl: "",
  isLoading: false,
  isRefreshing: false,
  errorMessage: "",
  guide: null,
  selectedGroupId: null,
  viewMode: "Guide",
  onNowSort: "Channel",
  favoriteIds: [],
  recentIds: [],
  profileId: null
};

function emit() {
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.warn("Live TV listener failed", error);
    }
  });
}

function saveProfileIds(key, ids) {
  LocalStore.set(profileKey(key, state.profileId || activeProfileId()), ids);
}

function saveSelectedGroup(groupId) {
  // An explicit "All channels" choice is stored as "" so it doesn't fall back to an older value.
  LocalStore.set(
    profileKey(KEY_SELECTED_GROUP, state.profileId || activeProfileId()),
    groupId || ""
  );
}

function seedFavoritesIfNeeded(guide) {
  if (LocalStore.get(profileKey(KEY_FAVORITES, state.profileId), null) != null) return;
  const seed = (guide?.groups || []).find(isAddonFavoritesGroup)?.channelIds || [];
  saveProfileIds(KEY_FAVORITES, seed);
  state.favoriteIds = seed.slice();
}

function isGroupValid(groupId, guide = state.guide) {
  if (!groupId) return true;
  if (groupId === LIVE_TV_FAVORITES_GROUP_ID) return state.favoriteIds.length > 0;
  if (groupId === LIVE_TV_RECENT_GROUP_ID) return state.recentIds.length > 0;
  if (!guide) return true;
  return guide.groups.some((group) => group.id === groupId);
}

/** Swaps in the active profile's favorites, recents and chip after a profile switch. */
function syncActiveProfile() {
  const profileId = activeProfileId();
  if (profileId === state.profileId) return false;
  state.profileId = profileId;
  state.favoriteIds = readIdList(LocalStore.get(profileKey(KEY_FAVORITES, profileId), []));
  state.recentIds = readIdList(LocalStore.get(profileKey(KEY_RECENTS, profileId), []));
  const storedGroup = String(LocalStore.get(profileKey(KEY_SELECTED_GROUP, profileId), "") || "");
  state.selectedGroupId = storedGroup && isGroupValid(storedGroup) ? storedGroup : null;
  if (state.guide) seedFavoritesIfNeeded(state.guide);
  return true;
}

let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  state.manifestUrl = String(LocalStore.get(KEY_MANIFEST_URL, "") || "");
  state.viewMode = LocalStore.get(KEY_VIEW_MODE, "Guide") === "OnNow" ? "OnNow" : "Guide";
  const sort = LocalStore.get(KEY_ON_NOW_SORT, "Channel");
  state.onNowSort = ["Channel", "EndingSoon", "JustStarted"].includes(sort) ? sort : "Channel";
}

export const LiveTvRepository = {
  get state() {
    ensureInitialized();
    return state;
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** For tests: replace how addon URLs are fetched. */
  setFetcher(nextFetchJson) {
    fetchJson = typeof nextFetchJson === "function" ? nextFetchJson : defaultFetchJson;
  },

  isConfigured() {
    ensureInitialized();
    return Boolean(state.manifestUrl.trim());
  },

  /** Makes sure the active profile's lists are loaded and a guide is on its way. */
  ensureLoaded() {
    ensureInitialized();
    const profileChanged = syncActiveProfile();
    if (!state.guide && !state.isLoading && !state.errorMessage && this.isConfigured()) {
      void this.refresh();
    } else if (profileChanged) {
      emit();
    }
    return state;
  },

  async refresh({ force = false } = {}) {
    ensureInitialized();
    const manifestUrl = state.manifestUrl.trim();
    if (!manifestUrl) return null;
    if (!force && (state.isLoading || state.isRefreshing)) return null;
    const token = ++loadToken;
    state.isLoading = !state.guide;
    state.isRefreshing = Boolean(state.guide);
    state.errorMessage = "";
    emit();
    try {
      const guide = await loadLiveTvGuide(manifestUrl, { nowMs: Date.now(), fetchJson });
      if (token !== loadToken) return null;
      syncActiveProfile();
      seedFavoritesIfNeeded(guide);
      state.guide = guide;
      if (!isGroupValid(state.selectedGroupId, guide)) state.selectedGroupId = null;
      return guide;
    } catch (error) {
      if (token !== loadToken) return null;
      console.warn("Live TV guide failed to load", error);
      // Keep showing a guide we already have; only report the error when there is nothing.
      if (!state.guide) {
        state.errorMessage = describeLoadError(error);
      }
      return null;
    } finally {
      if (token === loadToken) {
        state.isLoading = false;
        state.isRefreshing = false;
        emit();
      }
    }
  },

  /** Reloads in the background once the guide is older than 30 minutes. */
  refreshIfStale(nowMs = Date.now()) {
    if (!state.guide || state.isLoading || state.isRefreshing) return;
    if (nowMs - state.guide.loadedAtMs >= LIVE_TV_STALE_AFTER_MS) void this.refresh();
  },

  setManifestUrl(url) {
    ensureInitialized();
    const trimmed = String(url || "").trim();
    const changed = normalizeManifestUrl(trimmed) !== normalizeManifestUrl(state.manifestUrl);
    LocalStore.set(KEY_MANIFEST_URL, trimmed);
    state.manifestUrl = trimmed;
    if (!changed && state.guide) {
      emit();
      return;
    }
    loadToken += 1;
    state.guide = null;
    state.errorMessage = "";
    state.isLoading = false;
    state.isRefreshing = false;
    state.selectedGroupId = null;
    saveSelectedGroup(null);
    if (trimmed) {
      void this.refresh({ force: true });
    } else {
      emit();
    }
  },

  removeAddon() {
    this.setManifestUrl("");
  },

  selectGroup(groupId) {
    state.selectedGroupId = groupId || null;
    saveSelectedGroup(state.selectedGroupId);
    emit();
  },

  setViewMode(mode) {
    state.viewMode = mode === "OnNow" ? "OnNow" : "Guide";
    LocalStore.set(KEY_VIEW_MODE, state.viewMode);
    emit();
  },

  setOnNowSort(sort) {
    state.onNowSort = ["Channel", "EndingSoon", "JustStarted"].includes(sort) ? sort : "Channel";
    LocalStore.set(KEY_ON_NOW_SORT, state.onNowSort);
    emit();
  },

  isFavorite(channelId) {
    return state.favoriteIds.includes(channelId);
  },

  toggleFavorite(channelId) {
    if (!channelId) return false;
    const isFavorite = state.favoriteIds.includes(channelId);
    state.favoriteIds = isFavorite
      ? state.favoriteIds.filter((id) => id !== channelId)
      : [...state.favoriteIds, channelId];
    saveProfileIds(KEY_FAVORITES, state.favoriteIds);
    if (state.selectedGroupId === LIVE_TV_FAVORITES_GROUP_ID && !state.favoriteIds.length) {
      state.selectedGroupId = null;
      saveSelectedGroup(null);
    }
    emit();
    return !isFavorite;
  },

  recordWatched(channelId) {
    if (!channelId) return;
    state.recentIds = [channelId, ...state.recentIds.filter((id) => id !== channelId)].slice(
      0,
      LIVE_TV_MAX_RECENTS
    );
    saveProfileIds(KEY_RECENTS, state.recentIds);
    emit();
  },

  clearFavorites() {
    state.favoriteIds = [];
    saveProfileIds(KEY_FAVORITES, []);
    if (state.selectedGroupId === LIVE_TV_FAVORITES_GROUP_ID) {
      state.selectedGroupId = null;
      saveSelectedGroup(null);
    }
    emit();
  },

  clearRecents() {
    state.recentIds = [];
    saveProfileIds(KEY_RECENTS, []);
    if (state.selectedGroupId === LIVE_TV_RECENT_GROUP_ID) {
      state.selectedGroupId = null;
      saveSelectedGroup(null);
    }
    emit();
  },

  /** The channel watched before the current one, for the "Last channel" button. */
  previousChannelId(currentId = null) {
    return state.recentIds.find((id) => id !== currentId) || null;
  },

  /** Channels for a chip, resolving the local Favorites and Recent chips. */
  channelsFor(groupId = state.selectedGroupId) {
    const guide = state.guide;
    if (!guide) return [];
    if (groupId === LIVE_TV_FAVORITES_GROUP_ID)
      return state.favoriteIds.map((id) => guideChannel(guide, id)).filter(Boolean);
    if (groupId === LIVE_TV_RECENT_GROUP_ID)
      return state.recentIds.map((id) => guideChannel(guide, id)).filter(Boolean);
    return guideChannelsFor(guide, groupId);
  },

  /** Channels for channel up/down inside a chip; falls back to the full lineup. */
  channelsForSession(groupId) {
    const channels = this.channelsFor(groupId);
    return channels.length ? channels : guideLineup(state.guide);
  },

  /** Addon groups shown as chips (the addon's own favorites catalog is replaced by local Favorites). */
  addonChips() {
    return (state.guide?.groups || []).filter((group) => !isAddonFavoritesGroup(group));
  },

  workingStreams() {
    const stored = LocalStore.get(KEY_WORKING_STREAMS, {});
    return stored && typeof stored === "object" ? stored : {};
  },

  workingStreamFor(channelId) {
    return this.workingStreams()[channelId] || null;
  },

  /** Called when a source has been playing for a while, so the next tune starts with it. */
  rememberWorkingStream(channelId, stream) {
    const url = String(stream?.url || "").trim() || null;
    const label = streamLabelKey(stream) || null;
    if (!channelId || (!url && !label)) return;
    const current = this.workingStreams();
    const existing = current[channelId];
    if (existing && existing.url === url && existing.label === label) return;
    const updated = { ...current, [channelId]: { url, label, savedAtMs: Date.now() } };
    const trimmed = Object.entries(updated)
      .sort((left, right) => Number(right[1]?.savedAtMs || 0) - Number(left[1]?.savedAtMs || 0))
      .slice(0, LIVE_TV_MAX_REMEMBERED_STREAMS);
    LocalStore.set(KEY_WORKING_STREAMS, Object.fromEntries(trimmed));
  },

  /** A channel's raw streams, ordered so the source that worked last time comes first. */
  async loadStreams(channel) {
    const streams = await loadChannelStreams(state.manifestUrl, channel, { fetchJson });
    return orderStreamsByPreference(streams, this.workingStreamFor(channel.id));
  }
};

function describeLoadError(error) {
  const status = Number(error?.status || 0);
  if (status === 404)
    return "The addon link wasn't found (404). Check the link in Settings → Live TV.";
  if (status) return `The addon answered with an error (${status}).`;
  const message = String(error?.message || "").trim();
  if (/abort|timeout/i.test(message))
    return "The addon took too long to answer. Check your connection and try again.";
  if (/failed to fetch|network/i.test(message) || !message)
    return "Couldn't reach the addon. Check your connection and try again.";
  return message.length > 160 ? `${message.slice(0, 157)}…` : message;
}
