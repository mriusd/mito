import type { WalletScoresLedgerEmbed } from '../api';

function shortenWallet(w: string): string {
  if (w.length <= 12) return w;
  return w.slice(0, 6) + '…' + w.slice(-4);
}

function nickTrim(raw: string | null | undefined): string {
  return String(raw ?? '').trim();
}

/** User tag → Polymarket nickname → shortened address. */
export function toxicWalletDisplayLabel(
  wallet: string,
  opts: { tag?: string | null; ledgerEmbed?: WalletScoresLedgerEmbed | null; nickname?: string } = {},
): string {
  const tag = nickTrim(opts.tag);
  if (tag) return tag;
  const nick =
    nickTrim(opts.nickname) || nickTrim(opts.ledgerEmbed?.polymarketNickname);
  if (nick) return shortenWallet(nick);
  return shortenWallet(wallet);
}

export function toxicWalletSecondaryAddress(
  wallet: string,
  opts: { tag?: string | null; ledgerEmbed?: WalletScoresLedgerEmbed | null; nickname?: string } = {},
): string | null {
  const tag = nickTrim(opts.tag);
  const nick =
    nickTrim(opts.nickname) || nickTrim(opts.ledgerEmbed?.polymarketNickname);
  if (tag || nick) return shortenWallet(wallet);
  return null;
}
