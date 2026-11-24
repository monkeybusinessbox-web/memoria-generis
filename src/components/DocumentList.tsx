import React, { useState } from 'react';
import { Download, Eye, FileText, Paperclip, Trash2, X } from 'lucide-react';
import { DocumentAttachment } from '../types/genealogy';
import { readDocumentFile } from '../utils/storage';

interface DocumentListProps {
  documents: DocumentAttachment[];
  onChange: (next: DocumentAttachment[]) => void;
  compact?: boolean;
  label?: string;
}

function getDocExtensionLabel(doc: DocumentAttachment): string {
  if (doc.mimeType === 'application/pdf' || doc.name.toLowerCase().endsWith('.pdf')) return 'PDF';
  const match = doc.name.match(/\.([a-z0-9]{2,5})$/i);
  return match ? match[1].toUpperCase() : 'ДОК';
}

export function DocumentList({
  documents,
  onChange,
  compact = false,
  label = 'Прикрепить документ',
}: DocumentListProps) {
  const [previewDoc, setPreviewDoc] = useState<DocumentAttachment | null>(null);
  const [isReading, setIsReading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsReading(true);
    try {
      const added: DocumentAttachment[] = [];
      for (let i = 0; i < files.length; i++) {
        added.push(await readDocumentFile(files[i]));
      }
      onChange([...documents, ...added]);
    } finally {
      setIsReading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Proportional thumbnails ABOVE the attach button, without filenames, with icon controls underneath */}
      {documents.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          {documents.map((doc) => {
            const isImage = doc.mimeType.startsWith('image/');
            const canPreview = isImage || doc.mimeType === 'application/pdf';
            return (
              <div
                key={doc.id}
                className="inline-flex flex-col items-center gap-1.5 rounded-lg border border-stone-200 bg-white p-2"
              >
                <button
                  type="button"
                  onClick={() => canPreview && setPreviewDoc(doc)}
                  disabled={!canPreview}
                  title={canPreview ? 'Просмотреть документ' : doc.name}
                  className={`flex items-center justify-center overflow-hidden rounded border border-stone-100 bg-stone-50 ${
                    canPreview ? 'cursor-pointer hover:border-[#8B261D]' : 'cursor-default'
                  }`}
                >
                  {isImage ? (
                    <img
                      src={doc.dataUrl}
                      alt={doc.name}
                      className="block max-h-28 max-w-[140px] w-auto h-auto object-contain"
                    />
                  ) : (
                    <div className="flex h-24 w-[70px] flex-col items-center justify-center gap-1 text-stone-600">
                      <FileText size={20} className="text-[#8B261D]" />
                      <span className="text-[10px] font-medium tracking-[0.04em]">
                        {getDocExtensionLabel(doc)}
                      </span>
                    </div>
                  )}
                </button>

                <div className="flex items-center justify-center gap-1.5 pt-0.5 border-t border-stone-100 w-full">
                  {canPreview && (
                    <button
                      type="button"
                      onClick={() => setPreviewDoc(doc)}
                      title="Просмотреть документ"
                      className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 cursor-pointer"
                    >
                      <Eye size={13} />
                    </button>
                  )}
                  <a
                    href={doc.dataUrl}
                    download={doc.name}
                    title="Скачать документ"
                    className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                  >
                    <Download size={13} />
                  </a>
                  <button
                    type="button"
                    onClick={() => onChange(documents.filter((d) => d.id !== doc.id))}
                    title="Удалить документ"
                    className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-[#8B261D] cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-stone-200 bg-stone-50 px-3 py-1.5 text-[13px] font-medium text-stone-700 hover:border-[#8B261D] hover:text-[#8B261D] transition-colors">
          <Paperclip size={13} />
          <span>{isReading ? 'Загрузка...' : label}</span>
          <input
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.doc,.docx"
            className="hidden"
            onChange={handleUpload}
          />
        </label>
        {documents.length > 0 && !compact && (
          <span className="tabular-nums text-[13px] text-stone-400">
            {documents.length} док.
          </span>
        )}
      </div>

      {previewDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/85 p-4"
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-xl bg-[#FBF9F5] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4 border-b border-stone-200 pb-2">
              <div className="text-sm font-medium text-stone-900 truncate">
                {previewDoc.name}
              </div>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                aria-label="Закрыть просмотр"
                className="rounded-full p-1 text-stone-400/75 hover:bg-stone-200/45 hover:text-stone-700 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            {previewDoc.mimeType.startsWith('image/') ? (
              <img
                src={previewDoc.dataUrl}
                alt={previewDoc.name}
                className="mx-auto max-h-[75vh] w-auto rounded object-contain"
              />
            ) : (
              <iframe
                src={previewDoc.dataUrl}
                title={previewDoc.name}
                className="h-[75vh] w-full rounded border border-stone-200 bg-white"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
