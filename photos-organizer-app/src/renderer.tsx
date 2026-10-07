import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

interface PhotoWithThumbnail extends Photo {
  thumbnail: string;
}

function App() {
  // State to hold the list of photos with their thumbnails
  const [photos, setPhotos] = useState<PhotoWithThumbnail[]>([]);

  // Function to load photos from the database and read their thumbnails
  const loadPhotos = async () => {
    const savedPhotos = await window.electronAPI.getPhotos();

    const photosWithThumbnails = await Promise.all(
      savedPhotos.map(async (photo) => {
        const thumbnail = await window.electronAPI.readPhoto(
          photo.storage_path
        );

        return {
          ...photo,
          thumbnail,
        };
      })
    );

    setPhotos(photosWithThumbnails);
  };

  // Handler for selecting and importing photos
  const handleSelectPhotos = async () => {
    const selectedPhotos = await window.electronAPI.selectPhotos();

    if (selectedPhotos.length === 0) {
      return;
    }

    await window.electronAPI.importPhotos(selectedPhotos);

    await loadPhotos();
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

  // Load photos when the component mounts
  useEffect(() => {
    loadPhotos();
  }, []);

  return (
    <main>
      <h1>Photos Organizer</h1>
      <button
        onClick={async () => {
          const result = await window.electronAPI.enginePing();

          console.log("Engine response:", result);
        }}
      >
        Test Python Engine
      </button>
      <button onClick={handleTestThumbnail}>
        Test Thumbnail
      </button>
      <button onClick={handleSelectPhotos}>
        Tambah Foto
      </button>

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