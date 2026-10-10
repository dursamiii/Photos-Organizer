import { ipcMain } from 'electron';
import db from './database';

const settingsKey = 'album-settings';
const defaultSettings: AlbumSettings = {
  hierarchyLabels: ['Tahun', 'Nama Paket', 'Grup'],
  nameByDepartureDate: false,
};

export function getAlbumSettings(): AlbumSettings {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(settingsKey) as { value: string } | undefined;

  if (!row) {
    return defaultSettings;
  }

  let settings: AlbumSettings;
  try {
    settings = JSON.parse(row.value) as AlbumSettings;
  } catch (error) {
    throw new Error('Pengaturan album tersimpan tidak valid.', {
      cause: error,
    });
  }

  try {
    return normalizeSettings(settings);
  } catch (error) {
    throw new Error('Pengaturan album tersimpan tidak valid.', {
      cause: error,
    });
  }
}

function normalizeSettings(settings: AlbumSettings): AlbumSettings {
  if (
    !settings ||
    !Array.isArray(settings.hierarchyLabels) ||
    typeof settings.nameByDepartureDate !== 'boolean'
  ) {
    throw new Error('Pengaturan album tidak valid.');
  }

  const hierarchyLabels = settings.hierarchyLabels.map((label) => {
    if (typeof label !== 'string') {
      throw new Error('Nama level harus berupa teks.');
    }
    return label.trim();
  });
  hierarchyLabels[0] = 'Tahun';
  const normalizedNames = hierarchyLabels.map((label) =>
    label.toLocaleLowerCase(),
  );

  if (
    hierarchyLabels.length < 2 ||
    hierarchyLabels.length > 10 ||
    hierarchyLabels.some((label) => !label || label.length > 40) ||
    new Set(normalizedNames).size !== normalizedNames.length
  ) {
    throw new Error(
      'Gunakan 2 sampai 10 nama level yang unik (maksimal 40 karakter).',
    );
  }

  return {
    hierarchyLabels,
    nameByDepartureDate: settings.nameByDepartureDate,
  };
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('get-album-settings', () => getAlbumSettings());
  ipcMain.handle(
    'save-album-settings',
    (_event, settings: AlbumSettings): AlbumSettings => {
      const normalizedSettings = normalizeSettings(settings);
      db.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).run(settingsKey, JSON.stringify(normalizedSettings));
      return normalizedSettings;
    },
  );
}
