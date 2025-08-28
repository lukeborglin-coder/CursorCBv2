
Reports System Pack — 2025-08-25

WHAT THIS DELIVERS
- True persistence of reports per logged-in account (file-backed under ./data/reports.json)
- "Add to Report" flow that lists existing reports or creates a new one (title + optional description)
- Reports page UI to create and list reports, sorted by most-recent

FILES
- server_routes_patch.txt  (copy/paste this block into server.js once)
- public/reports.html      (drop-in reports page if yours is broken; otherwise copy the <main> + scripts)
- public/reports.js        (lists and creates reports)

HOW TO INSTALL (5–10 minutes)
1) Open server.js and paste the contents of server_routes_patch.txt after your auth/session setup.
   - It uses a file DB at ./data/reports.json (auto-creates)
   - Endpoints:
     GET  /api/reports
     POST /api/reports                 { title, description? }
     GET  /api/reports/:id
     POST /api/reports/:id/items       { id?, title?, html?, metadata?, createdAt? }
     DELETE /api/reports/:id/items/:itemId   (optional)

2) Put reports.html and reports.js into /public (adjust paths if your structure differs).
   Ensure these script tags exist near the end of <body>:
     <script src="/reports.js"></script>
     <script src="/reports-integration.js"></script>
     <script src="/sidebar.js"></script>

3) Home page integration is already handled by the new reports-integration.js & sidebar.js you installed earlier:
   - Clicking any button with [data-add-to-report] opens the modal to pick/create a report.
   - The sidebar’s "Recent Reports" auto-fetches /api/reports.

4) Restart your server. Create a report from the Reports page or via the Add-to-Report modal.
   Confirm persistence by stopping the server, starting again, logging out/in — the report should remain.

NOTE
- User scoping uses req.session.user.username (fallback to id). If your session stores a different field, edit getUserKey().
