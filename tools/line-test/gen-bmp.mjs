// Generate a BMP-only-encoded test carrier text and write it to Downloads/.
// This is for the "is BMP-only codec immune to LINE's VS-Supplement drop?"
// hypothesis test. We do NOT touch the production codec — this is a
// standalone reproducer the user can copy → paste into LINE → round-trip.
//
// Wire format mimics the production frame:
//   magic 0xAB 0xCD | length 4B BE | version 0x01 | flags 0x00 | body
// Body is deterministic pseudo-random so we can detect any bit-level damage.
//
// Encoding (the experimental part):
//   each byte → 2 BMP Variation Selector codepoints
//   high nibble = U+FE00 + (byte >> 4)
//   low  nibble = U+FE00 + (byte & 0x0F)
// All VS chars are BMP (U+FE00..U+FE0F), single UTF-16 unit, NO surrogate
// pairs, so LINE's surrogate-bisection-on-wrap behaviour cannot fire.

import fs from "node:fs";

const VS_BASE = 0xfe00;

function byteToBMPNibbles(byte) {
  const hi = (byte >> 4) & 0x0f;
  const lo = byte & 0x0f;
  return String.fromCodePoint(VS_BASE + hi) + String.fromCodePoint(VS_BASE + lo);
}

function encodeBytes(bytes) {
  let out = "";
  for (const b of bytes) out += byteToBMPNibbles(b);
  return out;
}

// Build a 371-byte frame that mirrors the production test payload size
// (matches the user's most recent diagnostic: length 0x16B = 363 body bytes).
const MAGIC_0 = 0xab;
const MAGIC_1 = 0xcd;
const VERSION = 0x01;
const FLAGS = 0x00; // uncompressed; we don't need to compress for this test
const BODY_LEN = 363;

const body = new Uint8Array(BODY_LEN);
let s = 0x12345;
for (let i = 0; i < BODY_LEN; i++) {
  // LCG; doesn't matter what — only that it's deterministic and uses the full
  // byte range so we can spot any mutation post-LINE.
  s = (s * 1103515245 + 12345) & 0x7fffffff;
  body[i] = s & 0xff;
}

const inner = 1 + 1 + BODY_LEN; // version + flags + body
const frame = new Uint8Array(2 + 4 + inner);
const view = new DataView(frame.buffer);
frame[0] = MAGIC_0;
frame[1] = MAGIC_1;
view.setUint32(2, inner, false);
frame[6] = VERSION;
frame[7] = FLAGS;
frame.set(body, 8);

// Embed structure mirrors the production embed():
//   MARKER + " " + head + VS_run + tail
// We do NOT insert ZWSPs here — that experiment failed; we want a clean
// readout of how LINE handles a pure BMP run.
const MARKER = "⌬";
const cover = "出張準備リスト";
const head = "出";
const tail = "張準備リスト";

const vsRun = encodeBytes(frame);
const carrier = MARKER + " " + head + vsRun + tail;

const outPath = "./BMP_LINE_test.txt";
fs.writeFileSync(outPath, carrier);

// Also write a metadata sidecar so analyze.mjs can verify byte-level
// recovery from the LINE-roundtripped copy.
const metaPath = "./BMP_LINE_test_meta.json";
fs.writeFileSync(
  metaPath,
  JSON.stringify(
    {
      frameBytesHex: Array.from(frame)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" "),
      frameByteCount: frame.length,
      vsCharCount: [...vsRun].length, // = 2 × frame.length
      utf16TotalLength: carrier.length,
      utf8ByteCount: Buffer.byteLength(carrier),
      cover,
      head,
      tail,
    },
    null,
    2,
  ),
);

console.log("Wrote:", outPath);
console.log("  frame bytes:", frame.length);
console.log("  VS chars (BMP only):", [...vsRun].length);
console.log("  UTF-16 units total:", carrier.length);
console.log("  UTF-8 bytes:", Buffer.byteLength(carrier));
console.log("Meta:  ", metaPath);
