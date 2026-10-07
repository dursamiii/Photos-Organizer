import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  isDevelopment: () => ipcRenderer.invoke("is-development"),

  selectPhotos: () => ipcRenderer.invoke("select-photos"),

  selectPhotoFolder: () => ipcRenderer.invoke("select-photo-folder"),

  readPhoto: (filePath: string) =>
    ipcRenderer.invoke("read-photo", filePath),

  importPhotos: (filePaths: string[]) =>
    ipcRenderer.invoke("import-photos", filePaths),

  onImportProgress: (callback: (progress: ImportProgress) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: ImportProgress,
    ) => callback(progress);

    ipcRenderer.on("import-progress", listener);
    return () => ipcRenderer.removeListener("import-progress", listener);
  },

  getPhotos: () => ipcRenderer.invoke("get-photos"),

  deletePhoto: (photoId: number) =>
  ipcRenderer.invoke("delete-photo", photoId),

  deleteAllPhotos: () => ipcRenderer.invoke("delete-all-photos"),

  enginePing: () =>
  ipcRenderer.invoke("engine-ping"),

  generateThumbnail: (
    inputPath: string,
    outputPath: string,
    maxSize?: number
    ) =>
    ipcRenderer.invoke(
        "generate-thumbnail",
        inputPath,
        outputPath,
        maxSize
    ),
});