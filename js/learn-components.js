/**
 * learn-components.js
 * Reusable UI components for the Learn hub.
 * Byline always shows "The Comp Desk Editorial Team" — never an individual name.
 */

/**
 * Renders the article byline into #article-byline.
 * @param {object} opts
 * @param {string} opts.date         - ISO date string e.g. "2026-04-07"
 * @param {number} opts.readTime     - Estimated read time in minutes
 * @param {string} opts.category     - Display label e.g. "Benefits"
 * @param {string} opts.categorySlug - URL slug e.g. "benefits"
 */
function renderArticleByline({ date, readTime, category, categorySlug }) {
  const el = document.getElementById('article-byline');
  if (!el) return;
  const d = new Date(date + 'T00:00:00');
  const formatted = d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  el.innerHTML = `
    <div class="article-byline">
      <span class="byline-author">By <strong>The Comp Desk Editorial Team</strong></span>
      <span class="byline-sep" aria-hidden="true">·</span>
      <a href="/learn/${categorySlug}/" class="byline-category">${category}</a>
      <span class="byline-sep" aria-hidden="true">·</span>
      <time datetime="${date}">${formatted}</time>
      <span class="byline-sep" aria-hidden="true">·</span>
      <span class="byline-read">${readTime} min read</span>
    </div>
  `;
}

/**
 * Renders the article footer disclaimer into #article-disclaimer.
 * Required on every Learn article per editorial policy.
 */
function renderArticleDisclaimer() {
  const el = document.getElementById('article-disclaimer');
  if (!el) return;
  el.innerHTML = `
    <div class="article-footer-disclaimer">
      <strong>Important disclaimer:</strong> The information in this article is provided for general educational purposes only and does not constitute legal advice. Every workers' compensation case is unique, and outcomes depend on facts specific to your situation. The Comp Desk is an informational platform — it is not a law firm and does not create an attorney-client relationship. For advice about your specific case, consult a licensed New York workers' compensation attorney. See our full <a href="/disclaimer.html">disclaimer</a>.
    </div>
  `;
}

export { renderArticleByline, renderArticleDisclaimer };
