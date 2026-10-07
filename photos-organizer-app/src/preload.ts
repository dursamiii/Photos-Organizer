import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  selectPhotos: () => ipcRenderer.invoke("select-photos"),

  readPhoto: (filePath: string) =>
    ipcRenderer.invoke("read-photo", filePath),

  importPhotos: (filePaths: string[]) =>
    ipcRenderer.invoke("import-photos", filePaths),

  getPhotos: () => ipcRenderer.invoke("get-photos"),

  deletePhoto: (photoId: number) =>
  ipcRenderer.invoke("delete-photo", photoId),

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