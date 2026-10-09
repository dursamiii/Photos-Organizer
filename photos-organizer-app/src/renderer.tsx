import {
  FormEvent,
  MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import './style/index.css';

interface PhotoWithThumbnail extends Photo {
  thumbnail: string;
}

type ContextMenuState =
  | { kind: 'album'; album: PhotoAlbum; x: number; y: number }
  | { kind: 'photo'; photo: PhotoWithThumbnail; x: number; y: number };

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 12 }, (_, index) =>
  String(currentYear - index),
);
const batchOptions = Array.from(
  { length: 12 },
  (_, index) => `Batch ${index + 1}`,
);
const groupOptions = Array.from(
  { length: 20 },
  (_, index) => `Group ${index + 1}`,
);
const deleteHoldDurationMs = 4000;
const deleteConfirmFadeDurationMs = 180;

function App() {
  const [albums, setAlbums] = useState<PhotoAlbum[]>([]);
  const [photos, setPhotos] = useState<PhotoWithThumbnail[]>([]);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null,
  );
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [isDeleteAllConfirmOpen, setIsDeleteAllConfirmOpen] = useState(false);
  const [isDeleteAllConfirmClosing, setIsDeleteAllConfirmClosing] =
    useState(false);
  const [isHoldingDelete, setIsHoldingDelete] = useState(false);
  const deleteHoldActive = useRef(false);
  const deleteHoldStartedAt = useRef(0);
  const deleteHoldProgress = useRef(0);
  const deleteHoldFrame = useRef<number | null>(null);
  const holdDeleteButton = useRef<HTMLButtonElement | null>(null);
  const holdDeleteSvg = useRef<SVGSVGElement | null>(null);
  const holdDeletePath = useRef<SVGPathElement | null>(null);
  const holdDeleteReverseStartedAt = useRef(0);
  const deleteConfirmCloseTimeout = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const selectionAnchorId = useRef<number | null>(null);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [hoveredPhotoId, setHoveredPhotoId] = useState<number | null>(null);
  const [collapsedYears, setCollapsedYears] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedCity, setSelectedCity] = useState('Semua kota');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingAlbum, setRenamingAlbum] = useState<PhotoAlbum | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [formValues, setFormValues] = useState({
    year: String(currentYear),
    batch: batchOptions[0],
    group: groupOptions[0],
    startDate: '',
    endDate: '',
  });

  const selectedAlbum = albums.find((album) => album.id === selectedAlbumId);
  const shiftPreviewPhotoIds = new Set<number>();
  if (isShiftPressed && hoveredPhotoId !== null) {
    const anchorIndex = photos.findIndex(
      (photo) => photo.id === selectionAnchorId.current,
    );
    const hoveredIndex = photos.findIndex(
      (photo) => photo.id === hoveredPhotoId,
    );
    if (hoveredIndex !== -1 && anchorIndex === -1) {
      const hoveredPhoto = photos[hoveredIndex];
      if (!selectedPhotoIds.has(hoveredPhoto.id)) {
        shiftPreviewPhotoIds.add(hoveredPhoto.id);
      }
    } else if (anchorIndex !== -1 && hoveredIndex !== -1) {
      for (
        let index = Math.min(anchorIndex, hoveredIndex);
        index <= Math.max(anchorIndex, hoveredIndex);
        index += 1
      ) {
        const photo = photos[index];
        if (!selectedPhotoIds.has(photo.id)) {
          shiftPreviewPhotoIds.add(photo.id);
        }
      }
    }
  }
  const years = [...new Set(albums.map((album) => album.year))].sort(
    (left, right) => Number(left) - Number(right),
  );

  const openCreateModal = () => {
    setFormError('');
    setIsCreateModalOpen(true);
  };

  const loadPhotos = async (albumId: number) => {
    const savedPhotos = await window.electronAPI.getPhotos(albumId);
    const withThumbnails = await Promise.all(
      savedPhotos.map(async (photo): Promise<PhotoWithThumbnail | null> => {
        try {
          return {
            ...photo,
            thumbnail: await window.electronAPI.readPhoto(
              photo.thumbnail_path ?? photo.storage_path,
            ),
          };
        } catch (thumbnailError) {
          if (photo.thumbnail_path) {
            try {
              return {
                ...photo,
                thumbnail: await window.electronAPI.readPhoto(
                  photo.storage_path,
                ),
              };
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
      withThumbnails.filter(
        (photo): photo is PhotoWithThumbnail => photo !== null,
      ),
    );
  };

  useEffect(() => {
    const unsubscribe = window.electronAPI.onImportProgress(setImportProgress);

    window.electronAPI
      .getAlbums()
      .then((savedAlbums) => {
        setAlbums(savedAlbums);
        if (savedAlbums.length > 0) {
          setSelectedAlbumId(savedAlbums[0].id);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load albums.', error);
      });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (selectedAlbumId === null) {
      setPhotos([]);
      setSelectedPhotoIds(new Set());
      selectionAnchorId.current = null;
      return;
    }

    setSelectedPhotoIds(new Set());
    selectionAnchorId.current = null;
    loadPhotos(selectedAlbumId).catch((error: unknown) => {
      console.error('Failed to load photos for the selected album.', error);
      setPhotos([]);
    });
  }, [selectedAlbumId]);

  const togglePhotoSelection = (photoId: number, updateAnchor = true) => {
    if (updateAnchor) {
      selectionAnchorId.current = photoId;
    }
    setSelectedPhotoIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  const selectPhoto = (photoId: number) => {
    selectionAnchorId.current = photoId;
    setSelectedPhotoIds((current) => new Set(current).add(photoId));
  };

  const selectPhotoRange = (photoId: number) => {
    const anchorIndex = photos.findIndex(
      (photo) => photo.id === selectionAnchorId.current,
    );
    const targetIndex = photos.findIndex((photo) => photo.id === photoId);
    if (anchorIndex === -1 || targetIndex === -1) {
      selectPhoto(photoId);
      return;
    }

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    setSelectedPhotoIds((current) => {
      const next = new Set(current);
      for (const photo of photos.slice(start, end + 1)) {
        next.add(photo.id);
      }
      return next;
    });
  };

  const handlePhotoClick = (
    event: ReactMouseEvent<HTMLElement>,
    photoId: number,
  ) => {
    if (event.shiftKey) {
      selectPhotoRange(photoId);
    } else if (event.metaKey || event.ctrlKey || selectedPhotoIds.size > 0) {
      togglePhotoSelection(photoId);
    }
  };

  const clearPhotoSelection = () => {
    selectionAnchorId.current = null;
    setSelectedPhotoIds(new Set());
  };

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const dismissMenu = () => {
      setContextMenu(null);
    };
    const dismissOnOutsideClick = (event: globalThis.MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-context-menu]')
      ) {
        return;
      }
      setContextMenu(null);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    document.addEventListener('mousedown', dismissOnOutsideClick);
    document.addEventListener('keydown', dismissOnEscape);
    window.addEventListener('blur', dismissMenu);
    window.addEventListener('resize', dismissMenu);
    return () => {
      document.removeEventListener('mousedown', dismissOnOutsideClick);
      document.removeEventListener('keydown', dismissOnEscape);
      window.removeEventListener('blur', dismissMenu);
      window.removeEventListener('resize', dismissMenu);
    };
  }, [contextMenu]);

  useEffect(() => {
    const updateShiftState = (event: KeyboardEvent) => {
      setIsShiftPressed(event.shiftKey);
    };
    const clearShiftState = () => setIsShiftPressed(false);

    window.addEventListener('keydown', updateShiftState);
    window.addEventListener('keyup', updateShiftState);
    window.addEventListener('blur', clearShiftState);
    return () => {
      window.removeEventListener('keydown', updateShiftState);
      window.removeEventListener('keyup', updateShiftState);
      window.removeEventListener('blur', clearShiftState);
    };
  }, []);

  function openContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    target: 'album',
    item: PhotoAlbum,
  ): void;
  function openContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    target: 'photo',
    item: PhotoWithThumbnail,
  ): void;
  function openContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    target: ContextMenuState['kind'],
    item: PhotoAlbum | PhotoWithThumbnail,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 200;
    const menuHeight = target === 'album' ? 104 : 90;
    const position = {
      x: Math.max(
        8,
        Math.min(event.clientX, window.innerWidth - menuWidth - 8),
      ),
      y: Math.max(
        8,
        Math.min(event.clientY, window.innerHeight - menuHeight - 8),
      ),
    };

    if (target === 'album' && !('thumbnail' in item)) {
      setContextMenu({ kind: 'album', album: item, ...position });
    } else if (target === 'photo' && 'thumbnail' in item) {
      setContextMenu({ kind: 'photo', photo: item, ...position });
    }
  }

  const createAlbum = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (formValues.endDate < formValues.startDate) {
      setFormError('Tanggal akhir harus sama atau setelah tanggal awal.');
      return;
    }

    try {
      const album = await window.electronAPI.createAlbum({
        year: formValues.year,
        batch: formValues.batch,
        groupName: formValues.group,
        startDate: formValues.startDate,
        endDate: formValues.endDate,
      });
      setAlbums((current) => [...current, album]);
      setSelectedAlbumId(album.id);
      setCollapsedYears((current) => {
        const next = new Set(current);
        next.delete(album.year);
        return next;
      });
      setCollapsedBatches((current) => {
        const next = new Set(current);
        next.delete(`${album.year}:${album.batch}`);
        return next;
      });
      setIsCreateModalOpen(false);
      setFormError('');
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Album gagal dibuat. Coba lagi.',
      );
    }
  };

  const renameAlbum = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renamingAlbum) {
      return;
    }

    try {
      const updatedAlbum = await window.electronAPI.renameAlbum(
        renamingAlbum.id,
        renameValue,
      );
      setAlbums((current) =>
        current.map((album) =>
          album.id === updatedAlbum.id ? updatedAlbum : album,
        ),
      );
      setRenamingAlbum(null);
      setRenameError('');
    } catch (error) {
      setRenameError(
        error instanceof Error ? error.message : 'Nama album gagal diubah.',
      );
    }
  };

  const deleteAlbum = async (album: PhotoAlbum) => {
    if (album.photo_count > 0) {
      return;
    }
    if (!window.confirm(`Hapus album "${album.group_name}"?`)) {
      return;
    }

    try {
      await window.electronAPI.deleteAlbum(album.id);
      setAlbums((current) => current.filter((item) => item.id !== album.id));
      setSelectedAlbumId((current) => {
        if (current !== album.id) {
          return current;
        }
        return albums.find((item) => item.id !== album.id)?.id ?? null;
      });
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : 'Album gagal dihapus.',
      );
    }
  };

  const deletePhoto = async (photo: PhotoWithThumbnail) => {
    if (
      !window.confirm(
        `Hapus "${photo.filename}" dari Kilas? Foto asli tidak akan dihapus.`,
      )
    ) {
      return;
    }

    try {
      await window.electronAPI.deletePhoto(photo.id);
      setPhotos((current) => current.filter((item) => item.id !== photo.id));
      setSelectedPhotoIds((current) => {
        const next = new Set(current);
        next.delete(photo.id);
        return next;
      });
      setAlbums((current) =>
        current.map((album) =>
          album.id === photo.album_id
            ? {
                ...album,
                photo_count: Math.max(0, album.photo_count - 1),
              }
            : album,
        ),
      );
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : 'Foto gagal dihapus.',
      );
    }
  };

  const deleteSelectedPhotos = async (confirmedAll = false) => {
    const selectedPhotos = photos.filter((photo) =>
      selectedPhotoIds.has(photo.id),
    );
    if (selectedPhotos.length === 0) {
      clearPhotoSelection();
      return;
    }

    const isDeletingAllPhotos =
      selectedPhotos.length === photos.length &&
      selectedPhotoIds.size === photos.length &&
      photos.every((photo) => selectedPhotoIds.has(photo.id));

    if (isDeletingAllPhotos && !confirmedAll) {
      if (deleteConfirmCloseTimeout.current !== null) {
        clearTimeout(deleteConfirmCloseTimeout.current);
        deleteConfirmCloseTimeout.current = null;
      }
      setIsDeleteAllConfirmClosing(false);
      setIsDeleteAllConfirmOpen(true);
      return;
    }
    if (confirmedAll && !isDeletingAllPhotos) {
      return;
    }
    if (
      !isDeletingAllPhotos &&
      !window.confirm(
        `Hapus ${selectedPhotos.length} foto terpilih dari Kilas? Foto asli tidak akan dihapus.`,
      )
    ) {
      return;
    }

    const results = await Promise.allSettled(
      selectedPhotos.map((photo) => window.electronAPI.deletePhoto(photo.id)),
    );
    const deletedPhotos = selectedPhotos.filter(
      (_, index) => results[index].status === 'fulfilled',
    );
    const failedCount = selectedPhotos.length - deletedPhotos.length;

    setPhotos((current) =>
      current.filter(
        (photo) => !deletedPhotos.some((deleted) => deleted.id === photo.id),
      ),
    );
    setAlbums((current) =>
      current.map((album) => ({
        ...album,
        photo_count: Math.max(
          0,
          album.photo_count -
            deletedPhotos.filter((photo) => photo.album_id === album.id).length,
        ),
      })),
    );
    setSelectedPhotoIds(
      new Set(
        selectedPhotos
          .filter((_, index) => results[index].status === 'rejected')
          .map((photo) => photo.id),
      ),
    );
    selectionAnchorId.current = null;

    if (failedCount > 0) {
      window.alert(
        `${deletedPhotos.length} foto berhasil dihapus, ${failedCount} foto gagal dihapus.`,
      );
    }
  };

  const cancelDeleteHold = () => {
    if (!deleteHoldActive.current) {
      return;
    }
    deleteHoldActive.current = false;
    setIsHoldingDelete(false);
    if (deleteHoldFrame.current !== null) {
      cancelAnimationFrame(deleteHoldFrame.current);
    }

    const progressAtRelease = deleteHoldProgress.current;
    const returnStartedAt = performance.now();
    holdDeleteReverseStartedAt.current = returnStartedAt;
    const returnProgress = (now: number) => {
      const elapsed = now - holdDeleteReverseStartedAt.current;
      const duration = 260;
      const amount = Math.min(elapsed / duration, 1);
      const easedAmount = 1 - (1 - amount) ** 3;
      deleteHoldProgress.current = progressAtRelease * (1 - easedAmount);
      if (holdDeletePath.current) {
        holdDeletePath.current.style.strokeDashoffset = String(
          1 - deleteHoldProgress.current,
        );
      }

      if (amount < 1) {
        deleteHoldFrame.current = requestAnimationFrame(returnProgress);
      } else {
        deleteHoldProgress.current = 0;
        deleteHoldFrame.current = null;
        if (holdDeletePath.current) {
          holdDeletePath.current.style.strokeDashoffset = '1';
        }
      }
    };

    deleteHoldFrame.current = requestAnimationFrame(returnProgress);
  };

  const closeDeleteAllConfirm = () => {
    cancelDeleteHold();
    if (
      isDeleteAllConfirmClosing ||
      deleteConfirmCloseTimeout.current !== null
    ) {
      return;
    }
    setIsDeleteAllConfirmClosing(true);
    deleteConfirmCloseTimeout.current = setTimeout(() => {
      deleteConfirmCloseTimeout.current = null;
      setIsDeleteAllConfirmOpen(false);
      setIsDeleteAllConfirmClosing(false);
    }, deleteConfirmFadeDurationMs);
  };

  const startDeleteHold = () => {
    if (deleteHoldActive.current) {
      return;
    }

    if (deleteHoldFrame.current !== null) {
      cancelAnimationFrame(deleteHoldFrame.current);
      deleteHoldFrame.current = null;
    }

    const buttonBounds = holdDeleteButton.current?.getBoundingClientRect();
    const svg = holdDeleteSvg.current;
    const path = holdDeletePath.current;
    if (!buttonBounds || !svg || !path) {
      return;
    }

    const width = buttonBounds.width;
    const height = buttonBounds.height;
    const radius = Math.min(9, (height - 2) / 2, (width - 2) / 2);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    path.setAttribute(
      'd',
      [
        `M ${width / 2} 1`,
        `H ${width - radius - 1}`,
        `Q ${width - 1} 1 ${width - 1} ${radius + 1}`,
        `V ${height - radius - 1}`,
        `Q ${width - 1} ${height - 1} ${width - radius - 1} ${height - 1}`,
        `H ${radius + 1}`,
        `Q 1 ${height - 1} 1 ${height - radius - 1}`,
        `V ${radius + 1}`,
        `Q 1 1 ${radius + 1} 1`,
        `H ${width / 2}`,
      ].join(' '),
    );
    path.style.strokeDashoffset = '1';
    deleteHoldProgress.current = 0;
    deleteHoldStartedAt.current = performance.now();
    deleteHoldActive.current = true;
    setIsHoldingDelete(true);

    const updateHoldProgress = (now: number) => {
      const elapsed = now - deleteHoldStartedAt.current;
      const amount = Math.min(elapsed / deleteHoldDurationMs, 1);
      const finalSegmentProgress = (amount - 0.9) / 0.1;
      const easedAmount =
        amount <= 0.9
          ? amount
          : 0.9 +
            0.1 *
              (finalSegmentProgress +
                finalSegmentProgress ** 2 -
                finalSegmentProgress ** 3);
      deleteHoldProgress.current = easedAmount;
      if (holdDeletePath.current) {
        holdDeletePath.current.style.strokeDashoffset = String(1 - easedAmount);
      }

      if (amount < 1) {
        deleteHoldFrame.current = requestAnimationFrame(updateHoldProgress);
        return;
      }

      deleteHoldFrame.current = null;
      deleteHoldActive.current = false;
      setIsHoldingDelete(false);
      closeDeleteAllConfirm();
      void deleteSelectedPhotos(true);
    };

    deleteHoldFrame.current = requestAnimationFrame(updateHoldProgress);
  };

  useEffect(() => {
    const handleSelectionShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditingText =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest('input, textarea, select, [contenteditable="true"]'));

      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'a' &&
        !isEditingText &&
        !contextMenu &&
        !renamingAlbum &&
        !isCreateModalOpen &&
        !isDeleteAllConfirmOpen
      ) {
        if (photos.length === 0) {
          return;
        }
        event.preventDefault();
        selectionAnchorId.current = photos[0].id;
        setSelectedPhotoIds(new Set(photos.map((photo) => photo.id)));
        return;
      }

      if (event.key === 'Escape') {
        if (isDeleteAllConfirmOpen) {
          event.preventDefault();
          closeDeleteAllConfirm();
          return;
        }
        if (!contextMenu) {
          clearPhotoSelection();
        }
        return;
      }

      if (
        (event.key !== 'Delete' && event.key !== 'Backspace') ||
        selectedPhotoIds.size === 0
      ) {
        return;
      }
      if (isEditingText) {
        return;
      }

      event.preventDefault();
      void deleteSelectedPhotos();
    };

    document.addEventListener('keydown', handleSelectionShortcut);
    return () =>
      document.removeEventListener('keydown', handleSelectionShortcut);
  }, [
    selectedPhotoIds,
    photos,
    contextMenu,
    renamingAlbum,
    isCreateModalOpen,
    isDeleteAllConfirmOpen,
  ]);

  useEffect(
    () => () => {
      if (deleteHoldFrame.current !== null) {
        cancelAnimationFrame(deleteHoldFrame.current);
      }
      if (deleteConfirmCloseTimeout.current !== null) {
        clearTimeout(deleteConfirmCloseTimeout.current);
      }
    },
    [],
  );

  const toggleYear = (year: string) => {
    setCollapsedYears((current) => {
      const next = new Set(current);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  };

  const toggleBatch = (batchKey: string) => {
    setCollapsedBatches((current) => {
      const next = new Set(current);
      if (next.has(batchKey)) {
        next.delete(batchKey);
      } else {
        next.add(batchKey);
      }
      return next;
    });
  };

  const updateForm = (field: keyof typeof formValues, value: string) => {
    setFormValues((current) => ({ ...current, [field]: value }));
  };

  const uploadToSelectedAlbum = async () => {
    if (!selectedAlbum) {
      return;
    }

    const filePaths = await window.electronAPI.selectPhotos();
    if (filePaths.length === 0) {
      return;
    }

    try {
      await window.electronAPI.importPhotos(filePaths, selectedAlbum.id);
      await loadPhotos(selectedAlbum.id);
      setAlbums(await window.electronAPI.getAlbums());
    } catch (error) {
      console.error('Failed to upload photos to the selected album.', error);
      window.alert(
        error instanceof Error ? error.message : 'Upload foto gagal.',
      );
    }
  };

  return (
    <div
      className={
        window.electronAPI.isMacOS ? 'app-shell app-shell--macos' : 'app-shell'
      }
    >
      <aside className="sidebar">
        <div className="brand">Kilas</div>

        <div className="sidebar-section-heading">
          <span>Album</span>
          <button
            className="icon-button add-album-button"
            type="button"
            aria-label="Buat album"
            title="Buat album"
            onClick={openCreateModal}
          >
            +
          </button>
        </div>

        {albums.length === 0 ? (
          <div className="sidebar-empty">
            <span className="sidebar-empty-icon" aria-hidden="true">
              ▱
            </span>
            <p>Belum ada album</p>
            <button
              className="text-button"
              type="button"
              onClick={openCreateModal}
            >
              Buat album pertama
            </button>
          </div>
        ) : (
          <nav className="album-tree" aria-label="Album foto">
            {years.map((year) => {
              const batches = [
                ...new Set(
                  albums
                    .filter((album) => album.year === year)
                    .map((album) => album.batch),
                ),
              ].sort((left, right) =>
                left.localeCompare(right, undefined, { numeric: true }),
              );
              const isYearExpanded = !collapsedYears.has(year);

              return (
                <section className="tree-year" key={year}>
                  <button
                    className="tree-parent tree-year-button"
                    type="button"
                    aria-expanded={isYearExpanded}
                    onClick={() => toggleYear(year)}
                  >
                    <span
                      className={`tree-chevron${isYearExpanded ? ' is-expanded' : ''}`}
                      aria-hidden="true"
                    >
                      ⌄
                    </span>
                    <span className="tree-icon" aria-hidden="true">
                      ▱
                    </span>
                    <span>{year}</span>
                  </button>
                  {isYearExpanded &&
                    batches.map((batch) => {
                      const batchKey = `${year}:${batch}`;
                      const isBatchExpanded = !collapsedBatches.has(batchKey);
                      const batchAlbums = albums.filter(
                        (album) => album.year === year && album.batch === batch,
                      );

                      return (
                        <div className="tree-batch" key={batchKey}>
                          <button
                            className="tree-parent tree-batch-button"
                            type="button"
                            aria-expanded={isBatchExpanded}
                            onClick={() => toggleBatch(batchKey)}
                          >
                            <span
                              className={`tree-chevron${isBatchExpanded ? ' is-expanded' : ''}`}
                              aria-hidden="true"
                            >
                              ⌄
                            </span>
                            <span className="tree-icon" aria-hidden="true">
                              ▱
                            </span>
                            <span>{batch}</span>
                          </button>
                          {isBatchExpanded &&
                            batchAlbums.map((album) => (
                              <button
                                className={`tree-group${selectedAlbumId === album.id ? ' is-selected' : ''}`}
                                type="button"
                                aria-pressed={selectedAlbumId === album.id}
                                key={album.id}
                                onClick={() => setSelectedAlbumId(album.id)}
                                onContextMenu={(event) =>
                                  openContextMenu(event, 'album', album)
                                }
                              >
                                <span aria-hidden="true">♧</span>
                                <span>{album.group_name}</span>
                              </button>
                            ))}
                        </div>
                      );
                    })}
                </section>
              );
            })}
            <button
              className="tree-add-button"
              type="button"
              onClick={openCreateModal}
            >
              <span aria-hidden="true">+</span>
              Tambah album
            </button>
          </nav>
        )}

        <div className="sidebar-footer">
          <div className="footer-emblem" aria-hidden="true">
            ✳
          </div>
          <span>
            Kenangan baik,
            <br />
            tertata rapi.
          </span>
        </div>
      </aside>

      <main className="workspace">
        <div className="sticky-header">
          <header className="topbar">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                aria-label="Cari foto atau album"
                placeholder="Cari berdasarkan tahun, batch, grup..."
              />
              <kbd>⌘ K</kbd>
            </label>
            <div className="topbar-actions">
              <span className="save-status">
                <span aria-hidden="true">✓</span> Semua perubahan tersimpan
              </span>
              <button
                className="primary-button upload-button"
                type="button"
                onClick={uploadToSelectedAlbum}
                disabled={
                  !selectedAlbum || importProgress?.status === 'running'
                }
                title={
                  selectedAlbum
                    ? 'Upload ke album terpilih'
                    : 'Buat dan pilih album untuk mengaktifkan upload'
                }
              >
                <span aria-hidden="true">＋</span>
                Upload
              </button>
              <button
                className="icon-button help-button"
                type="button"
                aria-label="Bantuan"
              >
                ?
              </button>
              <button
                className="avatar-button"
                type="button"
                aria-label="Profil"
              >
                K
              </button>
            </div>
          </header>
          <div
            className={`toolbar-stage${selectedPhotoIds.size > 0 ? ' has-selection' : ''}`}
          >
            <div className="toolbar">
              <div className="filter-tabs" aria-label="Filter foto">
                <button className="is-active" type="button">
                  Semua foto
                </button>
                <button type="button">Foto</button>
                <button type="button">Video</button>
                <button type="button">♡ Favorit</button>
              </div>
              <div className="city-filters" aria-label="Filter kota">
                {['Semua kota', 'Mekkah', 'Madinah', 'Jeddah', 'Taif'].map(
                  (city) => (
                    <button
                      className={`city-filter${selectedCity === city ? ' is-active' : ''}`}
                      type="button"
                      key={city}
                      onClick={() => setSelectedCity(city)}
                    >
                      {city}
                    </button>
                  ),
                )}
              </div>
            </div>
            <div
              className="selection-toolbar"
              aria-live="polite"
              aria-label="Foto terpilih"
            >
              <button
                className="icon-button selection-close"
                type="button"
                aria-label="Batalkan pilihan"
                title="Batalkan pilihan"
                onClick={clearPhotoSelection}
              >
                ×
              </button>
              <strong>Foto dipilih: {selectedPhotoIds.size}</strong>
              <button
                className="selection-delete-button"
                type="button"
                onClick={() => void deleteSelectedPhotos()}
                aria-label="Hapus foto terpilih"
                title="Hapus foto terpilih (Delete / Backspace)"
                aria-keyshortcuts="Delete Backspace"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                >
                  <path
                    d="M4 7h16M9 4h6m-9.5 3 .8 12a1.5 1.5 0 0 0 1.5 1.4h8.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 10v7m4-7v7"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="content-area">
          {importProgress?.status === 'running' && (
            <section
              className="import-progress"
              role="status"
              aria-live="polite"
            >
              <div className="import-progress-heading">
                <span className="import-spinner" aria-hidden="true" />
                <strong>Mengunggah foto</strong>
              </div>
              <p className="import-progress-summary">
                {importProgress.completed} / {importProgress.total} foto ·{' '}
                {importProgress.workerCount} worker
              </p>
              <progress
                value={importProgress.completed}
                max={importProgress.total}
              />
            </section>
          )}

          {photos.length > 0 ? (
            <section
              className={`photo-grid${selectedPhotoIds.size > 0 ? ' has-selection' : ''}`}
              aria-label="Foto album"
            >
              {photos.map((photo) => {
                const isSelected = selectedPhotoIds.has(photo.id);
                const isRangePreview = shiftPreviewPhotoIds.has(photo.id);
                return (
                  <div
                    className={`photo-tile${isSelected ? ' is-selected' : ''}${isRangePreview ? ' is-range-preview' : ''}`}
                    key={photo.id}
                    onMouseEnter={() => setHoveredPhotoId(photo.id)}
                    onMouseLeave={() => setHoveredPhotoId(null)}
                    onClick={(event) => handlePhotoClick(event, photo.id)}
                    onContextMenu={(event) =>
                      openContextMenu(event, 'photo', photo)
                    }
                  >
                    <img
                      className="photo-grid-image"
                      src={photo.thumbnail}
                      alt=""
                      draggable={false}
                    />
                    <button
                      className="photo-selection-indicator"
                      type="button"
                      aria-label={`${isSelected ? 'Batalkan pilihan' : 'Pilih'} ${photo.filename}`}
                      aria-pressed={isSelected}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (
                          event.shiftKey ||
                          event.metaKey ||
                          event.ctrlKey ||
                          selectedPhotoIds.size > 0
                        ) {
                          handlePhotoClick(event, photo.id);
                        } else {
                          selectPhoto(photo.id);
                        }
                      }}
                    >
                      ✓
                    </button>
                  </div>
                );
              })}
            </section>
          ) : (
            <section className="gallery-empty">
              <div className="empty-art" aria-hidden="true">
                <div className="empty-sun" />
                <div className="empty-mountain empty-mountain-back" />
                <div className="empty-mountain empty-mountain-front" />
                <div className="empty-photo">
                  <span>✦</span>
                </div>
              </div>
              {selectedAlbum ? (
                <>
                  <h2>{selectedAlbum.group_name} masih kosong</h2>
                  <p>
                    Rentang tanggal {selectedAlbum.start_date} —{' '}
                    {selectedAlbum.end_date}
                  </p>
                  <p className="empty-hint">
                    Foto yang diunggah akan masuk ke album ini.
                  </p>
                </>
              ) : (
                <>
                  <h2>
                    {albums.length === 0
                      ? 'Mulai dengan membuat album'
                      : 'Pilih album'}
                  </h2>
                  <p>
                    {albums.length === 0
                      ? 'Buat struktur tahun, batch, dan grup untuk menata foto perjalanan.'
                      : 'Pilih album dari panel navigasi untuk melihat dan mengelola fotonya.'}
                  </p>
                  {albums.length === 0 && (
                    <button
                      className="primary-button create-first-button"
                      type="button"
                      onClick={openCreateModal}
                    >
                      <span aria-hidden="true">＋</span>
                      Buat album
                    </button>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </main>

      {contextMenu && (
        <div
          className="context-menu"
          data-context-menu
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {contextMenu.kind === 'album' ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setRenamingAlbum(contextMenu.album);
                  setRenameValue(contextMenu.album.group_name);
                  setRenameError('');
                  setContextMenu(null);
                }}
              >
                Ganti nama album
              </button>
              <button
                className="context-menu-danger"
                type="button"
                role="menuitem"
                disabled={contextMenu.album.photo_count > 0}
                title={
                  contextMenu.album.photo_count > 0
                    ? 'Kosongkan album terlebih dahulu'
                    : undefined
                }
                onClick={() => {
                  setContextMenu(null);
                  void deleteAlbum(contextMenu.album);
                }}
              >
                Hapus album
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  if (selectedPhotoIds.has(contextMenu.photo.id)) {
                    togglePhotoSelection(contextMenu.photo.id);
                  } else {
                    selectPhoto(contextMenu.photo.id);
                  }
                  setContextMenu(null);
                }}
              >
                {selectedPhotoIds.has(contextMenu.photo.id)
                  ? 'Batalkan pilihan'
                  : 'Pilih'}
              </button>
              <button
                className="context-menu-danger"
                type="button"
                role="menuitem"
                onClick={() => {
                  setContextMenu(null);
                  void deletePhoto(contextMenu.photo);
                }}
              >
                Hapus foto
              </button>
            </>
          )}
        </div>
      )}

      {renamingAlbum && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setRenamingAlbum(null);
              setRenameError('');
            }
          }}
        >
          <section
            className="album-modal rename-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-album-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">ALBUM</p>
                <h2 id="rename-album-title">Ganti nama album</h2>
              </div>
              <button
                className="icon-button modal-close"
                type="button"
                aria-label="Tutup"
                onClick={() => {
                  setRenamingAlbum(null);
                  setRenameError('');
                }}
              >
                ×
              </button>
            </div>
            <form onSubmit={renameAlbum}>
              <label>
                Nama grup
                <input
                  autoFocus
                  required
                  maxLength={80}
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                />
              </label>
              {renameError && <p className="form-error">{renameError}</p>}
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setRenamingAlbum(null);
                    setRenameError('');
                  }}
                >
                  Batal
                </button>
                <button className="primary-button" type="submit">
                  Simpan
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {isCreateModalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsCreateModalOpen(false);
            }
          }}
        >
          <section
            className="album-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-album-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">STRUKTUR BARU</p>
                <h2 id="create-album-title">Buat album</h2>
              </div>
              <button
                className="icon-button modal-close"
                type="button"
                aria-label="Tutup"
                onClick={() => setIsCreateModalOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="modal-description">
              Tentukan periode dan grup untuk mengatur foto-fotomu.
            </p>

            <form onSubmit={createAlbum}>
              <div className="form-row">
                <label>
                  Tahun
                  <select
                    value={formValues.year}
                    onChange={(event) => updateForm('year', event.target.value)}
                  >
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Batch
                  <select
                    value={formValues.batch}
                    onChange={(event) =>
                      updateForm('batch', event.target.value)
                    }
                  >
                    {batchOptions.map((batch) => (
                      <option key={batch} value={batch}>
                        {batch}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Grup
                <select
                  value={formValues.group}
                  onChange={(event) => updateForm('group', event.target.value)}
                >
                  {groupOptions.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>Rentang tanggal</legend>
                <div className="form-row">
                  <label>
                    Dari
                    <input
                      type="date"
                      required
                      value={formValues.startDate}
                      onChange={(event) =>
                        updateForm('startDate', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Sampai
                    <input
                      type="date"
                      required
                      min={formValues.startDate || undefined}
                      value={formValues.endDate}
                      onChange={(event) =>
                        updateForm('endDate', event.target.value)
                      }
                    />
                  </label>
                </div>
              </fieldset>
              {formError && <p className="form-error">{formError}</p>}
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  Batal
                </button>
                <button className="primary-button" type="submit">
                  Buat album
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {isDeleteAllConfirmOpen && (
        <div
          className={`modal-backdrop delete-all-confirm-backdrop${isDeleteAllConfirmClosing ? ' is-closing' : ''}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDeleteAllConfirm();
            }
          }}
        >
          <section
            className={`album-modal delete-all-modal${isDeleteAllConfirmClosing ? ' is-closing' : ''}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-all-title"
            aria-describedby="delete-all-description"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">HAPUS SELURUH ALBUM</p>
                <h2 id="delete-all-title">Yakin ingin menghapus semua foto?</h2>
              </div>
            </div>
            <p id="delete-all-description" className="modal-description">
              {photos.length} foto akan dihapus dari Kilas. File foto asli di
              lokasi asal tidak akan dihapus. Tahan tombol sampai garis
              konfirmasi penuh untuk melanjutkan.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={closeDeleteAllConfirm}
              >
                Batal
              </button>
              <button
                className={`hold-delete-button${isHoldingDelete ? ' is-holding' : ''}`}
                type="button"
                ref={holdDeleteButton}
                aria-label="Tahan untuk menghapus semua foto"
                onPointerDown={(event) => {
                  event.preventDefault();
                  startDeleteHold();
                }}
                onPointerUp={cancelDeleteHold}
                onPointerCancel={cancelDeleteHold}
                onPointerLeave={cancelDeleteHold}
                onKeyDown={(event) => {
                  if (
                    (event.key === ' ' || event.key === 'Enter') &&
                    !event.repeat
                  ) {
                    event.preventDefault();
                    startDeleteHold();
                  }
                }}
                onKeyUp={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    cancelDeleteHold();
                  }
                }}
                onBlur={cancelDeleteHold}
                onClick={(event) => event.preventDefault()}
              >
                <svg
                  ref={holdDeleteSvg}
                  className="hold-delete-progress"
                  aria-hidden="true"
                  viewBox="0 0 100 40"
                  preserveAspectRatio="none"
                >
                  <path
                    ref={holdDeletePath}
                    pathLength="1"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray="1"
                    strokeDashoffset="1"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Tahan untuk menghapus</span>
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);

root.render(<App />);
