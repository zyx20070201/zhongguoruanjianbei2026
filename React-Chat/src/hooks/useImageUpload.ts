import { useCallback, useState, useEffect } from 'react';
import type { PendingImage } from '../types';

export function useImageUpload() {
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);

  const addImages = useCallback((files: File[]) => {
    const validFiles = files.filter(
      (f) => f.type.startsWith('image/') && f.size <= 20 * 1024 * 1024,
    );
    if (validFiles.length === 0) return false;

    for (const file of validFiles) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setPendingImages((prev) => [
          ...prev,
          {
            base64: dataUrl.split(',')[1],
            mediaType: file.type,
            dataUrl,
            name: file.name,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
    return true;
  }, []);

  const removeImage = useCallback((index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearImages = useCallback(() => {
    setPendingImages([]);
  }, []);

  // Handle paste events for images
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items || []);
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            setPendingImages((prev) => [
              ...prev,
              {
                base64: dataUrl.split(',')[1],
                mediaType: file.type,
                dataUrl,
                name: 'pasted-image',
              },
            ]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  return { pendingImages, addImages, removeImage, clearImages };
}
