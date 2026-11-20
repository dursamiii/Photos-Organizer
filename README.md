# Photos Organizer

A desktop app for organizing photo collection built with Electron. (under development)

![gallery preview](./preview/home.png)

![image preview](./preview/gallery.png)

## Features

- Import photos and detect duplicates using SHA-256
- Store managed copies inside the app
- Generate thumbnails automatically
- Organize photos into albums and manage metadata
- Delete app copies without deleting original files

## Tech stack

- Electron
- React + TypeScript
- SQLite (`better-sqlite3`)
- Python
- `pyvips` + `libvips`

## Run locally

```bash
npm install
npm start
```

Electron starts and manages the Python engine automatically.
