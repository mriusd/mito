export const SIDEBAR_CUSTOM_BUTTON_CLICK_EVENT = 'polybot-sidebar-custom-button-click';

export function dispatchCustomSidebarButtonClick(btnId: string): void {
  window.dispatchEvent(
    new CustomEvent<{ btnId: string }>(SIDEBAR_CUSTOM_BUTTON_CLICK_EVENT, { detail: { btnId } }),
  );
}

export function onCustomSidebarButtonClick(handler: (btnId: string) => void): () => void {
  const listener = (ev: Event) => {
    const id = (ev as CustomEvent<{ btnId: string }>).detail?.btnId;
    if (id) handler(id);
  };
  window.addEventListener(SIDEBAR_CUSTOM_BUTTON_CLICK_EVENT, listener);
  return () => window.removeEventListener(SIDEBAR_CUSTOM_BUTTON_CLICK_EVENT, listener);
}
