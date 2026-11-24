import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Download,
  GitMerge,
  Heart,
  Link2,
  Link2Off,
  Plus,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { TreeDocument } from '../types/genealogy';
import { formatFullName, formatLifespan } from '../utils/dateUtils';
import {
  exportTreeToJsonFile,
  exportTreeToZipFile,
  importArchiveFromFile,
} from '../utils/exportImport';
import {
  FieldChoice,
  MergeDecisions,
  analyzeTreeMerge,
  applyTreeMerge,
  buildDefaultMergeDecisions,
  formatEventSummaryForMerge,
} from '../utils/treeMerge';

interface TreeMergeModalProps {
  currentTree: TreeDocument;
  onApplyMergedTree: (merged: TreeDocument) => void;
  onClose: () => void;
}

type MergeTab = 'matched' | 'new_persons' | 'relations' | 'photos';

export function TreeMergeModal({
  currentTree,
  onApplyMergedTree,
  onClose,
}: TreeMergeModalProps) {
  const [sourceAMode, setSourceAMode] = useState<'current' | 'file'>('current');
  const [fileATree, setFileATree] = useState<{ name: string; doc: TreeDocument } | null>(null);
  const [fileBTree, setFileBTree] = useState<{ name: string; doc: TreeDocument } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [activeTab, setActiveTab] = useState<MergeTab>('matched');
  const [isExporting, setIsExporting] = useState(false);

  const [manualPersonMap, setManualPersonMap] = useState<
    Record<string, string | 'skip' | undefined>
  >({});
  const [fieldChoices, setFieldChoices] = useState<Record<string, FieldChoice>>({});
  const [eventChoices, setEventChoices] = useState<Record<string, boolean>>({});
  const [photoChoices, setPhotoChoices] = useState<Record<string, boolean>>({});
  const [docChoices, setDocChoices] = useState<Record<string, boolean>>({});
  const [unionInclude, setUnionInclude] = useState<Record<string, boolean>>({});
  const [unionFieldChoices, setUnionFieldChoices] = useState<Record<string, FieldChoice>>({});
  const [linkInclude, setLinkInclude] = useState<Record<string, boolean>>({});
  const [archivePhotoInclude, setArchivePhotoInclude] = useState<Record<string, boolean>>({});
  const [titleSource, setTitleSource] = useState<'a' | 'b'>('a');

  const baseTree = sourceAMode === 'current' ? currentTree : fileATree?.doc || null;
  const incomingTree = fileBTree?.doc || null;

  const analysis = useMemo(() => {
    if (!isReviewing || !baseTree || !incomingTree) return null;
    return analyzeTreeMerge(baseTree, incomingTree, manualPersonMap);
  }, [baseTree, incomingTree, isReviewing, manualPersonMap]);

  const basePeopleSorted = useMemo(() => {
    if (!baseTree) return [];
    return Object.values(baseTree.persons).sort((a, b) =>
      formatFullName(a).localeCompare(formatFullName(b), 'ru')
    );
  }, [baseTree]);

  const handleLoadFile = async (
    slot: 'a' | 'b',
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadError(null);
    try {
      const doc = await importArchiveFromFile(file);
      if (slot === 'a') {
        setFileATree({ name: file.name, doc });
        setSourceAMode('file');
      } else {
        setFileBTree({ name: file.name, doc });
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Не удалось прочитать выбранный файл'
      );
    } finally {
      e.target.value = '';
    }
  };

  const handleStartReview = () => {
    if (!baseTree || !incomingTree) return;
    const initialAnalysis = analyzeTreeMerge(baseTree, incomingTree, {});
    const defaults = buildDefaultMergeDecisions(initialAnalysis);
    setManualPersonMap({});
    setFieldChoices(defaults.fieldChoices);
    setEventChoices(defaults.eventChoices);
    setPhotoChoices(defaults.photoChoices);
    setDocChoices(defaults.docChoices);
    setUnionInclude(defaults.unionInclude);
    setUnionFieldChoices(defaults.unionFieldChoices);
    setLinkInclude(defaults.linkInclude);
    setArchivePhotoInclude(defaults.archivePhotoInclude);
    setTitleSource('a');
    setIsReviewing(true);
    if (initialAnalysis.matchedWithChanges.length > 0) {
      setActiveTab('matched');
    } else if (initialAnalysis.unmatchedB.length > 0) {
      setActiveTab('new_persons');
    } else if (
      initialAnalysis.unions.length > 0 ||
      initialAnalysis.parentChildLinks.length > 0
    ) {
      setActiveTab('relations');
    } else {
      setActiveTab('photos');
    }
  };

  const currentDecisions: MergeDecisions = useMemo(
    () => ({
      manualPersonMap,
      fieldChoices,
      eventChoices,
      photoChoices,
      docChoices,
      unionInclude,
      unionFieldChoices,
      linkInclude,
      archivePhotoInclude,
      titleSource,
    }),
    [
      archivePhotoInclude,
      docChoices,
      eventChoices,
      fieldChoices,
      linkInclude,
      manualPersonMap,
      photoChoices,
      titleSource,
      unionFieldChoices,
      unionInclude,
    ]
  );

  const summary = useMemo(() => {
    if (!analysis) {
      return {
        addedPersons: 0,
        skippedPersons: 0,
        updatedFields: 0,
        conflictsCount: 0,
        addedEvents: 0,
        addedPhotos: 0,
        addedRelations: 0,
      };
    }
    let addedPersons = 0;
    let skippedPersons = 0;
    for (const u of analysis.unmatchedB) {
      if (manualPersonMap[u.personB.id] === 'skip') skippedPersons += 1;
      else addedPersons += 1;
    }

    let updatedFields = 0;
    let conflictsCount = 0;
    let addedEvents = 0;
    let addedPhotos = 0;

    for (const m of analysis.matchedWithChanges) {
      for (const fd of m.fieldDiffs) {
        if (fd.kind === 'conflict') conflictsCount += 1;
        const ch =
          fieldChoices[`${m.personA.id}:${fd.key}`] ??
          (fd.kind === 'addition' ? 'take_b' : 'keep_a');
        if (ch !== 'keep_a') updatedFields += 1;
      }
      for (const ev of m.eventAdditions) {
        if (eventChoices[`${m.personA.id}:${ev.id}`] ?? true) addedEvents += 1;
      }
      for (const ph of m.photoAdditions) {
        if (photoChoices[`${m.personA.id}:${ph.id}`] ?? true) addedPhotos += 1;
      }
    }

    for (const ap of analysis.newArchivePhotos) {
      if (archivePhotoInclude[ap.id] ?? true) addedPhotos += 1;
    }

    let addedRelations = 0;
    for (const u of analysis.unions) {
      if (u.kind === 'new' && (unionInclude[u.id] ?? true)) addedRelations += 1;
    }
    for (const l of analysis.parentChildLinks) {
      if (linkInclude[l.id] ?? true) addedRelations += 1;
    }

    return {
      addedPersons,
      skippedPersons,
      updatedFields,
      conflictsCount,
      addedEvents,
      addedPhotos,
      addedRelations,
    };
  }, [
    analysis,
    archivePhotoInclude,
    eventChoices,
    fieldChoices,
    linkInclude,
    manualPersonMap,
    photoChoices,
    unionInclude,
  ]);

  const handleApplyPreset = (preset: 'safe_additions' | 'prefer_a' | 'prefer_b') => {
    if (!analysis) return;
    const nextFields: Record<string, FieldChoice> = { ...fieldChoices };
    const nextUnionFields: Record<string, FieldChoice> = { ...unionFieldChoices };

    for (const m of analysis.matchedWithChanges) {
      for (const fd of m.fieldDiffs) {
        const key = `${m.personA.id}:${fd.key}`;
        if (preset === 'prefer_a') {
          nextFields[key] = 'keep_a';
        } else if (preset === 'prefer_b') {
          nextFields[key] = 'take_b';
        } else {
          nextFields[key] = fd.kind === 'addition' ? 'take_b' : 'keep_a';
        }
      }
    }
    for (const u of analysis.unions) {
      for (const df of u.diffFields) {
        const key = `${u.id}:${df.key}`;
        if (preset === 'prefer_a') nextUnionFields[key] = 'keep_a';
        else if (preset === 'prefer_b') nextUnionFields[key] = 'take_b';
        else nextUnionFields[key] = df.isAddition ? 'take_b' : 'keep_a';
      }
    }
    setFieldChoices(nextFields);
    setUnionFieldChoices(nextUnionFields);
  };

  const handleLinkManualPair = (bId: string, aId: string) => {
    if (!baseTree || !incomingTree) return;
    const nextMap = { ...manualPersonMap, [bId]: aId };
    setManualPersonMap(nextMap);
    const updatedAnalysis = analyzeTreeMerge(baseTree, incomingTree, nextMap);
    const matchedEntry = updatedAnalysis.matchedWithChanges.find(
      (m) => m.personB.id === bId && m.personA.id === aId
    );
    if (matchedEntry) {
      const defaults = buildDefaultMergeDecisions(updatedAnalysis);
      setFieldChoices((prev) => ({ ...defaults.fieldChoices, ...prev }));
      setEventChoices((prev) => ({ ...defaults.eventChoices, ...prev }));
      setPhotoChoices((prev) => ({ ...defaults.photoChoices, ...prev }));
      setDocChoices((prev) => ({ ...defaults.docChoices, ...prev }));
    }
  };

  const handleUnlinkMatchedPair = (bId: string) => {
    // Store an explicit sentinel so auto-matcher won't re-pair this person
    setManualPersonMap((prev) => ({ ...prev, [bId]: 'unlinked_' + bId }));
  };

  const buildMergedDocument = (): TreeDocument | null => {
    if (!baseTree || !incomingTree || !analysis) return null;
    return applyTreeMerge(baseTree, incomingTree, analysis, currentDecisions);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/75 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#FBF9F5] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="flex items-center justify-between border-b border-stone-200 bg-white px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-2.5">
            <GitMerge size={19} className="text-[#8B261D]" />
            <div>
              <h2 className="font-editorial text-lg sm:text-xl font-normal text-[#78716C] uppercase tracking-[0.04em]">
                ОБЪЕДИНЕНИЕ ВЕРСИЙ РОДОСЛОВНОЙ
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть мастер объединения"
            className="rounded-full p-1.5 text-stone-400/75 hover:bg-stone-200/45 hover:text-stone-700 cursor-pointer"
          >
            <X size={17} />
          </button>
        </div>

        {/* Step 1: Select Sources A & B */}
        {!isReviewing || !analysis ? (
          <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-6">
            <p className="text-[15px] leading-relaxed text-stone-700 max-w-3xl">
              Выберите две версии родословной (например, вашу базу и дополненный файл от родственника или две независимые версии в форматах <span className="font-mono-tabular">.zip</span>, <span className="font-mono-tabular">.json</span> или <span className="font-mono-tabular">.ged</span>). Программа найдёт совпадения и покажет каждое отличие, чтобы вы сами решили, что добавить, что заменить, а что оставить без изменений.
            </p>

            {loadError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-900">
                <AlertCircle size={16} className="shrink-0" />
                <span>{loadError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Source A */}
              <div className="flex flex-col justify-between rounded-xl border border-stone-200 bg-white p-5 space-y-4">
                <div className="space-y-3">
                  <div className="text-[13px] font-medium uppercase tracking-[0.04em] text-stone-500">
                    База А (основная версия)
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSourceAMode('current')}
                      className={`rounded-md border px-3 py-1.5 text-[14px] transition-colors cursor-pointer ${
                        sourceAMode === 'current'
                          ? 'border-[#8B261D] bg-[#8B261D] text-white'
                          : 'border-stone-200 bg-[#FBF9F5] text-stone-700 hover:border-stone-300'
                      }`}
                    >
                      Текущее древо в программе
                    </button>
                    <label
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-[14px] transition-colors ${
                        sourceAMode === 'file'
                          ? 'border-[#8B261D] bg-[#8B261D] text-white'
                          : 'border-stone-200 bg-[#FBF9F5] text-stone-700 hover:border-stone-300'
                      }`}
                    >
                      <Upload size={14} />
                      <span>Загрузить файл А</span>
                      <input
                        type="file"
                        accept=".json,.zip,.ged,.gedcom"
                        className="hidden"
                        onChange={(e) => handleLoadFile('a', e)}
                      />
                    </label>
                  </div>

                  {baseTree ? (
                    <div className="rounded-lg border border-stone-200 bg-[#FBF9F5] p-3.5 space-y-1">
                      <div className="text-[12.5px] text-stone-500">
                        {sourceAMode === 'current'
                          ? 'Открыто сейчас в браузере'
                          : `Файл: ${fileATree?.name}`}
                      </div>
                      <div className="font-editorial text-lg font-medium text-stone-900">
                        {baseTree.title || 'Семейное древо'}
                      </div>
                      <div className="text-[13.5px] text-stone-600 font-mono-tabular">
                        {Object.keys(baseTree.persons).length} чел. · {baseTree.unions.length} союзов ·{' '}
                        {Object.values(baseTree.persons).reduce((s, p) => s + p.photos.length, 0) +
                          (baseTree.archivePhotos?.length || 0)}{' '}
                        фото
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-stone-300 p-4 text-center text-[13.5px] text-stone-500">
                      Загрузите первый файл (.zip, .json, .ged) или выберите текущее древо.
                    </div>
                  )}
                </div>
              </div>

              {/* Source B */}
              <div className="flex flex-col justify-between rounded-xl border border-stone-200 bg-white p-5 space-y-4">
                <div className="space-y-3">
                  <div className="text-[13px] font-medium uppercase tracking-[0.04em] text-stone-500">
                    База Б (дополняемая / вторая версия)
                  </div>

                  <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-[#FBF9F5] px-4 py-5 text-center hover:border-[#8B261D] transition-colors">
                    <Upload size={20} className="text-[#8B261D]" />
                    <span className="text-[14.5px] font-medium text-stone-800">
                      {fileBTree ? 'Выбрать другой файл Б' : 'Загрузить файл Б (.zip, .json, .ged)'}
                    </span>
                    <input
                      type="file"
                      accept=".json,.zip,.ged,.gedcom"
                      className="hidden"
                      onChange={(e) => handleLoadFile('b', e)}
                    />
                  </label>

                  {fileBTree && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-1">
                      <div className="text-[12.5px] text-emerald-800">
                        Файл: {fileBTree.name}
                      </div>
                      <div className="font-editorial text-lg font-medium text-stone-900">
                        {fileBTree.doc.title || 'Импортированная версия'}
                      </div>
                      <div className="text-[13.5px] text-stone-600 font-mono-tabular">
                        {Object.keys(fileBTree.doc.persons).length} чел. ·{' '}
                        {fileBTree.doc.unions.length} союзов ·{' '}
                        {Object.values(fileBTree.doc.persons).reduce(
                          (s, p) => s + p.photos.length,
                          0
                        ) + (fileBTree.doc.archivePhotos?.length || 0)}{' '}
                        фото
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-stone-200 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-4 py-2 text-[14.5px] text-stone-600 hover:bg-stone-200/60 cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!baseTree || !incomingTree}
                onClick={handleStartReview}
                className="inline-flex items-center gap-2 rounded-md bg-[#8B261D] px-5 py-2 text-[14.5px] font-medium text-white hover:bg-[#741E17] disabled:opacity-40 cursor-pointer"
              >
                <GitMerge size={16} />
                <span>Сравнить и разобрать отличия</span>
              </button>
            </div>
          </div>
        ) : (
          /* Step 2: Interactive Diff & Decision Review */
          <>
            {/* Sub-header with Presets & Tabs */}
            <div className="border-b border-stone-200 bg-white px-5 py-3 space-y-3 shrink-0">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
                <div className="flex flex-wrap items-center gap-2 text-stone-600">
                  <button
                    type="button"
                    onClick={() => setIsReviewing(false)}
                    className="text-[#8B261D] hover:underline font-medium cursor-pointer"
                  >
                    ← Изменить файлы
                  </button>
                  <span aria-hidden="true">·</span>
                  <span>
                    Совпало без отличий: <strong>{analysis.matchedIdentical.length}</strong> чел.
                  </span>
                  {baseTree && incomingTree && baseTree.title !== incomingTree.title && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1.5">
                        <span>Название древа:</span>
                        <select
                          value={titleSource}
                          onChange={(e) => setTitleSource(e.target.value as 'a' | 'b')}
                          className="rounded border border-stone-200 bg-[#FBF9F5] px-2 py-0.5 text-[13px] text-stone-800 cursor-pointer"
                        >
                          <option value="a">А: «{baseTree.title}»</option>
                          <option value="b">Б: «{incomingTree.title}»</option>
                        </select>
                      </span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('safe_additions')}
                    className="rounded border border-stone-200 bg-[#FBF9F5] px-2.5 py-1 text-[12.5px] text-stone-700 hover:border-stone-300 cursor-pointer"
                  >
                    Только дополнить пустое
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('prefer_a')}
                    className="rounded border border-stone-200 bg-white px-2.5 py-1 text-[12.5px] text-stone-700 hover:border-stone-300 cursor-pointer"
                  >
                    В конфликтах: А
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('prefer_b')}
                    className="rounded border border-stone-200 bg-white px-2.5 py-1 text-[12.5px] text-stone-700 hover:border-stone-300 cursor-pointer"
                  >
                    В конфликтах: Б
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    {
                      id: 'matched',
                      label: `Изменения и конфликты (${analysis.matchedWithChanges.length})`,
                    },
                    {
                      id: 'new_persons',
                      label: `Новые персоны (${analysis.unmatchedB.length})`,
                    },
                    {
                      id: 'relations',
                      label: `Связи и союзы (${
                        analysis.unions.length + analysis.parentChildLinks.length
                      })`,
                    },
                    ...(analysis.newArchivePhotos.length > 0
                      ? [
                          {
                            id: 'photos' as const,
                            label: `Фотоархив (${analysis.newArchivePhotos.length})`,
                          },
                        ]
                      : []),
                  ] as Array<{ id: MergeTab; label: string }>
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-md border px-3 py-1.5 text-[13.5px] font-medium transition-colors cursor-pointer ${
                      activeTab === tab.id
                        ? 'border-[#8B261D] bg-[#8B261D] text-white'
                        : 'border-stone-200 bg-[#FBF9F5] text-stone-700 hover:border-stone-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Review Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {activeTab === 'matched' && (
                <>
                  {analysis.matchedWithChanges.length === 0 ? (
                    <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-[15px] text-stone-500">
                      У совпавших персон нет отличий или новых полей.
                    </div>
                  ) : (
                    analysis.matchedWithChanges.map((m) => (
                      <div
                        key={m.personA.id}
                        className="rounded-xl border border-stone-200 bg-white p-4 sm:p-5 space-y-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-stone-100 pb-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-editorial text-lg font-semibold text-stone-900">
                                {formatFullName(m.personA)}
                              </h3>
                              <span className="font-editorial tabular-nums text-sm text-stone-500">
                                ({formatLifespan(m.personA)})
                              </span>
                            </div>
                            <div className="mt-0.5 text-[12.5px] text-stone-500">
                              {m.matchKind === 'id'
                                ? 'Совпадение по идентификатору записи'
                                : m.matchKind === 'manual'
                                ? 'Сопоставлено вами вручную'
                                : m.matchKind === 'auto_exact'
                                ? 'Найдено точное совпадение по ФИО и датам'
                                : 'Найдено вероятное совпадение (проверьте данные)'}
                              {formatFullName(m.personA) !== formatFullName(m.personB) && (
                                <> · В базе Б: «{formatFullName(m.personB)}»</>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleUnlinkMatchedPair(m.personB.id)}
                            title="Если это два разных человека, разъедините их"
                            className="inline-flex items-center gap-1 rounded border border-stone-200 px-2.5 py-1 text-[12.5px] text-stone-600 hover:border-[#8B261D] hover:text-[#8B261D] cursor-pointer"
                          >
                            <Link2Off size={13} />
                            <span>Это разные люди</span>
                          </button>
                        </div>

                        {/* Field Diffs */}
                        {m.fieldDiffs.length > 0 && (
                          <div className="space-y-2.5">
                            {m.fieldDiffs.map((fd) => {
                              const key = `${m.personA.id}:${fd.key}`;
                              const choice =
                                fieldChoices[key] ??
                                (fd.kind === 'addition' ? 'take_b' : 'keep_a');

                              return (
                                <div
                                  key={fd.key}
                                  className={`rounded-lg border p-3 ${
                                    fd.kind === 'addition'
                                      ? 'border-emerald-200 bg-emerald-50/35'
                                      : 'border-amber-200 bg-amber-50/35'
                                  }`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2 text-[13.5px] font-medium text-stone-800">
                                      <span>{fd.label}</span>
                                      <span
                                        className={`rounded px-1.5 py-0.5 text-[11.5px] ${
                                          fd.kind === 'addition'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : 'bg-amber-100 text-amber-900'
                                        }`}
                                      >
                                        {fd.kind === 'addition'
                                          ? 'Новое сведение'
                                          : 'Отличие (конфликт)'}
                                      </span>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setFieldChoices((prev) => ({
                                            ...prev,
                                            [key]: 'keep_a',
                                          }))
                                        }
                                        className={`rounded border px-2.5 py-1 cursor-pointer ${
                                          choice === 'keep_a'
                                            ? 'border-stone-900 bg-stone-900 text-white'
                                            : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
                                        }`}
                                      >
                                        {fd.kind === 'addition' ? 'Не добавлять' : 'Оставить А'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setFieldChoices((prev) => ({
                                            ...prev,
                                            [key]: 'take_b',
                                          }))
                                        }
                                        className={`rounded border px-2.5 py-1 cursor-pointer ${
                                          choice === 'take_b'
                                            ? 'border-[#8B261D] bg-[#8B261D] text-white'
                                            : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
                                        }`}
                                      >
                                        {fd.kind === 'addition' ? 'Добавить из Б' : 'Взять из Б'}
                                      </button>
                                      {fd.canCombine && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setFieldChoices((prev) => ({
                                              ...prev,
                                              [key]: 'combine',
                                            }))
                                          }
                                          className={`rounded border px-2.5 py-1 cursor-pointer ${
                                            choice === 'combine'
                                              ? 'border-[#15803D] bg-[#15803D] text-white'
                                              : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
                                          }`}
                                        >
                                          Объединить оба
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[14px]">
                                    <div className="rounded border border-stone-200/80 bg-white px-3 py-2">
                                      <div className="text-[11.5px] text-stone-400 mb-0.5">
                                        Версия А
                                      </div>
                                      <div className="text-stone-800 whitespace-pre-wrap break-words">
                                        {fd.displayA || (
                                          <span className="italic text-stone-400">Пусто</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="rounded border border-stone-200/80 bg-white px-3 py-2">
                                      <div className="text-[11.5px] text-stone-400 mb-0.5">
                                        Версия Б
                                      </div>
                                      <div className="text-stone-900 whitespace-pre-wrap break-words">
                                        {fd.displayB}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* New Events from B */}
                        {m.eventAdditions.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-[13px] font-medium text-stone-600">
                              Новые события из версии Б:
                            </div>
                            {m.eventAdditions.map((evAdd) => {
                              const k = `${m.personA.id}:${evAdd.id}`;
                              const checked = eventChoices[k] ?? true;
                              return (
                                <label
                                  key={evAdd.id}
                                  className="flex items-start gap-2.5 rounded-lg border border-stone-200 bg-[#FBF9F5] px-3 py-2 text-[14px] cursor-pointer hover:border-stone-300"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) =>
                                      setEventChoices((prev) => ({
                                        ...prev,
                                        [k]: e.target.checked,
                                      }))
                                    }
                                    className="mt-1 h-4 w-4 rounded border-stone-300 text-[#8B261D]"
                                  />
                                  <span className="text-stone-800">
                                    {formatEventSummaryForMerge(evAdd.event)}
                                    {evAdd.event.description && (
                                      <span className="block text-[13px] text-stone-500 mt-0.5">
                                        {evAdd.event.description}
                                      </span>
                                    )}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}

                        {/* New Photos from B */}
                        {m.photoAdditions.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-[13px] font-medium text-stone-600">
                              Новые фотографии из версии Б:
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {m.photoAdditions.map((phAdd) => {
                                const k = `${m.personA.id}:${phAdd.id}`;
                                const checked = photoChoices[k] ?? true;
                                return (
                                  <label
                                    key={phAdd.id}
                                    className="flex items-center gap-3 rounded-lg border border-stone-200 bg-[#FBF9F5] p-2 cursor-pointer hover:border-stone-300"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) =>
                                        setPhotoChoices((prev) => ({
                                          ...prev,
                                          [k]: e.target.checked,
                                        }))
                                      }
                                      className="h-4 w-4 rounded border-stone-300 text-[#8B261D] shrink-0"
                                    />
                                    <img
                                      src={phAdd.photo.dataUrl}
                                      alt={phAdd.photo.caption || 'Фото'}
                                      className="h-12 w-12 rounded object-cover border border-stone-200 shrink-0"
                                    />
                                    <div className="min-w-0 text-[13.5px]">
                                      <div className="text-stone-900 truncate">
                                        {phAdd.photo.caption || 'Фотография'}
                                      </div>
                                      {phAdd.photo.year && (
                                        <div className="text-stone-500 text-[12.5px]">
                                          {phAdd.photo.year}
                                        </div>
                                      )}
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* New Documents from B */}
                        {m.docAdditions.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-[13px] font-medium text-stone-600">
                              Новые документы из версии Б:
                            </div>
                            {m.docAdditions.map((dAdd) => {
                              const k = `${m.personA.id}:${dAdd.id}`;
                              const checked = docChoices[k] ?? true;
                              return (
                                <label
                                  key={dAdd.id}
                                  className="flex items-center gap-2.5 rounded-lg border border-stone-200 bg-[#FBF9F5] px-3 py-2 text-[14px] cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) =>
                                      setDocChoices((prev) => ({
                                        ...prev,
                                        [k]: e.target.checked,
                                      }))
                                    }
                                    className="h-4 w-4 rounded border-stone-300 text-[#8B261D]"
                                  />
                                  <span className="text-stone-800 truncate">
                                    {dAdd.kind === 'birth' ? 'Рождение: ' : 'Смерть: '}
                                    {dAdd.doc.name}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </>
              )}

              {activeTab === 'new_persons' && (
                <>
                  {analysis.unmatchedB.length === 0 ? (
                    <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-[15px] text-stone-500">
                      Все персоны из версии Б уже сопоставлены с базой А.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {analysis.unmatchedB.map(({ personB, suggestedPersonAId }) => {
                        const action = manualPersonMap[personB.id];
                        const isSkipped = action === 'skip';
                        const usedASet = new Set(Object.values(analysis.resolvedBToA));
                        const availableA = basePeopleSorted.filter((a) => !usedASet.has(a.id));

                        return (
                          <div
                            key={personB.id}
                            className={`rounded-xl border p-4 transition-colors ${
                              isSkipped
                                ? 'border-stone-200 bg-stone-100/70 opacity-75'
                                : 'border-stone-200 bg-white'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <UserPlus size={16} className="text-[#15803D] shrink-0" />
                                  <span className="font-editorial text-lg font-medium text-stone-900">
                                    {formatFullName(personB)}
                                  </span>
                                  <span className="font-editorial tabular-nums text-sm text-stone-500">
                                    ({formatLifespan(personB)})
                                  </span>
                                </div>
                                {(personB.birthPlace || personB.occupation) && (
                                  <div className="mt-1 text-[13.5px] text-stone-500">
                                    {[personB.birthPlace, personB.occupation]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </div>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setManualPersonMap((prev) => ({
                                      ...prev,
                                      [personB.id]: undefined,
                                    }))
                                  }
                                  className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[13.5px] cursor-pointer ${
                                    !isSkipped
                                      ? 'border-[#15803D] bg-[#15803D] text-white'
                                      : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
                                  }`}
                                >
                                  <Plus size={14} />
                                  <span>Добавить</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setManualPersonMap((prev) => ({
                                      ...prev,
                                      [personB.id]: 'skip',
                                    }))
                                  }
                                  className={`rounded-md border px-3 py-1.5 text-[13.5px] cursor-pointer ${
                                    isSkipped
                                      ? 'border-stone-800 bg-stone-800 text-white'
                                      : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
                                  }`}
                                >
                                  Не добавлять
                                </button>
                              </div>
                            </div>

                            {availableA.length > 0 && (
                              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-2.5 text-[13px] text-stone-600">
                                <Link2 size={14} className="text-stone-400" />
                                <span>Или связать с уже имеющимся человеком в базе А:</span>
                                <select
                                  value=""
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      handleLinkManualPair(personB.id, e.target.value);
                                    }
                                  }}
                                  className="max-w-xs rounded border border-stone-200 bg-[#FBF9F5] px-2.5 py-1 text-[13.5px] text-stone-800 cursor-pointer"
                                >
                                  <option value="">Выберите персону из А...</option>
                                  {suggestedPersonAId && baseTree?.persons[suggestedPersonAId] && (
                                    <option value={suggestedPersonAId}>
                                      ★ Похожая: {formatFullName(baseTree.persons[suggestedPersonAId])}
                                    </option>
                                  )}
                                  {availableA.map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {formatFullName(a)} ({formatLifespan(a)})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {activeTab === 'relations' && (
                <>
                  {analysis.unions.length === 0 && analysis.parentChildLinks.length === 0 ? (
                    <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-[15px] text-stone-500">
                      Новых союзов и родственных связей не обнаружено.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {analysis.unions.length > 0 && (
                        <div className="space-y-2.5">
                          <div className="text-[14px] font-medium text-stone-700">
                            Браки и союзы ({analysis.unions.length})
                          </div>
                          {analysis.unions.map((u) => {
                            const checked = unionInclude[u.id] ?? true;
                            return (
                              <div
                                key={u.id}
                                className="rounded-xl border border-stone-200 bg-white p-4 space-y-2.5"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 text-[15px] text-stone-900">
                                    <Heart size={15} className="text-[#8B261D] shrink-0" />
                                    <span className="font-medium">
                                      {u.partnerLabels[0]} — {u.partnerLabels[1]}
                                    </span>
                                    <span className="rounded bg-stone-100 px-2 py-0.5 text-[12px] text-stone-600">
                                      {u.kind === 'new' ? 'Новый союз' : 'Уточнение союза'}
                                    </span>
                                  </div>

                                  {u.kind === 'new' && (
                                    <label className="inline-flex items-center gap-2 text-[13.5px] text-stone-700 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) =>
                                          setUnionInclude((prev) => ({
                                            ...prev,
                                            [u.id]: e.target.checked,
                                          }))
                                        }
                                        className="h-4 w-4 rounded border-stone-300 text-[#8B261D]"
                                      />
                                      <span>Добавить союз</span>
                                    </label>
                                  )}
                                </div>

                                {u.kind === 'new' && (u.unionB.marriageDate || u.unionB.marriagePlace) && (
                                  <div className="text-[13.5px] text-stone-500">
                                    {[u.unionB.marriageDate, u.unionB.marriagePlace]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </div>
                                )}

                                {u.diffFields.map((df) => {
                                  const key = `${u.id}:${df.key}`;
                                  const ch =
                                    unionFieldChoices[key] ??
                                    (df.isAddition ? 'take_b' : 'keep_a');
                                  return (
                                    <div
                                      key={df.key}
                                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-[#FBF9F5] px-3 py-2 text-[13.5px]"
                                    >
                                      <div>
                                        <span className="font-medium text-stone-800">
                                          {df.label}:
                                        </span>{' '}
                                        <span className="text-stone-500">
                                          А: «{df.valA || 'пусто'}»
                                        </span>{' '}
                                        →{' '}
                                        <span className="text-stone-900">Б: «{df.valB}»</span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setUnionFieldChoices((prev) => ({
                                              ...prev,
                                              [key]: 'keep_a',
                                            }))
                                          }
                                          className={`rounded border px-2 py-0.5 text-[12.5px] cursor-pointer ${
                                            ch === 'keep_a'
                                              ? 'border-stone-900 bg-stone-900 text-white'
                                              : 'border-stone-200 bg-white text-stone-700'
                                          }`}
                                        >
                                          Оставить А
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setUnionFieldChoices((prev) => ({
                                              ...prev,
                                              [key]: 'take_b',
                                            }))
                                          }
                                          className={`rounded border px-2 py-0.5 text-[12.5px] cursor-pointer ${
                                            ch === 'take_b'
                                              ? 'border-[#8B261D] bg-[#8B261D] text-white'
                                              : 'border-stone-200 bg-white text-stone-700'
                                          }`}
                                        >
                                          Взять Б
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {analysis.parentChildLinks.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[14px] font-medium text-stone-700">
                            Связи «Родитель — Ребёнок» ({analysis.parentChildLinks.length})
                          </div>
                          {analysis.parentChildLinks.map((l) => {
                            const checked = linkInclude[l.id] ?? true;
                            return (
                              <label
                                key={l.id}
                                className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-[14.5px] cursor-pointer hover:border-stone-300"
                              >
                                <span className="flex items-center gap-2 text-stone-900">
                                  <Users size={15} className="text-stone-400 shrink-0" />
                                  <span>
                                    <strong>{l.parentLabel}</strong> → {l.childLabel}
                                  </span>
                                </span>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    setLinkInclude((prev) => ({
                                      ...prev,
                                      [l.id]: e.target.checked,
                                    }))
                                  }
                                  className="h-4 w-4 rounded border-stone-300 text-[#8B261D]"
                                />
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {activeTab === 'photos' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {analysis.newArchivePhotos.map((ap) => {
                    const checked = archivePhotoInclude[ap.id] ?? true;
                    return (
                      <label
                        key={ap.id}
                        className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-3 cursor-pointer hover:border-stone-300"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setArchivePhotoInclude((prev) => ({
                              ...prev,
                              [ap.id]: e.target.checked,
                            }))
                          }
                          className="h-4 w-4 rounded border-stone-300 text-[#8B261D]"
                        />
                        <img
                          src={ap.dataUrl}
                          alt={ap.caption || 'Материал фотоархива'}
                          className="h-14 w-14 rounded object-cover border border-stone-200 shrink-0"
                        />
                        <div className="min-w-0 text-[14px]">
                          <div className="text-stone-900 truncate">
                            {ap.caption || 'Без названия'}
                          </div>
                          {(ap.date || ap.year) && (
                            <div className="text-[12.5px] text-stone-500">
                              {ap.date || ap.year}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-white px-5 py-3.5 shrink-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px] text-stone-600">
                <CheckCircle2 size={15} className="text-[#15803D] shrink-0" />
                <span>
                  Новых персон: <strong>+{summary.addedPersons}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Уточнений полей: <strong>{summary.updatedFields}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Событий: <strong>+{summary.addedEvents}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Связей: <strong>+{summary.addedRelations}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Фото: <strong>+{summary.addedPhotos}</strong>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={async () => {
                    const merged = buildMergedDocument();
                    if (!merged) return;
                    setIsExporting(true);
                    try {
                      await exportTreeToZipFile(merged);
                    } finally {
                      setIsExporting(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-2 text-[14px] text-stone-700 hover:bg-stone-50 cursor-pointer"
                >
                  <Download size={14} />
                  <span>Скачать ZIP</span>
                </button>
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={async () => {
                    const merged = buildMergedDocument();
                    if (!merged) return;
                    setIsExporting(true);
                    try {
                      await exportTreeToJsonFile(merged);
                    } finally {
                      setIsExporting(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-2 text-[14px] text-stone-700 hover:bg-stone-50 cursor-pointer"
                >
                  <Download size={14} />
                  <span>Скачать JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const merged = buildMergedDocument();
                    if (!merged) return;
                    onApplyMergedTree(merged);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#8B261D] px-4 py-2 text-[14.5px] text-white hover:bg-[#741E17] cursor-pointer"
                >
                  <Check size={15} />
                  <span>Применить в программу</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
