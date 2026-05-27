import { useEffect, useState } from 'react';

type NotifyDialogNumberInputProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  integer?: boolean;
  precision?: number;
};

function clampNotifyNumber(
  v: number,
  min: number,
  max: number,
  integer: boolean,
  precision?: number,
): number {
  if (!Number.isFinite(v)) return min;
  let next = integer ? Math.round(v) : v;
  next = Math.min(max, Math.max(min, next));
  if (integer) next = Math.round(next);
  else if (precision != null) next = Math.round(next * 10 ** precision) / 10 ** precision;
  return next;
}

export function NotifyDialogNumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step,
  className,
  integer = false,
  precision,
}: NotifyDialogNumberInputProps) {
  const [draft, setDraft] = useState(() => String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === '.') {
      setDraft(String(value));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clampNotifyNumber(parsed, min, max, integer, precision);
    onChange(next);
    setDraft(String(next));
  };

  return (
    <input
      type="number"
      min={Number.isFinite(min) ? min : undefined}
      max={Number.isFinite(max) ? max : undefined}
      step={step}
      className={className}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}
