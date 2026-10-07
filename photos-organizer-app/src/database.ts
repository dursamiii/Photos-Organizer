import Database from "better-sqlite3";
import { app } from "electron";
import path from "node:path";

const databasePath = path.join(
  app.getPath("userData"),
  "photos-organizer.db"
);

const db = new Database(databasePath);

db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_path TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    thumbnail_path TEXT,
    file_size INTEGER NOT NULL,
    file_hash TEXT NOT NULL,
    mime_type TEXT,
    created_at TEXT NOT NULL
  );
`);

const photoColumns = db.pragma("table_info(photos)") as Array<{
  name: string;
}>;

if (!photoColumns.some((column) => column.name === "thumbnail_path")) {
  db.exec("ALTER TABLE photos ADD COLUMN thumbnail_path TEXT");
}

export default db;