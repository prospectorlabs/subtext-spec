// LINE の wrap 仕様を完全特定するテストスペシメン生成器。
//
// 11 個のテストケースを 1 ファイルに格納。LINE に 1 メッセージとして送ると
// 「累積カウンタなのか / 可視文字でリセットするのか / 厳密な閾値はいくつか」
// が一度に分かる。
//
// 各スペシメンは：
//   T0X[<可視マーカー の中に N 個の VS Supplement 不可視文字>]
// VS は連続する byte (specimen ごとに別の起点) を符号化、ドロップを検出可能。

import fs from "node:fs";

const VS1_BASE = 0xfe00; // bytes 0x00-0x0F
const VS2_BASE = 0xe0100; // bytes 0x10-0xFF

function byteToVS(byte) {
  if (byte < 0x10) return String.fromCodePoint(VS1_BASE + byte);
  return String.fromCodePoint(VS2_BASE + byte - 0x10);
}

function seqVS(count, startByte = 0x10) {
  let s = "";
  for (let i = 0; i < count; i++) s += byteToVS(startByte + i);
  return s;
}

const cases = [
  { id: "T01", n: 5,    body: () => `[${seqVS(5)}]`,    desc: "5 invisibles — sanity baseline" },
  { id: "T02", n: 28,   body: () => `[${seqVS(28)}]`,   desc: "28 invisibles — under threshold" },
  { id: "T03", n: 29,   body: () => `[${seqVS(29)}]`,   desc: "29 invisibles" },
  { id: "T04", n: 30,   body: () => `[${seqVS(30)}]`,   desc: "30 invisibles — at threshold" },
  { id: "T05", n: 31,   body: () => `[${seqVS(31)}]`,   desc: "31 invisibles — just over" },
  { id: "T06", n: 32,   body: () => `[${seqVS(32)}]`,   desc: "32 invisibles" },
  { id: "T07", n: 60,   body: () => `[${seqVS(60)}]`,   desc: "60 invisibles — 2 wraps?" },
  { id: "T08", n: 100,  body: () => `[${seqVS(100)}]`,  desc: "100 invisibles" },
  // Counter-reset probes — different start bytes so we can tell which half a byte came from.
  { id: "T09", n: 40,   body: () => `[${seqVS(20, 0x10)}X${seqVS(20, 0x40)}]`, desc: "20+X+20 (visible interrupter)" },
  { id: "T10", n: 40,   body: () => `[${seqVS(20, 0x10)} ${seqVS(20, 0x40)}]`, desc: "20+space+20" },
  { id: "T11", n: 40,   body: () => `[${seqVS(20, 0x10)}\n${seqVS(20, 0x40)}]`, desc: "20+newline+20" },
];

const header = `LINE 仕様調査テスト
このメッセージを LINE に送って、受信側で全文をコピーして送り返してください。
(全文を1メッセージとして送るのを推奨。長すぎてLINEに弾かれる場合は2分割可。)

`;

let out = header;
for (const c of cases) out += `${c.id}${c.body()}\n`;

fs.writeFileSync("./LINE_spec_test.txt", out);

// Metadata for analyzer
const meta = cases.map((c) => ({
  id: c.id,
  n: c.n,
  desc: c.desc,
  // List the byte values each specimen should contain in order.
  expectedBytes: (() => {
    if (c.id === "T09" || c.id === "T10" || c.id === "T11") {
      const a = Array.from({ length: 20 }, (_, i) => 0x10 + i);
      const b = Array.from({ length: 20 }, (_, i) => 0x40 + i);
      return [...a, ...b];
    }
    return Array.from({ length: c.n }, (_, i) => 0x10 + i);
  })(),
}));
fs.writeFileSync(
  "./LINE_spec_test_meta.json",
  JSON.stringify(meta, null, 2),
);

console.log("Wrote:", "./LINE_spec_test.txt");
console.log("Cases:", cases.length);
for (const c of cases) console.log(`  ${c.id}: ${c.desc}`);
console.log("Meta:", "./LINE_spec_test_meta.json");
