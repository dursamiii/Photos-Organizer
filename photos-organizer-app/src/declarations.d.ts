/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare module '*.css';

interface Photo {
  id: number;
  album_id: number | null;
  filename: string;
  original_path: string;
  storage_path: string;
  thumbnail_path: string | null;
  file_size: number;
  mime_type: string | null;
  created_at: string;
}

interface PhotoAlbum {
  id: number;
  year: string;
  batch: string;
  group_name: string;
  start_date: string;
  end_date: string;
  created_at: string;
  photo_count: number;
}

interface NewPhotoAlbum {
  year: string;
  batch: string;
  groupName: string;
  startDate: string;
  endDate: string;
}

interface ImportProgress {
  status: 'running' | 'completed';
  total: number;
  completed: number;
  workerCount: number;
  activeFiles: string[];
  imported: number;
  duplicates: number;
  failed: number;
}

interface Window {
  electronAPI: {
    isMacOS: boolean;
    selectPhotos: () => Promise<string[]>;
    selectPhotoFolder: () => Promise<string[]>;
    readPhoto: (filePath: string) => Promise<string>;
    importPhotos: (filePaths: string[], albumId: number) => Promise<string[]>;
    onImportProgress: (
      callback: (progress: ImportProgress) => void,
    ) => () => void;
    getPhotos: (albumId?: number) => Promise<Photo[]>;
    getAlbums: () => Promise<PhotoAlbum[]>;
    createAlbum: (album: NewPhotoAlbum) => Promise<PhotoAlbum>;
    renameAlbum: (albumId: number, groupName: string) => Promise<PhotoAlbum>;
    deleteAlbum: (albumId: number) => Promise<boolean>;
    deletePhoto: (photoId: number) => Promise<boolean>;
    deleteAllPhotos: () => Promise<number>;
    enginePing: () => Promise<{
      success: boolean;
      message?: string;
    }>;
    generateThumbnail: (
      inputPath: string,
      outputPath: string,
      maxSize?: number,
    ) => Promise<{
      id: string;
      success: boolean;
      input?: string;
      output?: string;
      width?: number;
      height?: number;
      error?: string;
    }>;
  };
}
