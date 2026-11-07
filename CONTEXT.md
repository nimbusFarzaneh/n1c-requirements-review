# N1C ACC requirements review: project context

This file explains the whole project so a person or an AI assistant can pick it up without the original conversation. It covers why the review board exists, how it works, where everything lives, what was decided, and what comes next.

Owner: **Nima Farzaneh** (GitHub `nimbusFarzaneh`). Last updated: 6 November 2026 (commit after `5e06213`).

---

## 1. Background: the wider requirements process

Nima is gathering requirements for a new multi-actor application: the **N1C Actionability Coordination Center (ACC)** for the N=1 Collaborative. The planned process:

1. **Use case diagram:** actors and their goals (done with an AI agent).
2. **System context diagram:** the system as one box, with people and external systems around it.
3. **Prioritised list of key workflows.**
4. **Scope review with stakeholders** ← *this repository*: reviewers confirm which requirements are **MVP**, **Later**, **Out of Scope**, or **Need an N1C decision**.
5. After scope is agreed: **swimlane diagrams** per workflow, **state diagrams** for core entities, a **permission matrix**, then **sequence diagrams** for integrations.
6. Later steps: written requirements (user stories with acceptance criteria), non-functional requirements, wireframes, technical design, estimates and backlog, traceability.

Swimlanes for workflows that are clearly MVP may start while the review runs; the rest wait for the review outcome.

## 2. The review in one paragraph

All **197 requirements** (109 MVP, 69 Later, 12 Out of Scope, 7 Needs N1C Decision) are shown as cards on a web board. Each of **three reviewers** signs in with a personal access code and, for every card, **agrees** with its column, or **moves** it (with a required reason). On the 7 *Needs N1C Decision* cards they instead pick the column they'd choose; those are settled in a discussion afterwards. Reviewers can comment on any card and suggest missing requirements. Everything is saved to a private Google Sheet owned by Nima. **Deadline: end of Thursday 12 November 2026.**

## 3. Where everything lives

| What | Where |
|---|---|
| Review board (public page, no data in it) | https://nimbusfarzaneh.github.io/n1c-requirements-review/ |
| Source code | https://github.com/nimbusFarzaneh/n1c-requirements-review (branch `main`, served by GitHub Pages from the root) |
| Data and feedback | Private Google Sheet owned by Nima ("N1C ACC requirements review – Nov 2026"), not shared with reviewers |
| Backend | Google Apps Script bound to that sheet, deployed as a web app. URL is in `config.js` (`scriptUrl`) |
| Original requirements source | `N1C_ACC_requirements_for_review.xlsx` (latest version is what's in the sheet; an older 4 Nov PDF reference with 206 items is superseded) |

### Repository files

| File | Purpose |
|---|---|
| `index.html` | Page layout and all styling. Script tags use `?v=N` cache-busting; bump N on every release. |
| `app.js` | All board behaviour (vanilla JS, no build step). Includes demo data used when `scriptUrl` is empty. |
| `config.js` | `scriptUrl`, `projectName` ("N1C"), `deadline` ("the end of Thursday 12 November"). |
| `apps-script/Code.gs` | Backend. **Not run by GitHub**: it must be pasted into the sheet's Apps Script editor and redeployed. |
| `logo.png`, `favicon.png` | N=1 Collaborative logo (cropped from a screenshot; a sharper original would be better). |
| `README.md` | Setup and owner instructions. |
| `CONTEXT.md` | This file. |

## 4. Architecture and security model

- **GitHub Pages** serves a static page containing **no requirement text and no access codes**.
- On sign-in the page POSTs `{action:'load', code}` (as `text/plain` to avoid CORS preflight) to the **Apps Script web app**, which checks the code against the Reviewers tab and only then returns data.
- Web app deployment settings: **Execute as: Me**, **Who has access: Anyone** (lets the page call it; it never exposes the sheet itself).
- Access codes are personal (`n1c-XXXX-XXXX`). They are stored **only in the Reviewers tab**. The page remembers the code in the browser's localStorage until **Sign out** (deliberate: reviewers come back several times).
- All writes go through a script lock; text is prefixed with `'` if it starts with `= + - @` (no formula injection).

### Changing the backend

After editing `apps-script/Code.gs`: open the sheet → **Extensions → Apps Script** → replace all of `Code.gs` → Save → **Deploy → Manage deployments → pencil → Version: New version → Deploy**. (Never "New deployment": that changes the URL.) The GitHub copy and the deployed copy can drift; always confirm the sheet runs the latest version.

## 5. Google Sheet structure

Run **Review board → Set up tabs** (or the `setup` function) once. Columns marked *auto* are added automatically by the script if missing.

**Requirements** (owner-maintained; one row per requirement)
`ID | Requirement | Workflow | Actor | Category | Reason | Also involves | Open question | Decision | Decision date (auto) | Decision rationale (auto)`
- Category must be exactly `MVP`, `Later`, `Out of Scope` or `Needs N1C Decision`. Anything else is **not shown** and the board displays a red warning naming the ID.
- **Decision**: leave empty until decided; then enter the final column (e.g. `Later`). The card becomes locked (script refuses further reviews) and appears in the "decided" pile. **Do not change Category**: it records the original proposal.
- ID prefixes in the data: `OBJ-` objectives, `FR-…` functional (e.g. `FR-ACC`, `FR-REC`, `FR-INT`, `FR-DASH`, `FR-SUB`, `FR-GOV`, `FR-ROLE`), `NFR-…` non-functional, `CON-` constraints. 52 items have no Actor (mostly OBJ/NFR/CON); all have a Reason.

**Reviewers** (owner-maintained)
`Name | Code | Active | Role (auto)`
- Reviewers: **Marlen Lauffer**, **Margaret Meserve**, **David Cheerie** (codes in the sheet only).
- **Tester**: Nima's own login with Role = `Owner`: can sign in but is excluded from counts, consensus and other reviewers' view lists.
- Active empty = allowed; `FALSE`/`No` = switched off. Names must be unique (sign-in is refused otherwise), because feedback is stored by name; don't rename a reviewer mid-review.

**Reviews** (written by the board): one row per reviewer × requirement holding their *current* position.
`Reviewer | ID | Status | Suggested category | Comment | Updated`

**Log** (written by the board, append-only history): every change, plus `signed in` / `signed out`, `suggestion edited` / `suggestion withdrawn`.

**Suggestions** (written by the board): missing requirements.
`Timestamp | Reviewer | Requirement | Workflow | Actor | Suggested category | Why | Decision | Decision note | ID (auto)`
- Owner fills **Decision** (e.g. `Added as MVP`, `Merged with FR-REC-03`, `Declined`) and optional **Decision note** after the review. (Older sheets may call these `Triage` / `Triage note`; both names work.)
- The form now asks only *What's needed*, *Why*, and optionally *Where it belongs*; owner fills workflow/actor later.

**Suggestion comments** (auto-created): `Timestamp | Suggestion | Reviewer | Comment | ID`

**Summary** (built on demand: **Review board → Refresh summary**): per requirement: `ID | Requirement | Workflow | Proposed | Decision | Reviewed (x of 3) | Outcome | Questions | <reviewer> | <reviewer> comment …`
- Outcome: `All agree`, `All suggest <column>`, `Reviewers disagree`, `Incomplete`, `Decided: <column>` (N1C: `All favour <column>`). Comments and clarification requests are **not** positions.

## 6. Review semantics (important)

| Status (stored) | Meaning | Counts as reviewed? | Allowed on |
|---|---|---|---|
| `agreed` (older rows: `approved`) | Requirement is right and in the right column | Yes | MVP / Later / Out of Scope |
| `moved` + Suggested category | Belongs elsewhere; reason required. Moving to *Needs N1C Decision* = **requesting** an N1C decision (doesn't make it an N1C item) | Yes | MVP / Later / Out of Scope |
| `clarify` | No longer offered (was "Unclear?"); treated as a comment | No | MVP / Later / Out of Scope |
| `commented` | Comment only | No | MVP / Later / Out of Scope |
| `view` + Suggested category | Reviewer's preferred column for an N1C item (note optional) | Only if a column is chosen | Needs N1C Decision only |
| `cleared` | Undo: removes the Reviews row (logged) | n/a | any |

- Other reviewers' views are visible **only on N1C items** (to prepare the discussion). Elsewhere each reviewer sees only their own choices.
- Decided items are locked server-side.

## 7. Board features (current UI)

- Sign-in page with logo; header with logo badge, "Signed in as …", Sign out (reload the page to see others' latest changes); progress card ("x of 197", deadline, save status).
- Four columns with sticky headers; long columns grouped by workflow ("x of y left", "Show more").
- Card actions: **Agree**, **Comment**, **Move to…** (or drag on desktop). Agreed cards fold into a green "agreed" pile; moved cards fold into a blue "moved here by you" pile in the target column. Short confirmation with **Undo**.
- Filters: Everything open, Not yet reviewed, Moved by me, With my comments or questions, Agreed by me. Search box (ID or wording; also finds decided items). On phones: filters become a dropdown and columns become tabs.
- Suggestions strip ("Something missing from the board?") with a collapsible list; authors can edit/withdraw until decided; anyone can comment.
- Pop-ups close via ✕, Esc, or clicking outside.
- Saves are queued; failed saves show **Retry**; a newer change to the same card supersedes an older failed one; Refresh never overwrites unsaved or newer changes; suggestions/comments carry client IDs so retries don't duplicate; unchanged clicks aren't saved or logged.
- Demo mode (no `scriptUrl`): sample booking-app data, nothing saved.

## 8. Decisions made along the way

- GitHub Pages + Google Sheet chosen over a hosted artifact; individual access codes; no "approve all" button; owner records decisions in the sheet.
- "Approve" renamed **Agree** after an external audit, so progress reflects real positions. An "Unclear?" button was added, then removed for simplicity (a Comment covers it; older `clarify` rows are treated as comments).
- Removed by request: workflow filter dropdown; workflow/actor fields in the suggestion form; time zone on the deadline; search box (hidden via `showSearch: false` in config.js); Refresh button (reload the page instead); "Unclear?" button. Save status only appears while saving or on failure. Simplicity is preferred over completeness in the UI.
- Deliberately **not** done (judged unnecessary for a one-week, three-person review): session expiry for remembered codes, staging environment, automated test suite, reviewer IDs separate from names, giving N1C-view controls to cards a reviewer moved into N1C.
- Four external audits were run; all valid findings are fixed as of commit `5e06213` (page `v=41`).

## 9. Status and next steps

**Before sending** (check if done): paste latest `Code.gs` and redeploy a new version; test with the Tester code (Agree should save a `agreed` row); delete test rows from Reviews, Log, Suggestions, Suggestion comments; confirm reviewer codes.

**Invitations**: one email per reviewer (sent individually, each with only their own code), signed "Kind regards, Nima Farzaneh", explaining Agree / Move / N1C views / suggestions, ~1 hour, can be done in several sittings, deadline end of Thursday 12 November.

**During the review**: watch the Log for sign-ins; start swimlanes for clearly-MVP workflows.

**After the deadline**:
1. Refresh summary; review disagreements, "All suggest …" changes and clarification questions.
2. Answer clarifications; decide suggestions (fill Decision in Suggestions).
3. Hold the discussion for the 7 N1C items plus disputed cards; record **Decision / Decision date / Decision rationale** in Requirements.
4. Baseline the agreed scope (versioned list), then proceed to swimlanes, state diagrams and the permission matrix for MVP workflows.
