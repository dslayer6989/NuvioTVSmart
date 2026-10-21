// The eight Live TV themes (same colors as the desktop and Android builds), their style
// touches (fonts, corners, glow, scanlines) and the Live TV guide colors for every theme.

export const LIVE_TV_THEME_IDS = Object.freeze([
  "NEON_BROADCAST",
  "RETRO_CABLE",
  "TELETEXT",
  "CRT_PHOSPHOR",
  "SYNTHWAVE_SUNSET",
  "GAME_DAY",
  "DRIVE_IN",
  "AURORA"
]);

function palette({
  secondary,
  variant,
  on,
  focus,
  focusBg,
  bg,
  elevated,
  card,
  text,
  text2,
  text3,
  border,
  gradient
}) {
  return {
    "--bg-color": bg,
    "--bg-elevated": elevated,
    "--card-bg": card,
    "--secondary-color": secondary,
    "--secondary-variant": variant,
    "--on-secondary": on,
    "--text-color": text,
    "--text-secondary": text2,
    "--text-tertiary": text3,
    "--border-color": border,
    "--focus-color": focus,
    "--focus-bg": focusBg,
    "--accent-gradient": `linear-gradient(90deg, ${gradient
      .map((color, index) => `${color} ${Math.round((index / (gradient.length - 1)) * 100)}%`)
      .join(", ")})`
  };
}

export const LIVE_TV_THEME_PALETTES = Object.freeze({
  NEON_BROADCAST: palette({
    secondary: "#00E5FF",
    variant: "#FF2BD6",
    on: "#05040A",
    focus: "#5CF2FF",
    focusBg: "#102A3A",
    bg: "#07060D",
    elevated: "#110E1D",
    card: "#191430",
    text: "#F4F2FF",
    text2: "#B9B3D9",
    text3: "#7D7699",
    border: "#231E3A",
    gradient: ["#7C4DFF", "#00E5FF", "#5CF2FF", "#FF2BD6"]
  }),
  RETRO_CABLE: palette({
    secondary: "#FFD83D",
    variant: "#7FD4FF",
    on: "#0A1440",
    focus: "#FFD83D",
    focusBg: "#1D3A8F",
    bg: "#06123F",
    elevated: "#0E2266",
    card: "#16307F",
    text: "#F4F7FF",
    text2: "#C3D0F2",
    text3: "#8A9BD0",
    border: "#2A4596",
    gradient: ["#FF9F1C", "#FFD83D", "#FFF3B0", "#7FD4FF"]
  }),
  TELETEXT: palette({
    secondary: "#FFFF00",
    variant: "#00FFFF",
    on: "#000000",
    focus: "#00FFFF",
    focusBg: "#0000AA",
    bg: "#000000",
    elevated: "#0B0B0B",
    card: "#161616",
    text: "#FFFFFF",
    text2: "#D6D6D6",
    text3: "#9A9A9A",
    border: "#3A3A3A",
    gradient: ["#FF0000", "#FFFF00", "#00FF00", "#00FFFF"]
  }),
  CRT_PHOSPHOR: palette({
    secondary: "#33FF66",
    variant: "#1FB84C",
    on: "#021006",
    focus: "#7CFF9B",
    focusBg: "#0E3A1B",
    bg: "#020A04",
    elevated: "#06140A",
    card: "#0B1F10",
    text: "#C9FFD6",
    text2: "#7FDB95",
    text3: "#4A9A5E",
    border: "#134D24",
    gradient: ["#0B6E2A", "#33FF66", "#B8FFC8"]
  }),
  SYNTHWAVE_SUNSET: palette({
    secondary: "#FF3CAC",
    variant: "#FF9F43",
    on: "#1A0526",
    focus: "#FFC75F",
    focusBg: "#3A1150",
    bg: "#12051F",
    elevated: "#1C0A30",
    card: "#2A0F44",
    text: "#FFEFFB",
    text2: "#D9B8E8",
    text3: "#9C7BB3",
    border: "#3B1D57",
    gradient: ["#784BA0", "#FF3CAC", "#FF7A59", "#FFC75F"]
  }),
  GAME_DAY: palette({
    secondary: "#FFB81C",
    variant: "#E8F5E9",
    on: "#0A1A0F",
    focus: "#FFD65C",
    focusBg: "#1D3F27",
    bg: "#07140C",
    elevated: "#0D2016",
    card: "#133021",
    text: "#F4FFF6",
    text2: "#B9D3C0",
    text3: "#7C9A85",
    border: "#1E3A28",
    gradient: ["#1F7A3A", "#FFB81C", "#FFE08A"]
  }),
  DRIVE_IN: palette({
    secondary: "#FFCF6B",
    variant: "#E63946",
    on: "#2A0B0B",
    focus: "#FFE3A3",
    focusBg: "#4A1616",
    bg: "#140606",
    elevated: "#240C0C",
    card: "#341212",
    text: "#FFF4E0",
    text2: "#E7C9A9",
    text3: "#A88672",
    border: "#4A2020",
    gradient: ["#E63946", "#FF7B54", "#FFCF6B", "#FFF1C1"]
  }),
  AURORA: palette({
    secondary: "#2EE6A6",
    variant: "#8B5CF6",
    on: "#04121A",
    focus: "#7CF7D4",
    focusBg: "#12304A",
    bg: "#050B16",
    elevated: "#0B1526",
    card: "#111F36",
    text: "#EAF6FF",
    text2: "#A9C1D9",
    text3: "#6F87A3",
    border: "#1A2B45",
    gradient: ["#2EE6A6", "#22C1E8", "#8B5CF6", "#D06BFF"]
  })
});

/** Theme picker entries for Settings → Appearance. */
export const LIVE_TV_THEME_OPTIONS = Object.freeze([
  { id: "NEON_BROADCAST", label: "Neon Broadcast", color: "#00E5FF", onColor: "#05040A" },
  { id: "RETRO_CABLE", label: "Retro Cable Guide", color: "#FFD83D", onColor: "#0A1440" },
  { id: "TELETEXT", label: "Teletext", color: "#FFFF00", onColor: "#000000" },
  { id: "CRT_PHOSPHOR", label: "CRT Phosphor", color: "#33FF66", onColor: "#021006" },
  { id: "SYNTHWAVE_SUNSET", label: "Synthwave Sunset", color: "#FF3CAC", onColor: "#1A0526" },
  { id: "GAME_DAY", label: "Game Day", color: "#FFB81C", onColor: "#0A1A0F" },
  { id: "DRIVE_IN", label: "Drive-In Marquee", color: "#FFCF6B", onColor: "#2A0B0B" },
  { id: "AURORA", label: "Aurora", color: "#2EE6A6", onColor: "#04121A" }
]);

/** Accent color stored with each theme, so the theme store recognizes it. */
export const LIVE_TV_THEME_ACCENTS = Object.freeze(
  Object.fromEntries(LIVE_TV_THEME_OPTIONS.map((option) => [option.id, option.color.toLowerCase()]))
);

// Fonts swap in for headings (and labels in some themes). `scale` evens out their sizes.
const FONT_FACES = {
  PIXEL: { family: '"NuvioThemePixel", "Courier New", monospace', scale: 0.8 },
  TERMINAL: { family: '"NuvioThemeTerminal", "Courier New", monospace', scale: 1.25 },
  RETRO: { family: '"NuvioThemeRetro", "Segoe UI", Arial, sans-serif', scale: 0.9 },
  CONDENSED: { family: '"NuvioThemeCondensed", "Arial Narrow", Arial, sans-serif', scale: 1.06 },
  MARQUEE: { family: '"NuvioThemeMarquee", Georgia, serif', scale: 0.94 },
  ROUNDED: { family: '"NuvioThemeRounded", "Segoe UI", Arial, sans-serif', scale: 1.02 }
};

const DEFAULT_STYLE = { cornerScale: 1, glow: true, scanlines: false, heading: null, label: null };

const THEME_STYLES = {
  NEON_BROADCAST: DEFAULT_STYLE,
  RETRO_CABLE: { ...DEFAULT_STYLE, cornerScale: 0.15, glow: false, scanlines: true },
  TELETEXT: { ...DEFAULT_STYLE, cornerScale: 0, glow: false, heading: "PIXEL" },
  CRT_PHOSPHOR: {
    ...DEFAULT_STYLE,
    cornerScale: 0.35,
    scanlines: true,
    heading: "TERMINAL",
    label: "TERMINAL"
  },
  SYNTHWAVE_SUNSET: { ...DEFAULT_STYLE, heading: "RETRO" },
  GAME_DAY: {
    ...DEFAULT_STYLE,
    cornerScale: 0.5,
    glow: false,
    heading: "CONDENSED",
    label: "CONDENSED"
  },
  DRIVE_IN: { ...DEFAULT_STYLE, cornerScale: 0.7, heading: "MARQUEE" },
  AURORA: { ...DEFAULT_STYLE, cornerScale: 1.25, heading: "ROUNDED", label: "ROUNDED" }
};

export function liveTvThemeStyle(themeName) {
  return THEME_STYLES[String(themeName || "").toUpperCase()] || DEFAULT_STYLE;
}

// --- Color helpers --------------------------------------------------------------------

function parseHex(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!match) return null;
  const value = match[1];
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}

function toHex(channels) {
  return `#${channels
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function mix(base, other, amount) {
  const left = parseHex(base) || [0, 0, 0];
  const right = parseHex(other) || [0, 0, 0];
  return toHex(left.map((channel, index) => channel + (right[index] - channel) * amount));
}

function rgba(hex, alpha) {
  const channels = parseHex(hex) || [0, 0, 0];
  return `rgba(${channels.join(", ")}, ${alpha})`;
}

function luminance(hex) {
  const channels = (parseHex(hex) || [0, 0, 0]).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function distinct(left, right) {
  const a = parseHex(left);
  const b = parseHex(right);
  if (!a || !b) return false;
  const delta = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  return delta / 255 > 0.12 || Math.abs(luminance(left) - luminance(right)) > 0.08;
}

function gradientStops(gradient) {
  return String(gradient || "").match(/#[0-9a-f]{6}/gi) || [];
}

function linear(direction, colors) {
  return `linear-gradient(${direction}, ${colors.join(", ")})`;
}

const LIVE_RED = "#FF3B6B";

// Three themes have their own guide colors; every other theme derives them from its palette.
const SPECIAL_GUIDE_PALETTES = {
  NEON_BROADCAST: {
    bg: "#07060D",
    surface: "#0F0C1A",
    raised: "#171329",
    panel: "rgba(18, 15, 34, 0.8)",
    grid: "#231E3A",
    gridStrong: "#342C57",
    accent: "#00E5FF",
    accentSoft: "#5CF2FF",
    highlight: "#FF2BD6",
    deep: "#7C4DFF",
    live: LIVE_RED,
    onAccent: "#05040A",
    text: "#F4F2FF",
    text2: "#B9B3D9",
    text3: "#7D7699",
    past: "#0D0B17",
    future: "#15122A",
    airing: "#1B1840",
    accentGradient: linear("90deg", ["#7C4DFF", "#00E5FF", "#FF2BD6"]),
    airingGradient: linear("90deg", ["#1E2A55", "#2A1745"]),
    screenGradient: linear("180deg", ["#0B0917", "#07060D", "#05040A"]),
    nowGradient: linear("180deg", ["#00E5FF", "#FF2BD6"]),
    progressGradient: linear("90deg", ["#00E5FF", "#FF2BD6"]),
    logoTile: linear("135deg", ["#1B1733", "#100D1E"])
  },
  RETRO_CABLE: {
    bg: "#06123F",
    surface: "#0E2266",
    raised: "#16307F",
    panel: "rgba(11, 27, 85, 0.9)",
    grid: "#2A4596",
    gridStrong: "#4262B8",
    accent: "#FFD83D",
    accentSoft: "#FFE680",
    highlight: "#7FD4FF",
    deep: "#FF9F1C",
    live: "#FF4D4D",
    onAccent: "#0A1440",
    text: "#F4F7FF",
    text2: "#C3D0F2",
    text3: "#8A9BD0",
    past: "#0A1A52",
    future: "#12297A",
    airing: "#2446B4",
    accentGradient: linear("90deg", ["#FFD83D", "#FFE680"]),
    airingGradient: linear("90deg", ["#3563DC", "#2446B4"]),
    screenGradient: linear("180deg", ["#0A1A55", "#06123F", "#040C2E"]),
    nowGradient: linear("180deg", ["#FFD83D", "#FFD83D"]),
    progressGradient: linear("90deg", ["#FFD83D", "#FFE680"]),
    logoTile: linear("135deg", ["#1D3A8F", "#12297A"])
  },
  TELETEXT: {
    bg: "#000000",
    surface: "#000000",
    raised: "#0000AA",
    panel: "rgba(0, 0, 0, 0.94)",
    grid: "#2E2E2E",
    gridStrong: "#5A5A5A",
    accent: "#FFFF00",
    accentSoft: "#00FFFF",
    highlight: "#FF00FF",
    deep: "#FF0000",
    live: "#FF0000",
    onAccent: "#000000",
    text: "#FFFFFF",
    text2: "#00FFFF",
    text3: "#B0B0B0",
    past: "#0A0A0A",
    future: "#141414",
    airing: "#0000C8",
    accentGradient: linear("90deg", ["#FFFF00", "#FFFF00"]),
    airingGradient: linear("90deg", ["#0000C8", "#0000C8"]),
    screenGradient: linear("180deg", ["#000000", "#000000"]),
    nowGradient: linear("180deg", ["#FF0000", "#FF0000"]),
    progressGradient: linear("90deg", ["#00FF00", "#FFFF00"]),
    logoTile: linear("135deg", ["#101010", "#101010"])
  }
};

/** Live TV guide colors for any theme, including Custom colors and AMOLED black. */
export function liveTvGuidePalette(themeName, colors) {
  const special = SPECIAL_GUIDE_PALETTES[String(themeName || "").toUpperCase()];
  if (special) return special;
  const background = colors["--bg-color"] || "#0d0d0d";
  const elevated = colors["--bg-elevated"] || "#1a1a1a";
  const card = colors["--card-bg"] || "#222222";
  const accent = colors["--secondary-color"] || "#f5f5f5";
  const stops = gradientStops(colors["--accent-gradient"]);
  const variant = colors["--secondary-variant"];
  const highlight =
    (distinct(variant, accent) && variant) ||
    (stops.length && distinct(stops[stops.length - 1], accent) && stops[stops.length - 1]) ||
    mix(accent, "#ffffff", 0.45);
  const deep =
    (stops.length && distinct(stops[0], accent) && stops[0]) || mix(accent, "#000000", 0.35);
  const amoled = String(background).toLowerCase() === "#000000";
  const surface = amoled ? "#080808" : mix(background, elevated, 0.6);
  const raised = amoled ? "#141414" : card;
  const textMuted = colors["--text-tertiary"] || "#808080";
  const border = colors["--border-color"] || "#333333";
  const gridCandidate = mix(background, border, 0.9);
  const accentStops = stops.length >= 2 ? stops : [deep, accent, highlight];
  return {
    bg: background,
    surface,
    raised,
    panel: rgba(elevated, 0.88),
    grid: distinct(gridCandidate, background) ? gridCandidate : mix(background, textMuted, 0.18),
    gridStrong: mix(background, textMuted, 0.32),
    accent,
    accentSoft: mix(accent, "#ffffff", 0.3),
    highlight,
    deep,
    live: LIVE_RED,
    onAccent: colors["--on-secondary"] || (luminance(accent) > 0.179 ? "#000000" : "#ffffff"),
    text: colors["--text-color"] || "#ffffff",
    text2: colors["--text-secondary"] || "#b3b3b3",
    text3: textMuted,
    past: mix(background, surface, 0.45),
    future: mix(raised, accent, 0.04),
    airing: mix(raised, accent, 0.16),
    accentGradient: linear("90deg", accentStops),
    airingGradient: linear("90deg", [mix(raised, accent, 0.2), mix(raised, highlight, 0.16)]),
    screenGradient: linear("180deg", [
      mix(background, surface, 0.5),
      background,
      mix(background, "#000000", 0.35)
    ]),
    nowGradient: linear("180deg", [accent, highlight]),
    progressGradient: linear("90deg", [accent, highlight]),
    logoTile: linear("135deg", [mix(raised, accent, 0.06), surface])
  };
}

const GUIDE_VARIABLES = {
  bg: "--ltv-bg",
  surface: "--ltv-surface",
  raised: "--ltv-raised",
  panel: "--ltv-panel",
  grid: "--ltv-grid",
  gridStrong: "--ltv-grid-strong",
  accent: "--ltv-accent",
  accentSoft: "--ltv-accent-soft",
  highlight: "--ltv-highlight",
  deep: "--ltv-deep",
  live: "--ltv-live",
  onAccent: "--ltv-on-accent",
  text: "--ltv-text",
  text2: "--ltv-text-2",
  text3: "--ltv-text-3",
  past: "--ltv-past",
  future: "--ltv-future",
  airing: "--ltv-airing",
  accentGradient: "--ltv-accent-gradient",
  airingGradient: "--ltv-airing-gradient",
  screenGradient: "--ltv-screen-gradient",
  nowGradient: "--ltv-now-gradient",
  progressGradient: "--ltv-progress-gradient",
  logoTile: "--ltv-logo-tile"
};

const BASE_CARD_RADIUS_PX = 16;

/**
 * Applies the Live TV colors and the theme's style touches. Called by ThemeManager.apply()
 * after the regular palette is written.
 */
export function applyLiveTvTheme(themeName, colors, root = globalThis.document?.documentElement) {
  if (!root?.style) return;
  const guide = liveTvGuidePalette(themeName, colors);
  Object.entries(GUIDE_VARIABLES).forEach(([key, variable]) => {
    root.style.setProperty(variable, guide[key]);
  });
  const style = liveTvThemeStyle(themeName);
  const heading = style.heading ? FONT_FACES[style.heading] : null;
  const label = style.label ? FONT_FACES[style.label] : null;
  root.style.setProperty("--ltv-corner-scale", String(style.cornerScale));
  root.style.setProperty("--ltv-heading-font", heading ? heading.family : "var(--app-font-family)");
  root.style.setProperty("--ltv-heading-scale", String(heading ? heading.scale : 1));
  root.style.setProperty("--ltv-label-font", label ? label.family : "var(--app-font-family)");
  root.style.setProperty("--ltv-label-scale", String(label ? label.scale : 1));
  const isLiveTvTheme = LIVE_TV_THEME_IDS.includes(String(themeName || "").toUpperCase());
  if (isLiveTvTheme) {
    // Corners follow the theme across the app, like the desktop build.
    root.style.setProperty(
      "--tv-card-radius",
      `${Math.round(BASE_CARD_RADIUS_PX * style.cornerScale)}px`
    );
  } else {
    root.style.removeProperty("--tv-card-radius");
  }
  const classes = root.classList;
  classes?.toggle("ltv-glow", Boolean(style.glow));
  classes?.toggle("ltv-scanlines", Boolean(style.scanlines));
  classes?.toggle("ltv-theme-heading-font", Boolean(heading));
  classes?.toggle("ltv-theme-label-font", Boolean(label));
  classes?.toggle("ltv-theme", isLiveTvTheme);
}
