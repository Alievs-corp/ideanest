# Reference promos — what they do

Three vertical app promos the owner picked on 2026-10-12. Each was downloaded and read
frame by frame (2–4 fps contact sheets, 10 fps around transitions, scene-cut detection,
loudness measured with `ebur128`). Timings are measured and rounded.

Take the **craft** from them: pacing, camera, how UI is staged, how a film ends. Never
their colours, typefaces, copy, music or brand marks — ours come from
`@ideanest/design-tokens`, Inter and the message catalogue.

| | A · Apple Music concept | B · Gamified habit tracker | C · WhatsApp Status stickers |
|---|---|---|---|
| Source | <https://www.pinterest.com/pin/816066395023612695/> | <https://www.pinterest.com/pin/816066395023612708/> | <https://www.pinterest.com/pin/816066395023612714/> |
| Length / fps | 18.5 s · 30 fps | 10.0 s · 24 fps | 43.5 s · 24 fps |
| Format | 720×1280 (9:16) | 720×1280 (9:16) | 720×1280 (9:16) |
| Cuts | ~31, one every 0.5–0.6 s (on the beat) | 1 (at 6.0 s) | 5 (4.0, 13.5, 18.7, 31.6, 35.0 s) |
| Energy | Kinetic, beat-driven | Slow, cinematic, single take | Explanatory, step by step |
| Loudness | −16.5 LUFS, LRA 3.4 LU | — | — |

## A · Apple Music concept — kinetic beat montage

| Time | What happens |
|---|---|
| 0.0–0.5 s | Black. "This is" in small bold type, one word in the brand colour. |
| 0.5–1.0 s | Hard cut to white. "Music" wordmark, a note glyph drops in under the "u". |
| 1.0–2.0 s | Full-bleed brand-colour background, a phone **tilted ~20° and cropped by the frame** shows the lock screen; a notification slides in. The phone is never centred and whole — it is a detail. |
| 2.0–3.0 s | White. Two tilted phones float. **Pop-out card:** the hero card of the "New" screen lifts *out of the glass* toward camera (scale ~1.15, offset up-left, own drop shadow), holds ~0.3 s, then settles back flush into the layout. The background cuts white → black under the phone while the card settles. |
| 3.0–4.0 s | **Macro on the tab bar**: two tab icons filling the frame, the active one switches with an icon morph. A component, not a screen, is the subject. |
| 4.0–5.0 s | Home screen, phones rotating through ~15° between beats. |
| 5.0–6.5 s | Headline "Your music companion" pinned at the top, two lines, very bold, tight leading. **The background alternates black / brand / black on each beat while the headline stays still**, and the screen inside the phone changes each beat. |
| 6.5–7.0 s | **Exploded menu:** the Library list items (Playlists, Artists, Tracks…) float as separate 3D slabs in a diagonal stack, then collapse back into the list. |
| 7.0–8.5 s | Library screen, two phones, a push-in. |
| 8.5–9.5 s | "Pin it" — the headline sits *behind* the phone (phone overlaps the type). Background alternates brand / black. |
| 10.0–10.5 s | Genre cards scattered in 3D space fly toward camera, then a cut to the Search grid. |
| 11.5–12.5 s | "Tailored to you" — headline over a phone with the keyboard typing a search. |
| 12.5–15.0 s | Logo on white, held still for 2.5 s. |
| 15.0–18.5 s | URL end card on black; the URL letters reveal left to right with a soft blur. |

What makes it premium: every cut lands on the beat; the phone is always tilted, cropped
and moving; one component at a time is the hero (card, tab bar, list items); type is
huge, bold and few words; a long still logo hold ends it.

What it gets wrong for us: whole-frame black/brand/white strobing on every beat for
seconds is close to the photosensitive flash limit and tiring; real artist photos and
song titles we could never use.

## B · Gamified habit tracker — cinematic single take

| Time | What happens |
|---|---|
| 0.0–3.0 s | One phone floating in a dark, misty studio (deep navy, soft floor glow). The camera orbits slowly; the phone turns from three-quarter view to edge-on. |
| 3.0–5.0 s | The camera **pushes in** to the screen; background goes soft (depth of field). A **tap ring** (white circle expanding and fading) shows a tap on the Rewards tab. |
| 5.0–6.0 s | The camera pulls back while the screen scrolls. |
| 6.0–8.5 s | Cut to an extreme close-up of one card ("Rewards Shop"), a second tap ring, a hover-lift on the card. |
| 8.5–10.0 s | Pull back; the phone spins edge-on and lands centred, straight, still — the end frame. |

What makes it premium: the camera never stops moving; lighting and depth of field;
one continuous take that feels like a product film.

What it gets wrong — **the lesson that matters most:** the UI is AI-generated. Paused,
the text is gibberish ("Geobont Krei", "Eamandts", "Buy Off", "Wands Dards"). At
thumbnail size it looks expensive; paused, it looks fake. Our UI pixels are always real
captures of the app.

## C · WhatsApp Status stickers — explainer with type and people

| Time | What happens |
|---|---|
| 0.0–4.0 s | Lifestyle photo of two people looking at a phone, framed inside a rounded card on a pale brand-tint background. "NEW" badge pill + "on Status:" headline; UI chips (Reaction, Question) pop onto the photo with short **hand-drawn burst strokes** around them. |
| 4.0–13.5 s | Headline at the top ("Add a **question sticker** on your status,") — the key phrase in the brand colour. Below, a real screen recording inside a cropped frame: the sticker tray opens, the Question chip is tapped (burst strokes again), the sticker is placed. |
| 13.5–18.7 s | Headline swaps to "and let your people weigh in." Lock screen with three response notifications stacking in. |
| 18.7–31.6 s | Activity list of responses; then "Or show your mood with a reaction sticker." and the reaction flow, emoji search, the sticker landing on the photo. |
| 31.6–35.0 s | The result — three viewers' stories with the reaction, small emoji bursting off the edges. |
| 35.0–39.0 s | Full brand-colour card: the summary headline, with **hand-drawn underlines** sweeping under the two feature names. |
| 39.0–40.5 s | **Logo resolve:** the headline collapses into a few dots; the dots draw the logo glyph; the wordmark reveals letter by letter. |
| 40.5–43.5 s | Logo held still. |

What makes it premium: each sentence of the headline is one step of the story, so the
film explains itself with the sound off; the UI is real; hand-drawn marks add warmth;
the ending turns the message itself into the logo.

What it gets wrong for us: 43 s is long for a feed; the pace sags in the middle.

## What we take, and what we leave

| Take | From | Becomes, in our film |
|---|---|---|
| Cuts on the beat, phone tilted and cropped, one component as hero | A | Montage bars, the pop-out card |
| Pop-out card from the glass | A | The campaign card lifting out to meet its backers |
| Exploded list into 3D slabs | A | Optional: reward tiers fanning out of the campaign page |
| Camera always moving, dark studio, push-in, tap ring | B | Every device shot; tap rings on every tap |
| Headline sentences that tell the story with sound off | C | Our four headline cards |
| Message collapses into the logo | C | The spark gathering into the IdeyaNest mark |
| Long still hold on the end card | A, C | ≥ 2 s still end card |

| Leave | Why |
|---|---|
| AI-generated UI | Gibberish when paused (B). Captures are real |
| Seconds of full-frame strobing | Flash-safety and fatigue (A). Our alternation is capped |
| Their colours, burst-stroke style, typefaces | Not ours, and copying them makes us look like them |
| 40 s explainer length | Our master is 30 s, with 15 s and 6 s cuts |
