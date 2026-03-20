import { useState, useEffect } from 'react';

type Phase = 'prompt' | 'signing' | 'done' | 'error';

type ExplainerState = {
  visible: boolean;
  phase: Phase;
  title: string;
  message: string;
  error?: string;
  onConfirm: (() => void) | null;
  onCancel: (() => void) | null;
};

const initialState: ExplainerState = { visible: false, phase: 'prompt', title: '', message: '', onConfirm: null, onCancel: null };

type Listener = (s: ExplainerState) => void;
let _state: ExplainerState = { ...initialState };
let _listeners: Listener[] = [];

function notify() { _listeners.forEach(fn => fn({ ..._state })); }

function close() {
  _state = { ...initialState };
  notify();
}

// Show a pre-signature explainer, then run the async action while showing a spinner.
// Resolves true on success, false on cancel or error.
export function showSignatureExplainer(
  title: string,
  message: string,
  action: () => Promise<void>,
): Promise<boolean> {
  return new Promise((resolve) => {
    _state = {
      visible: true,
      phase: 'prompt',
      title,
      message,
      onConfirm: async () => {
        _state = { ..._state, phase: 'signing', onConfirm: null, onCancel: null };
        notify();
        try {
          await action();
          close();
          resolve(true);
        } catch (err) {
          _state = { ..._state, phase: 'error', error: err instanceof Error ? err.message : 'Signature failed' };
          notify();
          // Auto-close after 3s on error
          setTimeout(() => { close(); resolve(false); }, 3000);
        }
      },
      onCancel: () => {
        close();
        resolve(false);
      },
    };
    notify();
  });
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function SignatureExplainerDialog() {
  const [state, setState] = useState<ExplainerState>({ ...initialState });

  useEffect(() => {
    const fn = (s: ExplainerState) => setState(s);
    _listeners.push(fn);
    return () => { _listeners = _listeners.filter(l => l !== fn); };
  }, []);

  if (!state.visible) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-5 h-5 text-blue-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
          <span className="text-sm font-bold text-white">{state.title}</span>
        </div>
        <p className="text-xs text-gray-300 whitespace-pre-line mb-4">{state.message}</p>

        {state.phase === 'signing' && (
          <div className="flex items-center gap-2 py-2">
            <Spinner />
            <span className="text-xs text-blue-300">Waiting for wallet signature...</span>
          </div>
        )}

        {state.phase === 'error' && (
          <div className="text-[10px] text-red-400 bg-red-900/30 rounded px-2 py-1 mb-2">
            {state.error}
          </div>
        )}

        {state.phase === 'prompt' && (
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => state.onCancel?.()}
              className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-xs font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={() => state.onConfirm?.()}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs font-bold transition"
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
