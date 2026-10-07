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

const handleOutputStreamError = (error: Error & { code?: string }) => {
  if (error.code !== "EPIPE") {
    throw error;
  }
};

process.stdout.on("error", handleOutputStreamError);
process.stderr.on("error", handleOutputStreamError);


// Handle creating/removing shortcuts on Windows when installing/uninstalling.
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
  app.on("second-instance", async () => {
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
        type: "info",
        buttons: ["OK"],
        defaultId: 0,
        title: "Photos Organizer",
        message: "Photos Organizer sudah terbuka.",
        detail: "Aplikasi sedang berjalan.",
      });
    } finally {
      isHandlingSecondInstance = false;
    }
  });
}

async function getFileHash(filePath: string): Promise<string> {
  const file = await readFile(filePath);

  return createHash("sha256")
    .update(file)
    .digest("hex");
}

const createWindow = () => {
  // Create the browser window.
  const window = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = window;

  window.once("ready-to-show", () => {
    if (window.isDestroyed()) {
      return;
    }

    window.show();
    app.focus({ steal: true });
    window.focus();
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
  window.on("close", async (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();

    const result = await dialog.showMessageBox(window, {
      type: "question",
      buttons: ["Cancel", "Minimize", "Exit"],
      defaultId: 2,
      cancelId: 0,
      title: "Photos Organizer",
      message: "Apa yang ingin kamu lakukan?",
      detail: "Batalkan, minimalkan window, atau keluar dari aplikasi.",
    });
    if (result.response === 1) {
      window.minimize();
    } else if (result.response === 2) {
      isQuitting = true;
      app.quit();
    }
  });
  window.on("closed", () => {
    mainWindow = null;
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
const importConcurrency = 4;

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

ipcMain.handle("is-development", () => !app.isPackaged);

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
ipcMain.handle("import-photos", async (event, filePaths: string[]) => {
  const importStartedAt = performance.now();
  const photosDir = path.join(app.getPath("userData"), "photos");
  const thumbnailsDir = path.join(app.getPath("userData"), "thumbnails");
  const importedPhotos: string[] = [];
  const failedImports: string[] = [];
  const seenFileHashes = new Set<string>();
  let duplicatesSkipped = 0;
  let completedCount = 0;
  const workerCount = Math.min(importConcurrency, filePaths.length);
  const activeFiles = Array.from(
    { length: workerCount },
    () => null as string | null,
  );
  const sendProgress = (status: ImportProgress["status"]) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send("import-progress", {
        status,
        total: filePaths.length,
        completed: completedCount,
        workerCount,
        activeFiles: activeFiles.filter(
          (fileName): fileName is string => fileName !== null,
        ),
        imported: importedPhotos.length,
        duplicates: duplicatesSkipped,
        failed: failedImports.length,
      } satisfies ImportProgress);
    }
  };

  try {
    await Promise.all([
      mkdir(photosDir, { recursive: true }),
      mkdir(thumbnailsDir, { recursive: true }),
    ]);

    const importFile = async (filePath: string) => {
      const fileName = path.basename(filePath);
      const fileHash = await getFileHash(filePath);

      if (seenFileHashes.has(fileHash)) {
        console.info(`[Import] Duplicate in batch skipped: ${fileName}`);
        duplicatesSkipped += 1;
        return;
      }
      seenFileHashes.add(fileHash);

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
        return;
      }

      const extension = path.extname(fileName);
      const storageFileName = `${randomUUID()}${extension}`;
      const destination = path.join(photosDir, storageFileName);
      const thumbnailPath = path.join(
        thumbnailsDir,
        `${path.parse(storageFileName).name}.jpg`,
      );

      try {
        await copyFile(filePath, destination);

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

        importedPhotos.push(destination);
      } catch (error) {
        await Promise.all([
          rm(destination, { force: true }),
          rm(thumbnailPath, { force: true }),
        ]);
        throw error;
      }
    };

    let nextFileIndex = 0;
    console.info(
      `[Import] Starting: ${filePaths.length} file(s) with ${workerCount} worker(s)`,
    );
    sendProgress("running");
    const workers = Array.from({ length: workerCount }, async (_, workerId) => {
      while (nextFileIndex < filePaths.length) {
        const filePath = filePaths[nextFileIndex++];
        const fileName = path.basename(filePath);
        activeFiles[workerId] = fileName;
        sendProgress("running");

        try {
          await importFile(filePath);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          failedImports.push(`${fileName}: ${message}`);
          console.error(`[Import] Failed: ${fileName}`, error);
        } finally {
          completedCount += 1;
          activeFiles[workerId] = null;
          sendProgress("running");
        }
      }
    });

    await Promise.all(workers);
    sendProgress("completed");

    if (failedImports.length > 0) {
      throw new Error(
        `Failed to import ${failedImports.length} photo(s): ${failedImports.join("; ")}`,
      );
    }

    return importedPhotos;
  } finally {
    console.info(
      `[Import] Finished: ${importedPhotos.length} imported, ${duplicatesSkipped} duplicate(s) skipped, ${failedImports.length} failed, ${Math.round(performance.now() - importStartedAt)} ms total`,
    );
    if (completedCount !== filePaths.length) {
      sendProgress("completed");
    }
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

ipcMain.handle("delete-all-photos", async () => {
  if (app.isPackaged) {
    throw new Error("Bulk photo deletion is only available in development.");
  }

  const photos = db
    .prepare("SELECT storage_path, thumbnail_path FROM photos")
    .all() as Array<{
    storage_path: string;
    thumbnail_path: string | null;
  }>;
  const photosDir = path.resolve(app.getPath("userData"), "photos");
  const thumbnailsDir = path.resolve(app.getPath("userData"), "thumbnails");

  const ensureManagedPath = (filePath: string, directory: string) => {
    const absolutePath = path.resolve(filePath);
    const relativePath = path.relative(directory, absolutePath);

    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(`Refusing to delete file outside managed storage: ${filePath}`);
    }

    return absolutePath;
  };

  const managedPaths = photos.flatMap((photo) => [
    ensureManagedPath(photo.storage_path, photosDir),
    ...(photo.thumbnail_path
      ? [ensureManagedPath(photo.thumbnail_path, thumbnailsDir)]
      : []),
  ]);

  await Promise.all(
    managedPaths.map((filePath) => rm(filePath, { force: true })),
  );

  const deleteResult = db.prepare("DELETE FROM photos").run();
  return deleteResult.changes;
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

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    engine.start();

    createWindow();

    app.on("activate", () => {
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
    app.on("before-quit", () => {
      engine.stop();
    });
  });
}



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
