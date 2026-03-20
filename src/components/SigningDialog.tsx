import { useState, useEffect } from 'react';
import { showToast } from '../utils/toast';

export type SigningStep = 'auth' | 'sign' | 'submit';
export type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface StepState {
  auth: StepStatus;
  sign: StepStatus;
  submit: StepStatus;
  error?: string;
  visible: boolean;
  needsAuth: boolean;
  title?: string;
  signLabel?: string;
  submitLabel?: string;
  orderInfo?: string;
}

const initialState: StepState = { auth: 'pending', sign: 'pending', submit: 'pending', visible: false, needsAuth: true };

type Listener = (s: StepState) => void;
let _state: StepState = { ...initialState };
let _listeners: Listener[] = [];

const HIDE_DIALOG_KEY = 'signing-dialog-hidden';

export function isDialogHidden(): boolean {
  return localStorage.getItem(HIDE_DIALOG_KEY) === 'true';
}

function notify() { _listeners.forEach(fn => fn({ ..._state })); }

export const signingDialog = {
  open(needsAuth: boolean, opts?: { title?: string; signLabel?: string; submitLabel?: string; orderInfo?: string }) {
    _state = { ...initialState, visible: true, needsAuth, auth: needsAuth ? 'active' : 'done', sign: needsAuth ? 'pending' : 'active', title: opts?.title, signLabel: opts?.signLabel, submitLabel: opts?.submitLabel, orderInfo: opts?.orderInfo };
    notify();
  },
  getState() { return { ..._state }; },
  setStep(step: SigningStep, status: StepStatus, error?: string) {
    _state = { ..._state, [step]: status, error: error || _state.error };
    if (status === 'error' && error && isDialogHidden()) {
      showToast(error, 'error');
    }
    notify();
  },
  close() {
    _state = { ..._state, visible: false };
    notify();
  },
  subscribe(fn: Listener) { _listeners.push(fn); return () => { _listeners = _listeners.filter(l => l !== fn); }; },
};

const STEPS: { key: SigningStep; label: string; skipKey: 'needsAuth' | null }[] = [
  { key: 'auth', label: 'Authenticate with Polymarket', skipKey: 'needsAuth' },
  { key: 'sign', label: 'Sign order in wallet', skipKey: null },
  { key: 'submit', label: 'Submit order', skipKey: null },
];

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'active') return <Spinner />;
  if (status === 'done') return <span className="text-green-400 text-sm">✓</span>;
  if (status === 'error') return <span className="text-red-400 text-sm">✗</span>;
  return <span className="text-gray-600 text-sm">○</span>;
}

export function SigningDialog() {
  const [state, setState] = useState<StepState>({ ...initialState });

  useEffect(() => {
    return signingDialog.subscribe(setState);
  }, []);

  if (!state.visible || isDialogHidden()) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => signingDialog.close()}>
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 w-72 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-white text-sm font-bold mb-1">{state.title || 'Placing Order'}</h3>
        {state.orderInfo && (
          <div className="text-[11px] text-gray-300 font-mono mb-3">{state.orderInfo}</div>
        )}
        <div className="space-y-3">
          {STEPS.map(({ key, label, skipKey }) => {
            if (skipKey && !state[skipKey]) return null;
            const status = state[key];
            const displayLabel = key === 'sign' && state.signLabel ? state.signLabel : key === 'submit' && state.submitLabel ? state.submitLabel : label;
            return (
              <div key={key} className="flex items-center gap-3">
                <div className="w-5 flex justify-center"><StepIcon status={status} /></div>
                <span className={`text-xs ${status === 'active' ? 'text-white' : status === 'done' ? 'text-green-400' : status === 'error' ? 'text-red-400' : 'text-gray-500'}`}>
                  {displayLabel}
                </span>
              </div>
            );
          })}
        </div>
        {state.error && (
          <div className="mt-3 text-[10px] text-red-400 bg-red-900/30 rounded px-2 py-1 break-words">
            {state.error}
          </div>
        )}
        {(state.submit === 'done' || state.submit === 'error' || state.auth === 'error' || state.sign === 'error') && (
          <button
            onClick={() => signingDialog.close()}
            className="mt-4 w-full py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium transition"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
