import { signingDialog } from '../components/SigningDialog';
import { dismissSignatureExplainer } from '../components/SignatureExplainerDialog';
import { useAppStore } from '../stores/appStore';
import { appKit } from './wallet';

export const UI_ESCAPE_DISMISS_EVENT = 'polybot:escape-dismiss';

export function dispatchUiEscapeDismiss(): void {
  window.dispatchEvent(new CustomEvent(UI_ESCAPE_DISMISS_EVENT));
}

export function subscribeUiEscapeDismiss(listener: () => void): () => void {
  window.addEventListener(UI_ESCAPE_DISMISS_EVENT, listener);
  return () => window.removeEventListener(UI_ESCAPE_DISMISS_EVENT, listener);
}

function clearStuckGridDragClasses(): void {
  document.querySelectorAll('.react-grid-item.react-draggable-dragging').forEach((el) => {
    el.classList.remove('react-draggable-dragging');
  });
  document.querySelectorAll('.react-grid-item.resizing').forEach((el) => {
    el.classList.remove('resizing');
  });
}

function reconcileAppKitModal(): void {
  let appKitOpen = false;
  try {
    appKitOpen = Boolean(appKit.getState().open);
  } catch {
    appKitOpen = false;
  }

  const modal = document.querySelector('w3m-modal, appkit-modal');
  if (!modal) return;

  if (!appKitOpen) {
    modal.classList.remove('open');
    if (modal instanceof HTMLElement) {
      modal.style.pointerEvents = 'none';
    }
    return;
  }

  if (modal instanceof HTMLElement) {
    modal.style.removeProperty('pointer-events');
  }
}

function dismissGlobalBlockingUi(): void {
  try {
    void appKit.close();
  } catch {
    /* ignore */
  }

  signingDialog.close();
  dismissSignatureExplainer();

  const st = useAppStore.getState();
  st.setProgDialogOpen(false);
  st.setEditProgArb(null);
  st.setArbDialogArb(null);
  st.closePnlDrilldown();
  st.setWalletSummaryDialogOpen(false);
  st.setMarketViewDialogOpen(false);

  reconcileAppKitModal();
  clearStuckGridDragClasses();
  dispatchUiEscapeDismiss();
}

export function installUiInteractionRecovery(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    dismissGlobalBlockingUi();
  };

  const onPointerEnd = () => {
    reconcileAppKitModal();
    clearStuckGridDragClasses();
  };

  const reconcileTimer = window.setInterval(reconcileAppKitModal, 2500);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointerup', onPointerEnd, true);
  window.addEventListener('pointercancel', onPointerEnd, true);
  window.addEventListener('blur', onPointerEnd);

  return () => {
    window.clearInterval(reconcileTimer);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pointerup', onPointerEnd, true);
    window.removeEventListener('pointercancel', onPointerEnd, true);
    window.removeEventListener('blur', onPointerEnd);
  };
}
