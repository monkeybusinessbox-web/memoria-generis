import React, { useRef, useState } from 'react';
import { Crosshair, Minimize2, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { PhotoAttachment, PhotoCrop } from '../types/genealogy';
import { estimateDataUrlBytes, formatBytes } from '../utils/dateUtils';
import { recompressDataUrl } from '../utils/storage';
import { TagFrameRect } from './PhotoTagFrameLayer';

export function computeTagFrameFromCrop(
  crop: PhotoCrop,
  aspectRatio = 1
): TagFrameRect {
  const r = aspectRatio > 0 && Number.isFinite(aspectRatio) ? aspectRatio : 1;
  const z = Math.max(1, crop.zoom || 1);
  const tx = (crop.x || 0) / 100;
  const ty = (crop.y || 0) / 100;

  const bx1 = (-0.5 - tx) / z;
  const bx2 = (0.5 - tx) / z;
  const by1 = (-0.5 - ty) / z;
  const by2 = (0.5 - ty) / z;

  let nx1: number;
  let nx2: number;
  let ny1: number;
  let ny2: number;

  if (r >= 1) {
    nx1 = 0.5 + bx1 / r;
    nx2 = 0.5 + bx2 / r;
    ny1 = 0.5 + by1;
    ny2 = 0.5 + by2;
  } else {
    nx1 = 0.5 + bx1;
    nx2 = 0.5 + bx2;
    ny1 = 0.5 + by1 * r;
    ny2 = 0.5 + by2 * r;
  }

  const x1 = Math.max(0, Math.min(1, nx1));
  const x2 = Math.max(0, Math.min(1, nx2));
  const y1 = Math.max(0, Math.min(1, ny1));
  const y2 = Math.max(0, Math.min(1, ny2));

  const round1 = (v: number) => Math.round(v * 10) / 10;
  let w = round1(Math.max(4, (x2 - x1) * 100));
  let h = round1(Math.max(4, (y2 - y1) * 100));
  let x = round1(Math.max(0, Math.min(100 - w, x1 * 100)));
  let y = round1(Math.max(0, Math.min(100 - h, y1 * 100)));

  if (w >= 98 && h >= 98) {
    x = 2;
    y = 2;
    w = 96;
    h = 96;
  }

  return { x, y, w, h };
}

interface CroppedCircleAvatarProps {
  photo: PhotoAttachment | null;
  initials: string;
  alt: string;
  sizeClass?: string;
  ringColor?: string;
  textSizeClass?: string;
  showBorder?: boolean;
}

export function CroppedCircleAvatar({
  photo,
  initials,
  alt,
  sizeClass = 'w-16 h-16',
  textSizeClass = 'text-lg',
}: CroppedCircleAvatarProps) {
  const crop = photo?.crop || { x: 0, y: 0, zoom: 1 };

  return (
    <div
      className={`relative overflow-hidden rounded-md bg-stone-100 shrink-0 ${sizeClass}`}
    >
      {photo?.dataUrl ? (
        <img
          src={photo.dataUrl}
          alt={alt}
          referrerPolicy="no-referrer"
          draggable={false}
          className="h-full w-full object-cover select-none pointer-events-none"
          style={{
            transform: `translate(${crop.x}%, ${crop.y}%) scale(${crop.zoom})`,
            transformOrigin: 'center center',
          }}
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center font-editorial font-semibold text-stone-600 ${textSizeClass}`}
        >
          {initials}
        </div>
      )}
    </div>
  );
}

interface PhotoCropModalProps {
  photo: PhotoAttachment;
  onSave: (updated: PhotoAttachment, tagFrame?: TagFrameRect) => void;
  onClose: () => void;
}

export function PhotoCropModal({ photo, onSave, onClose }: PhotoCropModalProps) {
  const [crop, setCrop] = useState<PhotoCrop>(
    photo.crop || { x: 0, y: 0, zoom: 1.1 }
  );
  const [dataUrl, setDataUrl] = useState(photo.dataUrl);
  const [naturalRatio, setNaturalRatio] = useState(1);
  const [isCompressing, setIsCompressing] = useState(false);
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const currentBytes = estimateDataUrlBytes(dataUrl);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: crop.x,
      origY: crop.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = ((e.clientX - dragRef.current.startX) / 220) * 100;
    const dy = ((e.clientY - dragRef.current.startY) / 220) * 100;
    const limit = Math.max(25, (crop.zoom - 1) * 50 + 25);
    setCrop((prev) => ({
      ...prev,
      x: Math.max(-limit, Math.min(limit, dragRef.current.origX + dx)),
      y: Math.max(-limit, Math.min(limit, dragRef.current.origY + dy)),
    }));
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  const handleCompress = async (maxDim: number, quality: number) => {
    setIsCompressing(true);
    try {
      const compressed = await recompressDataUrl(dataUrl, maxDim, quality);
      setDataUrl(compressed);
    } finally {
      setIsCompressing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/65 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-stone-200 bg-[#FBF9F5] p-5 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-editorial text-xl font-semibold text-stone-900">
              Настройка квадратного портрета
            </h3>
            <p className="text-xs text-stone-500">
              Перетяните снимок пальцем или мышью и настройте масштаб
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-stone-400 hover:text-stone-700 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Square Crop Viewport */}
        <div className="flex justify-center py-2">
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ touchAction: 'none' }}
            className="relative h-56 w-56 cursor-grab active:cursor-grabbing overflow-hidden rounded-lg border-4 border-[#8B261D]/75 bg-stone-200 shadow-inner select-none"
          >
            <img
              src={dataUrl}
              alt="Кадрирование портрета"
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  setNaturalRatio(img.naturalWidth / img.naturalHeight);
                }
              }}
              className="h-full w-full object-cover pointer-events-none select-none"
              style={{
                transform: `translate(${crop.x}%, ${crop.y}%) scale(${crop.zoom})`,
                transformOrigin: 'center center',
              }}
            />
            <div className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-white/40" />
          </div>
        </div>

        {/* Zoom & Center Controls */}
        <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-3.5">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setCrop((c) => ({ ...c, zoom: Math.max(1, +(c.zoom - 0.15).toFixed(2)) }))}
              className="rounded border border-stone-200 p-1.5 text-stone-600 hover:bg-stone-50 cursor-pointer"
              title="Уменьшить"
            >
              <ZoomOut size={15} />
            </button>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={crop.zoom}
              onChange={(e) => setCrop((c) => ({ ...c, zoom: parseFloat(e.target.value) }))}
              className="flex-1 accent-[#8B261D]"
            />
            <button
              type="button"
              onClick={() => setCrop((c) => ({ ...c, zoom: Math.min(3, +(c.zoom + 0.15).toFixed(2)) }))}
              className="rounded border border-stone-200 p-1.5 text-stone-600 hover:bg-stone-50 cursor-pointer"
              title="Увеличить"
            >
              <ZoomIn size={15} />
            </button>
            <span className="font-mono-tabular text-[14.5px] text-stone-600 w-12 text-right">
              {crop.zoom.toFixed(1)}×
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setCrop({ x: 0, y: 0, zoom: 1 })}
              className="inline-flex items-center gap-1.5 text-[14.5px] font-medium text-stone-600 hover:text-stone-900 cursor-pointer"
            >
              <Crosshair size={14} />
              <span>Оцентровать</span>
            </button>

            <div className="flex items-center gap-2">
              {currentBytes > 0 && (
                <span className="font-mono-tabular text-[13px] text-stone-400">
                  Вес: {formatBytes(currentBytes)}
                </span>
              )}
              <button
                type="button"
                disabled={isCompressing}
                onClick={() => handleCompress(520, 0.72)}
                title="Сжать изображение, чтобы уменьшить размер файла проекта"
                className="inline-flex items-center gap-1 rounded border border-stone-200 bg-stone-50 px-2.5 py-1 text-[13px] font-medium text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <Minimize2 size={12} />
                <span>{isCompressing ? 'Сжатие...' : 'Уменьшить вес'}</span>
              </button>
              {dataUrl !== photo.dataUrl && (
                <button
                  type="button"
                  onClick={() => setDataUrl(photo.dataUrl)}
                  title="Вернуть исходное качество"
                  className="text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <RotateCcw size={13} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3.5 py-2 text-[14.5px] text-stone-600 hover:bg-stone-200/60 cursor-pointer"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => {
              const tagFrame = computeTagFrameFromCrop(crop, naturalRatio);
              onSave({ ...photo, dataUrl, crop }, tagFrame);
            }}
            className="rounded-md bg-[#8B261D] px-4 py-2 text-[14.5px] font-medium text-white hover:bg-[#741E17] cursor-pointer"
          >
            Применить портрет
          </button>
        </div>
      </div>
    </div>
  );
}
