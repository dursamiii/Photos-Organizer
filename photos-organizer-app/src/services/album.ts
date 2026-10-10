import { ipcMain } from 'electron';
import db from './database';
import { getAlbumSettings } from './settings';

type AlbumRow = Omit<PhotoAlbum, 'hierarchy'> & {
  hierarchy_json: string;
};

function toPhotoAlbum(row: AlbumRow): PhotoAlbum {
  let hierarchy: AlbumHierarchyLevel[];
  try {
    hierarchy = JSON.parse(row.hierarchy_json) as AlbumHierarchyLevel[];
  } catch (error) {
    throw new Error(`Struktur album ${row.id} tidak valid.`, { cause: error });
  }

  if (
    !Array.isArray(hierarchy) ||
    hierarchy.length < 2 ||
    hierarchy.some(
      (level) =>
        !level ||
        typeof level.label !== 'string' ||
        typeof level.value !== 'string',
    )
  ) {
    throw new Error(`Struktur album ${row.id} tidak valid.`);
  }

  const { hierarchy_json: _hierarchyJson, ...album } = row;
  return { ...album, hierarchy };
}

function formatDepartureDate(departureDate: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${departureDate}T00:00:00.000Z`));
}

const getAlbumById = (id: number): PhotoAlbum => {
  const row = db
    .prepare(`
      SELECT albums.*, COUNT(photos.id) AS photo_count
      FROM albums
      LEFT JOIN photos ON photos.album_id = albums.id
      WHERE albums.id = ?
      GROUP BY albums.id
    `)
    .get(id) as AlbumRow | undefined;

  if (!row) {
    throw new Error('Album tidak ditemukan.');
  }
  return toPhotoAlbum(row);
};

export function registerAlbumHandlers(): void {
  ipcMain.handle('get-albums', () => {
    const rows = db
      .prepare(`
        SELECT albums.*, COUNT(photos.id) AS photo_count
        FROM albums
        LEFT JOIN photos ON photos.album_id = albums.id
        GROUP BY albums.id
      `)
      .all() as AlbumRow[];

    return rows.map(toPhotoAlbum);
  });

  ipcMain.handle('create-album', (_event, album: NewPhotoAlbum): PhotoAlbum => {
    if (!album || !Array.isArray(album.hierarchy)) {
      throw new Error('Struktur album tidak valid.');
    }

    const settings = getAlbumSettings();
    if (
      album.hierarchy.length !== settings.hierarchyLabels.length ||
      album.hierarchy.some(
        (level, index) => level?.label !== settings.hierarchyLabels[index],
      )
    ) {
      throw new Error(
        'Susunan level berubah. Tutup lalu buka kembali formulir album.',
      );
    }

    if (
      typeof album.departureDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(album.departureDate) ||
      Number.isNaN(
        new Date(`${album.departureDate}T00:00:00.000Z`).getTime(),
      ) ||
      new Date(`${album.departureDate}T00:00:00.000Z`)
        .toISOString()
        .slice(0, 10) !== album.departureDate
    ) {
      throw new Error('Tanggal keberangkatan tidak valid.');
    }
    if (
      typeof album.returnDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(album.returnDate) ||
      Number.isNaN(new Date(`${album.returnDate}T00:00:00.000Z`).getTime()) ||
      new Date(`${album.returnDate}T00:00:00.000Z`)
        .toISOString()
        .slice(0, 10) !== album.returnDate ||
      album.returnDate < album.departureDate
    ) {
      throw new Error(
        'Tanggal kepulangan harus sama atau setelah keberangkatan.',
      );
    }
    if (
      !Number.isInteger(album.memberCount) ||
      album.memberCount < 1 ||
      album.memberCount > 100000
    ) {
      throw new Error('Jumlah anggota harus berupa bilangan bulat minimal 1.');
    }

    const hierarchy = album.hierarchy.map((level) => {
      if (
        !level ||
        typeof level.label !== 'string' ||
        typeof level.value !== 'string'
      ) {
        throw new Error('Setiap level album harus memiliki nama dan nilai.');
      }
      return {
        label: level.label.trim(),
        value: level.value.trim(),
      };
    });
    hierarchy[0].value = album.departureDate.slice(0, 4);
    if (settings.nameByDepartureDate) {
      hierarchy[hierarchy.length - 1].value = formatDepartureDate(
        album.departureDate,
      );
    }

    if (
      hierarchy.length < 2 ||
      hierarchy.some(
        (level) =>
          !level.label ||
          !level.value ||
          level.label.length > 40 ||
          level.value.length > 100,
      )
    ) {
      throw new Error('Isi nama dan nilai untuk minimal dua level album.');
    }

    const hierarchyJson = JSON.stringify(hierarchy);
    if (
      db
        .prepare(
          'SELECT id FROM albums WHERE hierarchy_json = ? AND start_date = ?',
        )
        .get(hierarchyJson, album.departureDate)
    ) {
      throw new Error(
        'Album dengan struktur dan tanggal keberangkatan yang sama sudah ada.',
      );
    }

    const legacyValues = hierarchy.map((level) => level.value);
    const result = db
      .prepare(`
          INSERT INTO albums (
            year,
            batch,
            group_name,
            start_date,
            end_date,
            member_count,
            hierarchy_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
      .run(
        legacyValues[0],
        legacyValues.length > 2 ? legacyValues[1] : '',
        legacyValues.at(-1),
        album.departureDate,
        album.returnDate,
        album.memberCount,
        hierarchyJson,
        new Date().toISOString(),
      );

    return getAlbumById(Number(result.lastInsertRowid));
  });

  ipcMain.handle(
    'rename-album',
    (_event, albumId: number, albumName: string): PhotoAlbum => {
      const normalizedAlbumName = albumName.trim();
      if (!normalizedAlbumName) {
        throw new Error('Nama album tidak boleh kosong.');
      }

      const album = getAlbumById(albumId);
      const hierarchy = album.hierarchy.map((level, index) =>
        index === album.hierarchy.length - 1
          ? { ...level, value: normalizedAlbumName }
          : level,
      );
      const hierarchyJson = JSON.stringify(hierarchy);
      if (
        db
          .prepare(
            'SELECT id FROM albums WHERE hierarchy_json = ? AND start_date = ? AND id != ?',
          )
          .get(hierarchyJson, album.start_date, albumId)
      ) {
        throw new Error(
          'Album dengan struktur dan tanggal keberangkatan yang sama sudah ada.',
        );
      }
      const result = db
        .prepare(
          'UPDATE albums SET group_name = ?, hierarchy_json = ? WHERE id = ?',
        )
        .run(normalizedAlbumName, hierarchyJson, albumId);

      if (result.changes === 0) {
        throw new Error('Album tidak ditemukan.');
      }

      return getAlbumById(albumId);
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
