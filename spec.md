# subtext Protocol Specification

**Version**: 0.2  
**Status**: Draft  
**Date**: 2026-05-14  
**Repository**: prospectorlabs/subtext-spec  

---

## 1. Overview

subtext is a protocol for embedding arbitrary byte sequences invisibly into any Unicode text string, using Variation Selectors (VS).

Encoded text is visually indistinguishable from ordinary text and has been verified (as of 2026-05-14, on physical devices) to survive copy-paste operations across Slack, X, TikTok, iMessage, and LINE.

The central claim of the design is: **text can circulate as text while carrying machine-readable structured data**.

---

## 2. Terminology

**Cover text**: The human-readable string that carries the payload. What the recipient sees.

**Payload**: The byte sequence encoded as a VS sequence. A framed binary representation.

**VS character**: A single VS codepoint.

**VS sequence / VS chunk**: One or more consecutive VS characters.

**Carrier text**: The final string — marker + cover text + distributed VS chunks — that is actually copied and pasted.

**⌬ marker**: U+232C (BENZENE RING). A brand marker indicating the text was produced by the subtext protocol. It carries no protocol-level meaning. `extract` returns the same byte sequence regardless of marker presence (the marker can be added or removed freely). By convention, `embed` **prepends `⌬ ` to the carrier text**.

**Grapheme cluster**: What a human counts as one character. Obtained via `Intl.Segmenter` or equivalent. Used as the unit for distributing VS chunks across cover text.

**SAFE_CHUNK**: The maximum safe length of a consecutive invisible-character run (VS chunk). **30 characters**. Exceeding this causes some messaging apps (LINE) to trigger word-wrap processing that drops VS characters (see §9.3).

---

## 3. VS Codec

### 3.1 Codepoint Assignment

Unicode defines 256 VS codepoints:

```
U+FE00–U+FE0F    16 codepoints  (VS1–VS16)
U+E0100–U+E01EF  240 codepoints (VS17–VS256)
Total            256 codepoints
```

256 matches the full range of one byte (0x00–0xFF), enabling a direct 1:1 mapping between bytes and VS codepoints.

### 3.2 Byte → Codepoint Mapping

```
encode_byte(b):
  if b <= 0x0F: return U+FE00 + b
  else:         return U+E0100 + (b - 0x10)

decode_codepoint(cp):
  if 0xFE00 <= cp <= 0xFE0F:   return cp - 0xFE00
  if 0xE0100 <= cp <= 0xE01EF: return (cp - 0xE0100) + 0x10
  else: not a subtext VS — skip
```

### 3.3 UTF-8 Overhead

```
U+FE00–U+FE0F    → 3 bytes UTF-8  (EF B8 80 – EF B8 8F)
U+E0100–U+E01EF  → 4 bytes UTF-8  (F3 A0 84 80 – F3 A0 87 AF)
```

Typical JSON (mostly printable ASCII) maps almost entirely to the U+E0100–U+E01EF range, producing roughly 4 bytes of UTF-8 overhead per payload byte. Enabling compression (flag bit 0, §7) often halves effective payload size.

**Recommended payload size**: under 2 KB. A 2 KB payload adds approximately 8–9 KB of invisible VS data to the carrier text. Payloads exceeding 10 KB are outside the design scope of this protocol.

**Additional constraint for LINE compatibility**: When using the distribution strategy in §3.5, the clean byte capacity is approximately `grapheme_count × 30` bytes (see §3.5.5). Payloads beyond this limit can still be carried via HAIR_SPACE fallback, though narrow whitespace characters become visible.

### 3.4 Incidental VS in Cover Text

Some cover text characters include incidental VS (e.g., U+FE0F for emoji text presentation). The decoder locates payloads via magic byte frame detection (§4) rather than position, so incidental VS does not corrupt decoding.

On the encoding side: if a cover grapheme cluster contains incidental VS, payload VS chunks are placed **only after** that grapheme, ensuring the frame byte sequence is never split by incidental VS (see §3.5).

---

## 3.5 Embedding Strategy

### 3.5.1 Structure

The carrier text has the following structure:

```
⌬ <space> <cover with VS chunks distributed across grapheme boundaries>
```

Formally:

```
MARKER ' ' G[0] V[0] G[1] V[1] G[2] V[2] ... G[n-1] V[n-1]?
```

Where:
- `MARKER` = `U+232C` (`⌬`), fixed at the start
- `' '` = U+0020, separating marker from cover
- `G[i]` = the i-th grapheme cluster of the cover text (i ∈ [0, n))
- `V[i]` = the i-th VS chunk (zero or more VS characters), placed **before** `G[i]`

A VS chunk **must not** follow the final grapheme `G[n-1]` — some chat implementations strip trailing invisible characters.

### 3.5.2 Why Distribute

Concentrating VS characters in one location causes some messaging apps to treat the long invisible run as a wrap target, inserting whitespace mid-sequence and destroying surrogate pairs (dropping entire codepoints). See §9.3.1 for the specific LINE behavior.

Each visible grapheme acts as a wrap-counter reset point. Keeping each VS chunk ≤ SAFE_CHUNK ensures word-wrap does not fire and the byte sequence is preserved intact.

### 3.5.3 Distribution Algorithm

```
let G = graphemeClusters(coverText)              // array of n elements
let V = encodeVS(framedPayload)                  // VS string
let lastVSIdx = index of last grapheme in G containing incidental VS (-1 if none)
let safeStart = lastVSIdx + 1

if safeStart >= n:
  // Degenerate case: all graphemes contain incidental VS.
  // Fall back to tail placement with HAIR_SPACE separators.
  fall back to tail placement with HAIR_SPACE separators

let numGaps = n - safeStart
let baseSize = floor(|V| / numGaps)
let extras   = |V| mod numGaps

output = MARKER + ' '
for i in 0..safeStart-1:
  output += G[i]
let vIdx = 0
for i in 0..numGaps-1:
  let chunkLen = baseSize + (i < extras ? 1 : 0)
  let chunk = V[vIdx..vIdx+chunkLen]
  vIdx += chunkLen
  // If chunk exceeds SAFE_CHUNK, split with HAIR_SPACE
  for j in 0..chunkLen-1:
    if j > 0 and j mod SAFE_CHUNK == 0:
      output += HAIR_SPACE      // U+200A
    output += chunk[j]
  output += G[safeStart + i]
```

### 3.5.4 HAIR_SPACE Fallback

When a VS chunk exceeds SAFE_CHUNK, U+200A HAIR SPACE is inserted every SAFE_CHUNK characters. HAIR SPACE has the Unicode Whitespace property (resetting the wrap counter), but renders at near-zero width (typically ~1px), minimizing visual impact.

### 3.5.5 Clean Capacity (bytes without HAIR_SPACE)

```
clean_capacity_bytes ≈ (n - lastVSIdx - 1) × SAFE_CHUNK
```

Examples:
- n=7 graphemes, no incidental VS → 7 × 30 = 210 bytes
- n=12 graphemes, no incidental VS → 12 × 30 = 360 bytes
- n=3 graphemes, first is `❤️` (contains U+FE0F) → (3 − 0 − 1) × 30 = 60 bytes

Implementations are encouraged (but not required) to compute required capacity from payload size and grapheme count, and to prompt the user to lengthen the cover text when capacity is insufficient.

### 3.5.6 Decoder Transparency

`extract` collects all VS characters in order, regardless of position, so distributed placement is fully transparent to the decoder. A single code path correctly decodes both legacy (concatenated VS) and current (distributed VS chunk) formats.

---

## 4. Wire Format

### 4.1 Frame Structure

The byte sequence obtained after decoding all VS characters:

```
+--------+--------+--------+--------+--------+--------+--------+--------+
| magic           | length                    | ver    | flags  | body...
| 2 bytes         | 4 bytes (big-endian)       | 1 byte | 1 byte |
+--------+--------+--------+--------+--------+--------+--------+--------+
```

**magic**: `0xAB 0xCD` (fixed). Used to locate the frame start, skipping any incidental VS in the cover text.

**length**: Byte count of `version + flags + body`, big-endian 4-byte unsigned integer.

**version**: Currently `0x01`. Incremented on incompatible changes.

**flags**: Each bit independently enables an option.

**body**: Type-tagged payload, before compression or encryption (§4.3).

### 4.2 Flag Bit Definitions

```
bit 0 (0x01): body is compressed (deflate-raw)
bit 1 (0x02): body is symmetrically encrypted (AES-256-GCM + PBKDF2)
bit 2 (0x04): body is asymmetrically encrypted (ECDH P-256 + HKDF + AES-GCM)
bits 3–7:     reserved (must be 0)
```

Bits 1 and 2 are mutually exclusive. A frame with both set is invalid.

### 4.3 Body Structure (after decryption and decompression)

```
+--------+---------...--------+
| type   | payload bytes      |
| 1 byte |                    |
+--------+---------...--------+
```

**Type tag**:

```
0x00  Uint8Array (raw bytes)
0x01  UTF-8 string
0x02  JSON (UTF-8 encoded JSON value)
```

### 4.4 Processing Order

**Encoding**:
1. Serialize payload to a type-tagged byte sequence
2. Apply compression and/or encryption according to flags
3. Assemble frame: `magic + length + version + flags + body`
4. Convert byte sequence to VS string
5. Distribute VS string across cover grapheme boundaries (§3.5) and prepend marker

**Decoding**:
1. Collect all VS characters from the carrier text, preserving order, and convert to bytes
2. Search for magic bytes (`0xAB 0xCD`) to locate frame start
3. Read length and extract body
4. Apply decryption and/or decompression according to flags
5. Read type tag and recover payload

---

## 5. Symmetric Encryption (flag bit 1)

When flag bit 1 is set, the body is stored as:

```
+--------+----..----+----..----+----..--------+
| ver    | salt     | IV       | ciphertext + GCM tag |
| 1 byte | 16 bytes | 12 bytes | variable + 16 bytes  |
+--------+----..----+----..----+----..--------+
```

**ver**: `0x01`

**KDF**: PBKDF2-HMAC-SHA256, 600,000 iterations (OWASP 2023 recommendation)

**Cipher**: AES-256-GCM. Key is 32 bytes derived by KDF. Salt and IV generated by CSPRNG.

---

## 6. Asymmetric Encryption (flag bit 2)

When flag bit 2 is set, the body is stored as:

```
+--------+----...(65 bytes)...----+----..----+----..--------+
| ver    | ephemeral pubkey       | IV       | ciphertext + GCM tag |
| 1 byte | 65 bytes (SEC1 uncompressed) | 12 bytes | variable + 16 bytes |
+--------+----...(65 bytes)...----+----..----+----..--------+
```

**ver**: `0x01`

**ephemeral pubkey**: ECDH P-256 public key generated fresh per message. SEC1 uncompressed format (`0x04 || X(32B) || Y(32B)`).

**KDF**: HKDF-SHA256 applied to the ECDH shared secret. Salt: empty (length 0). Info: `"subtext-v1-asym-aesgcm"` (domain separation).

**Cipher**: AES-256-GCM. Key is 32 bytes derived by HKDF.

**Forward Secrecy**: A fresh ephemeral key pair is generated per message, providing per-message forward secrecy.

**Recipient's long-term public key format**: SEC1 uncompressed, 65 bytes, base64url-encoded (no padding) → 87 characters. Exchanged via the `contact` payload type's `public_key.value` field (§8).

---

## 7. Compression (flag bit 0)

When flag bit 0 is set, the body is compressed with deflate-raw (RFC 1951) before encryption. When combined with encryption, the order is: **compress then encrypt**.

Web Crypto API implementations use `CompressionStream` / `DecompressionStream` with the `deflate-raw` format.

---

## 8. Payload Types (`_type` Schema)

subtext JSON payloads are designed as a tagged union. The root object always has a `_type` property.

```
JSONValue = CalendarEvent | Todo | Contact | Link | Bundle
```

Detailed schemas are defined as JSON Schema 2020-12 in `schema/types/`:

- `calendar_event.json`
- `todo.json`
- `contact.json`
- `link.json`
- `bundle.json`
- `index.json` (oneOf union of all five)

### 8.1 The `contact` Type and Public Key Exchange

The `public_key` field of the `contact` type allows contact information and an encryption public key to be exchanged in a single payload. By embedding key retrieval in the natural interaction of saving a contact, explicit key-exchange ceremonies become unnecessary.

```json
{
  "_type": "contact",
  "name": { "display": "Hanako Tanaka" },
  "public_key": {
    "alg": "ECDH-P256",
    "value": "<87-char base64url>",
    "fingerprint": "<11-char base64url>"
  }
}
```

`fingerprint` is the first 8 bytes of the SHA-256 hash of the public key, base64url-encoded (no padding) → 11 characters.

### 8.2 The `bundle` Type

A container for carrying multiple items in a single carrier text. Nesting `bundle` within `bundle` is prohibited.

```json
{
  "_type": "bundle",
  "context": "Here's everything for the trip — please save these.",
  "items": [
    { "_type": "todo", ... },
    { "_type": "calendar_event", ... }
  ]
}
```

---

## 9. Implementation Notes

### 9.1 Secure Context in iOS WKWebView

The Web Crypto API (`crypto.subtle`) is only available in a Secure Context. When implementing this spec's encryption features inside an iOS WKWebView, the `baseURL` argument to `loadHTMLString(_:baseURL:)` determines whether the page is treated as a Secure Context.

- `baseURL: nil` causes WebKit to treat the page as an Insecure Context, making `crypto.subtle` undefined. Any call to `generateKey`, `encrypt`, `decrypt`, or `deriveBits` immediately throws `undefined is not an object`.
- Passing an HTTPS-scheme URL as `baseURL` (e.g., `URL(string: "https://localhost/")`) causes WebKit to treat the page as a Secure Context, enabling the full Web Crypto API. No actual network connection is made; this is purely an origin classification mechanism.
- This issue only surfaces when encryption is first added, since plain `encode`/`decode` does not require a Secure Context.

### 9.2 `callAsyncJavaScript` Argument Passing

In WKWebView's `callAsyncJavaScript(_:arguments:in:in:completionHandler:)`, values passed in `arguments` are accessible in JavaScript as **direct variable names** (e.g., `key`), not as `arguments["key"]`.

### 9.3 Platform Compatibility

The following platforms have been verified to preserve VS characters intact as of 2026-05-14: Slack, X (Twitter), TikTok, iMessage, **LINE (only when using the distribution strategy in §3.5)**.

The following platform strips VS characters on share (but preserves them on copy): Apple Notes (strips on share only; copy/display is intact).

### 9.3.1 LINE Word-Wrap Behavior

LINE applies the following processing to received message text (observed 2026-05-14 on physical devices; verified reproducibly via `tools/line-test/`):

- Consecutive invisible characters — VS, ZWNJ, ZWJ, WJ, BOM, Invisible Separator, and all other characters **without** the Unicode Whitespace property — are **cumulatively counted**.
- When the count reaches **31**, word-wrap fires.
- Wrap processing **replaces the 31st invisible character with two U+202F NARROW NO-BREAK SPACE characters**.
- VS Supplement codepoints (U+E0100–U+E01EF) are UTF-16 surrogate pairs; replacement mid-pair leaves an orphaned surrogate, destroying the entire codepoint.
- Each wrap event loses exactly 1 codepoint (= 1 payload byte).
- Characters with the Unicode Whitespace property (U+0020, U+00A0, U+2009, U+200A, U+202F, etc.) **reset the counter**.
- Zero-width control characters (U+200B, U+200C, U+200D, U+2060, U+FEFF, U+2063, U+034F, U+00AD, U+200E, U+180E) do **not** reset the counter — they accumulate as invisible characters.

The distribution strategy in §3.5 prevents wrap from firing by keeping each VS chunk ≤ 30 characters. Each cover grapheme (or HAIR_SPACE) acts as a visible character that resets the counter.

iMessage, Slack, X, and TikTok do not perform this wrap processing; the distribution strategy produces identical results to concatenated placement on those platforms. All implementations targeting LINE **should** implement §3.5.

---

## 10. Error Codes

All errors returned by a conforming implementation are identified by a `code` string:

```
NO_PAYLOAD           No subtext payload found in the text
UNSUPPORTED_VERSION  Version field is outside the implementation's supported range
UNKNOWN_FLAGS        Unknown flag bits are set
DECRYPT_FAILED       Decryption failed (wrong passphrase or tampered data)
PASSPHRASE_REQUIRED  Body is symmetrically encrypted but no passphrase was provided
PRIVATE_KEY_REQUIRED Body is asymmetrically encrypted but no private key was provided
INVALID_PUBLIC_KEY   Public key format is invalid
INVALID_TYPE_TAG     Unknown type tag byte
EMPTY_COVER          Cover text is empty
EMPTY_PAYLOAD        Payload is empty
CORRUPT_PAYLOAD      Frame is malformed or truncated
```

---

## 11. Runtime Requirements

**Browser**: Chrome 87+, Safari 16.4+, Firefox 125+

**Node.js**: 20+

`Intl.Segmenter` (the Firefox 125+ requirement) is used to preserve grapheme cluster boundaries in cover text.

---

## 12. Versioning

- This document describes the v0 (Phase 1) protocol.
- v1 will be frozen at public launch. Backward compatibility thereafter is maintained by adding new `_type` values.
- Removing or renaming properties of existing types is a v2+ change.
- Reformatting as an IETF Internet-Draft is planned for a future phase.

### 12.1 Changelog (pre-release)

**0.2 (2026-05-14)**:
- §3.5 "Embedding Strategy" added: VS chunks are distributed across cover grapheme boundaries. Required for LINE compatibility (LINE drops invisible characters after a run of 30, destroying surrogate pairs).
- §2: Marker `⌬` position changed from trailing (` ⌬`) to leading (`⌬ `).
- §3.4: Handling added for cover graphemes that contain incidental VS (payload chunks placed only after the last such grapheme).
- §9.3 / §9.3.1: LINE compatibility updated to "preserved when using distribution strategy" (verified on device). Detailed LINE word-wrap specification added.

**0.1 (2026-05-13)**: Initial draft.
