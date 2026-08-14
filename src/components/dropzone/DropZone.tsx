import React, { useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useFileStore } from '../../stores/fileStore';
import { ImageItem } from '../../types/conversion';

export const DropZone: React.FC = () => {
  const [isDragging, setIsDragging] = useState(false);
  const addFiles = useFileStore((state) => state.addFiles);

  const handleSelectFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Images',
            extensions: ['jpg', 'jpeg', 'png', 'webp'],
          },
        ],
      });

      if (selected) {
        const filePaths = Array.isArray(selected) ? selected : [selected];
        const newFiles: ImageItem[] = filePaths.map((path) => {
          const parts = path.split('/');
          const name = parts[parts.length - 1] || path;
          return {
            id: crypto.randomUUID(),
            path,
            name,
            size: 0,
            status: 'queued',
          };
        });
        addFiles(newFiles);
      }
    } catch (err) {
      console.error('Error opening file dialog:', err);
    }
  };

  return (
    <div
      onClick={handleSelectFiles}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all duration-200 select-none ${
        isDragging
          ? 'border-blue-500 bg-blue-50/5 dark:bg-blue-900/10 scale-[0.99]'
          : 'border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600 bg-zinc-50/50 dark:bg-zinc-900/50'
      }`}
    >
      <div className="p-4 rounded-full bg-zinc-100 dark:bg-zinc-800 mb-3 text-zinc-600 dark:text-zinc-300">
        <UploadCloud className="w-8 h-8" />
      </div>
      <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
        Drop images here or click to browse
      </h3>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        Supports JPG, JPEG, PNG, WebP
      </p>
    </div>
  );
};