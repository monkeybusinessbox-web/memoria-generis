import { jsPDF } from 'jspdf';
import { Person, TreeDocument, VerificationStatus } from '../types/genealogy';
import {
  EVENT_TYPE_LABELS,
  formatCardLifespan,
  formatFullName,
  formatGenealogyDate,
  formatLifespan,
  formatShortName,
  getPersonInitials,
  getPrimaryPhoto,
  getTreeDisplaySurname,
  parseGenealogyDate,
} from './dateUtils';
import {
  aggregateTimelineEvents,
  computeTreeLayout,
  getChildren,
  getParents,
  getUnionsForPerson,
} from './treeLayout';
import { formatExportTimestamp } from './exportImport';

export interface PdfArchiveOptions {
  customTitle?: string;
  includeTreeDiagram: boolean;
  includeDossiers: boolean;
  includeTimeline: boolean;
  includeNotes: boolean;
  includePhotos: boolean;
}

export interface GeneratedPdfResult {
  pageDataUrls: string[];
  save: () => void;
  filename: string;
}

// A4 at ~192 DPI for crisp printable Canvas -> PDF
const PAGE_W = 1588;
const PAGE_H = 2246;
const MARGIN = 96;
const CONTENT_W = PAGE_W - MARGIN * 2;

function createPageCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d')!;
  // Warm archival ivory paper
  ctx.fillStyle = '#FBF9F5';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  // Subtle double hairline archival border
  ctx.strokeStyle = '#DDD6C8';
  ctx.lineWidth = 2;
  ctx.strokeRect(44, 44, PAGE_W - 88, PAGE_H - 88);
  ctx.strokeStyle = '#EAE4D8';
  ctx.lineWidth = 1;
  ctx.strokeRect(54, 54, PAGE_W - 108, PAGE_H - 108);

  return { canvas, ctx };
}

function drawPageFooter(ctx: CanvasRenderingContext2D, title: string, pageNum: number) {
  ctx.save();
  ctx.fillStyle = '#78716C';
  ctx.font = '400 20px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, MARGIN, PAGE_H - 74);

  ctx.textAlign = 'right';
  ctx.fillText(`Стр. ${pageNum}`, PAGE_W - MARGIN, PAGE_H - 74);
  ctx.restore();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const p of paragraphs) {
    if (!p.trim()) {
      lines.push('');
      continue;
    }
    const words = p.split(/\s+/);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function verificationLabel(v: VerificationStatus): { text: string; color: string; symbol: string } {
  if (v === 'confirmed') return { text: 'Подтверждено', color: '#15803D', symbol: '✓' };
  if (v === 'possible') return { text: 'Возможно', color: '#B45309', symbol: '?' };
  return { text: '', color: '#78716C', symbol: '' };
}

async function loadImageSafe(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawCoverFittedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  const imgRatio = img.width / img.height;
  const boxRatio = dw / dh;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (imgRatio > boxRatio) {
    sw = img.height * boxRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / boxRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawRoundedPolyline(
  ctx: CanvasRenderingContext2D,
  rawPoints: Array<{ x: number; y: number }>,
  radius: number
) {
  const pts: Array<{ x: number; y: number }> = [];
  for (const p of rawPoints) {
    const prev = pts[pts.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 0.5) {
      pts.push(p);
    }
  }
  if (pts.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 0.5 || len2 < 0.5) {
      ctx.lineTo(curr.x, curr.y);
      continue;
    }
    const r = Math.min(radius, len1 / 2, len2 / 2);
    const inX = curr.x - (v1x / len1) * r;
    const inY = curr.y - (v1y / len1) * r;
    const outX = curr.x + (v2x / len2) * r;
    const outY = curr.y + (v2y / len2) * r;
    ctx.lineTo(inX, inY);
    ctx.quadraticCurveTo(curr.x, curr.y, outX, outY);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

export async function buildFamilyArchivePdf(
  tree: TreeDocument,
  options: PdfArchiveOptions
): Promise<GeneratedPdfResult> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const persons = Object.values(tree.persons).sort(
    (a, b) => parseGenealogyDate(a.birthDate).sortKey - parseGenealogyDate(b.birthDate).sortKey
  );
  const timeline = aggregateTimelineEvents(tree);
  const layout = computeTreeLayout(tree, 'vertical');

  // Preload primary photos
  const photoMap: Record<string, HTMLImageElement | null> = {};
  if (options.includePhotos) {
    await Promise.all(
      persons.map(async (p) => {
        const src = getPrimaryPhoto(p);
        if (src) {
          photoMap[p.id] = await loadImageSafe(src);
        }
      })
    );
  }

  const pages: HTMLCanvasElement[] = [];

  const pdfTitle = options.customTitle?.trim() || tree.title || 'Семейное древо';

  // ---------------------------------------------------------
  // PAGE 1: Cover Header + Statistics + Tree Schematic
  // ---------------------------------------------------------
  {
    const { canvas, ctx } = createPageCanvas();
    let y = 130;

    ctx.fillStyle = '#8B261D';
    ctx.font = '600 20px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'left';
    ctx.fillText('СЕМЕЙНЫЙ ГЕНЕАЛОГИЧЕСКИЙ АРХИВ', MARGIN, y);
    y += 66;

    ctx.fillStyle = '#1C1917';
    ctx.font = '600 64px Georgia, "Times New Roman", serif';
    const titleLines = wrapTextLines(ctx, pdfTitle, CONTENT_W);
    for (const line of titleLines.slice(0, 2)) {
      ctx.fillText(line, MARGIN, y);
      y += 74;
    }

    if (tree.subtitle) {
      ctx.fillStyle = '#57534E';
      ctx.font = 'italic 28px Georgia, "Times New Roman", serif';
      ctx.fillText(tree.subtitle, MARGIN, y);
      y += 44;
    }

    // Hairline rule
    y += 10;
    ctx.strokeStyle = '#CFC6B6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MARGIN, y);
    ctx.lineTo(PAGE_W - MARGIN, y);
    ctx.stroke();
    y += 46;

    // Archival Summary Strip
    const totalPhotos = persons.reduce((s, p) => s + p.photos.length, 0);
    const confirmedCount = persons.filter((p) => p.verification === 'confirmed').length;
    const stats = [
      { label: 'Персон в древе', value: String(persons.length) },
      { label: 'Поколений', value: String(Math.max(1, layout.generations.length)) },
      { label: 'Событий хроники', value: String(timeline.length) },
      { label: 'Фотографий', value: String(totalPhotos) },
      { label: 'Подтверждено', value: `${confirmedCount} из ${persons.length}` },
    ];
    const colW = CONTENT_W / stats.length;
    stats.forEach((st, idx) => {
      const sx = MARGIN + idx * colW;
      ctx.fillStyle = '#78716C';
      ctx.font = '400 18px Georgia, "Times New Roman", serif';
      ctx.fillText(st.label, sx, y);
      ctx.fillStyle = '#1C1917';
      ctx.font = '600 32px Georgia, "Times New Roman", serif';
      ctx.fillText(st.value, sx, y + 42);
    });
    y += 82;

    if (options.includeTreeDiagram && persons.length > 0) {
      const boxX = MARGIN;
      const boxY = y;
      const boxW = CONTENT_W;
      const boxH = PAGE_H - y - 134;

      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#DED7C8';
      ctx.lineWidth = 1.5;
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      // Fit tree layout inside box
      const pad = 42;
      const scaleX = (boxW - pad * 2) / layout.bounds.width;
      const scaleY = (boxH - pad * 2) / layout.bounds.height;
      const scale = Math.min(scaleX, scaleY, 1.0);
      const offsetX =
        boxX + (boxW - layout.bounds.width * scale) / 2 - layout.bounds.minX * scale;
      const offsetY =
        boxY + (boxH - layout.bounds.height * scale) / 2 - layout.bounds.minY * scale;

      ctx.save();
      ctx.beginPath();
      ctx.rect(boxX + 2, boxY + 2, boxW - 4, boxH - 4);
      ctx.clip();

      const cornerRadius = 12 * scale;
      const toX = (vx: number) => offsetX + vx * scale;
      const toY = (vy: number) => offsetY + vy * scale;

      // Draw rounded-corner orthogonal child edges first
      for (const ce of layout.childEdges) {
        ctx.strokeStyle = ce.color;
        ctx.lineWidth = Math.max(1.8, 2.8 * scale);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash(
          ce.link.verification === 'possible' || ce.link.relationType !== 'biological'
            ? [6 * scale, 4 * scale]
            : []
        );

        const waypoints =
          ce.detourX !== undefined
            ? [
                { x: toX(ce.parentX), y: toY(ce.parentY) },
                { x: toX(ce.parentX), y: toY(ce.dropY ?? ce.parentY + 18) },
                { x: toX(ce.detourX), y: toY(ce.dropY ?? ce.parentY + 18) },
                { x: toX(ce.detourX), y: toY(ce.busPos) },
                { x: toX(ce.childX), y: toY(ce.busPos) },
                { x: toX(ce.childX), y: toY(ce.childY) },
              ]
            : [
                { x: toX(ce.parentX), y: toY(ce.parentY) },
                { x: toX(ce.parentX), y: toY(ce.busPos) },
                { x: toX(ce.childX), y: toY(ce.busPos) },
                { x: toX(ce.childX), y: toY(ce.childY) },
              ];

        drawRoundedPolyline(ctx, waypoints, cornerRadius);
      }
      ctx.setLineDash([]);

      // Draw union lines with rounded corners and hub marker
      for (const ue of layout.unionEdges) {
        const x1 = toX(ue.x1);
        const y1 = toY(ue.y1);
        const x2 = toX(ue.x2);
        const y2 = toY(ue.y2);
        const hx = toX(ue.hubX);
        const hy = toY(ue.hubY);

        ctx.lineWidth = Math.max(1.8, 2.8 * scale);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash(
          ue.union.status === 'divorced' || ue.union.verification === 'possible'
            ? [6 * scale, 4 * scale]
            : []
        );

        if (ue.routeBelow && ue.bridgeY !== undefined) {
          const by = toY(ue.bridgeY);
          ctx.strokeStyle = ue.color1;
          drawRoundedPolyline(
            ctx,
            [
              { x: x1, y: y1 },
              { x: x1, y: by },
              { x: hx, y: by },
            ],
            cornerRadius
          );
          ctx.strokeStyle = ue.color2;
          drawRoundedPolyline(
            ctx,
            [
              { x: hx, y: by },
              { x: x2, y: by },
              { x: x2, y: y2 },
            ],
            cornerRadius
          );
        } else if (Math.abs(ue.y1 - ue.y2) > 1) {
          ctx.strokeStyle = ue.color1;
          drawRoundedPolyline(
            ctx,
            [
              { x: x1, y: y1 },
              { x: hx, y: y1 },
              { x: hx, y: hy },
            ],
            cornerRadius
          );
          ctx.strokeStyle = ue.color2;
          drawRoundedPolyline(
            ctx,
            [
              { x: hx, y: hy },
              { x: hx, y: y2 },
              { x: x2, y: y2 },
            ],
            cornerRadius
          );
        } else {
          ctx.strokeStyle = ue.color1;
          drawRoundedPolyline(
            ctx,
            [
              { x: x1, y: y1 },
              { x: hx, y: hy },
            ],
            cornerRadius
          );
          ctx.strokeStyle = ue.color2;
          drawRoundedPolyline(
            ctx,
            [
              { x: hx, y: hy },
              { x: x2, y: y2 },
            ],
            cornerRadius
          );
        }

        ctx.setLineDash([]);
        ctx.fillStyle = '#FBF9F5';
        ctx.strokeStyle = '#D6CEBE';
        ctx.lineWidth = Math.max(1.2, 1.6 * scale);
        ctx.beginPath();
        ctx.arc(hx, hy, Math.max(4, 7 * scale), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = ue.union.status === 'divorced' ? '#B45309' : ue.color1;
        ctx.beginPath();
        ctx.arc(hx, hy, Math.max(1.8, 2.8 * scale), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.setLineDash([]);

      // Draw narrower vertical rounded-rectangle person cards with borderless square portrait
      for (const node of Object.values(layout.nodes)) {
        const nx = offsetX + node.x * scale;
        const ny = offsetY + node.y * scale;
        const nw = node.width * scale;
        const nh = node.height * scale;
        const cx = nx + nw / 2;

        // Card container
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#DDD6C8';
        ctx.lineWidth = Math.max(1, 1.4 * scale);
        drawRoundedRectPath(ctx, nx, ny, nw, nh, Math.max(4, 8 * scale));
        ctx.fill();
        ctx.stroke();

        // Top-right verification symbol (5px equidistant padding)
        const nodeVerif = verificationLabel(node.person.verification);
        if (nodeVerif.symbol && nw > 42) {
          ctx.fillStyle = nodeVerif.color;
          ctx.font = `400 ${Math.max(8, Math.round(10.5 * scale))}px Georgia, serif`;
          ctx.textAlign = 'right';
          ctx.fillText(nodeVerif.symbol, nx + nw - 5 * scale, ny + 12 * scale);
        }

        const padY = 15 * scale;
        const photoSize = Math.max(20, 66 * scale);
        const px = cx - photoSize / 2;
        const py = ny + padY;
        const photoRadius = Math.max(3, 6 * scale);

        ctx.fillStyle = '#F5F2EB';
        drawRoundedRectPath(ctx, px, py, photoSize, photoSize, photoRadius);
        ctx.fill();

        const loadedImg = photoMap[node.person.id];
        if (loadedImg) {
          ctx.save();
          drawRoundedRectPath(ctx, px, py, photoSize, photoSize, photoRadius);
          ctx.clip();
          drawCoverFittedImage(ctx, loadedImg, px, py, photoSize, photoSize);
          ctx.restore();
        } else {
          ctx.fillStyle = '#78716C';
          ctx.font = `400 ${Math.max(9, Math.round(15 * scale))}px Georgia, serif`;
          ctx.textAlign = 'center';
          ctx.fillText(getPersonInitials(node.person), cx, py + photoSize / 2 + 5 * scale);
        }

        if (nw > 42) {
          const cardLife = formatCardLifespan(node.person);
          const dateY = ny + nh - padY;
          const firstY = cardLife ? dateY - 14.5 * scale : ny + nh - padY - 5 * scale;
          const lastY = firstY - 15.5 * scale;

          const nameFontSize = Math.max(7.5, Math.min(14, Math.round(12.5 * scale)));
          ctx.fillStyle = '#1C1917';
          ctx.font = `400 ${nameFontSize}px Georgia, serif`;
          ctx.textAlign = 'center';
          ctx.fillText(getTreeDisplaySurname(node.person), cx, lastY, nw - 12 * scale);
          ctx.fillText(node.person.firstName || '', cx, firstY, nw - 12 * scale);

          if (cardLife) {
            ctx.fillStyle = '#57534E';
            const dateFontSize = Math.max(6.5, Math.min(10.5, Math.round(9 * scale)));
            ctx.font = `400 ${dateFontSize}px Georgia, serif`;
            ctx.fillText(cardLife, cx, dateY, nw - 12 * scale);
          }
        }
      }

      ctx.restore();
    } else {
      ctx.fillStyle = '#57534E';
      ctx.font = '400 24px Georgia, "Times New Roman", serif';
      ctx.fillText(
        `Дата составления архива: ${new Date().toLocaleDateString('ru-RU')}`,
        MARGIN,
        y
      );
    }

    drawPageFooter(ctx, pdfTitle, pages.length + 1);
    pages.push(canvas);
  }

  // ---------------------------------------------------------
  // PAGES 2..N: Personal Biographical Dossiers
  // ---------------------------------------------------------
  if (options.includeDossiers && persons.length > 0) {
    let current = createPageCanvas();
    let y = 116;

    const drawSectionHeader = (ctx: CanvasRenderingContext2D, text: string, yPos: number) => {
      ctx.fillStyle = '#8B261D';
      ctx.font = '600 18px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'left';
      ctx.fillText(text, MARGIN, yPos);
      ctx.strokeStyle = '#DDD6C8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(MARGIN, yPos + 14);
      ctx.lineTo(PAGE_W - MARGIN, yPos + 14);
      ctx.stroke();
      return yPos + 46;
    };

    y = drawSectionHeader(current.ctx, 'БИОГРАФИЧЕСКИЕ ДОСЬЕ', y);

    for (const person of persons) {
      const ctx = current.ctx;

      // Pre-calculate height needed for this dossier block
      ctx.font = '400 20px Georgia, "Times New Roman", serif';
      const noteLines =
        options.includeNotes && person.notes.trim()
          ? wrapTextLines(ctx, person.notes.trim(), CONTENT_W - 210)
          : [];
      const eventCount = Math.min(8, person.events.length);
      const estimatedH =
        210 + eventCount * 30 + (noteLines.length > 0 ? Math.min(8, noteLines.length) * 28 + 24 : 0);

      if (y + estimatedH > PAGE_H - 130) {
        drawPageFooter(current.ctx, pdfTitle, pages.length + 1);
        pages.push(current.canvas);
        current = createPageCanvas();
        y = drawSectionHeader(current.ctx, 'БИОГРАФИЧЕСКИЕ ДОСЬЕ (ПРОДОЛЖЕНИЕ)', 116);
      }

      const cardCtx = current.ctx;
      const startY = y;

      // Portrait box (160 x 190)
      const pBoxW = 160;
      const pBoxH = 190;
      cardCtx.fillStyle = '#EFEAE0';
      cardCtx.strokeStyle = '#D6CEBE';
      cardCtx.lineWidth = 1.5;
      cardCtx.fillRect(MARGIN, startY, pBoxW, pBoxH);
      cardCtx.strokeRect(MARGIN, startY, pBoxW, pBoxH);

      const loadedImg = photoMap[person.id];
      if (loadedImg) {
        cardCtx.save();
        cardCtx.beginPath();
        cardCtx.rect(MARGIN + 2, startY + 2, pBoxW - 4, pBoxH - 4);
        cardCtx.clip();
        drawCoverFittedImage(cardCtx, loadedImg, MARGIN + 2, startY + 2, pBoxW - 4, pBoxH - 4);
        cardCtx.restore();
      } else {
        cardCtx.fillStyle = '#8C8275';
        cardCtx.font = '400 42px Georgia, "Times New Roman", serif';
        cardCtx.textAlign = 'center';
        cardCtx.fillText(getPersonInitials(person), MARGIN + pBoxW / 2, startY + pBoxH / 2 + 16);
        cardCtx.textAlign = 'left';
      }

      // Text column
      const textX = MARGIN + pBoxW + 32;
      const textW = CONTENT_W - pBoxW - 32;
      let ty = startY + 34;

      cardCtx.fillStyle = '#1C1917';
      cardCtx.font = '600 32px Georgia, "Times New Roman", serif';
      cardCtx.textAlign = 'left';
      cardCtx.fillText(formatFullName(person, true), textX, ty, textW - 180);

      // Verification mark right-aligned
      const verif = verificationLabel(person.verification);
      if (verif.text) {
        cardCtx.fillStyle = verif.color;
        cardCtx.font = '400 18px Georgia, "Times New Roman", serif';
        cardCtx.textAlign = 'right';
        cardCtx.fillText(`${verif.symbol} ${verif.text}`, PAGE_W - MARGIN, ty - 4);
        cardCtx.textAlign = 'left';
      }

      ty += 32;
      cardCtx.fillStyle = '#57534E';
      cardCtx.font = '400 19px Georgia, "Times New Roman", serif';
      const metaParts = [formatLifespan(person)];
      if (person.occupation) metaParts.push(person.occupation);
      cardCtx.fillText(metaParts.join(' · '), textX, ty, textW);

      ty += 30;
      cardCtx.fillStyle = '#44403C';
      cardCtx.font = '400 19px Georgia, "Times New Roman", serif';
      const birthLine = `Рождение: ${formatGenealogyDate(person.birthDate) || 'не указано'}${
        person.birthPlace ? ` (${person.birthPlace})` : ''
      }`;
      cardCtx.fillText(birthLine, textX, ty, textW);

      if (person.deathDate?.trim() || person.deathPlace?.trim()) {
        ty += 28;
        const deathLine = `Кончина: ${formatGenealogyDate(person.deathDate) || 'не указано'}${
          person.deathPlace ? ` (${person.deathPlace})` : ''
        }`;
        cardCtx.fillText(deathLine, textX, ty, textW);
      }

      // Family connections line
      const parents = getParents(tree, person.id).map((p) => formatShortName(p.person));
      const spouses = getUnionsForPerson(tree, person.id).map((u) => formatShortName(u.partner));
      const children = getChildren(tree, person.id).map((c) => formatShortName(c.person));
      const relParts: string[] = [];
      if (parents.length) relParts.push(`Родители: ${parents.join(', ')}`);
      if (spouses.length) relParts.push(`Супруг(а): ${spouses.join(', ')}`);
      if (children.length) relParts.push(`Дети: ${children.join(', ')}`);

      if (relParts.length > 0) {
        ty += 30;
        cardCtx.fillStyle = '#57534E';
        cardCtx.font = '400 18px Georgia, "Times New Roman", serif';
        const relWrapped = wrapTextLines(cardCtx, relParts.join(' · '), textW);
        for (const rl of relWrapped.slice(0, 2)) {
          cardCtx.fillText(rl, textX, ty);
          ty += 24;
        }
      }

      // Events
      if (eventCount > 0) {
        ty += 12;
        cardCtx.fillStyle = '#8B261D';
        cardCtx.font = '600 17px Georgia, "Times New Roman", serif';
        cardCtx.fillText('Важные даты:', textX, ty);
        ty += 26;
        cardCtx.font = '400 18px Georgia, "Times New Roman", serif';
        for (const ev of person.events.slice(0, 8)) {
          const evVerif = verificationLabel(ev.verification);
          const dateStr = formatGenealogyDate(ev.date) || 'без даты';
          const evText = `${dateStr} — ${ev.title || EVENT_TYPE_LABELS[ev.type]}${
            ev.place ? ` (${ev.place})` : ''
          }${evVerif.symbol ? ` [${evVerif.symbol}]` : ''}`;
          cardCtx.fillStyle = '#292524';
          cardCtx.fillText(evText, textX, ty, textW);
          ty += 26;
        }
      }

      // Notes
      if (noteLines.length > 0) {
        ty += 10;
        cardCtx.fillStyle = '#44403C';
        cardCtx.font = '400 18px Georgia, "Times New Roman", serif';
        for (const nl of noteLines.slice(0, 8)) {
          cardCtx.fillText(nl, textX, ty);
          ty += 25;
        }
      }

      const endY = Math.max(startY + pBoxH + 24, ty + 20);
      cardCtx.strokeStyle = '#E6DFD3';
      cardCtx.lineWidth = 1.5;
      cardCtx.beginPath();
      cardCtx.moveTo(MARGIN, endY);
      cardCtx.lineTo(PAGE_W - MARGIN, endY);
      cardCtx.stroke();

      y = endY + 34;
    }

    drawPageFooter(current.ctx, pdfTitle, pages.length + 1);
    pages.push(current.canvas);
  }

  // ---------------------------------------------------------
  // FINAL PAGES: Chronological Family Timeline
  // ---------------------------------------------------------
  if (options.includeTimeline && timeline.length > 0) {
    let current = createPageCanvas();
    let y = 116;

    const drawTimelineHeader = (ctx: CanvasRenderingContext2D, yPos: number, cont = false) => {
      ctx.fillStyle = '#8B261D';
      ctx.font = '600 18px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'left';
      ctx.fillText(
        cont ? 'ХРОНИКА СЕМЕЙНЫХ СОБЫТИЙ (ПРОДОЛЖЕНИЕ)' : 'ХРОНИКА СЕМЕЙНЫХ СОБЫТИЙ',
        MARGIN,
        yPos
      );
      ctx.strokeStyle = '#DDD6C8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(MARGIN, yPos + 14);
      ctx.lineTo(PAGE_W - MARGIN, yPos + 14);
      ctx.stroke();
      return yPos + 48;
    };

    y = drawTimelineHeader(current.ctx, y, false);

    for (const ev of timeline) {
      if (y > PAGE_H - 140) {
        drawPageFooter(current.ctx, pdfTitle, pages.length + 1);
        pages.push(current.canvas);
        current = createPageCanvas();
        y = drawTimelineHeader(current.ctx, 116, true);
      }

      const ctx = current.ctx;
      // Year column
      ctx.fillStyle = '#1C1917';
      ctx.font = '600 20px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'left';
      ctx.fillText(ev.year ? String(ev.year) : '—', MARGIN, y);

      // Date detail + title
      const colX = MARGIN + 115;
      ctx.fillStyle = '#78716C';
      ctx.font = '400 17px Georgia, "Times New Roman", serif';
      const subMeta = [ev.dateDisplay, EVENT_TYPE_LABELS[ev.category], ev.place]
        .filter(Boolean)
        .join(' · ');
      ctx.fillText(subMeta, colX, y - 2, CONTENT_W - 290);

      ctx.fillStyle = '#1C1917';
      ctx.font = '600 22px Georgia, "Times New Roman", serif';
      ctx.fillText(ev.title, colX, y + 28, CONTENT_W - 290);

      const verif = verificationLabel(ev.verification);
      if (verif.text) {
        ctx.fillStyle = verif.color;
        ctx.font = '400 17px Georgia, "Times New Roman", serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${verif.symbol} ${verif.text}`, PAGE_W - MARGIN, y + 4);
        ctx.textAlign = 'left';
      }

      ctx.strokeStyle = '#ECE6DA';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN, y + 46);
      ctx.lineTo(PAGE_W - MARGIN, y + 46);
      ctx.stroke();

      y += 70;
    }

    drawPageFooter(current.ctx, pdfTitle, pages.length + 1);
    pages.push(current.canvas);
  }

  const pageDataUrls = pages.map((c) => c.toDataURL('image/jpeg', 0.9));
  const safeBase =
    pdfTitle
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'family_archive';
  const filename = `${safeBase}_archive_${formatExportTimestamp()}.pdf`;

  const save = () => {
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });
    pageDataUrls.forEach((dataUrl, idx) => {
      if (idx > 0) pdf.addPage();
      pdf.addImage(dataUrl, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    });
    pdf.save(filename);
  };

  return { pageDataUrls, save, filename };
}
