import { signingDialog } from '../components/SigningDialog';
import { dismissSignatureExplainer } from '../components/SignatureExplainerDialog';
import { useAppStore } from '../stores/appStore';
import { noteUserInteractionForBidAsk } from './bidAskMarketLookup';
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
      // Full-viewport invisible modal still sits at z-index 9999 — hide it completely
      // so it cannot interfere with wheel/scroll hit-testing in some browsers.
      modal.style.display = 'none';
    }
    return;
  }

  if (modal instanceof HTMLElement) {
    modal.style.removeProperty('pointer-events');
    modal.style.removeProperty('display');
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
    // Yield bid/ask apply so typing / Esc stays responsive under WS load.
    noteUserInteractionForBidAsk(e.target);
    if (e.key !== 'Escape') return;
    dismissGlobalBlockingUi();
  };

  const onPointerStart = (e: PointerEvent) => {
    noteUserInteractionForBidAsk(e.target);
  };

  const onPointerEnd = (e: PointerEvent) => {
    noteUserInteractionForBidAsk(e.target);
    reconcileAppKitModal();
    clearStuckGridDragClasses();
  };

  // blur is FocusEvent — do not reuse the PointerEvent handler.
  const onBlur = () => {
    reconcileAppKitModal();
    clearStuckGridDragClasses();
  };

  reconcileAppKitModal();
  const reconcileTimer = window.setInterval(reconcileAppKitModal, 2500);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointerdown', onPointerStart, true);
  window.addEventListener('pointerup', onPointerEnd, true);
  window.addEventListener('pointercancel', onPointerEnd, true);
  window.addEventListener('blur', onBlur);

  return () => {
    window.clearInterval(reconcileTimer);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pointerdown', onPointerStart, true);
    window.removeEventListener('pointerup', onPointerEnd, true);
    window.removeEventListener('pointercancel', onPointerEnd, true);
    window.removeEventListener('blur', onBlur);
  };
}
