import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isMacOS: process.platform === 'darwin',

  selectPhotos: () => ipcRenderer.invoke('select-photos'),

  selectPhotoFolder: () => ipcRenderer.invoke('select-photo-folder'),

  readPhoto: (filePath: string) => ipcRenderer.invoke('read-photo', filePath),

  importPhotos: (filePaths: string[], albumId: number) =>
    ipcRenderer.invoke('import-photos', filePaths, albumId),

  onImportProgress: (callback: (progress: ImportProgress) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: ImportProgress,
    ) => callback(progress);

    ipcRenderer.on('import-progress', listener);
    return () => ipcRenderer.removeListener('import-progress', listener);
  },

  getPhotos: (albumId?: number) => ipcRenderer.invoke('get-photos', albumId),

  getAlbums: () => ipcRenderer.invoke('get-albums'),

  getAlbumSettings: () => ipcRenderer.invoke('get-album-settings'),

  saveAlbumSettings: (settings: AlbumSettings) =>
    ipcRenderer.invoke('save-album-settings', settings),

  createAlbum: (album: NewPhotoAlbum) =>
    ipcRenderer.invoke('create-album', album),

  renameAlbum: (albumId: number, groupName: string) =>
    ipcRenderer.invoke('rename-album', albumId, groupName),

  deleteAlbum: (albumId: number) => ipcRenderer.invoke('delete-album', albumId),

  deletePhoto: (photoId: number) => ipcRenderer.invoke('delete-photo', photoId),

  deleteAllPhotos: () => ipcRenderer.invoke('delete-all-photos'),

  enginePing: () => ipcRenderer.invoke('engine-ping'),

  generateThumbnail: (
    inputPath: string,
    outputPath: string,
    maxSize?: number,
  ) => ipcRenderer.invoke('generate-thumbnail', inputPath, outputPath, maxSize),
});
