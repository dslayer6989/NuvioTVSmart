// "Set up with your phone": the TV shows a QR code for a small page it serves on the
// home network. The phone types or pastes the addon link there, and the TV picks it up.
// Samsung: the EngineFS web service (Tizen 5+) runs the page (port 2716 control).
// LG: the webOS plugin service runs it. See services/livetv-phone-config.cjs.

import { Platform } from "../platform/index.js";
import { PluginServiceClient } from "../platform/pluginServiceClient.js";
import { TizenEngineFsService } from "../platform/tizen/tizenEngineFsService.js";
import { QrCodeGenerator } from "../core/qr/qrCodeGenerator.js";

const TIZEN_CONTROL_URL = "http://127.0.0.1:2716/livetv-config";
const POLL_MS = 1000;

function randomToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function controlUrl() {
  if (Platform.isTizen()) {
    await TizenEngineFsService.ensureStarted({ purpose: "livetv-phone-setup" }).catch(() => null);
    return TIZEN_CONTROL_URL;
  }
  if (Platform.isWebOS()) {
    const health = await PluginServiceClient.ensureReady();
    const port = Number(health?.port || 2721);
    return `http://127.0.0.1:${port}/livetv-config`;
  }
  throw new Error("Phone setup needs the TV app's local service, which isn't available here.");
}

async function call(url, body) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!response.ok) throw new Error(`Phone setup service answered ${response.status}`);
    const result = await response.json();
    if (result?.returnValue === false) throw new Error("Phone setup service refused the request");
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function tvAddress(sessionAddress) {
  let address = String(sessionAddress || "");
  if (!address && Platform.isTizen()) {
    try {
      address = globalThis.webapis?.network?.getIp?.() || "";
    } catch (_) {
      address = "";
    }
  }
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) || /^127\./.test(address)) return "";
  return address;
}

/**
 * Starts a phone session. `onLink(link)` runs each time the phone sends a link.
 * @returns {Promise<{ url: string, qrDataUrl: string, stop: () => void }>}
 */
export async function startLiveTvPhoneEntry({ currentLink = "", onLink, onExpired } = {}) {
  const url = await controlUrl();
  const token = randomToken();
  const session = await call(url, { action: "start", token, link: currentLink || "" });
  const address = tvAddress(session.address);
  if (!address) {
    void call(url, { action: "stop", token }).catch(() => {});
    throw new Error("The TV isn't connected to a home network, so a phone can't reach it.");
  }
  const pageUrl = `http://${address}:${session.port}/${token}/`;
  const canvas = document.createElement("canvas");
  QrCodeGenerator.generate(canvas, pageUrl, 420);
  let stopped = false;
  let timer = null;
  let revision = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    void call(url, { action: "stop", token }).catch(() => {});
  };
  const poll = async () => {
    if (stopped) return;
    try {
      const state = await call(url, { action: "read", token });
      if (stopped) return;
      if (Number(state.revision || 0) > revision) {
        revision = Number(state.revision || 0);
        onLink?.(String(state.link || ""));
      }
    } catch (_) {
      if (!stopped) {
        stopped = true;
        onExpired?.();
      }
      return;
    }
    timer = setTimeout(poll, POLL_MS);
  };
  timer = setTimeout(poll, POLL_MS);
  return { url: pageUrl, qrDataUrl: canvas.toDataURL("image/png"), stop };
}
