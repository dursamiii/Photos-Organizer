import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { readFile, copyFile, mkdir, stat, unlink } from "node:fs/promises";
import db from "./database";
import { createHash, randomUUID } from "node:crypto";
import { engine } from "./engine-manager";



// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let isQuitting = false;

async function getFileHash(filePath: string): Promise<string> {
  const file = await readFile(filePath);

  return createHash("sha256")
    .update(file)
    .digest("hex");
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
  mainWindow.on("close", async (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();

    const result = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["Minimize", "Quit"],
      defaultId: 0,
      cancelId: 0,
      title: "Photos Organizer",
      message: "Apa yang ingin kamu lakukan?",
      detail: "Kamu bisa meminimalkan window atau keluar dari aplikasi.",
    });

    if (result.response === 0) {
      mainWindow.minimize();
    } else if (result.response === 1) {
      isQuitting = true;
      app.quit();
    }
  });
  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
};

function getMimeType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();

  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
  };

  return mimeTypes[extension] ?? "application/octet-stream";
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.

// GET DARI DATABASE
ipcMain.handle("get-photos", () => {
  const photos = db
    .prepare(`
      SELECT *
      FROM photos
      ORDER BY id DESC
    `)
    .all();

  return photos;
});

// PILIH FOTO DARI FILE SYSTEM
ipcMain.handle("select-photos", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Images",
        extensions: ["jpg", "jpeg", "png", "webp", "heic"],
      },
    ],
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths;
});

// BACA FOTO DARI FILE SYSTEM
ipcMain.handle("read-photo", async (_event, filePath: string) => {
  const file = await readFile(filePath);

  const mimeType = getMimeType(filePath);

  return `data:${mimeType};base64,${file.toString("base64")}`;
});

ipcMain.handle("import-photos", async (_event, filePaths: string[]) => {
  const photosDir = path.join(app.getPath("userData"), "photos");

  await mkdir(photosDir, { recursive: true });

  const importedPhotos: string[] = [];

  for (const filePath of filePaths) {
    const fileName = path.basename(filePath);

    // Hitung hash isi file
    const fileHash = await getFileHash(filePath);

    // Cek apakah foto sudah pernah diimport
    const existingPhoto = db
      .prepare(`
        SELECT storage_path
        FROM photos
        WHERE file_hash = ?
      `)
      .get(fileHash) as { storage_path: string } | undefined;

    if (existingPhoto) {
      console.log(`Duplicate skipped: ${fileName}`);
      continue;
    }

    const extension = path.extname(fileName);
    const storageFileName = `${randomUUID()}${extension}`;
    const destination = path.join(photosDir, storageFileName);

    await copyFile(filePath, destination);

    const fileInfo = await stat(destination);

    db.prepare(`
      INSERT INTO photos (
        filename,
        original_path,
        storage_path,
        file_size,
        file_hash,
        mime_type,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      fileName,
      filePath,
      destination,
      fileInfo.size,
      fileHash,
      getMimeType(fileName),
      new Date().toISOString()
    );

    importedPhotos.push(destination);
  }

  return importedPhotos;
});

// DELETE FOTO DARI DATABASE DAN FILE SYSTEM
ipcMain.handle("delete-photo", async (_event, photoId: number) => {
  const photo = db
    .prepare(`
      SELECT storage_path
      FROM photos
      WHERE id = ?
    `)
    .get(photoId) as { storage_path: string } | undefined;

  if (!photo) {
    throw new Error("Photo not found");
  }

  await unlink(photo.storage_path);

  db.prepare(`
    DELETE FROM photos
    WHERE id = ?
  `).run(photoId);

  return true;
});

// ENGINE PING
ipcMain.handle("engine-ping", async () => {
  return await engine.send({
    id: randomUUID(),
    action: "ping",
  });
});


// GENERATE THUMBNAIL
ipcMain.handle(
  "generate-thumbnail",
  async (
    _event,
    inputPath: string,
    outputPath: string,
    maxSize = 500
  ) => {
    return await engine.send({
      id: randomUUID(),
      action: "generate_thumbnail",
      input: inputPath,
      output: outputPath,
      max_size: maxSize,
    });
  }
);
// =============================

app.whenReady().then(() => {
  engine.start();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  app.on("before-quit", () => {
  engine.stop();
});
});



// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
