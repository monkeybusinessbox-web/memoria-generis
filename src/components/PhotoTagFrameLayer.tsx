import React, { useRef, useState } from 'react';
import { Person, PhotoPersonTag } from '../types/genealogy';
import { formatFullName } from '../utils/dateUtils';

export interface TagFrameRect {
  x: number; // left % 0..100
  y: number; // top % 0..100
  w: number; // width % 0..100
  h: number; // height % 0..100
}

export function resolveTagFrameRect(tag: PhotoPersonTag): TagFrameRect {
  if (
    typeof tag.w === 'number' &&
    typeof tag.h === 'number' &&
    tag.w > 0 &&
    tag.h > 0
  ) {
    return {
      x: Math.max(0, Math.min(100 - tag.w, tag.x)),
      y: Math.max(0, Math.min(100 - tag.h, tag.y)),
      w: Math.min(100, tag.w),
      h: Math.min(100, tag.h),
    };
  }
  // Legacy center-point compatibility: convert point into centered neat frame
  const w = 14;
  const h = 18;
  return {
    x: Math.max(0, Math.min(100 - w, tag.x - w / 2)),
    y: Math.max(0, Math.min(100 - h, tag.y - h / 2)),
    w,
    h,
  };
}

interface PhotoTagFrameLayerProps {
  src: string;
  alt: string;
  tags: PhotoPersonTag[];
  persons: Record<string, Person>;
  imgClassName?: string;
  containerClassName?: string;
  isTagging?: boolean;
  pendingFrame?: TagFrameRect | null;
  hoveredTagId: string | null;
  onHoverTagChange: (tagId: string | null) => void;
  onFrameDrawn?: (frame: TagFrameRect) => void;
  onTagClick?: (personId: string) => void;
  onImageClick?: () => void;
  title?: string;
}

export function PhotoTagFrameLayer({
  src,
  alt,
  tags,
  persons,
  imgClassName = 'block max-h-80 w-auto rounded object-contain',
  containerClassName = '',
  isTagging = false,
  pendingFrame = null,
  hoveredTagId,
  onHoverTagChange,
  onFrameDrawn,
  onTagClick,
  onImageClick,
  title,
}: PhotoTagFrameLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ xPct: number; yPct: number; pointerId: number } | null>(null);
  const [draftBox, setDraftBox] = useState<TagFrameRect | null>(null);

  const getRelativePercent = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const xPct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    return { xPct, yPct };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isTagging || !onFrameDrawn) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const pt = getRelativePercent(e.clientX, e.clientY);
    if (!pt) return;
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unsupported
    }
    dragStartRef.current = { xPct: pt.xPct, yPct: pt.yPct, pointerId: e.pointerId };
    setDraftBox({ x: pt.xPct, y: pt.yPct, w: 0, h: 0 });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isTagging || !dragStartRef.current) return;
    const pt = getRelativePercent(e.clientX, e.clientY);
    if (!pt) return;
    const start = dragStartRef.current;
    const x = Math.min(start.xPct, pt.xPct);
    const y = Math.min(start.yPct, pt.yPct);
    const w = Math.abs(pt.xPct - start.xPct);
    const h = Math.abs(pt.yPct - start.yPct);
    setDraftBox({
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      w: Math.round(w * 10) / 10,
      h: Math.round(h * 10) / 10,
    });
  };

  const finalizeDrag = (clientX: number, clientY: number, currentTarget?: HTMLDivElement) => {
    const start = dragStartRef.current;
    if (!start || !onFrameDrawn) return;
    dragStartRef.current = null;
    if (currentTarget) {
      try {
        if (currentTarget.hasPointerCapture(start.pointerId)) {
          currentTarget.releasePointerCapture(start.pointerId);
        }
      } catch {
        // Ignore
      }
    }

    const pt = getRelativePercent(clientX, clientY);
    setDraftBox(null);
    if (!pt) return;

    const rawW = Math.abs(pt.xPct - start.xPct);
    const rawH = Math.abs(pt.yPct - start.yPct);

    // If dragged a visible box (>= 2.5%), use user-drawn frame; otherwise fallback to neat box around tap
    if (rawW >= 2.5 && rawH >= 2.5) {
      const w = Math.round(Math.max(4, Math.min(96, rawW)) * 10) / 10;
      const h = Math.round(Math.max(4, Math.min(96, rawH)) * 10) / 10;
      const x = Math.round(Math.max(0, Math.min(100 - w, Math.min(start.xPct, pt.xPct))) * 10) / 10;
      const y = Math.round(Math.max(0, Math.min(100 - h, Math.min(start.yPct, pt.yPct))) * 10) / 10;
      onFrameDrawn({ x, y, w, h });
    } else {
      const w = 16;
      const h = 20;
      const x = Math.round(Math.max(0, Math.min(100 - w, pt.xPct - w / 2)) * 10) / 10;
      const y = Math.round(Math.max(0, Math.min(100 - h, pt.yPct - h / 2)) * 10) / 10;
      onFrameDrawn({ x, y, w, h });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isTagging || !dragStartRef.current) return;
    e.stopPropagation();
    finalizeDrag(e.clientX, e.clientY, e.currentTarget);
  };

  const handlePointerCancel = () => {
    dragStartRef.current = null;
    setDraftBox(null);
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={(e) => {
        if (isTagging) {
          e.stopPropagation();
          return;
        }
        onImageClick?.();
      }}
      style={{ touchAction: isTagging ? 'none' : 'auto' }}
      title={title}
      className={`relative inline-block w-fit select-none ${
        isTagging ? 'cursor-crosshair' : onImageClick ? 'cursor-zoom-in' : ''
      } ${containerClassName}`}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        referrerPolicy="no-referrer"
        className={imgClassName}
      />

      {/* Existing face-tag frames: hidden until hovered directly OR hovered via person chip below */}
      {tags.map((tag) => {
        const tp = persons[tag.personId];
        if (!tp) return null;
        const rect = resolveTagFrameRect(tag);
        const isHovered = hoveredTagId === tag.id;
        const labelAbove = rect.y + rect.h > 82;

        return (
          <button
            key={tag.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!isTagging) {
                onTagClick?.(tp.id);
              }
            }}
            onMouseEnter={() => onHoverTagChange(tag.id)}
            onMouseLeave={() => onHoverTagChange(null)}
            style={{
              left: `${rect.x}%`,
              top: `${rect.y}%`,
              width: `${rect.w}%`,
              height: `${rect.h}%`,
            }}
            title={formatFullName(tp)}
            aria-label={formatFullName(tp)}
            className={`group/face absolute rounded-[3px] transition-all duration-150 ${
              isTagging ? 'pointer-events-none' : 'cursor-pointer'
            } ${
              isHovered
                ? 'border border-white/75 bg-white/12 shadow-[0_0_0_1px_rgba(28,25,23,0.34)] opacity-100'
                : isTagging
                ? 'border border-dashed border-white/45 bg-white/5 opacity-60'
                : 'border border-white/70 bg-white/10 shadow-[0_0_0_1px_rgba(28,25,23,0.28)] opacity-0 hover:opacity-100 focus-visible:opacity-100'
            }`}
          >
            <span
              className={`pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-stone-900/75 px-2 py-0.5 text-[11.5px] text-white/95 shadow-sm backdrop-blur-[1px] transition-opacity duration-150 ${
                labelAbove ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
              } ${isHovered ? 'opacity-100' : 'opacity-0 group-hover/face:opacity-100'}`}
            >
              {formatFullName(tp)}
            </span>
          </button>
        );
      })}

      {/* Live drag frame while drawing */}
      {draftBox && (draftBox.w > 0.5 || draftBox.h > 0.5) && (
        <div
          style={{
            left: `${draftBox.x}%`,
            top: `${draftBox.y}%`,
            width: `${draftBox.w}%`,
            height: `${draftBox.h}%`,
          }}
          className="pointer-events-none absolute rounded-[3px] border border-dashed border-white/90 bg-white/15 shadow-[0_0_0_1px_rgba(139,38,29,0.55)]"
        />
      )}

      {/* Pending frame awaiting person assignment */}
      {pendingFrame && (
        <div
          style={{
            left: `${pendingFrame.x}%`,
            top: `${pendingFrame.y}%`,
            width: `${pendingFrame.w}%`,
            height: `${pendingFrame.h}%`,
          }}
          className="pointer-events-none absolute rounded-[3px] border border-white/90 bg-white/15 shadow-[0_0_0_1px_rgba(139,38,29,0.65)]"
        />
      )}
    </div>
  );
}
