import { app, dialog, ipcMain } from 'electron';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import db from './database';
import { engine } from './engine-manager';

async function getFileHash(filePath: string): Promise<string> {
  const file = await readFile(filePath);

  return createHash('sha256').update(file).digest('hex');
}

function getMimeType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();

  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
  };

  return mimeTypes[extension] ?? 'application/octet-stream';
}

const supportedImageExtensions = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.heic',
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

export function registerPhotoHandlers(): void {
  ipcMain.handle('get-photos', (_event, albumId?: number) => {
    if (albumId === undefined) {
      return db
        .prepare(`
          SELECT *
          FROM photos
          ORDER BY id DESC
        `)
        .all();
    }

    return db
      .prepare(`
        SELECT *
        FROM photos
        WHERE album_id = ?
        ORDER BY id DESC
      `)
      .all(albumId);
  });

  ipcMain.handle('select-photos', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic'],
        },
      ],
    });

    if (result.canceled) {
      return [];
    }

    return result.filePaths;
  });

  ipcMain.handle('select-photo-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });

    if (result.canceled) {
      return [];
    }

    return collectImagesFromFolder(result.filePaths[0]);
  });

  ipcMain.handle('read-photo', async (_event, filePath: string) => {
    const file = await readFile(filePath);
    const mimeType = getMimeType(filePath);

    return `data:${mimeType};base64,${file.toString('base64')}`;
  });

  ipcMain.handle(
    'import-photos',
    async (event, filePaths: string[], albumId: number) => {
      const importStartedAt = performance.now();
      const photosDir = path.join(app.getPath('userData'), 'photos');
      const thumbnailsDir = path.join(app.getPath('userData'), 'thumbnails');
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
      const sendProgress = (status: ImportProgress['status']) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('import-progress', {
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
        const targetAlbum = db
          .prepare('SELECT id FROM albums WHERE id = ?')
          .get(albumId);

        if (!targetAlbum) {
          throw new Error('Pilih album yang valid sebelum mengimpor foto.');
        }

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
                action: 'generate_thumbnail',
                input: destination,
                output: thumbnailPath,
                max_size: 500,
              });

              if (!thumbnailResult.success) {
                throw new Error(
                  `Thumbnail generation failed for ${fileName}: ${String(thumbnailResult.error ?? 'unknown engine error')}`,
                );
              }

              thumbnailSucceeded = true;
            } finally {
              console.info(
                `[Thumbnail] ${thumbnailSucceeded ? 'Finished' : 'Failed'}: ${fileName} in ${Math.round(performance.now() - thumbnailStartedAt)} ms`,
              );
            }

            const fileInfo = await stat(destination);

            db.prepare(`
              INSERT INTO photos (
                filename,
                original_path,
                storage_path,
                thumbnail_path,
                album_id,
                file_size,
                file_hash,
                mime_type,
                created_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              fileName,
              filePath,
              destination,
              thumbnailPath,
              albumId,
              fileInfo.size,
              fileHash,
              getMimeType(fileName),
              new Date().toISOString(),
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
        sendProgress('running');
        const workers = Array.from(
          { length: workerCount },
          async (_, workerId) => {
            while (nextFileIndex < filePaths.length) {
              const filePath = filePaths[nextFileIndex++];
              const fileName = path.basename(filePath);
              activeFiles[workerId] = fileName;
              sendProgress('running');

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
                sendProgress('running');
              }
            }
          },
        );

        await Promise.all(workers);
        sendProgress('completed');

        if (failedImports.length > 0) {
          throw new Error(
            `Failed to import ${failedImports.length} photo(s): ${failedImports.join('; ')}`,
          );
        }

        return importedPhotos;
      } finally {
        console.info(
          `[Import] Finished: ${importedPhotos.length} imported, ${duplicatesSkipped} duplicate(s) skipped, ${failedImports.length} failed, ${Math.round(performance.now() - importStartedAt)} ms total`,
        );
        if (completedCount !== filePaths.length) {
          sendProgress('completed');
        }
      }
    },
  );

  ipcMain.handle('delete-photo', async (_event, photoId: number) => {
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
      throw new Error('Photo not found');
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

  ipcMain.handle('delete-all-photos', async () => {
    const photos = db
      .prepare('SELECT storage_path, thumbnail_path FROM photos')
      .all() as Array<{
      storage_path: string;
      thumbnail_path: string | null;
    }>;
    const photosDir = path.resolve(app.getPath('userData'), 'photos');
    const thumbnailsDir = path.resolve(app.getPath('userData'), 'thumbnails');

    const ensureManagedPath = (filePath: string, directory: string) => {
      const absolutePath = path.resolve(filePath);
      const relativePath = path.relative(directory, absolutePath);

      if (
        !relativePath ||
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      ) {
        throw new Error(
          `Refusing to delete file outside managed storage: ${filePath}`,
        );
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

    const deleteResult = db.prepare('DELETE FROM photos').run();
    return deleteResult.changes;
  });

  ipcMain.handle('engine-ping', async () => {
    return await engine.send({
      id: randomUUID(),
      action: 'ping',
    });
  });

  ipcMain.handle(
    'generate-thumbnail',
    async (_event, inputPath: string, outputPath: string, maxSize = 500) => {
      return await engine.send({
        id: randomUUID(),
        action: 'generate_thumbnail',
        input: inputPath,
        output: outputPath,
        max_size: maxSize,
      });
    },
  );
}
