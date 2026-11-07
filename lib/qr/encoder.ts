/**
 * QR Code Model 2 encoder — byte mode, versions 1–20, all four error-correction levels.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────
 * The previous `generateAILinkQRCodeSvg` drew finder patterns and a sha256-derived grid. It
 * looked like a QR code and scanned like nothing: no mode indicator, no Reed–Solomon ECC, no
 * format information. Any phone camera silently failed on it.
 *
 * This is a real ISO/IEC 18004 encoder, written natively so the Business Page QR identity has
 * no external service and no paid dependency. `tests/unit/qr-encoder.test.ts` decodes the
 * matrices it produces with an independent decoder (jsQR) and cross-checks the module layout
 * against the standard, so "it renders" can never be mistaken for "it scans".
 *
 * Scope: byte (8-bit) mode only — every payload this product encodes is a URL. Versions 1–20
 * carry up to 1,271 bytes at level L and 666 at level M; the longest possible business page URL
 * is ~120 characters, so the encoder raises rather than silently truncate beyond version 20.
 */

export type QrErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export type QrMatrix = {
  /** Modules per side (21 + 4 × (version − 1)). */
  size: number;
  version: number;
  ecLevel: QrErrorCorrectionLevel;
  /** `modules[row][col]` — true means a dark module. */
  modules: boolean[][];
  /** true where the module is a function pattern (finder, timing, alignment, format, version). */
  reserved: boolean[][];
  mask: number;
};

export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 20;

/** Total codewords (data + error correction) per version. */
const TOTAL_CODEWORDS: number[] = [
  0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
  404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
];

/** Remainder bits that pad the final row of data modules. */
const REMAINDER_BITS: number[] = [
  0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3,
];

/**
 * Reed–Solomon block structure per version and EC level:
 * [ecCodewordsPerBlock, blocksInGroup1, dataCodewordsPerBlockInGroup1, blocksInGroup2, dataCodewordsPerBlockInGroup2]
 * Indexed `[level][version]`, with a dummy entry at index 0 so versions read naturally.
 */
const RS_BLOCK_TABLE: Record<QrErrorCorrectionLevel, (readonly number[])[]> = {
  L: [
    [],
    [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69],
    [20, 4, 81, 0, 0], [24, 2, 92, 2, 93], [26, 4, 107, 0, 0], [30, 3, 115, 1, 116], [22, 5, 87, 1, 88],
    [24, 5, 98, 1, 99], [28, 1, 107, 5, 108], [30, 5, 120, 1, 121], [28, 3, 113, 4, 114], [28, 3, 107, 5, 108],
  ],
  M: [
    [],
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
    [30, 1, 50, 4, 51], [22, 6, 36, 2, 37], [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42],
    [28, 7, 45, 3, 46], [28, 10, 46, 1, 47], [26, 9, 43, 4, 44], [26, 3, 44, 11, 45], [26, 3, 41, 13, 42],
  ],
  Q: [
    [],
    [13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0], [18, 2, 15, 2, 16],
    [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19], [20, 4, 16, 4, 17], [24, 6, 19, 2, 20],
    [28, 4, 22, 4, 23], [26, 4, 20, 6, 21], [24, 8, 20, 4, 21], [20, 11, 16, 5, 17], [30, 5, 24, 7, 25],
    [24, 15, 19, 2, 20], [28, 1, 22, 15, 23], [28, 17, 22, 1, 23], [26, 17, 21, 4, 22], [30, 15, 24, 5, 25],
  ],
  H: [
    [],
    [17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0], [22, 2, 11, 2, 12],
    [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15], [24, 4, 12, 4, 13], [28, 6, 15, 2, 16],
    [24, 3, 12, 8, 13], [28, 7, 14, 4, 15], [22, 12, 11, 4, 12], [24, 11, 12, 5, 13], [24, 11, 12, 7, 13],
    [30, 3, 15, 13, 16], [28, 2, 14, 17, 15], [28, 2, 14, 19, 15], [26, 9, 13, 16, 14], [28, 15, 15, 10, 16],
  ],
};

/** Alignment-pattern centre coordinates per version (versions 1 has none). */
const ALIGNMENT_POSITIONS: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
];

const EC_LEVEL_BITS: Record<QrErrorCorrectionLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** GF(256) tables for the Reed–Solomon arithmetic (primitive polynomial 0x11D). */
const GF_EXP: number[] = new Array(512).fill(0);
const GF_LOG: number[] = new Array(256).fill(0);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Generator polynomial of degree `degree` over GF(256). */
function rsGenerator(degree: number): number[] {
  let result = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(result.length + 1).fill(0);
    for (let j = 0; j < result.length; j++) {
      next[j] ^= result[j];
      next[j + 1] ^= gfMul(result[j], GF_EXP[i]);
    }
    result = next;
  }
  return result;
}

/** Reed–Solomon remainder (the EC codewords) for one block. */
function rsRemainder(data: number[], ecLength: number): number[] {
  const generator = rsGenerator(ecLength);
  const remainder = new Array(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLength; i++) remainder[i] ^= gfMul(generator[i + 1], factor);
    }
  }
  return remainder;
}

/** Byte-mode payload capacity of a (version, level) pair. */
export function qrByteCapacity(version: number, ecLevel: QrErrorCorrectionLevel): number {
  const [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] = RS_BLOCK_TABLE[ecLevel][version];
  const dataCodewords = g1Blocks * g1Data + g2Blocks * g2Data;
  const countBits = version < 10 ? 8 : 16;
  return Math.floor((dataCodewords * 8 - 4 - countBits) / 8);
}

function buildCodewords(bytes: Uint8Array, version: number, ecLevel: QrErrorCorrectionLevel): number[] {
  const [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] = RS_BLOCK_TABLE[ecLevel][version];
  const totalDataCodewords = g1Blocks * g1Data + g2Blocks * g2Data;
  const countBits = version < 10 ? 8 : 16;

  const bits: number[] = [];
  const pushBits = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  pushBits(0b0100, 4); // byte mode
  pushBits(bytes.length, countBits);
  for (const byte of bytes) pushBits(byte, 8);

  // Terminator, then pad to a byte boundary, then the mandatory pad codewords.
  const capacityBits = totalDataCodewords * 8;
  const terminatorLength = Math.min(4, capacityBits - bits.length);
  pushBits(0, terminatorLength);
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }
  const padBytes = [0xec, 0x11];
  for (let i = 0; data.length < totalDataCodewords; i++) data.push(padBytes[i % 2]);

  // Split into blocks, append EC per block, then interleave data and EC codewords.
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (let i = 0; i < g1Blocks; i++) {
    const slice = data.slice(offset, offset + g1Data);
    offset += g1Data;
    blocks.push({ data: slice, ec: rsRemainder(slice, ecPerBlock) });
  }
  for (let i = 0; i < g2Blocks; i++) {
    const slice = data.slice(offset, offset + g2Data);
    offset += g2Data;
    blocks.push({ data: slice, ec: rsRemainder(slice, ecPerBlock) });
  }

  const result: number[] = [];
  const maxData = Math.max(g1Data, g2Data || 0);
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.data.length) result.push(block.data[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of blocks) result.push(block.ec[i]);
  }
  // Remainder bits are appended to the data stream as zeros (they are not codewords).
  const remainder = REMAINDER_BITS[version] ?? 0;
  if (remainder > 0) result.push(0);
  return result;
}

function emptyGrid(size: number, fill: boolean): boolean[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => fill));
}

function drawFinder(modules: boolean[][], reserved: boolean[][], row: number, col: number): void {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= modules.length || c < 0 || c >= modules.length) continue;
      const inRing = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) || (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6));
      const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      modules[r][c] = inRing || inCore;
      reserved[r][c] = true; // the 1-module separator is reserved too
    }
  }
}

function drawAlignment(modules: boolean[][], reserved: boolean[][], row: number, col: number): void {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= modules.length || c < 0 || c >= modules.length) continue;
      const edge = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
      modules[r][c] = edge;
      reserved[r][c] = true;
    }
  }
}

function maskBit(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return false;
  }
}

/** ISO/IEC 18004 §8.8.2 penalty scoring — the lowest-scoring mask is chosen. */
function maskPenalty(modules: boolean[][]): number {
  const size = modules.length;
  let penalty = 0;

  // Rule 1: runs of five or more identical modules in a row or column.
  const countRun = (get: (index: number) => boolean) => {
    let runColour = get(0);
    let runLength = 1;
    for (let i = 1; i < size; i++) {
      const colour = get(i);
      if (colour === runColour) {
        runLength += 1;
        continue;
      }
      if (runLength >= 5) penalty += 3 + (runLength - 5);
      runColour = colour;
      runLength = 1;
    }
    if (runLength >= 5) penalty += 3 + (runLength - 5);
  };
  for (let row = 0; row < size; row++) countRun((col) => modules[row][col]);
  for (let col = 0; col < size; col++) countRun((row) => modules[row][col]);

  // Rule 2: 2×2 blocks of the same colour.
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const colour = modules[row][col];
      if (colour === modules[row][col + 1] && colour === modules[row + 1][col] && colour === modules[row + 1][col + 1]) {
        penalty += 3;
      }
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules on one side.
  const FINDER_LIKE_A = [true, false, true, true, true, false, true, false, false, false, false];
  const FINDER_LIKE_B = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (values: boolean[], pattern: boolean[]): boolean =>
    pattern.every((expected, index) => values[index] === expected);
  const scanWindow = (get: (index: number) => boolean) => {
    for (let start = 0; start + 11 <= size; start++) {
      const window = Array.from({ length: 11 }, (_, offset) => get(start + offset));
      if (matches(window, FINDER_LIKE_A) || matches(window, FINDER_LIKE_B)) penalty += 40;
    }
  };
  for (let row = 0; row < size; row++) scanWindow((col) => modules[row][col]);
  for (let col = 0; col < size; col++) scanWindow((row) => modules[row][col]);

  // Rule 4: deviation from an even split of dark and light modules.
  let dark = 0;
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) if (modules[row][col]) dark += 1;
  const percent = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return penalty;
}

function formatBits(ecLevel: QrErrorCorrectionLevel, mask: number): number {
  const data = (EC_LEVEL_BITS[ecLevel] << 3) | mask;
  let remainder = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((remainder >>> i) & 1) remainder ^= 0x537 << (i - 10);
  }
  return (((data << 10) | remainder) ^ 0x5412) & 0x7fff;
}

function versionBits(version: number): number {
  let remainder = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((remainder >>> i) & 1) remainder ^= 0x1f25 << (i - 12);
  }
  return ((version << 12) | remainder) & 0x3ffff;
}

/**
 * Encodes `text` (UTF-8, byte mode) into a QR matrix.
 *
 * @throws when the payload does not fit in version 20 at the requested EC level. Callers that
 * encode business URLs should not be able to reach that limit; the throw keeps a future
 * long-payload feature from silently emitting an unscannable symbol.
 */
export function encodeQrMatrix(
  text: string,
  options: { ecLevel?: QrErrorCorrectionLevel; minVersion?: number } = {},
): QrMatrix {
  const ecLevel = options.ecLevel ?? "M";
  const minVersion = Math.max(QR_MIN_VERSION, Math.min(QR_MAX_VERSION, options.minVersion ?? 1));
  const bytes = new TextEncoder().encode(text);

  let version = -1;
  for (let candidate = minVersion; candidate <= QR_MAX_VERSION; candidate += 1) {
    if (bytes.length <= qrByteCapacity(candidate, ecLevel)) {
      version = candidate;
      break;
    }
  }
  if (version < 0) {
    throw new Error(
      `QR payload of ${bytes.length} bytes does not fit in version ${QR_MAX_VERSION} at EC level ${ecLevel}.`,
    );
  }

  const size = version * 4 + 17;
  const codewords = buildCodewords(bytes, version, ecLevel);

  const reserved = emptyGrid(size, false);
  const base = emptyGrid(size, false);

  // Finder patterns and separators.
  drawFinder(base, reserved, 0, 0);
  drawFinder(base, reserved, 0, size - 7);
  drawFinder(base, reserved, size - 7, 0);

  // Timing patterns.
  for (let i = 0; i < size; i++) {
    if (!reserved[6][i]) {
      base[6][i] = i % 2 === 0;
      reserved[6][i] = true;
    }
    if (!reserved[i][6]) {
      base[i][6] = i % 2 === 0;
      reserved[i][6] = true;
    }
  }

  // Alignment patterns (skipping the three that collide with the finders).
  const positions = ALIGNMENT_POSITIONS[version] ?? [];
  for (const row of positions) {
    for (const col of positions) {
      const nearTopLeft = row === 6 && col === 6;
      const nearTopRight = row === 6 && col === size - 7;
      const nearBottomLeft = row === size - 7 && col === 6;
      if (nearTopLeft || nearTopRight || nearBottomLeft) continue;
      drawAlignment(base, reserved, row, col);
    }
  }

  // Reserve the format-information areas (drawn after masking) and the always-dark module.
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  reserved[size - 8][8] = true; // dark module

  // Version information (versions 7 and up).
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      base[a][b] = bit;
      reserved[a][b] = true;
      base[b][a] = bit;
      reserved[b][a] = true;
    }
  }

  // Place the codeword bits in the two-module-wide zigzag, skipping reserved modules.
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern, so the pair that would start there is shifted one
    // column left. Reassigning `right` (rather than reading a local copy) is what keeps the
    // remaining pairs odd: 20, 18 … 8, 6→5, 3, 1. A local copy would walk 6→5, 4, 2 — filling
    // column 3 twice and never reaching column 0, which was exactly the bug this replaced.
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - step : step;
        if (reserved[row][col] || bitIndex >= totalBits) continue;
        const byte = codewords[bitIndex >>> 3] ?? 0;
        base[row][col] = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
        bitIndex += 1;
      }
    }
  }

  // Choose the mask with the lowest penalty; the winner's own bits are written last.
  let best: { mask: number; modules: boolean[][]; penalty: number } | null = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const modules = base.map((row) => row.slice());
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (!reserved[row][col] && maskBit(mask, row, col)) modules[row][col] = !modules[row][col];
      }
    }
    const bits = formatBits(ecLevel, mask);
    for (let i = 0; i <= 5; i += 1) modules[i][8] = ((bits >>> i) & 1) === 1;
    modules[7][8] = ((bits >>> 6) & 1) === 1;
    modules[8][8] = ((bits >>> 7) & 1) === 1;
    modules[8][7] = ((bits >>> 8) & 1) === 1;
    for (let i = 9; i < 15; i += 1) modules[8][14 - i] = ((bits >>> i) & 1) === 1;
    for (let i = 0; i < 8; i += 1) modules[8][size - 1 - i] = ((bits >>> i) & 1) === 1;
    for (let i = 8; i < 15; i += 1) modules[size - 15 + i][8] = ((bits >>> i) & 1) === 1;
    modules[size - 8][8] = true;

    const penalty = maskPenalty(modules);
    if (!best || penalty < best.penalty) best = { mask, modules, penalty };
  }

  return {
    size,
    version,
    ecLevel,
    modules: best!.modules,
    reserved,
    mask: best!.mask,
  };
}

/** Convenience: the module grid as an array of row strings ("#" dark, " " light). */
export function qrMatrixToText(matrix: QrMatrix): string[] {
  return matrix.modules.map((row) => row.map((dark) => (dark ? "#" : " ")).join(""));
}
