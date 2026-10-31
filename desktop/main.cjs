const { app, BrowserWindow, shell } = require("electron");

const APP_URL = "https://quorum-static.onrender.com";
const APP_HOST = new URL(APP_URL).host;

function openExternal(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:" || url.protocol === "mailto:") {
      void shell.openExternal(url.href);
    }
  } catch {
    // Ignore malformed navigation requests from the remote page.
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#f7f6f2",
    title: "Quorum",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, rawUrl) => {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || url.host !== APP_HOST) {
        event.preventDefault();
        openExternal(rawUrl);
      }
    } catch {
      event.preventDefault();
    }
  });

  void window.loadURL(APP_URL);
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
