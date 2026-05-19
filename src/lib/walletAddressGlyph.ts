/** Deterministic multi-color pixel glyph from a wallet address (symmetric grid). */

const GRID = 5;

export const WALLET_ADDRESS_GLYPH_BG = '#000000';

const PALETTES: readonly (readonly [string, string, string])[] = [
  ['#38bdf8', '#22d3ee', '#a78bfa'],
  ['#f97316', '#fbbf24', '#fb7185'],
  ['#4ade80', '#86efac', '#fde047'],
  ['#e879f9', '#c084fc', '#67e8f9'],
  ['#f87171', '#fb923c', '#fcd34d'],
  ['#0ea5e9', '#2dd4bf', '#818cf8'],
  ['#d97706', '#eab308', '#f472b6'],
  ['#14b8a6', '#34d399', '#a3e635'],
  ['#6366f1', '#38bdf8', '#f472b6'],
  ['#a1a1aa', '#e4e4e7', '#facc15'],
];

function addressSeedBytes(address: string): Uint8Array {
  const a = address.trim().toLowerCase();
  const hex = a.startsWith('0x') ? a.slice(2) : a;
  if (/^[0-9a-f]+$/.test(hex) && hex.length >= 2 && hex.length % 2 === 0) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  return new TextEncoder().encode(a);
}

function expandSeed(seed: Uint8Array, count: number): number[] {
  let s = seed.reduce((acc, b) => (Math.imul(acc, 31) + b) >>> 0, 0x811c9dc5) || 1;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    out.push(s & 0xff);
  }
  return out;
}

export type WalletAddressGlyphCell = {
  filled: boolean;
  color: string;
};

export type WalletAddressGlyphModel = {
  grid: number;
  bg: string;
  cells: WalletAddressGlyphCell[][];
};

/** Build a 5×5 symmetric glyph; empty address → null. */
export function walletAddressGlyphModel(address: string): WalletAddressGlyphModel | null {
  const raw = address.trim();
  if (!raw) return null;

  const bytes = expandSeed(addressSeedBytes(raw), 32);
  const palette = PALETTES[bytes[0] % PALETTES.length]!;
  const [c1, c2, c3] = palette;
  const bg = WALLET_ADDRESS_GLYPH_BG;

  const cells: WalletAddressGlyphCell[][] = [];
  let bitIdx = 0;
  for (let row = 0; row < GRID; row++) {
    const rowCells: WalletAddressGlyphCell[] = [];
    const half: boolean[] = [];
    for (let srcCol = 0; srcCol < 3; srcCol++) {
      const byte = bytes[1 + Math.floor(bitIdx / 8)] ?? 0;
      half[srcCol] = ((byte >> (bitIdx % 8)) & 1) === 1;
      bitIdx += 1;
    }
    for (let col = 0; col < GRID; col++) {
      const srcCol = col < 3 ? col : GRID - 1 - col;
      const filled = half[srcCol]!;
      if (!filled) {
        rowCells.push({ filled: false, color: bg });
      } else {
        const shade = bytes[2 + ((row * 3 + srcCol) % 16)]! % 3;
        const color = shade === 0 ? c1 : shade === 1 ? c2 : c3;
        rowCells.push({ filled: true, color });
      }
    }
    cells.push(rowCells);
  }

  return { grid: GRID, bg, cells };
}
