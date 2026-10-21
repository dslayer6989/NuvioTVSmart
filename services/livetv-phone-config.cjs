"use strict";
// Lets a phone on the same Wi-Fi type the Live TV addon link for the TV.
// The TV app starts a session with a random token, shows a QR code for
// http://<tv-ip>:<port>/<token>/, and polls `read` until the phone saves a link.
// Written in ES5 because the Tizen 5.x web-service runtime is old.
var http = require("http");
var session = null;
var listener = null;
var expiry = null;
var FIRST_PORT = 8110;
var LAST_PORT = 8119;
var SESSION_IDLE_MS = 120000;

function escape(value) {
  return String(value || "").replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function reply(response, status, body, html) {
  response.writeHead(status, {
    "Content-Type": html ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" +
      (session ? session.token : "") +
      "'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'"
  });
  response.end(html ? body : JSON.stringify(body));
}

function stop(token) {
  if (!session || token !== session.token) return false;
  clearTimeout(expiry);
  expiry = null;
  session = null;
  if (listener) listener.close();
  listener = null;
  return true;
}

function renew() {
  clearTimeout(expiry);
  var token = session.token;
  expiry = setTimeout(function () {
    stop(token);
  }, SESSION_IDLE_MS);
  if (expiry.unref) expiry.unref();
}

function isAcceptableLink(value) {
  return (
    /^(https?|stremio):\/\/[^\s]+$/i.test(value) ||
    /^[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(value)
  );
}

function page(current) {
  return (
    '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Nuvio Live TV</title><style>" +
    "body{margin:0;padding:24px;background:#0d0d10;color:#f2f2f5;font:18px system-ui,-apple-system,Segoe UI,Roboto,sans-serif}" +
    "main{max-width:640px;margin:auto}h1{font-size:26px;margin:8px 0 4px}p{color:#b8b8c4;line-height:1.5;overflow-wrap:anywhere}" +
    "label{display:block;margin:18px 0 8px;font-weight:600}" +
    "input{box-sizing:border-box;width:100%;padding:14px;border-radius:12px;border:1px solid #666;background:#1d1d24;color:#fff;font:17px monospace}" +
    "button{margin-top:16px;padding:14px 26px;border:0;border-radius:12px;background:#ff3b6b;color:#fff;font:600 18px system-ui}" +
    "#status{min-height:26px;font-weight:600;color:#7cf7d4}</style><main>" +
    "<h1>Nuvio Live TV</h1><p>Type or paste the link of a Stremio addon with live channels. Its program guide loads on the TV automatically.</p>" +
    '<label for="link">Addon link</label>' +
    '<input id="link" type="url" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="https://example.com/manifest.json">' +
    '<button id="save">Send to TV</button><p id="status" role="status"></p>' +
    "<p>The link can end in /manifest.json or not, and stremio:// links work too.</p></main>" +
    '<script nonce="' +
    current.token +
    '">(function(){var field=document.getElementById("link"),status=document.getElementById("status");' +
    'function api(action,body){return fetch("api/"+action,{method:body?"POST":"GET",headers:{"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined}).then(function(r){if(!r.ok)throw Error(r.status);return r.json()})}' +
    'api("link").then(function(v){field.value=v.link||""});' +
    'document.getElementById("save").onclick=function(){var value=field.value.trim();if(!value){status.textContent="Type a link first.";return}' +
    'api("link",{link:value}).then(function(){status.textContent="Sent! Check your TV."}).catch(function(e){status.textContent=String(e.message)==="400"?"That doesn\\u2019t look like a web link.":"Couldn\\u2019t reach the TV. Is the QR code still on screen?"})};' +
    "})();</script></html>"
  );
}

function handle(request, response) {
  var current = session;
  if (!current) return reply(response, 404, { error: "Expired" });
  var prefix = "/" + current.token + "/";
  var route = String(request.url || "").split("?")[0];
  if (route.indexOf(prefix) !== 0) return reply(response, 404, { error: "Not found" });
  if (request.headers.origin && request.headers.origin !== "http://" + request.headers.host) {
    return reply(response, 403, { error: "Origin" });
  }
  route = route.slice(prefix.length);
  renew();
  if (request.method === "GET" && route === "") return reply(response, 200, page(current), true);
  if (request.method === "GET" && route === "api/link")
    return reply(response, 200, { link: current.link });
  if (request.method !== "POST" || route !== "api/link")
    return reply(response, 404, { error: "Not found" });
  var size = 0;
  var chunks = [];
  request.on("data", function (chunk) {
    size += chunk.length;
    if (size <= 8192) chunks.push(chunk);
  });
  request.on("end", function () {
    if (session !== current) return reply(response, 410, { error: "Expired" });
    if (size > 8192) return reply(response, 413, { error: "Too large" });
    try {
      var body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      var link = typeof body.link === "string" ? body.link.trim() : "";
      if (!link || link.length > 2048 || !isAcceptableLink(link))
        return reply(response, 400, { error: "Invalid link" });
      current.link = link;
      current.revision += 1;
      reply(response, 200, { status: "saved" });
    } catch (_) {
      reply(response, 400, { error: "Invalid JSON" });
    }
  });
  request.on("error", function () {});
}

function lanAddress() {
  try {
    var interfaces = require("os").networkInterfaces();
    var found = "";
    Object.keys(interfaces).some(function (name) {
      return (interfaces[name] || []).some(function (entry) {
        if (!entry.internal && (entry.family === "IPv4" || entry.family === 4)) {
          found = entry.address;
          return true;
        }
        return false;
      });
    });
    return found;
  } catch (_) {
    return "";
  }
}

function start(payload) {
  if (!/^[a-f0-9]{64}$/.test((payload && payload.token) || ""))
    return Promise.reject(new Error("Invalid token"));
  var initial = typeof payload.link === "string" ? payload.link.slice(0, 2048) : "";
  if (session) stop(session.token);
  var current = { token: payload.token, link: initial, revision: 0 };
  session = current;
  return new Promise(function (resolve, reject) {
    function bind(port) {
      var server = http.createServer(handle);
      server.maxConnections = 8;
      server.setTimeout(15000);
      server.once("error", function (error) {
        if (session !== current) return reject(new Error("Superseded"));
        if (error && error.code === "EADDRINUSE" && port < LAST_PORT) return bind(port + 1);
        stop(current.token);
        reject(error);
      });
      server.listen(port, "0.0.0.0", function () {
        if (session !== current) {
          server.close();
          return reject(new Error("Superseded"));
        }
        listener = server;
        renew();
        resolve({ port: port, address: lanAddress(), revision: 0 });
      });
    }
    bind(FIRST_PORT);
  });
}

function read(token) {
  if (!session || session.token !== token) return null;
  renew();
  return { link: session.link, revision: session.revision };
}

/** Handles the app's `POST /livetv-config` control calls: {action: start|read|stop, token, link}. */
function control(payload) {
  var action = payload && payload.action;
  if (action === "start") return start(payload);
  if (action === "read") {
    var state = read(payload.token);
    return state ? Promise.resolve(state) : Promise.reject(new Error("Expired"));
  }
  if (action === "stop") return Promise.resolve({ stopped: stop(payload.token) });
  return Promise.reject(new Error("Unknown action"));
}

module.exports = { start: start, stop: stop, read: read, control: control };
