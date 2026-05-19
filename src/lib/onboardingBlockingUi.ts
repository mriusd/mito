import { isSignatureExplainerVisible, subscribeSignatureExplainer } from '../components/SignatureExplainerDialog';
import { isDialogHidden, signingDialog } from '../components/SigningDialog';
import { appKit } from './wallet';

const listeners = new Set<() => void>();
let initialized = false;
let appKitModalOpen = false;

function notify() {
  listeners.forEach((l) => l());
}

function initOnboardingBlockingUiWatchers() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  try {
    appKitModalOpen = Boolean(appKit.getState().open);
    appKit.subscribeState((state) => {
      const next = Boolean(state.open);
      if (next === appKitModalOpen) return;
      appKitModalOpen = next;
      notify();
    });
  } catch {
    appKitModalOpen = false;
  }
  subscribeSignatureExplainer(() => notify());
  signingDialog.subscribe(() => notify());
}

/** AppKit connect modal, wallet signature explainer, or signing progress dialog. */
export function isOnboardingBlockingUiOpen(): boolean {
  initOnboardingBlockingUiWatchers();
  if (appKitModalOpen) return true;
  if (isSignatureExplainerVisible()) return true;
  const signing = signingDialog.getState();
  if (signing.visible && !isDialogHidden()) return true;
  return false;
}

export function subscribeOnboardingBlockingUi(listener: () => void): () => void {
  initOnboardingBlockingUiWatchers();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
