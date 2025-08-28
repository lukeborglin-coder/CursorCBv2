# CHANGELOG (Automated)
Date: 2025-08-25 15:36:22

## Added
- `server.js`: JSON datastore helpers; endpoints:
  - `GET /report-metadata/:fileId` (PDF parse + disk cache)
  - `POST /history/save`, `GET /history/list`, `GET /history/get/:id` (snapshot history)
  - `POST /feedback`, `PATCH /feedback/:id`, `GET /feedback` (feedback storage)
  - `GET /recos/:clientLibraryId` and `POST /search-log` (search recommendations with lazy daily rebuild)

## Updated
- `public/app.js`:
  - Search recommendations chips on focus (`attachSearchRecos`)
  - Study details dropdown on report references (`attachStudyDetails`)
  - Filter auto-link presets (`applyThinkingPreset`)
  - Skeleton loaders for related slides
  - 3-dot menus on answer cards with Add/Remove/Change chart type
- `public/styles.css`: new styles for chips, skeletons, study dropdown, menus, and footer
- `public/index.html`, `public/reports.html`, `public/admin.html`: footer with Feature/Bug modals wired to `/feedback`
- `views/admin.ejs`: removed library stats block; added Feedback section with status controls

## Removed / Cleaned
- `public/reports.html`: removed bottom "Create New Report" panel (if annotated)
