import { type KeyboardEvent } from 'react';

type InlineConfirmCancelInputProps = {
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  placeholder?: string;
  inputClassName?: string;
  autoFocus?: boolean;
};

/** Sidebar replace-order style: text field + ✓ / ✕. */
export function InlineConfirmCancelInput({
  value,
  onChange,
  onConfirm,
  onCancel,
  placeholder,
  inputClassName = 'inline-block w-24 max-w-[10rem] bg-gray-800 border border-gray-600 rounded px-1 text-white text-xs font-sans [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
  autoFocus = true,
}: InlineConfirmCancelInputProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConfirm();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <span className="inline-flex max-w-full items-center gap-0.5">
      <input
        type="text"
        autoFocus={autoFocus}
        onFocus={(e) => e.target.select()}
        className={inputClassName}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        onClick={onConfirm}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-green-600 hover:bg-green-500"
        title="Confirm"
      >
        <span className="text-[10px] font-bold leading-none text-black">✓</span>
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-gray-600 hover:bg-gray-500"
        title="Cancel"
      >
        <span className="text-[10px] font-bold leading-none text-black">✕</span>
      </button>
    </span>
  );
}
