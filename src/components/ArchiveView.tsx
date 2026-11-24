import React, { useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  Download,
  FileCode2,
  FileJson,
  FileText,
  FolderArchive,
  GitMerge,
  Lock,
  Minimize2,
  Printer,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { TreeDocument } from '../types/genealogy';
import { estimateDataUrlBytes, formatBytes } from '../utils/dateUtils';
import {
  exportTreeToGedcomFile,
  exportTreeToJsonFile,
  exportTreeToZipFile,
  importArchiveFromFile,
} from '../utils/exportImport';
import {
  GeneratedPdfResult,
  PdfArchiveOptions,
  buildFamilyArchivePdf,
} from '../utils/pdfExport';
import { optimizeTreePhotos } from '../utils/storage';
import { aggregateTimelineEvents, computeTreeLayout } from '../utils/treeLayout';
import { TreeMergeModal } from './TreeMergeModal';

interface ArchiveViewProps {
  tree: TreeDocument;
  onUpdateTreeTitle: (title: string) => void;
  onReplaceTree: (next: TreeDocument) => void;
  onMergeTree: (incoming: TreeDocument) => void;
  onResetToEmpty: () => void;
  onRestoreSample: () => void;
}

export function ArchiveView({
  tree,
  onUpdateTreeTitle,
  onReplaceTree,
  onMergeTree,
  onResetToEmpty,
  onRestoreSample,
}: ArchiveViewProps) {
  const [pdfOptions, setPdfOptions] = useState<PdfArchiveOptions>({
    customTitle: tree.title || '',
    includeTreeDiagram: true,
    includeDossiers: true,
    includeTimeline: true,
    includeNotes: true,
    includePhotos: true,
  });
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<GeneratedPdfResult | null>(null);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [isExportingJson, setIsExportingJson] = useState(false);
  const [compressOnExport, setCompressOnExport] = useState(false);
  const [isOptimizingLocal, setIsOptimizingLocal] = useState(false);

  const [importCandidate, setImportCandidate] = useState<{
    fileName: string;
    doc: TreeDocument;
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);

  const stats = useMemo(() => {
    const persons = Object.values(tree.persons);
    const archivePhotos = tree.archivePhotos || [];
    const totalPhotos =
      persons.reduce((s, p) => s + p.photos.length, 0) + archivePhotos.length;
    const photoBytes =
      persons.reduce(
        (s, p) =>
          s + p.photos.reduce((ps, ph) => ps + estimateDataUrlBytes(ph.dataUrl), 0),
        0
      ) +
      archivePhotos.reduce((s, ph) => s + estimateDataUrlBytes(ph.dataUrl), 0);
    const confirmed = persons.filter((p) => p.verification === 'confirmed').length;
    const possible = persons.filter((p) => p.verification === 'possible').length;
    const timelineCount = aggregateTimelineEvents(tree).length;
    const generations = computeTreeLayout(tree, 'vertical').generations.length;
    return {
      personCount: persons.length,
      unionCount: tree.unions.length,
      totalPhotos,
      photoBytes,
      confirmed,
      possible,
      timelineCount,
      generations,
    };
  }, [tree]);

  const handleGeneratePdf = async () => {
    setIsGeneratingPdf(true);
    setStatusMessage(null);
    try {
      const result = await buildFamilyArchivePdf(tree, {
        ...pdfOptions,
        customTitle: tree.title,
      });
      setPdfPreview(result);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleOptimizeProjectPhotos = async (maxDim: number, quality: number) => {
    setIsOptimizingLocal(true);
    setStatusMessage(null);
    try {
      const beforeBytes = stats.photoBytes;
      const optimized = await optimizeTreePhotos(tree, maxDim, quality);
      const afterBytes =
        Object.values(optimized.persons).reduce(
          (s, p) =>
            s + p.photos.reduce((ps, ph) => ps + estimateDataUrlBytes(ph.dataUrl), 0),
          0
        ) +
        (optimized.archivePhotos || []).reduce(
          (s, ph) => s + estimateDataUrlBytes(ph.dataUrl),
          0
        );
      onReplaceTree(optimized);
      setStatusMessage(
        `Фотографии в проекте сжаты: ${formatBytes(beforeBytes)} → ${formatBytes(afterBytes)}.`
      );
    } finally {
      setIsOptimizingLocal(false);
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setStatusMessage(null);
    try {
      const doc = await importArchiveFromFile(file);
      setImportCandidate({ fileName: file.name, doc });
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Не удалось прочитать файл архива'
      );
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#FBF9F5] px-4 py-5 sm:px-6 sm:py-7 lg:px-10">
      <div className="mx-auto max-w-5xl space-y-7 sm:space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6">
          <div className="w-full space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-[#15803D]">
              <Lock size={13} />
              <span>Автономный локальный архив · Данные не покидают ваш браузер</span>
            </div>
            <h1 className="font-editorial text-2xl sm:text-3xl font-semibold text-stone-900">
              Семейный архив, печать и резервные копии
            </h1>
            <p className="text-sm text-stone-600 max-w-2xl">
              Все изменения автоматически сохраняются в локальном хранилище браузера (IndexedDB). Здесь вы можете задать название древа, сжать фото, подготовить печатный PDF-альбом, выгрузить ZIP или перенести данные через GEDCOM и JSON.
            </p>
            <div className="max-w-md pt-1">
              <label
                htmlFor="archive-tree-title"
                className="block text-[13.5px] font-medium text-stone-600 mb-1"
              >
                Название семейного древа (используется в PDF и архиве)
              </label>
              <input
                id="archive-tree-title"
                type="text"
                value={tree.title}
                onChange={(e) => onUpdateTreeTitle(e.target.value)}
                placeholder="Например: Родословное древо семьи..."
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 border-b border-stone-200 pb-6">
          <div>
            <div className="text-xs text-stone-500">Персон в древе</div>
            <div className="mt-1 font-mono-tabular text-2xl font-semibold text-stone-900">
              {stats.personCount}
            </div>
          </div>
          <div>
            <div className="text-xs text-stone-500">Поколений</div>
            <div className="mt-1 font-mono-tabular text-2xl font-semibold text-stone-900">
              {stats.generations}
            </div>
          </div>
          <div>
            <div className="text-xs text-stone-500">Событий хроники</div>
            <div className="mt-1 font-mono-tabular text-2xl font-semibold text-stone-900">
              {stats.timelineCount}
            </div>
          </div>
          <div>
            <div className="text-xs text-stone-500">Фотографий ({formatBytes(stats.photoBytes)})</div>
            <div className="mt-1 font-mono-tabular text-2xl font-semibold text-stone-900">
              {stats.totalPhotos}
            </div>
          </div>
          <div>
            <div className="text-xs text-stone-500">Подтверждено / Возможно</div>
            <div className="mt-1 font-mono-tabular text-2xl font-semibold text-stone-900">
              {stats.confirmed} <span className="text-stone-400 text-base">/ {stats.possible}</span>
            </div>
          </div>
        </div>

        {statusMessage && (
          <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs font-medium text-emerald-900">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-[#15803D]" />
              <span>{statusMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-emerald-700 hover:text-emerald-950 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Photo Weight Optimization Banner */}
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1 max-w-xl">
              <div className="flex items-center gap-2">
                <Minimize2 size={16} className="text-[#8B261D]" />
                <h2 className="font-editorial text-xl font-semibold text-stone-900">
                  Оптимизация веса фотографий в проекте
                </h2>
              </div>
              <p className="text-xs leading-relaxed text-stone-600">
                Текущий объём встроенных фото: <span className="font-mono-tabular font-semibold">{formatBytes(stats.photoBytes)}</span>. Вы можете сжать фотографии в проекте перед сохранением резервной копии, чтобы файл проекта оставался компактным.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isOptimizingLocal || stats.totalPhotos === 0}
                onClick={() => handleOptimizeProjectPhotos(640, 0.78)}
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-[14.5px] font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-45 cursor-pointer"
              >
                Оптимально (640px)
              </button>
              <button
                type="button"
                disabled={isOptimizingLocal || stats.totalPhotos === 0}
                onClick={() => handleOptimizeProjectPhotos(420, 0.68)}
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-[14.5px] font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-45 cursor-pointer"
              >
                Компактно (420px)
              </button>
            </div>
          </div>

          <div className="mt-3 border-t border-stone-100 pt-3">
            <label className="inline-flex items-center gap-2 text-[14.5px] text-stone-700 cursor-pointer">
              <input
                type="checkbox"
                checked={compressOnExport}
                onChange={(e) => setCompressOnExport(e.target.checked)}
                className="h-4 w-4 rounded border-stone-300 text-[#8B261D]"
              />
              <span>Автоматически сжимать фото при экспорте в JSON / ZIP (не изменяя оригиналы в браузере)</span>
            </label>
          </div>
        </section>

        {/* Export Section */}
        <section className="space-y-4">
          <h2 className="font-editorial text-2xl font-semibold text-stone-900">
            Экспорт и печать архива
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="flex flex-col justify-between rounded-xl border border-stone-200 bg-white p-5 space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <Printer size={18} className="text-[#8B261D]" />
                  <h3 className="font-editorial text-xl font-semibold text-stone-900">
                    Печатный семейный архив (PDF, A4)
                  </h3>
                </div>
                <p className="text-xs leading-relaxed text-stone-600">
                  Формирует многостраничную книгу-архив формата A4 с векторной схемой древа, портретами, биографическими досье, заметками, метками достоверности и полной хроникой событий.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[14.5px] text-stone-700">
                  {(
                    [
                      { key: 'includeTreeDiagram', label: 'Схема родословного древа' },
                      { key: 'includeDossiers', label: 'Досье персон' },
                      { key: 'includePhotos', label: 'Портреты в досье' },
                      { key: 'includeNotes', label: 'Текстовые заметки' },
                      { key: 'includeTimeline', label: 'Хроника событий' },
                    ] as const
                  ).map((opt) => (
                    <label key={opt.key} className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pdfOptions[opt.key]}
                        onChange={(e) =>
                          setPdfOptions((prev) => ({ ...prev, [opt.key]: e.target.checked }))
                        }
                        className="h-4 w-4 rounded border-stone-300 text-[#8B261D] focus:ring-[#8B261D]"
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  disabled={isGeneratingPdf || stats.personCount === 0}
                  onClick={handleGeneratePdf}
                  className="inline-flex items-center gap-2 rounded-md bg-[#8B261D] px-4 py-2 text-[14.5px] font-medium text-white hover:bg-[#741E17] disabled:opacity-45 transition-colors cursor-pointer"
                >
                  <FileText size={15} />
                  <span>
                    {isGeneratingPdf ? 'Подготовка страниц A4...' : 'Сформировать и просмотреть PDF'}
                  </span>
                </button>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-stone-200 bg-white p-5 space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <FolderArchive size={18} className="text-stone-800" />
                  <h3 className="font-editorial text-xl font-semibold text-stone-900">
                    Полный ZIP-архив с фотографиями
                  </h3>
                </div>
                <p className="text-[14.5px] leading-relaxed text-stone-600">
                  Упаковывает структуру древа (<span className="font-mono-tabular">archive.json</span>), универсальный файл <span className="font-mono-tabular">family.ged</span> и папку <span className="font-mono-tabular">photos/</span> со всеми изображениями в единый архив.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={isExportingZip || stats.personCount === 0}
                  onClick={async () => {
                    setIsExportingZip(true);
                    try {
                      const payload = compressOnExport
                        ? await optimizeTreePhotos(tree, 560, 0.74)
                        : tree;
                      await exportTreeToZipFile(payload);
                      setStatusMessage('ZIP-архив с фотографиями успешно сформирован и скачан.');
                    } finally {
                      setIsExportingZip(false);
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-md bg-stone-900 px-4 py-2 text-[14.5px] font-medium text-white hover:bg-stone-800 disabled:opacity-45 cursor-pointer"
                >
                  <Download size={15} />
                  <span>{isExportingZip ? 'Упаковка ZIP...' : 'Скачать ZIP с фото'}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-stone-200 bg-white p-5 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <FileJson size={18} className="text-stone-800" />
                  <h3 className="font-editorial text-xl font-semibold text-stone-900">
                    Резервная копия JSON
                  </h3>
                </div>
                <p className="text-[14.5px] leading-relaxed text-stone-600">
                  Сохраняет полную копию вашего древа, заметок, дат, документов, меток достоверности и прикреплённых фотографий в одном файле <span className="font-mono-tabular">.json</span>.
                </p>
              </div>
              <div>
                <button
                  type="button"
                  disabled={isExportingJson}
                  onClick={async () => {
                    setIsExportingJson(true);
                    try {
                      const payload = compressOnExport
                        ? await optimizeTreePhotos(tree, 560, 0.74)
                        : tree;
                      await exportTreeToJsonFile(payload);
                      setStatusMessage('Резервная копия JSON сохранена.');
                    } finally {
                      setIsExportingJson(false);
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2 text-[14.5px] font-medium text-stone-800 hover:bg-stone-50 cursor-pointer"
                >
                  <Download size={15} />
                  <span>{isExportingJson ? 'Экспорт...' : 'Экспорт в JSON'}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-stone-200 bg-white p-5 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <FileCode2 size={18} className="text-stone-800" />
                  <h3 className="font-editorial text-xl font-semibold text-stone-900">
                    Стандарт GEDCOM (.ged)
                  </h3>
                </div>
                <p className="text-[14.5px] leading-relaxed text-stone-600">
                  Совместим с программами «Древо Жизни», Gramps, MyHeritage, Ancestry и FamilySearch. Сохраняет персон, семьи, даты, важные события, заметки и метки.
                </p>
              </div>
              <div>
                <button
                  type="button"
                  disabled={stats.personCount === 0}
                  onClick={() => {
                    exportTreeToGedcomFile(tree);
                    setStatusMessage('Файл GEDCOM (.ged) экспортирован.');
                  }}
                  className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2 text-[14.5px] font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-45 cursor-pointer"
                >
                  <Download size={15} />
                  <span>Экспорт в .ged</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Import Section */}
        <section className="space-y-4">
          <h2 className="font-editorial text-2xl font-semibold text-stone-900">
            Импорт из других программ и резервных копий
          </h2>

          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-white px-6 py-8 text-center hover:border-[#8B261D] transition-colors">
            <Upload size={22} className="text-[#8B261D]" />
            <div className="text-sm font-medium text-stone-900">
              Выберите файл для импорта (.ged, .zip, .json)
            </div>
            <p className="text-xs text-stone-500 max-w-lg">
              Поддерживаются файлы GEDCOM в кодировке UTF-8 и Windows-1251 (из MyHeritage, Gramps, Древо Жизни), ZIP-архивы с фотографиями и резервные копии JSON.
            </p>
            <input
              type="file"
              accept=".json,.zip,.ged,.gedcom"
              className="hidden"
              onChange={handleFileInput}
            />
          </label>

          {importError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">
              Ошибка импорта: {importError}
            </div>
          )}

          {importCandidate && (
            <div className="rounded-xl border border-stone-300 bg-white p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-stone-500">
                    Готово к импорту из файла {importCandidate.fileName}
                  </div>
                  <h3 className="font-editorial text-xl font-semibold text-stone-900 mt-0.5">
                    {importCandidate.doc.title}
                  </h3>
                  <div className="mt-1 flex items-center gap-3 text-xs text-stone-600 font-mono-tabular">
                    <span>{Object.keys(importCandidate.doc.persons).length} персон</span>
                    <span>·</span>
                    <span>{importCandidate.doc.unions.length} союзов</span>
                    <span>·</span>
                    <span>
                      {Object.values(importCandidate.doc.persons).reduce(
                        (s, p) => s + p.photos.length,
                        0
                      )}{' '}
                      фото
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setImportCandidate(null)}
                  className="text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      onReplaceTree(importCandidate.doc);
                      setStatusMessage(
                        `Загружен архив «${importCandidate.doc.title}» (${
                          Object.keys(importCandidate.doc.persons).length
                        } персон).`
                      );
                      setImportCandidate(null);
                    }}
                    className="rounded-md bg-[#8B261D] px-4 py-2 text-[14.5px] font-medium text-white hover:bg-[#741E17] cursor-pointer"
                  >
                    Заменить текущее древо
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onMergeTree(importCandidate.doc);
                      setStatusMessage(
                        `В текущее древо добавлено ${
                          Object.keys(importCandidate.doc.persons).length
                        } персон из файла.`
                      );
                      setImportCandidate(null);
                    }}
                    className="rounded-md border border-stone-300 bg-white px-4 py-2 text-[14.5px] font-medium text-stone-800 hover:bg-stone-50 cursor-pointer"
                  >
                    Добавить к текущему древу
                  </button>
                </div>
              </div>
            )}
          </section>

        {/* Merge Two Genealogy Versions Section */}
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1.5 max-w-2xl">
              <div className="flex items-center gap-2">
                <GitMerge size={18} className="text-[#8B261D]" />
                <h2 className="font-editorial text-xl font-semibold text-stone-900">
                  Объединение версий родословной от разных составителей
                </h2>
              </div>
              <p className="text-[14px] leading-relaxed text-stone-600">
                Помогает аккуратно свести данные из двух версий древа (например, из вашего текущего древа и файла от родственника или из двух независимых файлов <span className="font-mono-tabular">.zip</span>, <span className="font-mono-tabular">.json</span>, <span className="font-mono-tabular">.ged</span>). Программа найдёт совпадения и позволит по каждому полю, событию, фото и родственной связи выбрать, что добавить, что заменить, а что оставить без изменений.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setMergeModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-md bg-[#8B261D] px-4 py-2 text-[14.5px] font-medium text-white hover:bg-[#741E17] transition-colors cursor-pointer shrink-0"
            >
              <GitMerge size={15} />
              <span>Объединить две базы</span>
            </button>
          </div>
        </section>

        <section className="border-t border-stone-200 pt-6 pb-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-[14.5px] text-stone-500">
              <Archive size={15} />
              <span>Управление локальным хранилищем браузера</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  onRestoreSample();
                  setStatusMessage('Загружен демонстрационный архив.');
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-[14.5px] font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
              >
                <RotateCcw size={14} />
                <span>Загрузить пример древа</span>
              </button>

              {!confirmClear ? (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-[14.5px] font-medium text-[#8B261D] hover:bg-red-50 cursor-pointer"
                >
                  <Trash2 size={14} />
                  <span>Очистить и начать с нуля</span>
                </button>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1">
                  <span className="text-[14.5px] text-red-900">Удалить все текущие записи?</span>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="text-[14.5px] text-stone-600 hover:underline cursor-pointer"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onResetToEmpty();
                      setConfirmClear(false);
                      setStatusMessage('Создано чистое семейное древо.');
                    }}
                    className="rounded bg-[#8B261D] px-2.5 py-1 text-[14.5px] font-medium text-white cursor-pointer"
                  >
                    Очистить
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {pdfPreview && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-stone-950/85"
          onClick={() => setPdfPreview(null)}
        >
          <div
            className="flex items-center justify-between border-b border-stone-800 bg-stone-900 px-6 py-3 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="font-editorial text-xl font-semibold">
                Предпросмотр печатного семейного архива
              </div>
              <div className="text-[13px] text-stone-400 font-mono-tabular">
                {pdfPreview.filename} · {pdfPreview.pageDataUrls.length} стр. (A4)
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => pdfPreview.save()}
                className="inline-flex items-center gap-2 rounded-md bg-[#8B261D] px-4 py-2 text-[14.5px] font-medium text-white hover:bg-[#741E17] cursor-pointer"
              >
                <Download size={15} />
                <span>Скачать PDF</span>
              </button>
              <button
                type="button"
                onClick={() => setPdfPreview(null)}
                className="rounded p-1.5 text-stone-300 hover:bg-stone-800 hover:text-white cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div
            className="flex-1 overflow-y-auto p-6 space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            {pdfPreview.pageDataUrls.map((url, idx) => (
              <div key={idx} className="mx-auto max-w-3xl">
                <div className="mb-1.5 text-center font-mono-tabular text-xs text-stone-400">
                  Страница {idx + 1} из {pdfPreview.pageDataUrls.length}
                </div>
                <img
                  src={url}
                  alt={`Страница архива ${idx + 1}`}
                  className="w-full rounded border border-stone-700 shadow-2xl"
                />
              </div>
            ))}
          </div>
        </div>
      )}
      {mergeModalOpen && (
        <TreeMergeModal
          currentTree={tree}
          onApplyMergedTree={(merged) => {
            onReplaceTree(merged);
            setMergeModalOpen(false);
            setStatusMessage(
              `Версии родословной объединены: ${Object.keys(merged.persons).length} чел., ${merged.unions.length} союзов.`
            );
          }}
          onClose={() => setMergeModalOpen(false)}
        />
      )}
    </div>
  );
}
