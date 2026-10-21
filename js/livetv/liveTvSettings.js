// Settings → Live TV: the addon link (typed on the TV or sent from a phone), guide
// refresh, removing the addon, and clearing this profile's favorites and recents.
// Rendered by the Settings screen with `this` bound to it.

import { Router } from "../ui/navigation/routerState.js";
import { LiveTvRepository } from "./liveTvRepository.js";
import { isPlausibleManifestUrl } from "./liveTvGuide.js";
import { startLiveTvPhoneEntry } from "./liveTvPhoneEntry.js";
import { formatClock } from "./liveTvTime.js";
import { escapeHtml } from "./ui/liveTvMarkup.js";

export const LIVE_TV_SETTINGS_SECTION = {
  id: "liveTv",
  label: "Live TV",
  subtitle: "Addon link, guide refresh, favorites"
};

function rerender(screen) {
  if (Router.getCurrent() === "settings" && screen.activeSection === LIVE_TV_SETTINGS_SECTION.id) {
    void screen.render({ refreshModel: false }).then(() => screen.applyFocus?.());
  }
}

function watchRepository(screen) {
  if (screen.liveTvSettingsUnsubscribe) return;
  screen.liveTvSettingsUnsubscribe = LiveTvRepository.subscribe(() => {
    if (Router.getCurrent() !== "settings") {
      screen.liveTvSettingsUnsubscribe?.();
      screen.liveTvSettingsUnsubscribe = null;
      return;
    }
    // Don't redraw under an open dialog; it would steal the remote's focus.
    if (!screen.textDialog && !screen.optionDialog) rerender(screen);
  });
}

function openLinkDialog(screen) {
  const state = LiveTvRepository.state;
  screen.openTextDialog({
    title: "Live TV addon link",
    value: state.manifestUrl || "",
    placeholder: "https://…/manifest.json",
    returnFocusKey: "liveTv:link",
    saveLabel: "Save",
    clearLabel: state.manifestUrl ? "Remove" : "",
    onClear: state.manifestUrl
      ? () => {
          LiveTvRepository.removeAddon();
          return true;
        }
      : undefined,
    onSubmit: (value) => {
      const trimmed = String(value || "").trim();
      if (!trimmed) {
        if (screen.textDialog) screen.textDialog.statusMessage = "Type the addon's link first.";
        return false;
      }
      if (!isPlausibleManifestUrl(trimmed)) {
        if (screen.textDialog)
          screen.textDialog.statusMessage =
            "That doesn't look like a web link (for example https://example.com/manifest.json).";
        return false;
      }
      LiveTvRepository.setManifestUrl(trimmed);
      return true;
    }
  });
}

async function openPhoneDialog(screen) {
  screen.closeLiveTvPhoneSession?.();
  const showMessage = (html, options = [{ id: "close", label: "Close" }]) => {
    screen.openOptionDialog({
      title: "Set up with your phone",
      messageHtml: html,
      options,
      selectedId: options[0].id,
      returnFocusKey: "liveTv:phone",
      dialogClassName: "ltv-phone-dialog",
      onSelect: () => {
        screen.closeLiveTvPhoneSession?.();
      },
      onClose: () => screen.closeLiveTvPhoneSession?.()
    });
  };
  showMessage(`<p>Starting…</p>`);
  rerender(screen);
  try {
    const session = await startLiveTvPhoneEntry({
      currentLink: LiveTvRepository.state.manifestUrl,
      onLink: (link) => {
        if (!isPlausibleManifestUrl(link)) return;
        LiveTvRepository.setManifestUrl(link);
        screen.closeLiveTvPhoneSession?.();
        showMessage(
          `<p class="ltv-phone-done">Got it! The guide is loading from:</p><p class="ltv-phone-url">${escapeHtml(link)}</p>`,
          [{ id: "close", label: "Done" }]
        );
        rerender(screen);
      },
      onExpired: () => {
        screen.liveTvPhoneSession = null;
      }
    });
    if (
      Router.getCurrent() !== "settings" ||
      screen.optionDialog?.returnFocusKey !== "liveTv:phone"
    ) {
      session.stop();
      return;
    }
    screen.liveTvPhoneSession = session;
    screen.closeLiveTvPhoneSession = () => {
      screen.liveTvPhoneSession?.stop();
      screen.liveTvPhoneSession = null;
    };
    showMessage(`
      <div class="ltv-phone-qr-block">
        <img class="ltv-phone-qr" src="${escapeHtml(session.qrDataUrl)}" alt="QR code" />
        <div class="ltv-phone-steps">
          <p>1. Make sure your phone is on the same Wi-Fi as this TV.</p>
          <p>2. Scan the code with your phone's camera.</p>
          <p>3. Type or paste the addon link and tap <b>Send to TV</b>.</p>
          <p class="ltv-phone-url">${escapeHtml(session.url)}</p>
        </div>
      </div>`);
    rerender(screen);
  } catch (error) {
    showMessage(
      `<p>${escapeHtml(error?.message || "Phone setup isn't available right now.")}</p><p>You can type the link on the TV instead.</p>`
    );
    rerender(screen);
  }
}

function confirm(screen, { title, message, confirmLabel, focusKey, onConfirm }) {
  screen.openOptionDialog({
    title,
    message,
    options: [
      { id: "confirm", label: confirmLabel },
      { id: "cancel", label: "Cancel" }
    ],
    selectedId: "cancel",
    returnFocusKey: focusKey,
    onSelect: (option) => {
      if (option?.id === "confirm") onConfirm();
    }
  });
}

/** Runs an action requested from the Live TV screen (its setup buttons). */
export function runLiveTvSettingsAction(screen, action) {
  if (action === "phone") void openPhoneDialog(screen);
  if (action === "type") openLinkDialog(screen);
}

export function renderLiveTvSettingsSection() {
  watchRepository(this);
  const state = LiveTvRepository.ensureLoaded();
  const guide = state.guide;
  const configured = LiveTvRepository.isConfigured();
  const status = !configured
    ? "No addon yet"
    : guide
      ? `${guide.addonName} · ${guide.lineupIds.length} channels · Updated ${formatClock(guide.loadedAtMs)}`
      : state.isLoading
        ? "Loading the guide…"
        : state.errorMessage || "Not loaded yet";

  this.actionMap.set("liveTv:link", () => openLinkDialog(this));
  this.actionMap.set("liveTv:phone", () => openPhoneDialog(this));
  this.actionMap.set("liveTv:refresh", () => {
    void LiveTvRepository.refresh({ force: true });
  });
  this.actionMap.set("liveTv:open", () => {
    Router.navigate("liveTv");
  });
  this.actionMap.set("liveTv:remove", () =>
    confirm(this, {
      title: "Remove addon?",
      message: "Live TV will ask for an addon link again.",
      confirmLabel: "Remove",
      focusKey: "liveTv:remove",
      onConfirm: () => LiveTvRepository.removeAddon()
    })
  );
  this.actionMap.set("liveTv:clearFavorites", () =>
    confirm(this, {
      title: "Clear favorites?",
      message: "This profile's starred channels will be removed.",
      confirmLabel: "Clear",
      focusKey: "liveTv:clearFavorites",
      onConfirm: () => LiveTvRepository.clearFavorites()
    })
  );
  this.actionMap.set("liveTv:clearRecents", () =>
    confirm(this, {
      title: "Clear recently watched?",
      message: "This profile's recently watched channels will be removed.",
      confirmLabel: "Clear",
      focusKey: "liveTv:clearRecents",
      onConfirm: () => LiveTvRepository.clearRecents()
    })
  );

  const count = (ids) => `${ids.length} channel${ids.length === 1 ? "" : "s"}`;
  return `
    ${this.renderSectionHeader(LIVE_TV_SETTINGS_SECTION)}
    <div class="settings-group-card">
      <div class="settings-group-heading">
        <div class="settings-group-title">Addon</div>
        <div class="settings-group-subtitle">${escapeHtml(status)}</div>
      </div>
      <div class="settings-stack">
        ${this.renderActionRow({
          focusKey: "liveTv:phone",
          title: "Set up with your phone",
          subtitle: "Scan a QR code and type or paste the link on your phone",
          leadingIcon: "qr_code_2"
        })}
        ${this.renderActionRow({
          focusKey: "liveTv:link",
          title: "Addon link",
          subtitle: configured
            ? state.manifestUrl
            : "Type the manifest.json link of a Stremio addon with live channels",
          value: configured ? "Change" : "Add",
          leadingIcon: "link"
        })}
        ${
          configured
            ? `${this.renderActionRow({
                focusKey: "liveTv:refresh",
                title: "Refresh guide now",
                subtitle: "The guide also refreshes itself every 30 minutes",
                leadingIcon: "refresh"
              })}
              ${this.renderActionRow({
                focusKey: "liveTv:open",
                title: "Open Live TV",
                leadingIcon: "live_tv"
              })}
              ${this.renderActionRow({
                focusKey: "liveTv:remove",
                title: "Remove addon",
                subtitle: "Live TV will ask for an addon link again",
                leadingIcon: "delete"
              })}`
            : ""
        }
      </div>
    </div>
    <div class="settings-group-card">
      <div class="settings-group-heading">
        <div class="settings-group-title">Your channels</div>
        <div class="settings-group-subtitle">Favorites and recently watched are saved separately for each profile.</div>
      </div>
      <div class="settings-stack">
        ${this.renderActionRow({
          focusKey: "liveTv:clearFavorites",
          title: "Clear favorites",
          value: count(state.favoriteIds),
          leadingIcon: "star_border",
          disabled: !state.favoriteIds.length
        })}
        ${this.renderActionRow({
          focusKey: "liveTv:clearRecents",
          title: "Clear recently watched",
          value: count(state.recentIds),
          leadingIcon: "history",
          disabled: !state.recentIds.length
        })}
      </div>
    </div>`;
}
