import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import {
  readFile,
  copyFile,
  mkdir,
  readdir,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
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

const supportedImageExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
]);

async function collectImagesFromFolder(folderPath: string): Promise<string[]> {
  const pendingFolders = [folderPath];
  const imagePaths: string[] = [];

  while (pendingFolders.length > 0) {
    const currentFolder = pendingFolders.pop()!;
    const entries = await readdir(currentFolder, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentFolder, entry.name);

      if (entry.isDirectory()) {
        pendingFolders.push(entryPath);
      } else if (
        entry.isFile() &&
        supportedImageExtensions.has(path.extname(entry.name).toLowerCase())
      ) {
        imagePaths.push(entryPath);
      }
    }
  }

  return imagePaths;
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

ipcMain.handle("select-photo-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });

  if (result.canceled) {
    return [];
  }

  return collectImagesFromFolder(result.filePaths[0]);
});

// BACA FOTO DARI FILE SYSTEM
ipcMain.handle("read-photo", async (_event, filePath: string) => {
  const file = await readFile(filePath);

  const mimeType = getMimeType(filePath);

  return `data:${mimeType};base64,${file.toString("base64")}`;
});


// IMPORT FOTO KE DATABASE DAN FILE SYSTEM
ipcMain.handle("import-photos", async (_event, filePaths: string[]) => {
  const importStartedAt = performance.now();
  const photosDir = path.join(app.getPath("userData"), "photos");
  const thumbnailsDir = path.join(app.getPath("userData"), "thumbnails");
  const importedPhotos: string[] = [];
  let duplicatesSkipped = 0;

  try {
    await Promise.all([
      mkdir(photosDir, { recursive: true }),
      mkdir(thumbnailsDir, { recursive: true }),
    ]);

    for (const filePath of filePaths) {
      const fileName = path.basename(filePath);
      const fileHash = await getFileHash(filePath);
      const existingPhoto = db
        .prepare(`
          SELECT storage_path
          FROM photos
          WHERE file_hash = ?
        `)
        .get(fileHash) as { storage_path: string } | undefined;

      if (existingPhoto) {
        console.info(`[Import] Duplicate skipped: ${fileName}`);
        duplicatesSkipped += 1;
        continue;
      }

      const extension = path.extname(fileName);
      const storageFileName = `${randomUUID()}${extension}`;
      const destination = path.join(photosDir, storageFileName);
      const thumbnailPath = path.join(
        thumbnailsDir,
        `${path.parse(storageFileName).name}.jpg`,
      );

      await copyFile(filePath, destination);

      try {
        const thumbnailStartedAt = performance.now();
        let thumbnailSucceeded = false;
        console.info(`[Thumbnail] Started: ${fileName}`);

        try {
          const thumbnailResult = await engine.send({
            id: randomUUID(),
            action: "generate_thumbnail",
            input: destination,
            output: thumbnailPath,
            max_size: 500,
          });

          if (!thumbnailResult.success) {
            throw new Error(
              `Thumbnail generation failed for ${fileName}: ${String(thumbnailResult.error ?? "unknown engine error")}`,
            );
          }

          thumbnailSucceeded = true;
        } finally {
          console.info(
            `[Thumbnail] ${thumbnailSucceeded ? "Finished" : "Failed"}: ${fileName} in ${Math.round(performance.now() - thumbnailStartedAt)} ms`,
          );
        }

        const fileInfo = await stat(destination);

        db.prepare(`
          INSERT INTO photos (
            filename,
            original_path,
            storage_path,
            thumbnail_path,
            file_size,
            file_hash,
            mime_type,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          fileName,
          filePath,
          destination,
          thumbnailPath,
          fileInfo.size,
          fileHash,
          getMimeType(fileName),
          new Date().toISOString()
        );
      } catch (error) {
        await Promise.all([
          rm(destination, { force: true }),
          rm(thumbnailPath, { force: true }),
        ]);
        throw error;
      }

      importedPhotos.push(destination);
    }

    return importedPhotos;
  } finally {
    console.info(
      `[Import] Finished: ${importedPhotos.length} imported, ${duplicatesSkipped} duplicate(s) skipped, ${Math.round(performance.now() - importStartedAt)} ms total`,
    );
  }
});

// DELETE FOTO DARI DATABASE DAN FILE SYSTEM
ipcMain.handle("delete-photo", async (_event, photoId: number) => {
  const photo = db
    .prepare(`
      SELECT storage_path, thumbnail_path
      FROM photos
      WHERE id = ?
    `)
    .get(photoId) as
    | { storage_path: string; thumbnail_path: string | null }
    | undefined;

  if (!photo) {
    throw new Error("Photo not found");
  }

  await Promise.all([
    unlink(photo.storage_path),
    photo.thumbnail_path ? unlink(photo.thumbnail_path) : Promise.resolve(),
  ]);

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
