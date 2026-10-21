// Small HTML builders shared by the Live TV guide, On Now, the Home row and the player.

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function monogram(name) {
  const words = String(name || "")
    .replace(/[^A-Za-z0-9\u00C0-\u024F ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "TV";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

/** Channel logo on a tile, falling back to the channel's initials if the image fails. */
export function logoTile(channel, className = "") {
  const name = channel?.name || "";
  const logo = String(channel?.logo || "").trim();
  return `<span class="ltv-logo-tile${className ? ` ${className}` : ""}" aria-hidden="true">
      <span class="ltv-logo-monogram">${escapeHtml(monogram(name))}</span>
      ${
        logo
          ? `<img class="ltv-logo-image" src="${escapeHtml(logo)}" alt="" loading="lazy" onerror="this.remove()" onload="this.parentNode&&this.parentNode.classList.add('has-logo')" />`
          : ""
      }
    </span>`;
}

export function liveBadge(label = "LIVE") {
  return `<span class="ltv-live-badge"><span class="ltv-live-dot"></span>${escapeHtml(label)}</span>`;
}

export function progressBar(fraction, className = "") {
  // Whole percents keep the markup stable between key presses, so rows can be reused.
  const percent = Math.round(Math.max(0, Math.min(1, Number(fraction) || 0)) * 100);
  return `<span class="ltv-progress${className ? ` ${className}` : ""}"><span class="ltv-progress-fill" style="width:${percent}%"></span></span>`;
}

export function starIcon(filled = true) {
  return `<span class="ltv-star${filled ? " is-filled" : ""}" aria-hidden="true">${filled ? "★" : "☆"}</span>`;
}
