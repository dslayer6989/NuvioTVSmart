/* global module, require */
"use strict";

// Live TV "set up with your phone" control endpoint for Samsung TVs. It runs inside the
// EngineFS web service (Tizen 5+), because the PluginService only exists on Tizen 6+.
// The app calls POST http://127.0.0.1:2716/livetv-config; see services/livetv-phone-config.cjs.
var http = require("http");

// Outside the media runtime's 2710-2714 range and the subtitle service's 2715.
var DEFAULT_PORT = 2716;
var MAX_BODY_BYTES = 16384;
var server = null;

function send(response, status, payload) {
  var body = JSON.stringify(payload || {});
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function handle(request, response) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    response.end();
    return;
  }
  if (request.url === "/health") return send(response, 200, { returnValue: true, service: "nuvio-livetv-phone" });
  if (request.url !== "/livetv-config" || request.method !== "POST") {
    return send(response, 404, { returnValue: false });
  }
  var chunks = [];
  var size = 0;
  request.on("data", function (chunk) {
    size += chunk.length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  });
  request.on("end", function () {
    var payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch (_) {
      return send(response, 400, { returnValue: false });
    }
    try {
      require("../../livetv-phone-config.cjs")
        .control(payload)
        .then(
          function (result) {
            var reply = { returnValue: true };
            Object.keys(result || {}).forEach(function (key) {
              reply[key] = result[key];
            });
            send(response, 200, reply);
          },
          function () {
            send(response, payload && payload.action === "read" ? 410 : 503, { returnValue: false });
          }
        );
    } catch (_) {
      send(response, 503, { returnValue: false });
    }
  });
  request.on("error", function () {});
}

function start() {
  if (server) return;
  server = http.createServer(handle);
  server.on("error", function () {
    server = null;
  });
  server.listen(DEFAULT_PORT, "127.0.0.1");
}

function stop() {
  if (!server) return;
  try {
    server.close();
  } catch (_) {}
  server = null;
}

module.exports = { start: start, stop: stop, port: DEFAULT_PORT };
