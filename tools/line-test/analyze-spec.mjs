// Analyze the LINE-roundtripped spec-test file.
//
// Usage:
//   node tools/line-test/analyze-spec.mjs /path/to/LINE_spec_received.txt

import fs from "node:fs";

const VS1_BASE = 0xfe00;
const VS2_BASE = 0xe0100;

function isVS(cp) {
  return (cp >= VS1_BASE && cp <= VS1_BASE + 0x0f) ||
         (cp >= VS2_BASE && cp <= VS2_BASE + 0xef);
}

function vsToByte(cp) {
  if (cp >= VS1_BASE && cp <= VS1_BASE + 0x0f) return cp - VS1_BASE;
  if (cp >= VS2_BASE && cp <= VS2_BASE + 0xef) return cp - VS2_BASE + 0x10;
  return -1;
}

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error("Usage: node analyze-spec.mjs <LINE_spec_received.txt>");
  process.exit(1);
}

const text = fs.readFileSync(args[0], "utf8");
const meta = JSON.parse(
  fs.readFileSync("./LINE_spec_test_meta.json", "utf8"),
);

console.log("=".repeat(70));
console.log("PER-SPECIMEN ANALYSIS");
console.log("=".repeat(70));

const summary = [];
for (const c of meta) {
  // Find `T0X[ ... ]` (non-greedy, multiline)
  const re = new RegExp(`${c.id}\\[([\\s\\S]*?)\\]`);
  const m = text.match(re);
  if (!m) {
    console.log(`\n${c.id}: ❌ specimen markers not found in input`);
    summary.push({ id: c.id, status: "MISSING" });
    continue;
  }
  const section = m[1];

  let vsCount = 0;
  let nnbspCount = 0;
  let zwspCount = 0;
  let spaceCount = 0;
  let newlineCount = 0;
  let otherCount = 0;
  const otherCps = new Map();
  const recoveredBytes = [];
  for (const ch of section) {
    const cp = ch.codePointAt(0);
    if (isVS(cp)) {
      vsCount++;
      recoveredBytes.push(vsToByte(cp));
    } else if (cp === 0x202f) nnbspCount++;
    else if (cp === 0x200b) zwspCount++;
    else if (cp === 0x20) spaceCount++;
    else if (cp === 0x0a || cp === 0x0d) newlineCount++;
    else if (cp === 0x58) otherCount++; // 'X'
    else { otherCount++; otherCps.set(cp, (otherCps.get(cp) || 0) + 1); }
  }

  const expected = c.expectedBytes;
  const missing = expected.filter((b) => !recoveredBytes.includes(b));
  const extra = recoveredBytes.filter((b) => !expected.includes(b));

  const status =
    missing.length === 0 && extra.length === 0 ? "✅ INTACT" :
    `⚠️ ${missing.length} dropped`;

  console.log(`\n${c.id} (${c.desc})`);
  console.log(`  expected ${c.n} VS, got ${vsCount} | NNBSP=${nnbspCount} ZWSP=${zwspCount} sp=${spaceCount} nl=${newlineCount} other=${otherCount}`);
  console.log(`  status: ${status}`);
  if (missing.length > 0) {
    console.log(`  missing bytes: ${missing.map((b) => "0x" + b.toString(16).padStart(2, "0")).join(", ")}`);
    // Position of each missing byte in the original ordered byte list
    const positions = missing.map((b) => expected.indexOf(b));
    console.log(`  positions (0-indexed): ${positions.join(", ")}`);
  }
  if (extra.length > 0) {
    console.log(`  EXTRA bytes (shouldn't be here): ${extra.map((b) => "0x" + b.toString(16)).join(", ")}`);
  }
  if (otherCps.size > 0) {
    console.log(`  unexpected non-VS chars:`);
    for (const [cp, n] of otherCps)
      console.log(`    U+${cp.toString(16)} ×${n}`);
  }
  summary.push({ id: c.id, status, vsCount, expected: c.n, nnbspCount, missing: missing.length });
}

console.log("\n" + "=".repeat(70));
console.log("SUMMARY");
console.log("=".repeat(70));
console.log("id   expected got  NNBSP dropped  status");
for (const s of summary) {
  if (s.status === "MISSING") {
    console.log(`${s.id}  ❌ specimen not found in LINE output`);
    continue;
  }
  console.log(`${s.id}  ${String(s.expected).padStart(8)} ${String(s.vsCount).padStart(4)} ${String(s.nnbspCount).padStart(5)} ${String(s.missing).padStart(8)}  ${s.status}`);
}

// Interpretation hints
console.log("\n" + "=".repeat(70));
console.log("INTERPRETATION HINTS");
console.log("=".repeat(70));
const t01 = summary.find((s) => s.id === "T01");
const t02 = summary.find((s) => s.id === "T02");
const t04 = summary.find((s) => s.id === "T04");
const t05 = summary.find((s) => s.id === "T05");

if (t01?.missing === 0 && t02?.missing === 0 && t04?.missing === 0 && t05?.missing > 0) {
  console.log("✅ Counter likely RESETS at visible chars (\"]T0X[\")");
  console.log("   Threshold appears to be 30 (T04 intact, T05 dropped).");
} else if (t02?.missing > 0) {
  console.log("⚠️  Counter is CUMULATIVE across visible boundaries.");
  console.log("   T02 (28 invisibles) shows drops → counter from prior specimens carried over.");
}

const t09 = summary.find((s) => s.id === "T09");
const t10 = summary.find((s) => s.id === "T10");
const t11 = summary.find((s) => s.id === "T11");
console.log("\nMid-run separator behavior:");
console.log(`  T09 (20+X+20):       ${t09?.missing ?? "?"} drops`);
console.log(`  T10 (20+space+20):   ${t10?.missing ?? "?"} drops`);
console.log(`  T11 (20+newline+20): ${t11?.missing ?? "?"} drops`);
console.log("  → 0 drops means that separator resets the wrap counter.");
