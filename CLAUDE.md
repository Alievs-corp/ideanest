# Contributing to IdeaNest

Rules for anyone — human or agent — working in this repository. They are not
suggestions. A change that violates them should be rejected in review even if
the code is otherwise correct.

---

## 1. Git workflow

**Every task follows this sequence. No exceptions.**

```bash
# 1. Start from an up-to-date main. Always.
git checkout main
git pull origin main

# 2. Branch. Never commit to main directly.
git checkout -b <type>/<short-description>

# 3. Work, committing in logical units.

# 4. Push and open a pull request.
git push -u origin <branch>
gh pr create --base main --title "..." --body "..."

# 5. Add labels. Every pull request carries a type and an area.

# 6. Merge only when CI is green.
```

### Branch naming

`<type>/<kebab-case-description>`

| Type | Use for |
|---|---|
| `feat/` | New capability |
| `fix/` | Bug fix |
| `chore/` | Tooling, config, dependencies |
| `docs/` | Documentation only |
| `refactor/` | Restructuring with no behaviour change |
| `test/` | Test coverage |
| `perf/` | Performance work |

Good: `feat/pledge-checkout-flow`, `fix/progress-bar-overflow`
Bad: `new-stuff`, `ismet-branch`, `fix2`, `patch-1`

Keep it under about fifty characters. If you cannot describe the branch in a
few words, the task is probably too large and should be split.

### Commits

Conventional Commits, in English:

```
<type>(<scope>): <subject in the imperative>

<body: what changed and why, wrapped at 72 columns>
```

```
feat(payments): add idempotent pledge confirmation

A retried request previously created a second pledge when the network
dropped between the charge and the response. Confirmation now takes an
idempotency key and returns the original result on replay.
```

Rules:

- **English only**, in commits, pull requests, code, comments, and documentation
- Imperative subject: "add", not "added" or "adds"
- No period at the end of the subject
- Explain **why** in the body. What changed is visible in the diff; the reason
  is not
- Never use `--no-verify`. If a hook fails, fix the cause

### Pull requests

Every pull request must:

1. Link its issue — `Closes #123`, or `Part of #123` for partial work
2. Carry a `type:` label and at least one `area:` label
3. Carry a `priority:` label
4. Pass CI
5. Describe what was verified, with the commands that were run

State what you did **not** do, and why. A pull request that hides a gap is
worse than one that names it.

### Merging

- Merge only when CI is green. A red pipeline is never merged, never bypassed
- Squash merge, so `main` stays readable
- Delete the branch after merge
- If CI fails, fix the cause. Do not disable the check or mark the test skipped

**Branch protection on `main`** requires: `CI complete` passing, the branch up
to date with `main`, conversations resolved, and no force pushes or deletions.
It requires **zero** approving reviews.

`CI complete` is one check and it is deliberately the only one. `ci.yml` skips
the jobs a change does not concern — a pull request touching only `apps/web`
does not build the Java service — and **a required status check that never runs
is reported as pending, not as passed**, so requiring `Frontend (typecheck,
test, storybook)` and `Backend (Java)` by name would leave those pull requests
unmergeable for ever. `CI complete` always runs, waits for the rest, and fails
if any job that had work to do did not succeed. Issue #67 has the reasoning.

> Anyone adding a job to `ci.yml` that should be able to block a merge adds it
> to `ci-complete`'s `needs` **and** to the list its script checks. Adding it to
> `needs` alone makes `CI complete` wait for a job it will then pass regardless
> of. Adding a required context in the branch protection settings instead is the
> mistake this whole arrangement exists to prevent.

That last setting is deliberate but temporary. GitHub does not permit anyone to
approve their own pull request, so on a single-maintainer repository a review
requirement makes every maintainer pull request unmergeable except by
administrator override. A rule that has to be bypassed every time is worse than
no rule, because the override becomes habit and stops being noticed.

> **Restore `required_approving_review_count` to 1 as soon as a second person
> can review.** At that point the rule protects something real.
>
> ```
> gh api --method PATCH \
>   repos/<owner>/<repo>/branches/main/protection/required_pull_request_reviews \
>   -F required_approving_review_count=1
> ```

---

## 2. Design constraints

These come from `docs/ui-kit.md` and `docs/motion-system.md`. They are
enforceable, and some of them are enforced by tests.

### Colour

**Every colour comes from `@ideanest/design-tokens`.** A hex literal in source
fails the build. If you believe you need a new colour, that is a design change:
open an issue rather than adding it inline.

**Lime means urgent, not successful.** `--lime-500` says "act now". A campaign
that reached its goal uses `--success`. Confusing the two tells a backer the
opposite of the truth.

**Never lime text on a light surface.** It measures 1.3:1 and is unreadable.
Lime is a surface with near-black text on it, or it is nothing.

**Context decides the token.** `text-white/64` is invisible on a lime card and
on a white panel. Use the `onLime` and `on-white` variants.

### Motion

**One scroll-entry animation.** `FadeUp`, everywhere. A second entry animation
is a design change, not an implementation detail.

**Motion decreases as money gets closer.** Discovery may animate. Checkout must
not — every animation there reads as hesitation. The budget per surface is in
`docs/motion-system.md` §5.

**Animate only `transform` and `opacity`.** Anything else forces layout on every
frame.

**`prefers-reduced-motion` is mandatory.** Not a nice-to-have.

### Accessibility

- Icon-only controls need an accessible name
- Colour alone must never carry meaning — pair it with an icon or text
- Focus must be visible on every interactive element, including on lime
- Contrast failures are build errors, not warnings

---

## 3. Code standards

### TypeScript

- `strict` and `noUncheckedIndexedAccess` are on. Do not weaken them
- No `any`. If a type is genuinely unknown, use `unknown` and narrow it
- Types shared between packages live in a shared package, never duplicated

### Money

**Never use floating point for money.** `0.1 + 0.2 !== 0.3`, and on a funding
platform that is somebody's pledge. Use `decimal.js` on the frontend and
`BigDecimal` on the backend. Money crosses the API as a string, never a number.

### Backend

- Java 21, Spring Boot, Gradle
- Every schema change is a versioned, reversible migration
- Migrations must be safe under rolling deployment: expand, then contract, never
  both in one release
- Every payment mutation is idempotent
- Every privileged action is audited

### Testing

- Behaviour and accessibility are tested; appearance is reviewed in Storybook
- Money arithmetic, state transitions, idempotency, and stock reservation are
  **not optional** to test — they fail silently and expensively
- A test that is skipped is a bug report nobody filed
- A visual change arrives with its updated snapshots, in the same pull request.
  Accepting a snapshot without reading what changed is the same failure as
  deleting the test

---

## 4. Documentation

| File | Contents |
|---|---|
| `README.md` | Product summary, setup, scripts |
| `docs/architecture.md` | Full platform specification |
| `docs/ui-kit.md` | Colour, surface, typography, components |
| `docs/motion-system.md` | Motion tokens, patterns, budgets |
| `packages/*/README.md` | Package-level usage |

Update the documentation in the same pull request as the change. Documentation
that trails the code is worse than none, because it is believed.

---

## 5. Working with issues

Work is tracked as epics with native sub-issues.

- Pick a sub-issue, not an epic
- Assign yourself before starting
- One sub-issue, one branch, one pull request
- If the work grows beyond the issue, split it rather than expanding the pull
  request

Issues labelled `status: needs-decision` are blocked on a product or legal
answer. Do not implement around them — the decision changes the design.

---

## 6. For agents

- Read `docs/ui-kit.md` and `docs/motion-system.md` before touching any UI
- Never invent a colour, radius, or duration. Everything exists as a token
- Never commit to `main`
- Never claim something works without running it. "Typecheck passes" means you
  ran the typecheck and saw it pass
- Report what failed as plainly as what succeeded
- When a rule here conflicts with a habit, the rule wins
