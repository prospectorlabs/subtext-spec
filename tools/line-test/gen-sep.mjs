// LINE counter-reset テスト第二弾：
// 「視覚的に不可視 (or ほぼ不可視) なのに LINE のカウンタをリセットする文字」
// を見つける。
//
// 各スペシメンは:
//   T0X[<20 VS Supplement>SEP<20 VS Supplement>]
// 40 不可視 + 1 セパレータ。
//
//   SEP がカウンタを「リセット」する  → 0 ドロップ（両 20 が独立にカウント）
//   SEP がカウンタを進める/無視される → cumulative 31 個目でドロップ
//   SEP が削除/変換される             → 受信側で SEP が消えている
//
// それぞれの結果から候補ごとに分類できる。

import fs from "node:fs";

const VS1_BASE = 0xfe00;
const VS2_BASE = 0xe0100;

function byteToVS(byte) {
  if (byte < 0x10) return String.fromCodePoint(VS1_BASE + byte);
  return String.fromCodePoint(VS2_BASE + byte - 0x10);
}

function seqVS(count, startByte = 0x10) {
  let s = "";
  for (let i = 0; i < count; i++) s += byteToVS(startByte + i);
  return s;
}

// SEP candidates — ranked by visual invisibility (most invisible first).
// Each entry: { id, cp (codepoint), name }
// We avoid characters that may cause display breakage (U+2028/2029 paragraph
// separators) and keep to format/control characters that should pass through
// untouched.
const seps = [
  { id: "T00", cp: null,   name: "control (no separator, 40 contiguous)" },
  { id: "T01", cp: 0x200c, name: "ZWNJ Zero Width Non-Joiner" },
  { id: "T02", cp: 0x200d, name: "ZWJ Zero Width Joiner" },
  { id: "T03", cp: 0x2060, name: "WJ Word Joiner" },
  { id: "T04", cp: 0xfeff, name: "ZWNBSP / BOM" },
  { id: "T05", cp: 0x2063, name: "INVISIBLE SEPARATOR (math)" },
  { id: "T06", cp: 0x2062, name: "INVISIBLE TIMES (math)" },
  { id: "T07", cp: 0x034f, name: "CGJ Combining Grapheme Joiner" },
  { id: "T08", cp: 0x00ad, name: "SOFT HYPHEN" },
  { id: "T09", cp: 0x200e, name: "LRM Left-to-Right Mark" },
  { id: "T10", cp: 0x180e, name: "MVS Mongolian Vowel Separator (deprecated, zero-width)" },
  { id: "T11", cp: 0x2009, name: "THIN SPACE (narrow visible)" },
  { id: "T12", cp: 0x200a, name: "HAIR SPACE (narrowest visible)" },
  { id: "T13", cp: 0x202f, name: "NNBSP Narrow No-Break Space (what LINE inserts)" },
  { id: "T14", cp: 0x00a0, name: "NBSP No-Break Space (regular width)" },
];

function bodyFor(cp) {
  const first = seqVS(20, 0x10); // bytes 0x10..0x23
  const second = seqVS(20, 0x40); // bytes 0x40..0x53
  if (cp === null) return `[${first}${second}]`;
  return `[${first}${String.fromCodePoint(cp)}${second}]`;
}

const header = `LINE 仕様調査テスト (セパレータ探索)
このメッセージを LINE に送って、受信側で全文をコピーしてください。

`;

let out = header;
for (const s of seps) out += `${s.id}${bodyFor(s.cp)}\n`;

fs.writeFileSync("./LINE_sep_test.txt", out);

const meta = seps.map((s) => ({
  id: s.id,
  cp: s.cp,
  cpHex: s.cp !== null ? "U+" + s.cp.toString(16).toUpperCase().padStart(4, "0") : null,
  name: s.name,
  expectedFirst: Array.from({ length: 20 }, (_, i) => 0x10 + i),
  expectedSecond: Array.from({ length: 20 }, (_, i) => 0x40 + i),
}));
fs.writeFileSync(
  "./LINE_sep_test_meta.json",
  JSON.stringify(meta, null, 2),
);

console.log("Wrote:", "./LINE_sep_test.txt");
console.log(`Candidates: ${seps.length} (incl. control)`);
for (const s of seps)
  console.log(
    `  ${s.id}: ${s.cp !== null ? "U+" + s.cp.toString(16).toUpperCase().padStart(4, "0") : "—"}  ${s.name}`,
  );
