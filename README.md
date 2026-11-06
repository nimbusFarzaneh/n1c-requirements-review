# N1C requirements review board

A review board where reviewers approve, move or comment on N1C requirements proposed as **MVP**, **Later**, **Out of Scope** or **Needs N1C Decision**, and suggest anything that's missing.

- The page is hosted on GitHub Pages. It holds no requirement text and no access codes.
- The requirements, access codes and all feedback live in a private Google Sheet. A Google Apps Script attached to the sheet checks each reviewer's code before returning or saving anything.
- With no sheet connected (`scriptUrl` empty in `config.js`), the board runs in **demo mode** with sample data, and nothing is saved.

## How reviewers use it

1. Open the link and enter their personal access code.
2. For each card: **Approve** it (it moves to the approved pile), **Comment** on it, or move it to another column (drag it, or use **Move to…**). Moving requires a reason.
3. On **Needs N1C Decision** cards, pick a view (MVP, Later or Out of Scope) and add a note. These are the only cards where reviewers see each other's input, to prepare for the discussion.
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
| Decision | Leave empty. Fill in after the discussion for N1C items, e.g. `MVP`. The card then moves to the "decided" pile. |

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
- **Sign-ins:** the **Log** tab records each time someone signs in or reopens the board (Status `signed in`), so you can see who has started.
- **Summary:** choose **Review board → Refresh summary** in the sheet. It builds a **Summary** tab with one row per requirement, each reviewer's position and comment, and an Agreement column (All approved, Disagreement, Incomplete, Views differ, and so on).
- **Suggestions:** fill in **Triage** (e.g. `Added`, `Merged with R-042`, `Declined`) and **Triage note**. Reviewers see the result on the board.
- **N1C decisions:** after the discussion, fill in **Decision** on each requirement. To actually move it into a column, change its **Category** too.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page layout and styling |
| `app.js` | Board behaviour, demo data |
| `config.js` | Script URL, project name, deadline |
| `apps-script/Code.gs` | Google Apps Script to paste into the sheet (not used by the page directly) |
