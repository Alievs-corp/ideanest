# `@ideanest/dashboard`

The creator dashboard's rules with one right answer, for `apps/web` and `apps/mobile` (#163):

| Module | Contents |
|---|---|
| `./clock` | The campaign clock: remaining-time bands, tick intervals, the 48-hour urgent threshold, server skew |
| `./controls` | Extend and withdraw: which states offer them, the 50% and 80% thresholds, the new deadline's bounds |
| `./analytics` | The funding trend's types and geometry, and the share bars' widths |
| `./finance` | The financial summary's types and how it is read |
| `./backers` | The backer report's types, reported states and the filter body |
| `./surveys` | The survey builder's types and question rules |

Import by subpath only. There is no root entry, so a web bundle pulls in exactly the module it
names: the web's first-load JS budgets have no headroom.

The words stay with each client's copy. Nothing here reads a catalogue; sentences are passed in.
