// Analyze LINE-roundtripped separator-search file.
//
// Usage:
//   node tools/line-test/analyze-sep.mjs /path/to/LINE_sep_received.txt

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
  console.error("Usage: node analyze-sep.mjs <LINE_sep_received.txt>");
  process.exit(1);
}

const text = fs.readFileSync(args[0], "utf8");
const meta = JSON.parse(
  fs.readFileSync("./LINE_sep_test_meta.json", "utf8"),
);

const NNBSP = 0x202f;

console.log("=".repeat(80));
console.log("PER-CANDIDATE ANALYSIS");
console.log("=".repeat(80));

const results = [];
for (const c of meta) {
  const re = new RegExp(`${c.id}\\[([\\s\\S]*?)\\]`);
  const m = text.match(re);
  if (!m) {
    console.log(`\n${c.id}: ❌ marker not found`);
    results.push({ ...c, status: "MISSING" });
    continue;
  }
  const section = m[1];

  // Walk codepoints, track each.
  const cps = [...section];
  let vsCount = 0;
  let nnbspCount = 0;
  let sepKept = 0;
  let otherKept = new Map();
  const bytesGot = [];
  for (const ch of cps) {
    const cp = ch.codePointAt(0);
    if (isVS(cp)) {
      vsCount++;
      bytesGot.push(vsToByte(cp));
    } else if (cp === NNBSP) {
      nnbspCount++;
    } else if (c.cp !== null && cp === c.cp) {
      sepKept++;
    } else {
      otherKept.set(cp, (otherKept.get(cp) || 0) + 1);
    }
  }

  const expectFirst = c.expectedFirst;
  const expectSecond = c.expectedSecond;
  const missingFirst = expectFirst.filter((b) => !bytesGot.includes(b));
  const missingSecond = expectSecond.filter((b) => !bytesGot.includes(b));
  const totalMissing = missingFirst.length + missingSecond.length;

  // Decide reset behavior
  let resetVerdict;
  if (c.cp === null) {
    // Control: should show ~1 drop at cumulative position 30
    resetVerdict = totalMissing === 1 ? "expected 1 drop ✓" : `unexpected ${totalMissing} drops`;
  } else {
    if (totalMissing === 0) resetVerdict = "✅ RESETS counter — 0 drops";
    else if (totalMissing === 1) resetVerdict = "❌ does NOT reset — 1 drop";
    else resetVerdict = `⚠️ ${totalMissing} drops (anomalous)`;
  }

  // Separator survival
  let sepVerdict = "n/a";
  if (c.cp !== null) {
    sepVerdict = sepKept === 1 ? "kept ✓" : sepKept === 0 ? "stripped ❌" : `${sepKept}× kept`;
  }

  console.log(`\n${c.id}: ${c.cpHex ?? "—"}  ${c.name}`);
  console.log(`  VS got: ${vsCount}/40 | NNBSP injected: ${nnbspCount} | separator survived: ${sepVerdict}`);
  console.log(`  drops: ${totalMissing} (first-half ${missingFirst.length}, second-half ${missingSecond.length})`);
  console.log(`  verdict: ${resetVerdict}`);
  if (missingFirst.length > 0)
    console.log(`    missing in first half: ${missingFirst.map((b) => "0x" + b.toString(16)).join(", ")}`);
  if (missingSecond.length > 0)
    console.log(`    missing in second half: ${missingSecond.map((b) => "0x" + b.toString(16)).join(", ")}`);
  if (otherKept.size > 0) {
    console.log(`  unexpected non-VS chars:`);
    for (const [cp, n] of otherKept)
      console.log(`    U+${cp.toString(16)} ×${n}`);
  }

  results.push({
    ...c,
    vsCount,
    nnbspCount,
    sepKept,
    totalMissing,
    resetVerdict,
    sepVerdict,
  });
}

console.log("\n" + "=".repeat(80));
console.log("RANKING (most promising first)");
console.log("=".repeat(80));
console.log("id   codepoint  drops  sep-kept  name");
const ranked = results
  .filter((r) => r.cp !== null && r.totalMissing !== undefined)
  .sort((a, b) => {
    // Reset (0 drops) first, then by separator survival
    if (a.totalMissing !== b.totalMissing) return a.totalMissing - b.totalMissing;
    return (b.sepKept || 0) - (a.sepKept || 0);
  });
for (const r of ranked) {
  const tick = r.totalMissing === 0 ? "✅" : "❌";
  console.log(
    `${r.id}  ${r.cpHex.padEnd(8)}  ${tick} ${String(r.totalMissing).padStart(2)}    ${r.sepVerdict.padEnd(12)} ${r.name}`,
  );
}

console.log("\n" + "=".repeat(80));
console.log("CANDIDATES SUITABLE AS LINE-COMPAT INVISIBLE SEPARATOR");
console.log("=".repeat(80));
const winners = ranked.filter((r) => r.totalMissing === 0 && r.sepKept === 1);
if (winners.length === 0) {
  console.log("none. Need to fall back to visible separator (ASCII space).");
} else {
  for (const w of winners) {
    console.log(`  ${w.id} ${w.cpHex}: ${w.name}`);
  }
  console.log("\nTop pick:", winners[0].cpHex, "—", winners[0].name);
}
