import { HelpCircle, ShieldCheck, CircleDashed } from 'lucide-react';
import { VerificationStatus } from '../types/genealogy';

interface VerificationIconProps {
  status: VerificationStatus;
  showLabel?: boolean;
  size?: number;
  className?: string;
}

export function VerificationIcon({
  status,
  showLabel = false,
  size = 15,
  className = '',
}: VerificationIconProps) {
  if (status === 'confirmed') {
    return (
      <span
        className={`inline-flex items-center gap-1 leading-none text-[#15803D] ${className}`}
        title="Подтверждено"
        aria-label="Подтверждено"
      >
        <ShieldCheck size={size} strokeWidth={2} className="shrink-0" />
        {showLabel && <span className="text-[14.5px] font-medium whitespace-nowrap">Подтверждено</span>}
      </span>
    );
  }

  if (status === 'possible') {
    return (
      <span
        className={`inline-flex items-center gap-1 leading-none text-[#B45309] ${className}`}
        title="Возможно (требует уточнения)"
        aria-label="Возможно"
      >
        <HelpCircle size={size} strokeWidth={2} className="shrink-0" />
        {showLabel && <span className="text-[14.5px] font-medium whitespace-nowrap">Возможно</span>}
      </span>
    );
  }

  if (showLabel) {
    return (
      <span
        className={`inline-flex items-center gap-1 leading-none text-stone-400 ${className}`}
        title="Статус не задан"
      >
        <CircleDashed size={size} strokeWidth={1.75} className="shrink-0" />
        <span className="text-[14.5px] whitespace-nowrap">Не отмечено</span>
      </span>
    );
  }

  return null;
}

interface VerificationSelectorProps {
  value: VerificationStatus;
  onChange: (next: VerificationStatus) => void;
  compact?: boolean;
}

export function VerificationSelector({
  value,
  onChange,
  compact = false,
}: VerificationSelectorProps) {
  return (
    <div
      className="inline-flex items-center rounded-md border border-stone-200 bg-stone-50 p-0.5"
      role="group"
      aria-label="Достоверность сведений"
    >
      <button
        type="button"
        onClick={() => onChange('confirmed')}
        title="Подтверждено"
        className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[14.5px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          value === 'confirmed'
            ? 'bg-white text-[#15803D] shadow-xs ring-1 ring-stone-200/80'
            : 'text-stone-600 hover:text-stone-900'
        }`}
      >
        <ShieldCheck size={15} />
        {!compact && <span>Подтверждено</span>}
      </button>

      <button
        type="button"
        onClick={() => onChange('possible')}
        title="Возможно"
        className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[14.5px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          value === 'possible'
            ? 'bg-white text-[#B45309] shadow-xs ring-1 ring-stone-200/80'
            : 'text-stone-600 hover:text-stone-900'
        }`}
      >
        <HelpCircle size={15} />
        {!compact && <span>Возможно</span>}
      </button>

      <button
        type="button"
        onClick={() => onChange('unverified')}
        title="Снять отметку"
        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[14.5px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          value === 'unverified'
            ? 'bg-white text-stone-700 shadow-xs ring-1 ring-stone-200/80'
            : 'text-stone-400 hover:text-stone-700'
        }`}
      >
        <CircleDashed size={14} />
      </button>
    </div>
  );
}
