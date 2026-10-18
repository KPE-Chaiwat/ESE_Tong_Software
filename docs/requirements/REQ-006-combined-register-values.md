# REQ-006 Combined-register numeric interpretations

Source: owner request, 2026-10-18. Explicitly brings the formerly deferred 32/64-bit interpretation scope into Modbus Master. Extends REQ-001/002/003; no new product tool/crate.

## Goal and user story
An engineer reads adjacent registers as signed/unsigned 32/64-bit integers, IEEE 754 float32 or float64 (double), using the device's byte and word order, while retaining access to original register values.

## Scope and PM defaults
- Add per-poll interpretation: existing 16-bit Unsigned, Signed, Hex and Binary; Signed 32-bit, Unsigned 32-bit, Float 32-bit, Signed 64-bit, Unsigned 64-bit and Float 64-bit (Double). Existing profiles/defaults remain Unsigned 16-bit unless they already saved another 16-bit format.
- FC03/04 only. FC01/02 retain their existing display; preserve register settings while switching function and show why combined controls are unavailable.
- **Owner confirmed:** group non-overlapping registers sequentially starting at the poll's start address, regardless of odd/even absolute address. Two registers form 32 bits; four form 64 bits. Address and alias use the first register; show the covered address range and make every constituent raw register inspectable. REQ-003 per-address scales/aliases for constituent registers remain preserved.
- Default order: most significant word first, most significant byte first within each register. Provide all four combinations of byte swap within every 16-bit register and reversal of the register-word sequence as explicit Big-endian, Little-endian, Big-endian byte swap, and Little-endian byte swap choices. Show the exact byte sequence beside each name for both widths; no arbitrary permutation editor.
- The Interpretation controls in Poll setup are reachable from the normal and combined-register value-row context menus through **Format / endian…**. The menu opens and focuses the existing draft controls; a setting changes the applied display only after **Apply interpretation**.
- Explain order with explicit raw-byte examples, not only ambiguous labels such as little endian. For 32-bit raw bytes A B C D, orders are ABCD, BADC, CDAB and DCBA. For 64-bit A B C D E F G H, they are ABCDEFGH, BADCFEHG, GHEFCDAB and HGFEDCBA.
- Quantity remains the number of wire registers. Trailing registers that cannot form a full group remain visible as raw data with an Incomplete value marker; never request extra registers, pad with zeros or combine values from different responses.
- Preserve exact integer values through display, copy and profiles; 64-bit integers must not pass through a lossy JavaScript Number. Float32/64 use IEEE 754 decoding. Render NaN, +Infinity and -Infinity explicitly, with a nonfinite indicator. Negative zero may render as 0, consistently with existing display conventions. Designer specifies finite float formatting and precision without truncating significant values silently.
- REQ-003 scaling continues unchanged for 16-bit formats. Combined modes show interpreted values and raw words; scaling is unavailable in combined mode with an explanatory message, but saved scale settings are retained and restored on return to 16-bit. This avoids silently applying the established independent 16-bit signed scaling setting to a wider type.
- Existing writes remain raw 16-bit FC06/16 operations. Opening Write from a combined group identifies its first register and retains explicit raw-register address/value entry. No inverse float/integer encoding is introduced.
- Changing interpretation/order is a display-only applied setting, marks Modified, updates current complete readings and adds no Modbus traffic. Save/load, duplicate, workspace/native hosts and copy preserve/display the same interpretation. Older profile migration and rejection of invalid/newer schemas remain explicit.

## Acceptance criteria
1. Registers 0x1234, 0x5678 decode as 305419896 in unsigned 32-bit default order; the other three orders produce 0x34127856, 0x56781234 and 0x78563412 respectively.
2. 0xFFFF, 0xFFFE decode as -2 signed 32-bit and 4294967294 unsigned. 0x3F80, 0x0000 decode as float32 1; 0x3FF0, 0, 0, 0 decode as double 1.
3. 0xFFFF repeated four times decodes as -1 signed 64-bit and 18446744073709551615 unsigned, exactly in UI and clipboard. Include min/max and values immediately above 2^53 in test vectors.
4. Both widths verify every documented order with asymmetric bytes; IEEE vectors cover fractions, negatives, subnormals, signed zero, NaN and both infinities.
5. Odd start addresses work; quantities 1/3/5 demonstrate trailing incomplete groups. Poll edits/failed replies never assemble a group from different snapshots.
6. Function switching and format switching preserve existing aliases/scales/settings; raw write values and captured traffic remain unchanged. Copy identifies the group address and exact interpreted value; raw-word inspection covers all registers.
7. Old profiles preserve their existing interpretation and scale; new settings round-trip and duplicate. Browser and real-window QA cover workspace and native displays with no regression in scheduling or responsiveness.

## Out of scope
Per-address interpretation overrides, arbitrary word permutations, mixed types inside one poll, ASCII/strings, BCD, bitfields, combined-value writes, combined-value scaling and cross-poll grouping. Separate polls cover differing types/orders.

## Handoff and open questions
Designer produces DES/FE/CHK-006 with exact grouping, copy, raw inspection and float formatting. PM supplies BE-006 with stable serialized types and public-spec test vectors. No owner decision blocks design.
