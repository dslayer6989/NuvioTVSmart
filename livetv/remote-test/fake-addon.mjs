// A stand-in for the Stremio-TV addon, with programmes around the current time, used by
// the remote-navigation tests. Shapes match https://dslayer6989.github.io/Stremio-TV.
//   node livetv/remote-test/fake-addon.mjs [port]
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOUR = 60 * 60 * 1000;
const PAGE_SIZE = 10;

const CHANNEL_NAMES = [
  ["cnn", "CNN", "news"],
  ["espn", "ESPN", "sports"],
  ["pbs", "PBS Kids", "kids"],
  ["nbc", "NBC News Now", "news"],
  ["fox", "FOX Sports", "sports"],
  ["hgtv", "HGTV", "home"],
  ["discovery", "Discovery", "documentary"],
  ["cartoon", "Cartoon Classics", "kids"],
  ["movies", "Movie Vault", "movies"],
  ["abc", "ABC News Live", "news"],
  ["food", "Food Network", "home"],
  ["history", "History", "documentary"],
  ["golf", "Golf Channel", "sports"],
  ["comedy", "Comedy Central", "entertainment"],
  ["bravo", "Bravo", "entertainment"],
  ["nat", "Nat Geo", "documentary"],
  ["weather", "Weather Now", "news"],
  ["classic", "Classic TV", "entertainment"],
  ["nfl", "NFL Network", "sports"],
  ["cooking", "Cooking Live", "home"],
  ["nopgm", "No Guide Channel", "entertainment"]
];

export function buildFixture(baseUrl, nowMs = Date.now()) {
  const dayStart = Math.floor(nowMs / (24 * HOUR)) * 24 * HOUR;
  const channels = CHANNEL_NAMES.map(([slug, name, genre], index) => {
    const id = `stremiotv_${slug}`;
    const videos = [];
    if (slug !== "nopgm") {
      // Programmes of 30, 60 or 90 minutes from yesterday to two days ahead.
      let cursor = dayStart - 24 * HOUR + (index % 3) * 15 * 60 * 1000;
      let count = 0;
      while (cursor < dayStart + 72 * HOUR) {
        const length = [30, 60, 90][(index + count) % 3] * 60 * 1000;
        videos.push({
          id: `${id}:epg:${new Date(cursor).toISOString()}`,
          title: `${name} Show ${count + 1}`,
          startTime: new Date(cursor).toISOString(),
          endTime: new Date(cursor + length).toISOString(),
          overview: `Episode ${count + 1} of ${name}.`
        });
        cursor += length;
        count += 1;
      }
    }
    return {
      id,
      type: "tv",
      name,
      genres: [genre],
      logo: `${baseUrl}/logo/${slug}.svg`,
      behaviorHints: { isLive: true, hasScheduledVideos: true },
      videos
    };
  });
  return { channels, dayStart };
}

const CATALOGS = ["favorites", "sports", "news", "entertainment", "home", "documentary", "kids", "movies"];

function manifest() {
  return {
    id: "com.stremiotv.philly",
    version: "0.7.0",
    name: "Stremio TV",
    description: "Test copy of the Stremio-TV addon.",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    idPrefixes: ["stremiotv_"],
    catalogs: [
      { type: "tv", id: "channels", name: "Stremio TV", extra: [{ name: "skip" }, { name: "date" }] },
      ...CATALOGS.map((id) => ({
        type: "tv",
        id,
        name: id === "favorites" ? "★ Favorites" : id[0].toUpperCase() + id.slice(1),
        extra: [{ name: "genre", isRequired: true, options: ["All"] }, { name: "skip" }]
      })),
      { type: "tv", id: "search", name: "Search", extra: [{ name: "search", isRequired: true }] }
    ],
    behaviorHints: { epgProvider: true }
  };
}

function parseExtras(segment) {
  const extras = {};
  String(segment || "")
    .split("&")
    .filter(Boolean)
    .forEach((pair) => {
      const [key, value] = pair.split("=");
      extras[decodeURIComponent(key)] = decodeURIComponent(value || "");
    });
  return extras;
}

function logoSvg(slug) {
  const hue = [...slug].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90"><rect width="160" height="90" rx="12" fill="hsl(${hue},70%,45%)"/><text x="80" y="56" font-size="30" font-family="Arial" font-weight="700" fill="#fff" text-anchor="middle">${slug.slice(0, 4).toUpperCase()}</text></svg>`;
}

export function startFakeAddon({ port = 7000, host = "0.0.0.0", publicBaseUrl = null } = {}) {
  const baseUrl = publicBaseUrl || `http://127.0.0.1:${port}`;
  const log = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, baseUrl);
    log.push(url.pathname);
    const send = (status, body, type = "application/json; charset=utf-8") => {
      response.writeHead(status, {
        "Content-Type": type,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Cache-Control": "no-store"
      });
      response.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    if (request.method === "OPTIONS") return send(204, "");
    const { channels, dayStart } = buildFixture(baseUrl);
    const parts = url.pathname.replace(/\.json$/, "").split("/").filter(Boolean);
    if (url.pathname === "/manifest.json") return send(200, manifest());
    if (parts[0] === "logo") return send(200, logoSvg(parts[1].replace(/\.svg$/, "")), "image/svg+xml");
    if (parts[0] === "media" && parts[1] === "test.webm") {
      try {
        return send(200, await readFile(path.join(here, "fixtures", "test.webm")), "video/webm");
      } catch (_) {
        return send(404, { error: "no test video" });
      }
    }
    if (parts[0] === "catalog" && parts[1] === "tv") {
      const id = parts[2];
      const extras = parseExtras(parts[3]);
      const skip = Number(extras.skip || 0);
      if (id === "channels") {
        const date = extras.date ? Date.parse(`${extras.date}T00:00:00Z`) : dayStart;
        if (!Number.isFinite(date)) return send(404, { error: "bad date" });
        const page = channels.slice(skip, skip + PAGE_SIZE).map((channel) => ({
          ...channel,
          videos: channel.videos.filter((video) => {
            const start = Date.parse(video.startTime);
            return start >= date && start < date + 24 * HOUR;
          })
        }));
        return send(200, { metasDetailed: page });
      }
      if (CATALOGS.includes(id)) {
        if (extras.genre !== "All") return send(404, { error: "genre required" });
        const members = id === "favorites"
          ? channels.filter((channel) => ["stremiotv_cnn", "stremiotv_espn"].includes(channel.id))
          : id === "movies"
            ? channels.filter((channel) => channel.genres[0] === "movies")
            : channels.filter((channel) => channel.genres[0] === id);
        return send(200, { metas: members.slice(skip, skip + PAGE_SIZE).map(({ videos, ...rest }) => rest) });
      }
      return send(404, { error: "unknown catalog" });
    }
    if (parts[0] === "stream" && parts[1] === "tv") {
      const id = decodeURIComponent(parts[2]);
      if (!channels.some((channel) => channel.id === id)) return send(404, { error: "unknown channel" });
      // The primary link is broken on purpose, so the player has to fail over to the backup.
      return send(200, {
        streams: [
          { name: "Primary • 720p", url: `${baseUrl}/media/missing-${id}.webm` },
          { name: "Backup 1 • 480p", url: `${baseUrl}/media/test.webm` }
        ]
      });
    }
    return send(404, { error: "not found" });
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, baseUrl, log }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.argv[2] || 7000);
  startFakeAddon({ port }).then(({ baseUrl }) => console.log(`Fake Live TV addon on ${baseUrl}/manifest.json`));
}
