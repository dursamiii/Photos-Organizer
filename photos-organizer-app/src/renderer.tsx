import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

interface PhotoWithThumbnail extends Photo {
  thumbnail: string;
}

function App() {
  // State to hold the list of photos with their thumbnails
  const [photos, setPhotos] = useState<PhotoWithThumbnail[]>([]);
  const [isDevelopment, setIsDevelopment] = useState(false);
  const [importProgress, setImportProgress] =
    useState<ImportProgress | null>(null);

  // Function to load photos from the database and read their thumbnails
  const loadPhotos = async () => {
    const savedPhotos = await window.electronAPI.getPhotos();

    const photosWithThumbnails = await Promise.all(
      savedPhotos.map(async (photo): Promise<PhotoWithThumbnail | null> => {
        try {
          const thumbnail = await window.electronAPI.readPhoto(
            photo.thumbnail_path ?? photo.storage_path,
          );

          return { ...photo, thumbnail };
        } catch (thumbnailError) {
          if (photo.thumbnail_path) {
            try {
              const original = await window.electronAPI.readPhoto(
                photo.storage_path,
              );

              console.warn(
                `Thumbnail unavailable for "${photo.filename}", showing original instead.`,
                thumbnailError,
              );
              return { ...photo, thumbnail: original };
            } catch (originalError) {
              console.error(
                `Unable to load photo "${photo.filename}".`,
                originalError,
              );
              return null;
            }
          }

          console.error(
            `Unable to load photo "${photo.filename}".`,
            thumbnailError,
          );
          return null;
        }
      }),
    );

    setPhotos(
      photosWithThumbnails.filter(
        (photo): photo is PhotoWithThumbnail => photo !== null,
      ),
    );
  };

  // Handler for selecting and importing photos
  const handleSelectPhotos = async () => {
    const selectedPhotos = await window.electronAPI.selectPhotos();

    if (selectedPhotos.length === 0) {
      return;
    }

    await runImport(selectedPhotos);
  };

  const handleSelectPhotoFolder = async () => {
    const selectedPhotos = await window.electronAPI.selectPhotoFolder();

    if (selectedPhotos.length === 0) {
      return;
    }

    await runImport(selectedPhotos);
  };

  const handleDeletePhoto = async (photoId: number) => {
    const confirmed = window.confirm(
      "Hapus foto ini dari Photos Organizer?"
    );

    if (!confirmed) {
      return;
    }

    await window.electronAPI.deletePhoto(photoId);

    await loadPhotos();
  };

  const handleDeleteAllPhotos = async () => {
    const confirmed = window.confirm(
      "Hapus semua foto yang diimpor beserta thumbnail dari Photos Organizer? File sumber asli tidak dihapus.",
    );

    if (!confirmed) {
      return;
    }

    try {
      const deletedCount = await window.electronAPI.deleteAllPhotos();
      await loadPhotos();
      window.alert(`${deletedCount} foto berhasil dihapus.`);
    } catch (error) {
      console.error("Failed to delete all imported photos.", error);
      window.alert(
        `Gagal menghapus semua foto: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  /*
  // Handler for testing the thumbnail generation
  const handleTestThumbnail = async () => {
    const selectedPhotos = await window.electronAPI.selectPhotos();

    if (selectedPhotos.length === 0) {
      return;
    }

    const inputPath = selectedPhotos[0];

    const outputPath =
      inputPath.replace(/\.[^/.]+$/, "") +
      "-thumbnail.jpg";

    const result =
      await window.electronAPI.generateThumbnail(
        inputPath,
        outputPath,
        500
      );

    console.log("Thumbnail result:", result);
  };
  */

  // Load photos when the component mounts
  useEffect(() => {
    const unsubscribe = window.electronAPI.onImportProgress((progress) => {
      setImportProgress(progress);
    });

    window.electronAPI.isDevelopment().then(setIsDevelopment);
    loadPhotos();

    return unsubscribe;
  }, []);

  async function runImport(filePaths: string[]) {
    if (filePaths.length === 0) {
      return;
    }

    setImportProgress({
      status: "running",
      total: filePaths.length,
      completed: 0,
      workerCount: Math.min(4, filePaths.length),
      activeFiles: [],
      imported: 0,
      duplicates: 0,
      failed: 0,
    });

    try {
      await window.electronAPI.importPhotos(filePaths);
      await loadPhotos();
    } finally {
      setImportProgress(null);
    }
  };

  return (
    <main>
      <h1>Photos Organizer</h1>
      {/* Tombol tes engine disimpan untuk debugging nanti.
      <button
        onClick={async () => {
          const result = await window.electronAPI.enginePing();

          console.log("Engine response:", result);
        }}
      >
        Test Python Engine
      </button>
      */}
      {/* Tombol tes thumbnail disimpan untuk debugging nanti.
      <button onClick={handleTestThumbnail}>
        Test Thumbnail
      </button>
      */}
      <button
        disabled={importProgress?.status === "running"}
        onClick={handleSelectPhotos}
      >
        Tambah Foto
      </button>
      <button
        disabled={importProgress?.status === "running"}
        onClick={handleSelectPhotoFolder}
      >
        Import dari Folder
      </button>
      {isDevelopment && (
        <button
          disabled={importProgress?.status === "running"}
          onClick={handleDeleteAllPhotos}
        >
          Hapus Semua (Dev)
        </button>
      )}

      {importProgress?.status === "running" && (
        <section className="import-progress" aria-live="polite" role="status">
          <div className="import-progress-heading">
            <span className="import-spinner" aria-hidden="true" />
            <strong>Mengimpor foto</strong>
          </div>
          <p className="import-progress-summary">
            {importProgress.completed} / {importProgress.total} foto
            {" · "}
            {importProgress.workerCount} worker
          </p>
          <progress
            aria-label="Progres import foto"
            value={importProgress.completed}
            max={importProgress.total}
          />
        </section>
      )}

      <p>{photos.length} foto</p>

      <div className="gallery">
        {photos.map((photo) => (
          <div className="photo-card" key={photo.id}>
            <img
              src={photo.thumbnail}
              alt={photo.filename}
            />

            <p>{photo.filename}</p>
            <button onClick={() => handleDeletePhoto(photo.id)}>
              Hapus
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);

root.render(<App />);