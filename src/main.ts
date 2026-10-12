import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { engine } from './services/engine-manager';
import { registerAlbumHandlers } from './services/album';
import { registerPhotoHandlers } from './services/photos';
import { registerSettingsHandlers } from './services/settings';

const handleOutputStreamError = (error: Error & { code?: string }) => {
  if (error.code !== 'EPIPE') {
    throw error;
  }
};

process.stdout.on('error', handleOutputStreamError);
process.stderr.on('error', handleOutputStreamError);

if (started) {
  app.quit();
}

let isQuitting = false;
let mainWindow: BrowserWindow | null = null;
let isHandlingSecondInstance = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', async () => {
    if (isHandlingSecondInstance) {
      return;
    }

    isHandlingSecondInstance = true;

    try {
      await app.whenReady();

      const window = mainWindow;
      if (!window || window.isDestroyed()) {
        return;
      }

      if (window.isMinimized()) {
        window.restore();
      }
      window.show();
      app.focus({ steal: true });
      window.focus();

      await dialog.showMessageBox(window, {
        type: 'info',
        buttons: ['OK'],
        defaultId: 0,
        title: 'Photos Organizer',
        message: 'Photos Organizer sudah terbuka.',
        detail: 'Aplikasi sedang berjalan.',
      });
    } finally {
      isHandlingSecondInstance = false;
    }
  });
}

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1200,
    minHeight: 800,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = window;

  window.once('ready-to-show', () => {
    if (window.isDestroyed()) {
      return;
    }

    window.show();
    app.focus({ steal: true });
    window.focus();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
  window.on('close', async (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();

    const result = await dialog.showMessageBox(window, {
      type: 'question',
      buttons: ['Cancel', 'Minimize', 'Exit'],
      defaultId: 2,
      cancelId: 0,
      title: 'Photos Organizer',
      message: 'Apa yang ingin kamu lakukan?',
      detail: 'Batalkan, minimalkan window, atau keluar dari aplikasi.',
    });
    if (result.response === 1) {
      window.minimize();
    } else if (result.response === 2) {
      isQuitting = true;
      app.quit();
    }
  });
  window.on('closed', () => {
    mainWindow = null;
  });
};

registerAlbumHandlers();
registerPhotoHandlers();
registerSettingsHandlers();
ipcMain.on('set-photo-preview-active', (event, active: boolean) => {
  if (process.platform !== 'darwin' || typeof active !== 'boolean') {
    return;
  }
  BrowserWindow.fromWebContents(event.sender)?.setWindowButtonVisibility(
    !active,
  );
});

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    engine.start();

    createWindow();

    app.on('activate', () => {
      const [window] = BrowserWindow.getAllWindows();
      if (!window) {
        createWindow();
      } else {
        if (window.isMinimized()) {
          window.restore();
        }
        window.show();
        app.focus({ steal: true });
        window.focus();
      }
    });
    app.on('before-quit', () => {
      engine.stop();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
