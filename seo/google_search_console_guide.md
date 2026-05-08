# Google Search Console — Verification & Sitemap Submission Guide

**For**: Joel Mays / The Comp Desk
**Domain**: www.thecompdesk.com
**Date**: 2026-04-05

---

## Part 1: Verify Ownership of thecompdesk.com

You may already have partial verification from the April 1 sitemap submission. If so, skip to Part 2. If not, follow these steps.

### Option A: DNS TXT Record (Recommended — Covers Entire Domain)

This is the strongest verification method and covers all subdomains.

1. Go to [Google Search Console](https://search.google.com/search-console) and sign in with your Google account.

2. Click **"Add property"** in the top-left dropdown.

3. Choose **"Domain"** (left panel) and enter: `thecompdesk.com`

4. Google will give you a TXT record that looks like:
   ```
   google-site-verification=XXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

5. Log in to **Namecheap** (your DNS provider):
   - Go to **Domain List** > click **Manage** next to `thecompdesk.com`
   - Click **Advanced DNS**
   - Click **Add New Record**
   - Type: **TXT Record**
   - Host: **@**
   - Value: paste the full `google-site-verification=...` string
   - TTL: **Automatic**
   - Click the green checkmark to save

6. Go back to Google Search Console and click **Verify**.

7. DNS propagation can take a few minutes to 48 hours. If it fails, wait 30 minutes and try again.

### Option B: HTML File Upload (Faster, But URL-Prefix Only)

1. In Search Console, click **"Add property"** and choose **"URL prefix"** (right panel).

2. Enter: `https://www.thecompdesk.com`

3. Under **Verification method**, expand **"HTML file"**.

4. Download the HTML verification file (named something like `googleXXXXXXXXXXXX.html`).

5. Add this file to the root of your GitHub repository (`thecompdesk-site`):
   ```
   thecompdesk-site/
   ├── public/
   │   └── googleXXXXXXXXXXXX.html    <-- place here
   ```
   Or if your site deploys from root:
   ```
   thecompdesk-site/
   ├── googleXXXXXXXXXXXX.html         <-- place here
   ```

6. Push to GitHub. Vercel will auto-deploy it.

7. Verify it's accessible by visiting `https://www.thecompdesk.com/googleXXXXXXXXXXXX.html` in your browser.

8. Go back to Search Console and click **Verify**.

### Option C: HTML Meta Tag (Quick But Fragile)

1. Choose **URL prefix** > `https://www.thecompdesk.com`

2. Expand **"HTML tag"** verification method.

3. Copy the meta tag:
   ```html
   <meta name="google-site-verification" content="XXXXXXXXXXXXX" />
   ```

4. Add it to the `<head>` section of `index.html` in your repo.

5. Push to GitHub, wait for Vercel deploy, then click **Verify** in Search Console.

**Downside**: If you ever rebuild the homepage and forget this tag, verification breaks.

---

## Part 2: Add Both www and non-www Properties

Google treats `www.thecompdesk.com` and `thecompdesk.com` as separate properties.

1. If you used **DNS verification** (Option A), both are automatically covered.

2. If you used **URL prefix** verification, add a second property:
   - `https://thecompdesk.com` (without www)
   - Verify using the same method

3. In Search Console **Settings** > **Preferred domain**, there's no longer a setting for this — Google determines canonical automatically. However, make sure your site consistently uses one version (www or non-www) in canonical tags and internal links.

**Current state**: Your site resolves to `www.thecompdesk.com` but canonical URLs in the HTML use `thecompdesk.com` (no www). Pick one and be consistent.

---

## Part 3: Submit Your Sitemap

1. In Search Console, select the `www.thecompdesk.com` property (or the Domain property).

2. In the left sidebar, click **Sitemaps**.

3. In the **"Add a new sitemap"** field, enter: `sitemap.xml`

4. Click **Submit**.

5. Google will show the status as **"Pending"**. It typically processes within a few hours to a few days.

6. After processing, you should see:
   - **Status**: Success
   - **Discovered URLs**: 15 (matching our new sitemap)

7. If the old sitemap (with 8 URLs) was previously submitted, Google will automatically use the updated version at the same URL.

---

## Part 4: Deploy the New Files

The SEO audit produced three files that need to be deployed to the live site:

### Files to add to the GitHub repo root:

| File | Repo Location | Live URL |
|---|---|---|
| `sitemap.xml` | `/public/sitemap.xml` or repo root | `www.thecompdesk.com/sitemap.xml` |
| `robots.txt` | `/public/robots.txt` or repo root | `www.thecompdesk.com/robots.txt` |

### Deployment steps:

1. Copy `sitemap.xml` and `robots.txt` from `/ops/website/seo/` to your local clone of `thecompdesk-site`.

2. Place them where Vercel serves static files from (usually the project root or `/public/`).

3. Commit and push:
   ```bash
   git add sitemap.xml robots.txt
   git commit -m "Add sitemap.xml and robots.txt for SEO"
   git push origin main
   ```

4. Vercel will auto-deploy. Verify:
   - Visit `https://www.thecompdesk.com/robots.txt` — should show crawler directives
   - Visit `https://www.thecompdesk.com/sitemap.xml` — should show 15 URLs

5. Go back to Search Console and resubmit the sitemap if needed.

---

## Part 5: Request Indexing for Key Pages

After verification and sitemap submission:

1. In Search Console, go to **URL Inspection** (top search bar).

2. Enter each high-priority URL and click **"Request Indexing"**:
   - `https://www.thecompdesk.com/`
   - `https://www.thecompdesk.com/calculators/`
   - `https://www.thecompdesk.com/calculators/slu.html`
   - `https://www.thecompdesk.com/calculators/aww.html`
   - `https://www.thecompdesk.com/calculators/lwec.html`
   - `https://www.thecompdesk.com/find-attorney`

3. Google limits indexing requests to ~10-12 per day. Prioritize the calculator pages first since those target your main SEO keywords.

4. Full indexing typically takes 3-14 days after sitemap submission.

---

## Part 6: Ongoing Monitoring

After setup, check Search Console weekly for:

- **Coverage report**: Errors, warnings, excluded pages
- **Performance report**: Impressions, clicks, average position for target keywords
- **Core Web Vitals**: Page speed and user experience metrics
- **Enhancements**: Structured data validation (once JSON-LD is added)

Target keywords to monitor in Performance:
- NYS workers compensation calculator
- workers comp calculator New York
- schedule loss of use calculator
- SLU calculator NY
- AWW calculator workers comp
- LWEC calculator
