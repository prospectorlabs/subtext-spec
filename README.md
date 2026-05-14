# subtext protocol

subtext is an open protocol for embedding structured data invisibly in Unicode text.

A subtext-encoded string looks and behaves like ordinary text. It survives copy-paste across messaging platforms. To a human, it is readable prose. To a subtext-aware application, it is structured data.

```
⌬ Renting a car to BBQ and glamp at Mashiko the Sunday after next. Create prep reminders and a shopping list.
```

The string above appears to contain a single sentence. It also contains a calendar event, a reminder list, and a shopping list — invisible to the reader, recoverable by any conforming implementation.

## How it works

Unicode defines 256 Variation Selector codepoints (U+FE00–U+FE0F and U+E0100–U+E01EF). These characters modify the rendering of the preceding character and are preserved through text transformations. 256 is exactly the number of values a single byte can hold.

subtext maps each payload byte to a Variation Selector, distributes the resulting invisible sequence across the grapheme boundaries of a cover text, and frames the payload with magic bytes, a type tag, and optional compression and encryption.

The result is a carrier text that is indistinguishable from ordinary text and has been verified to survive copy-paste on Slack, X, TikTok, iMessage, and LINE.

## Specification

→ [spec.md](./spec.md)

The spec defines the VS codec, wire format, embedding strategy (including LINE word-wrap compatibility), symmetric and asymmetric encryption, and the `_type` payload schema.

## Reference implementation

→ [prospectorlabs/subtext-core](https://github.com/prospectorlabs/subtext-core)

A TypeScript library with zero runtime dependencies. Runs in the browser (Chrome 87+, Safari 16.4+, Firefox 125+) and Node.js 20+.

```bash
npm install subtext-core
```

```ts
import { encode, decode } from "subtext-core";

const text = await encode({ _type: "todo", title: "Buy oat milk" }, "pick this up on the way home");
// → "⌬ pick this up"  (contains structured data, invisible to readers)

const data = await decode(text);
// → { _type: "todo", title: "Buy oat milk" }
```

## Status

Protocol: **v0.2 draft** — stable for implementation. Breaking changes will increment the version field.  
Reference app: coming soon (TestFlight).

## License

The specification is released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Implement freely, no attribution required.
