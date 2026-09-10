# TripSplit

Mobile-first shared travel expense splitter for Iris, Jason and Ashley.

## Deploy to GitHub Pages

1. Create a **public** GitHub repository named `tripsplit`.
2. Upload these files to the repository root:
   - `index.html`
   - `style.css`
   - `app.js`
   - `config.js`
3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**, choose:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
5. Save. Your site URL will normally be:
   `https://YOUR_GITHUB_USERNAME.github.io/tripsplit/`

## Supabase Auth setup

After GitHub Pages gives you the final URL:

1. Supabase → Authentication → URL Configuration
2. Set **Site URL** to your GitHub Pages URL.
3. Add the same URL under **Redirect URLs**.
4. Keep Email/Password sign-in enabled.

Users register once with email + password. If email confirmation is enabled, they confirm the email once, then log in and enter their one-time invitation code.

## Security

The browser uses only the Supabase publishable key. Never put a `sb_secret_...` key or service-role key in this repository.
