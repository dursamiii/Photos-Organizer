import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

function App() {
  const [files, setFiles] = useState<string[]>([]);

  async function selectPhotos() {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Images",
          extensions: ["jpg", "jpeg", "png", "webp", "heic"],
        },
      ],
    });

    if (selected) {
      setFiles(Array.isArray(selected) ? selected : [selected]);
    }
  }

  return (
    <main>
      <h1>Photos Organizer</h1>

      <button onClick={selectPhotos}>
        Upload Photos
      </button>

      <div>
        {files.map((file) => (
          <p key={file}>{file}</p>
        ))}
      </div>
    </main>
  );
}

export default App;