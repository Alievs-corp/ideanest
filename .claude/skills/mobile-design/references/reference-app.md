# Reference app — what it does

Source: <https://www.pinterest.com/pin/816066395023427987/> — a 15 s, 60 fps screen
recording of a dark fintech app. Analysed frame by frame (4 fps contact sheets and 20 fps
around every transition). Timings are measured from the recording and rounded.

Take the **structure and motion** from it. Colours, copy and content are ours.

## Screens

| Screen | Structure |
|---|---|
| Home | Avatar top-left, bell top-right. "Total balance" label, hero figure `$ 7,854 .43` (minor units small and grey). Pill pair: primary "Send" (white, leading arrow icon) and secondary "Request" (dark). A stack of three accent cards peeks in from the right edge. A translucent dark "Spending $1,385" block with an overlapping stack of merchant logos and a `+2` pill. A white sheet with a grabber, "Transactions" title, filter and search icon buttons, and rows: leading logo with a coloured corner dot (which card paid), name, signed amount (income in green). The list fades out under a floating pill tab bar. |
| Cards | "Cards" title and an "Order a card" white pill. Three full-width accent cards (yellow, mint, blue), each with "Digital card", masked number, a small toggle, and three circular translucent action buttons (freeze, details, settings) overhanging the card's bottom edge. Each card casts a soft glow of its own hue. |
| Recipients | "Recipients" title + "Add" pill. 3×2 grid of round avatars with name and handle. White sheet below with an "All / My accounts" segmented pill, search, and a list of accounts. |
| Send | A white full-height sheet: "Send / Request" segmented pill, "Pavlo · 7642 USD ⌄" source selector, hero amount, "Available $7,854.43", operator row `+ − × ÷`, and a 4×3 pill keypad (`.`, `0`, backspace on the last row). |
| Success | Full-bleed success colour, a check, "$286", "Sent to Pavlo", and a small "Tap anywhere to close" at the bottom. |

Tab bar: a black floating capsule with three icon-only slots; the active slot is a white
capsule behind a dark glyph.

## Motion, moment by moment

| Moment | What happens | Time |
|---|---|---|
| Home → Cards | Whole page pushes left. The peeking card stack is the shared element: it moves to the centre, the three layers separate vertically with a stagger (top card first), grow to full width, and their glows fade in last. The header title cross-moves with the page. | ~550 ms |
| Cards → Home | Interactive edge swipe; the exact reverse — cards compress back into the stack at the right edge while the home page slides in. | follows the finger |
| Spending tap → Recipients | Horizontal push; the incoming page brings its header pill and avatar grid with it; the outgoing page shifts and darkens. | ~500 ms |
| Avatar tap → Send | The recipients page dims and greys back; a white sheet rises from the bottom on a soft spring, no overshoot. | ~400 ms |
| Key press | The key's pill darkens for ~100 ms. The new digit appears at the right of the amount with a soft "blur-in" (opacity + slight scale), the placeholder `$0.00` crossfades to the first digit. | ~200 ms |
| Operator (`× 2`) | Operator and second operand appear grey after the amount; a small spinner pill `= ⋯` resolves to `= 286`. | ~300 ms |
| Commit result | Tapping `= 286` rolls the digits odometer-style, one column after another, into `$286`; the operator and operand fade out. | ~350 ms |
| Recipient chip | The recipient's tiny avatar scales in beside the amount. | ~250 ms |
| Ready to confirm | "Swipe right to confirm" hint with a hand glyph fades in under the amount. | ~250 ms |
| Swipe | During the swipe the amount turns success-green; on release the avatar flies onto the amount. | follows the finger |
| Success | A success-colour circle grows from the avatar's position until it fills the screen (circular reveal); the check, amount and caption fade up in sequence. | ~600 ms |

Character: soft springs with no visible overshoot, 300–550 ms transitions, every movement
pointing at where the content came from or is going.
