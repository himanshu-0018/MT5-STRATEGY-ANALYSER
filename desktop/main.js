const { app, BrowserWindow, Menu, protocol, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

/**
 * QuantFolio desktop shell.
 *
 * The whole app is a static build, so instead of opening a port we serve
 * `web/` (the CRA build, bundled inside the asar) over a private `app://`
 * protocol. That keeps every absolute path (`/static/js/...`, `/samples/...`)
 * working offline, with no localhost server and no firewall prompt.
 */

const SCHEME = "app";
const HOST = "quantfolio";
// Packaged: the CRA build is bundled inside the asar at web/ (see "files" in
// package.json). In development (`npm start`) serve the frontend build as-is.
const WEB_ROOT = app.isPackaged
  ? path.join(__dirname, "web")
  : path.join(__dirname, "..", "frontend", "build");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function serve(request) {
  let rel = "/index.html";
  try {
    const url = new URL(request.url);
    rel = decodeURIComponent(url.pathname || "/");
  } catch (e) {
    return new Response("Bad request", { status: 400 });
  }
  if (rel === "/" || rel === "") rel = "/index.html";

  const resolved = path.normalize(path.join(WEB_ROOT, rel));
  if (!resolved.startsWith(WEB_ROOT)) return new Response("Forbidden", { status: 403 });

  let target = resolved;
  try {
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) target = path.join(WEB_ROOT, "index.html");
    const body = fs.readFileSync(target);
    return new Response(body, {
      headers: { "content-type": TYPES[path.extname(target).toLowerCase()] || "application/octet-stream" },
    });
  } catch (err) {
    return new Response(`Not found: ${rel}`, { status: 404 });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#0B0F19",
    title: "QuantFolio",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.loadURL(`${SCHEME}://${HOST}/index.html`);

  // anything that is not the app itself opens in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}`)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  app.setName("QuantFolio");
  protocol.handle(SCHEME, serve);
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
