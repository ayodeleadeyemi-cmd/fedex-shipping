# Put this site on Vercel

1. Unzip this folder on your computer.
2. Go to https://vercel.com and sign in (free account is enough).
3. Click **Add New… → Project**.
4. If the folder is not on GitHub yet:
   - Install the Vercel CLI is optional. Easiest path: create an empty GitHub repository, upload these files (not node_modules), then import that repo in Vercel.
   - Or drag the project in with the Vercel dashboard after connecting Git.
5. Framework preset: **Other**. There is no build command. Output is this folder as-is.
   - Build command: leave empty
   - Install command: `npm install` (there are no packages; that is fine)
   - Output directory: leave empty
6. Environment variables (optional). If you skip them, the live admin login is:
   - Email: `admin@edgeshipping.com`
   - Password: `EdgeDemo#2026`
   Set these before a real launch:
   - `ADMIN_EMAIL` = your email
   - `ADMIN_PASSWORD` = a long unique password
   - `SESSION_SECRET` = a long random string
7. Click **Deploy**. When it finishes, open the `*.vercel.app` link.
8. Open **Account → Administrator sign in** and use the email and password above.

Pages such as /track and /admin are rewritten to the homepage app. The API lives under /api.

Note: Vercel does not keep a disk. New shipments and logo uploads last only as long as that serverless instance. For a permanent live database, move `data/store.json` to a hosted database later. The sample tracking IDs are always there after a fresh start.
