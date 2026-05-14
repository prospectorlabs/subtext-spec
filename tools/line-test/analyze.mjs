// Analyze a LINE-roundtripped BMP test file against the original.
//
// Usage:
//   node tools/line-test/analyze.mjs /path/to/LINE_roundtripped.txt
//
// Expects the metadata sidecar from gen-bmp.mjs at:
//   ./BMP_LINE_test_meta.json
//
// Reports:
//   - VS char count delta (how many dropped)
//   - Magic byte position in the recovered byte stream
//   - First N hex bytes of the recovered frame
//   - Per-wrap-point analysis (which bytes survived where)

import fs from "node:fs";

const VS_BASE = 0xfe00;

function isVSBmp(cp) {
  return cp >= VS_BASE && cp <= VS_BASE + 0x0f;
}

function isVSSup(cp) {
  return cp >= 0xe0100 && cp <= 0xe01ef;
}

function pairNibbles(nibbles) {
  const len = Math.floor(nibbles.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = (nibbles[2 * i] << 4) | nibbles[2 * i + 1];
  }
  return out;
}

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error("Usage: node analyze.mjs <LINE_roundtripped.txt>");
  process.exit(1);
}

const lineText = fs.readFileSync(args[0], "utf8");
const meta = JSON.parse(
  fs.readFileSync("./BMP_LINE_test_meta.json", "utf8"),
);
const origFrameBytes = meta.frameBytesHex
  .split(" ")
  .map((h) => parseInt(h, 16));

// Walk LINE text codepoint by codepoint, classify each.
const tally = {
  total: 0,
  vsBmp: 0,
  vsSup: 0,
  zwsp: 0,
  nnbsp: 0,
  asciiSpace: 0,
  visible: 0,
  newline: 0,
  other: 0,
};
const otherCps = new Map();
const nibbles = [];
for (const ch of lineText) {
  const cp = ch.codePointAt(0);
  tally.total++;
  if (isVSBmp(cp)) {
    tally.vsBmp++;
    nibbles.push(cp - VS_BASE);
  } else if (isVSSup(cp)) {
    tally.vsSup++;
  } else if (cp === 0x200b) tally.zwsp++;
  else if (cp === 0x202f) tally.nnbsp++;
  else if (cp === 0x20) tally.asciiSpace++;
  else if (cp === 0x0a || cp === 0x0d) tally.newline++;
  else if (cp >= 0x20 && cp < 0x7f) tally.visible++;
  else {
    tally.other++;
    otherCps.set(cp, (otherCps.get(cp) || 0) + 1);
  }
}

console.log("=== LINE-roundtripped text breakdown ===");
console.log("  total codepoints:", tally.total);
console.log("  UTF-16 length:   ", lineText.length);
console.log("  UTF-8 bytes:     ", Buffer.byteLength(lineText));
console.log("  VS BMP (good):   ", tally.vsBmp);
console.log("  VS Supplement:   ", tally.vsSup, "(should be 0 — original was BMP-only)");
console.log("  ZWSP:            ", tally.zwsp);
console.log("  NNBSP:           ", tally.nnbsp);
console.log("  ASCII space:     ", tally.asciiSpace);
console.log("  newline:         ", tally.newline);
console.log("  visible ASCII:   ", tally.visible);
console.log("  other:           ", tally.other);
if (otherCps.size > 0) {
  console.log("  other codepoints:");
  for (const [cp, count] of otherCps)
    console.log(`    U+${cp.toString(16)} ×${count}`);
}

const expectedVS = meta.vsCharCount;
console.log("\n=== Loss check ===");
console.log(`  expected VS chars:  ${expectedVS}`);
console.log(`  received VS chars:  ${tally.vsBmp}`);
console.log(`  dropped:            ${expectedVS - tally.vsBmp}`);

// Pair nibbles into bytes
const recovered = pairNibbles(nibbles);
console.log("\n=== Recovered byte stream ===");
console.log(`  bytes (paired):     ${recovered.length}`);
console.log(`  expected:           ${meta.frameByteCount}`);

// Find magic at every byte and nibble alignment.
function findMagic(bytes) {
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0xab && bytes[i + 1] === 0xcd) return i;
  }
  return -1;
}

const magicAlign0 = findMagic(recovered);
// Try shift by 1 nibble (drop first nibble, repair)
const shiftedNibbles = nibbles.slice(1);
const recoveredShift = pairNibbles(shiftedNibbles);
const magicAlign1 = findMagic(recoveredShift);

console.log(`  magic @ byte (align 0): ${magicAlign0}`);
console.log(`  magic @ byte (align 1): ${magicAlign1}`);

// Show first 64 bytes of recovered stream from the magic
function hex64(bytes, start) {
  const out = [];
  for (let i = start; i < Math.min(start + 64, bytes.length); i++) {
    out.push(bytes[i].toString(16).padStart(2, "0"));
  }
  return out.join(" ");
}

if (magicAlign0 >= 0) {
  console.log("\nFirst 64 bytes from magic (align 0):");
  console.log(" ", hex64(recovered, magicAlign0));
} else if (magicAlign1 >= 0) {
  console.log("\nFirst 64 bytes from magic (align 1):");
  console.log(" ", hex64(recoveredShift, magicAlign1));
}

// Compare to the original frame byte-by-byte to find first divergence.
const recAtMagic = magicAlign0 >= 0
  ? recovered.subarray(magicAlign0)
  : magicAlign1 >= 0
    ? recoveredShift.subarray(magicAlign1)
    : recovered;

console.log("\n=== Byte-by-byte divergence from original frame ===");
let firstDiff = -1;
for (let i = 0; i < Math.min(origFrameBytes.length, recAtMagic.length); i++) {
  if (origFrameBytes[i] !== recAtMagic[i]) {
    firstDiff = i;
    break;
  }
}
if (firstDiff < 0 && origFrameBytes.length === recAtMagic.length) {
  console.log("  ✅ PERFECT MATCH — BMP-only codec survived LINE intact!");
} else if (firstDiff < 0) {
  console.log(`  Identical for first ${Math.min(origFrameBytes.length, recAtMagic.length)} bytes,`);
  console.log(`  but lengths differ: orig=${origFrameBytes.length} rec=${recAtMagic.length}`);
} else {
  console.log(`  First divergence at byte ${firstDiff}`);
  const origCtx = origFrameBytes.slice(Math.max(0, firstDiff - 3), firstDiff + 5)
    .map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const recCtx = Array.from(recAtMagic.slice(Math.max(0, firstDiff - 3), firstDiff + 5))
    .map((b) => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`    orig: ${origCtx}`);
  console.log(`    rec:  ${recCtx}`);
}

// Locate where LINE inserted breaks (NNBSPs) so we can map drops to wrap points.
if (tally.nnbsp > 0) {
  console.log("\n=== NNBSP injection points (LINE's wrap markers) ===");
  let vsSeen = 0;
  let cpIdx = 0;
  let utf16Idx = 0;
  for (const ch of lineText) {
    const cp = ch.codePointAt(0);
    if (cp === 0x202f) {
      console.log(`  cp=${cpIdx} utf16=${utf16Idx} (after ${vsSeen} VS BMP chars)`);
    }
    if (isVSBmp(cp)) vsSeen++;
    cpIdx++;
    utf16Idx += ch.length;
  }
}
