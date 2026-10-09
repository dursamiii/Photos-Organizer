import { ipcMain } from 'electron';
import db from './database';

export function registerAlbumHandlers(): void {
  ipcMain.handle('get-albums', () =>
    db
      .prepare(`
        SELECT albums.*, COUNT(photos.id) AS photo_count
        FROM albums
        LEFT JOIN photos ON photos.album_id = albums.id
        GROUP BY albums.id
        ORDER BY albums.year DESC, albums.batch ASC, albums.group_name ASC
      `)
      .all(),
  );

  ipcMain.handle('create-album', (_event, album: NewPhotoAlbum): PhotoAlbum => {
    const result = db
      .prepare(`
          INSERT INTO albums (
            year,
            batch,
            group_name,
            start_date,
            end_date,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `)
      .run(
        album.year,
        album.batch,
        album.groupName,
        album.startDate,
        album.endDate,
        new Date().toISOString(),
      );

    return db
      .prepare(`
          SELECT albums.*, COUNT(photos.id) AS photo_count
          FROM albums
          LEFT JOIN photos ON photos.album_id = albums.id
          WHERE albums.id = ?
          GROUP BY albums.id
        `)
      .get(Number(result.lastInsertRowid)) as PhotoAlbum;
  });

  ipcMain.handle(
    'rename-album',
    (_event, albumId: number, groupName: string): PhotoAlbum => {
      const normalizedGroupName = groupName.trim();
      if (!normalizedGroupName) {
        throw new Error('Nama album tidak boleh kosong.');
      }

      const result = db
        .prepare('UPDATE albums SET group_name = ? WHERE id = ?')
        .run(normalizedGroupName, albumId);

      if (result.changes === 0) {
        throw new Error('Album tidak ditemukan.');
      }

      return db
        .prepare(`
          SELECT albums.*, COUNT(photos.id) AS photo_count
          FROM albums
          LEFT JOIN photos ON photos.album_id = albums.id
          WHERE albums.id = ?
          GROUP BY albums.id
        `)
        .get(albumId) as PhotoAlbum;
    },
  );

  ipcMain.handle('delete-album', (_event, albumId: number) => {
    const deleteAlbum = db.transaction((id: number) => {
      const album = db.prepare('SELECT id FROM albums WHERE id = ?').get(id);
      if (!album) {
        throw new Error('Album tidak ditemukan.');
      }

      const photoCount = db
        .prepare('SELECT COUNT(*) AS count FROM photos WHERE album_id = ?')
        .get(id) as { count: number };
      if (photoCount.count > 0) {
        throw new Error('Album hanya bisa dihapus jika tidak memiliki foto.');
      }

      db.prepare('DELETE FROM albums WHERE id = ?').run(id);
    });

    deleteAlbum(albumId);
    return true;
  });
}
