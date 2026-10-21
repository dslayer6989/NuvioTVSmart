// Pure time helpers for the Live TV guide. All values are epoch milliseconds (UTC).

export const MINUTE_MS = 60 * 1000;
export const HALF_HOUR_MS = 30 * MINUTE_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function floorToHalfHour(epochMs) {
  return Math.floor(epochMs / HALF_HOUR_MS) * HALF_HOUR_MS;
}

/** Half-hour slot starts covering [startMs, endMs). */
export function halfHourSlots(startMs, endMs) {
  const slots = [];
  for (let cursor = floorToHalfHour(startMs); cursor < endMs; cursor += HALF_HOUR_MS) {
    slots.push(cursor);
  }
  return slots;
}

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

/** "YYYY-MM-DD" for the UTC day containing epochMs. */
export function utcDate(epochMs) {
  const date = new Date(Math.floor(epochMs / DAY_MS) * DAY_MS);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Every UTC date touched by [startMs, endMs]. */
export function utcDatesBetween(startMs, endMs) {
  if (endMs < startMs) return [];
  const dates = [];
  for (let day = Math.floor(startMs / DAY_MS); day <= Math.floor(endMs / DAY_MS); day += 1) {
    dates.push(utcDate(day * DAY_MS));
  }
  return dates;
}

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;
const XMLTV_PATTERN = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/;

function parseOffset(raw) {
  if (!raw || raw.toLowerCase() === "z") return 0;
  const sign = raw.startsWith("-") ? -1 : 1;
  const digits = raw.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length > 2 ? Number(digits.slice(2)) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 18 || minutes > 59)
    return null;
  return sign * (hours * HOUR_MS + minutes * MINUTE_MS);
}

function toEpochMs(year, month, day, hour, minute, second, millis, offsetMs) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) {
    return null;
  }
  return Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMs;
}

/** Parses ISO-8601 instants ("2026-09-29T20:00:00Z", offsets, fractions) and XMLTV stamps. */
export function parseInstant(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  let match = ISO_PATTERN.exec(text);
  if (match) {
    const offsetMs = parseOffset(match[8] || "");
    if (offsetMs == null) return null;
    const fraction = match[7] ? Number(match[7].padEnd(3, "0").slice(0, 3)) : 0;
    return toEpochMs(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
      fraction,
      offsetMs
    );
  }
  match = XMLTV_PATTERN.exec(text);
  if (match) {
    const offsetMs = parseOffset(match[7] || "");
    if (offsetMs == null) return null;
    return toEpochMs(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0),
      0,
      offsetMs
    );
  }
  return null;
}

/** "60 min", "1h 30m", "1:30", "PT1H30M" or a bare number of minutes. */
export function parseRuntimeMinutes(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const minutes = Number(text);
    return minutes > 0 ? minutes : null;
  }
  let match = /^(\d+):(\d{2})$/.exec(text);
  if (match) {
    const total = Number(match[1]) * 60 + Number(match[2]);
    return total > 0 ? total : null;
  }
  match = /^pt(?:(\d+)h)?(?:(\d+)m)?(?:\d+s)?$/.exec(text);
  if (match) {
    const total = Number(match[1] || 0) * 60 + Number(match[2] || 0);
    return total > 0 ? total : null;
  }
  const hours = Number(/(\d+)\s*(?:h|hr|hrs|hour|hours)\b/.exec(text)?.[1] || 0);
  const minutes = Number(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/.exec(text)?.[1] || 0);
  const total = hours * 60 + minutes;
  return total > 0 ? total : null;
}

/** "9:30 PM" style clock text in the TV's local time zone. */
export function formatClock(epochMs) {
  const date = new Date(epochMs);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${pad(minutes)} ${hours < 12 ? "AM" : "PM"}`;
}

/** "Today", "Tomorrow" or a short weekday + date, for the guide's day label. */
export function formatDayLabel(epochMs, nowMs = Date.now()) {
  const date = new Date(epochMs);
  const today = new Date(nowMs);
  const startOfDay = (value) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const dayDelta = Math.round((startOfDay(date) - startOfDay(today)) / DAY_MS);
  if (dayDelta === 0) return "Today";
  if (dayDelta === 1) return "Tomorrow";
  if (dayDelta === -1) return "Yesterday";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  return `${weekdays[date.getDay()]} ${months[date.getMonth()]} ${date.getDate()}`;
}

/** "45 min" or "1h 20m" for a remaining duration. */
export function formatDuration(ms) {
  const totalMinutes = Math.max(1, Math.round(ms / MINUTE_MS));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}
