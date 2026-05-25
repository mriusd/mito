import { useLayoutEffect, type RefObject } from 'react';
import { useSidebarToxicWalletExtraWidth } from '../lib/sidebarToxicWalletWidthStore';

export function SidebarToxicWalletWidthHost({
  rootRef,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const width = useSidebarToxicWalletExtraWidth();

  useLayoutEffect(() => {
    rootRef.current?.style.setProperty('--toxic-wallet-extra-width', width);
  }, [width, rootRef]);

  return null;
}
