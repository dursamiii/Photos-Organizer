import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';

const databasePath = path.join(app.getPath('userData'), 'photos-organizer.db');

const db = new Database(databasePath);
db.pragma('foreign_keys = OFF');
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const tableExists = (tableName: string) =>
  Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );

const migrateSchema = db.transaction(() => {
  const hasLegacyDirectories = tableExists('photo_directories');
  const hasAlbums = tableExists('albums');

  if (hasLegacyDirectories && hasAlbums) {
    throw new Error(
      'Both photo_directories and albums tables exist; resolve the conflicting database schema before opening the app.',
    );
  }

  if (hasLegacyDirectories) {
    db.exec('ALTER TABLE photo_directories RENAME TO albums');
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS albums (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year TEXT NOT NULL,
        batch TEXT NOT NULL,
        group_name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        member_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        hierarchy_json TEXT NOT NULL DEFAULT '[]'
      );
    `);
  }

  if (!tableExists('photos')) {
    db.exec(`
      CREATE TABLE photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        original_path TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        thumbnail_path TEXT,
        album_id INTEGER REFERENCES albums(id),
        file_size INTEGER NOT NULL,
        file_hash TEXT NOT NULL,
        mime_type TEXT,
        created_at TEXT NOT NULL
      );
    `);
    return;
  }

  const photoColumns = db.pragma('table_info(photos)') as Array<{
    name: string;
  }>;
  const columnNames = new Set(photoColumns.map((column) => column.name));
  const albumForeignKeyExists = (
    db.pragma('foreign_key_list(photos)') as Array<{
      from: string;
      table: string;
      to: string;
    }>
  ).some(
    (foreignKey) =>
      foreignKey.from === 'album_id' &&
      foreignKey.table === 'albums' &&
      foreignKey.to === 'id',
  );

  if (
    columnNames.has('album_id') &&
    !columnNames.has('directory_id') &&
    columnNames.has('thumbnail_path') &&
    albumForeignKeyExists
  ) {
    return;
  }

  const albumIdExpression = columnNames.has('album_id')
    ? 'album_id'
    : columnNames.has('directory_id')
      ? 'directory_id'
      : 'NULL';
  const thumbnailPathExpression = columnNames.has('thumbnail_path')
    ? 'thumbnail_path'
    : 'NULL';

  db.exec(`
    CREATE TABLE photos_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_path TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      thumbnail_path TEXT,
      album_id INTEGER REFERENCES albums(id),
      file_size INTEGER NOT NULL,
      file_hash TEXT NOT NULL,
      mime_type TEXT,
      created_at TEXT NOT NULL
    );

    INSERT INTO photos_new (
      id,
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
    SELECT
      id,
      filename,
      original_path,
      storage_path,
      ${thumbnailPathExpression},
      ${albumIdExpression},
      file_size,
      file_hash,
      mime_type,
      created_at
    FROM photos;

    DROP TABLE photos;
    ALTER TABLE photos_new RENAME TO photos;
  `);
});

migrateSchema();
const albumColumns = db.pragma('table_info(albums)') as Array<{
  name: string;
}>;
if (!albumColumns.some((column) => column.name === 'hierarchy_json')) {
  db.exec(
    "ALTER TABLE albums ADD COLUMN hierarchy_json TEXT NOT NULL DEFAULT '[]'",
  );
}
if (!albumColumns.some((column) => column.name === 'member_count')) {
  db.exec(
    'ALTER TABLE albums ADD COLUMN member_count INTEGER NOT NULL DEFAULT 0',
  );
}

const albumsWithEmptyHierarchy = db
  .prepare(
    "SELECT id, year, batch, group_name FROM albums WHERE hierarchy_json = '[]'",
  )
  .all() as Array<{
  id: number;
  year: string;
  batch: string;
  group_name: string;
}>;
const backfillAlbumHierarchy = db.transaction(() => {
  const updateAlbum = db.prepare(
    'UPDATE albums SET hierarchy_json = ? WHERE id = ?',
  );
  for (const album of albumsWithEmptyHierarchy) {
    updateAlbum.run(
      JSON.stringify([
        { label: 'Tahun', value: album.year },
        { label: 'Batch', value: album.batch },
        { label: 'Grup', value: album.group_name },
      ]),
      album.id,
    );
  }
});
backfillAlbumHierarchy();

const albumIndexes = db.pragma('index_list(albums)') as Array<{
  origin: string;
}>;
if (albumIndexes.some((index) => index.origin === 'u')) {
  const rebuildAlbums = db.transaction(() => {
    db.exec(`
      CREATE TABLE albums_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year TEXT NOT NULL,
        batch TEXT NOT NULL,
        group_name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        member_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        hierarchy_json TEXT NOT NULL DEFAULT '[]'
      );

      INSERT INTO albums_new (
        id,
        year,
        batch,
        group_name,
        start_date,
        end_date,
        member_count,
        created_at,
        hierarchy_json
      )
      SELECT
        id,
        year,
        batch,
        group_name,
        start_date,
        end_date,
        member_count,
        created_at,
        hierarchy_json
      FROM albums;

      DROP TABLE albums;
      ALTER TABLE albums_new RENAME TO albums;
    `);
  });
  rebuildAlbums();
}

db.exec('CREATE INDEX IF NOT EXISTS idx_photos_album_id ON photos(album_id)');
if (
  db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_albums_hierarchy_json'",
    )
    .get()
) {
  db.exec('DROP INDEX idx_albums_hierarchy_json');
}
db.exec(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_hierarchy_date ON albums(hierarchy_json, start_date)',
);
db.pragma('foreign_keys = ON');

const foreignKeyErrors = db.pragma('foreign_key_check') as Array<unknown>;
if (foreignKeyErrors.length > 0) {
  throw new Error('Album migration produced invalid photo references.');
}

export default db;
