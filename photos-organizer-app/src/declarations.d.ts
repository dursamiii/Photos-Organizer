/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare module '*.css';


interface Photo {
  id: number;
  filename: string;
  original_path: string;
  storage_path: string;
  thumbnail_path: string | null;
  file_size: number;
  mime_type: string | null;
  created_at: string;
}

interface ImportProgress {
  status: "running" | "completed";
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
    isDevelopment: () => Promise<boolean>;
    selectPhotos: () => Promise<string[]>;
    selectPhotoFolder: () => Promise<string[]>;
    readPhoto: (filePath: string) => Promise<string>;
    importPhotos: (filePaths: string[]) => Promise<string[]>;
    onImportProgress: (
      callback: (progress: ImportProgress) => void,
    ) => () => void;
    getPhotos: () => Promise<Photo[]>;
    deletePhoto: (photoId: number) => Promise<boolean>;
    deleteAllPhotos: () => Promise<number>;
    enginePing: () => Promise<{
    success: boolean;
    message?: string;
    }>;
    generateThumbnail: (
    inputPath: string,
    outputPath: string,
    maxSize?: number
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
