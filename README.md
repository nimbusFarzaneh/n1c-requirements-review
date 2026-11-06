# N1C requirements review board

A review board where reviewers approve, move or comment on N1C requirements proposed as **MVP**, **Later**, **Out of Scope** or **Needs N1C Decision**, and suggest anything that's missing.

- The page is hosted on GitHub Pages. It holds no requirement text and no access codes.
- The requirements, access codes and all feedback live in a private Google Sheet. A Google Apps Script attached to the sheet checks each reviewer's code before returning or saving anything.
- With no sheet connected (`scriptUrl` empty in `config.js`), the board runs in **demo mode** with sample data, and nothing is saved.

## How reviewers use it

1. Open the link and enter their personal access code.
2. For each card, take a position:
   - **Agree**: the requirement is right and belongs in its column. It moves to the agreed pile.
   - **Move** it to another column (drag it, or use **Move to…**), with a reason. Moving it to **Needs N1C Decision** means "this should be decided by N1C".
   - **Unclear?**: they can't judge it as written. They say what's unclear; the card stays unreviewed.
   - **Comment** on it at any time. A comment alone doesn't count as reviewed.
3. On **Needs N1C Decision** cards, pick the column they'd choose (MVP, Later or Out of Scope) and optionally add a note. Only a chosen column counts as reviewed. These are the only cards where reviewers see each other's input, to prepare for the discussion.
4. Use **Suggest a missing requirement** for anything that isn't on the board.

Everything saves automatically. Reviewers can stop and come back later; their progress is kept.

## One-time setup (about 10 minutes)

### 1. Prepare the Google Sheet

1. Open the sheet, then **Extensions → Apps Script**.
2. Delete any code in `Code.gs` and paste in the contents of [`apps-script/Code.gs`](apps-script/Code.gs). Click **Save**.
3. In the function dropdown at the top, choose **setup** and click **Run**. Approve the permission prompt (it's your own script accessing your own sheet; you may need to click **Advanced → Go to project**).
4. Back in the sheet, you'll now have these tabs: **Requirements**, **Reviewers**, **Reviews**, **Log**, **Suggestions**, plus a **Review board** menu (reload the sheet if the menu doesn't show).

### 2. Fill in the Requirements tab

One row per requirement:

| Column | What goes in it |
|---|---|
| ID | A stable ID such as `R-001`. Don't change it once the review starts. Comments are linked to it. |
| Requirement | The requirement, written as an outcome reviewers recognise. |
| Workflow | Used to group cards, e.g. `Booking`. |
| Actor | Who it's for, e.g. `Customer`. |
| Category | `MVP`, `Later`, `Out of Scope` or `Needs N1C Decision`. |
| Reason | One line on why it's in that category. Shown on the card. |
| Also involves | Optional. Other stakeholders needed, mainly for N1C items. |
| Open question | Optional. The question to settle, mainly for N1C items. |
| Decision | Leave empty. After a decision (usually for N1C items), enter the final column, e.g. `Later`. The card is then locked and shows in the "decided" pile. **Don't change Category**: it records what was originally proposed. |
| Decision date | Optional. When it was decided, e.g. `2026-11-13`. |
| Decision rationale | Optional. A line on why, shown to reviewers with the decision. |

### 3. Fill in the Reviewers tab

One row per reviewer: **Name**, **Code**, **Active**, **Role**.

- Give each reviewer their own code (e.g. a random word plus numbers). Codes are only stored in your sheet.
- Leave **Active** empty to allow access. Type `FALSE` or `No` to switch a reviewer off.
- Leave **Role** empty for reviewers. Type `Owner` for yourself: you can sign in to test or watch progress, but you're not counted as a reviewer, your N1C views aren't shown to others, and you're left out of the Summary.

### 4. Deploy the script as a web app

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. ("Anyone" lets the page send data to the script. It does not give anyone access to the sheet. Every request still needs a valid reviewer code.)
4. Click **Deploy**, then copy the **Web app URL** (it ends in `/exec`).

If you change the script later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

### 5. Connect the page

Edit [`config.js`](config.js) in this repository (on GitHub: open the file and click the pencil icon):

```js
scriptUrl: 'https://script.google.com/macros/s/…/exec',
projectName: 'N1C',
deadline: 'Friday 20 November',
```

Commit the change. GitHub Pages republishes within a minute or two.

### 6. Test before sending

Add yourself as a reviewer with a test code, sign in, approve a card, move one, and add a comment and a suggestion. Check that rows appear in the **Reviews**, **Log** and **Suggestions** tabs. Then delete your test rows (in Reviews, Log and Suggestions) and your test reviewer.

## During and after the review

- **Freeze the requirements** once reviewers start. Editing wording is fine, but avoid changing IDs or adding or removing rows.
- **Sign-ins:** the **Log** tab records each time someone signs in or reopens the board (Status `signed in`), and when they click **Sign out** (`signed out`), so you can see who has started. Closing the tab without signing out isn't recorded.
- **Summary:** choose **Review board → Refresh summary** in the sheet. It builds a **Summary** tab with one row per requirement: how many reviewers have taken a position, an **Outcome** (All agree, All suggest *column*, Reviewers disagree, Incomplete, or Decided), how many asked for clarification, and each reviewer's position and comment. Comments and clarification requests don't count as positions.
- **Suggestion comments:** reviewers can comment on any suggestion, and edit or withdraw their own until it has a decision. Comments are stored in a **Suggestion comments** tab (created automatically the first time someone comments); edits and withdrawals are recorded in the Log.
- **Suggestions:** after the review, fill in **Decision** (e.g. `Added as MVP`, `Merged with FR-REC-03`, `Declined`) and optionally **Decision note** in the Suggestions tab. Until then the board shows "Not decided yet"; afterwards it shows your decision. (If your tab still has the older headers **Triage** / **Triage note**, rename them to **Decision** / **Decision note**; the old names also still work.)
- **N1C decisions:** after the discussion, fill in **Decision** (the final column), and optionally **Decision date** and **Decision rationale**, on each requirement. Leave **Category** as it was, so the original proposal stays on record. (The Decision date and Decision rationale columns are added to the tab automatically if they're missing.)

## Files

| File | Purpose |
|---|---|
| `index.html` | Page layout and styling |
| `app.js` | Board behaviour, demo data |
| `config.js` | Script URL, project name, deadline |
| `apps-script/Code.gs` | Google Apps Script to paste into the sheet (not used by the page directly) |
