// A short message at the bottom of the screen ("Tuning to CNN…", "Switching to Backup 1…").

const DEFAULT_DURATION_MS = 3000;
let hideTimer = null;

export function showLiveTvToast(message, { durationMs = DEFAULT_DURATION_MS } = {}) {
  const text = String(message || "").trim();
  if (!text || typeof document === "undefined") return;
  let toast = document.getElementById("liveTvToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "liveTvToast";
    toast.className = "ltv-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add("is-visible");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => toast.classList.remove("is-visible"), durationMs);
}

export function hideLiveTvToast() {
  clearTimeout(hideTimer);
  document.getElementById("liveTvToast")?.classList.remove("is-visible");
}
