#!/usr/bin/env node
/**
 * scripts/audit-learn-links.ts
 *
 * Audits every /learn article HTML file to confirm it contains at least 4
 * outbound internal links:
 *   - ≥ 2 links to other /learn/ articles
 *   - ≥ 1 link to a calculator (/calculators/ or /tools/settlement)
 *   - ≥ 1 link to /find-attorney
 *
 * Usage:
 *   npx ts-node scripts/audit-learn-links.ts
 *   # or after compiling:
 *   node scripts/audit-learn-links.js
 *
 * Exit code 0 = all checks pass
 * Exit code 1 = one or more articles failed the audit
 */

import * as fs from 'fs';
import * as path from 'path';

const LEARN_DIR = path.resolve(__dirname, '..', 'learn');
const ARTICLE_PATTERN = /^index\.html$/;

interface AuditResult {
  file: string;
  learnLinks: string[];
  calcLinks: string[];
  attorneyLinks: string[];
  passed: boolean;
  failures: string[];
}

function findArticleFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip category index directories — recurse into article subdirectories
      results.push(...findArticleFiles(fullPath));
    } else if (entry.isFile() && ARTICLE_PATTERN.test(entry.name)) {
      // Include if this is inside a slug directory (depth ≥ 2 from learn/)
      const rel = path.relative(LEARN_DIR, fullPath);
      const parts = rel.split(path.sep);
      // parts: ['benefits', 'average-weekly-wage', 'index.html'] = depth 3 → article
      // parts: ['benefits', 'index.html'] = depth 2 → category page, skip
      // parts: ['index.html'] = depth 1 → hub, skip
      if (parts.length >= 3) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

function extractLinks(html: string): string[] {
  const linkRegex = /href=["']([^"']+)["']/g;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    links.push(match[1]);
  }
  return links;
}

function auditFile(filePath: string): AuditResult {
  const html = fs.readFileSync(filePath, 'utf8');
  const allLinks = extractLinks(html);
  const rel = path.relative(LEARN_DIR, filePath);

  // Derive this article's own slug path so we don't count self-links
  const ownPath = '/learn/' + rel.replace(/index\.html$/, '').replace(/\\/g, '/');

  const learnLinks = allLinks.filter(
    href =>
      href.startsWith('/learn/') &&
      !href.startsWith(ownPath) &&
      !href.startsWith('/learn/feed') &&
      // Must link to an article or category, not just /learn/ hub
      href !== '/learn/'
  );

  const calcLinks = allLinks.filter(
    href =>
      href.startsWith('/calculators/') ||
      href === '/tools/settlement.html' ||
      href.startsWith('/tools/settlement')
  );

  const attorneyLinks = allLinks.filter(href =>
    href.startsWith('/find-attorney')
  );

  const failures: string[] = [];
  if (learnLinks.length < 2) {
    failures.push(`Needs ≥2 /learn/ internal links (found ${learnLinks.length})`);
  }
  if (calcLinks.length < 1) {
    failures.push(`Needs ≥1 calculator link (found ${calcLinks.length})`);
  }
  if (attorneyLinks.length < 1) {
    failures.push(`Needs ≥1 /find-attorney link (found ${attorneyLinks.length})`);
  }

  return {
    file: rel,
    learnLinks,
    calcLinks,
    attorneyLinks,
    passed: failures.length === 0,
    failures,
  };
}

function main(): void {
  console.log('🔍  Auditing /learn article internal links...\n');

  const articleFiles = findArticleFiles(LEARN_DIR);

  if (articleFiles.length === 0) {
    console.error('❌  No article files found under', LEARN_DIR);
    process.exit(1);
  }

  console.log(`Found ${articleFiles.length} article(s) to audit.\n`);

  const results: AuditResult[] = articleFiles.map(auditFile);
  const failed = results.filter(r => !r.passed);
  const passed = results.filter(r => r.passed);

  // Print passed
  for (const r of passed) {
    console.log(`✅  ${r.file}`);
    console.log(
      `     /learn links: ${r.learnLinks.length}  |  calc links: ${r.calcLinks.length}  |  attorney links: ${r.attorneyLinks.length}`
    );
  }

  if (failed.length > 0) {
    console.log('\n--- FAILURES ---\n');
    for (const r of failed) {
      console.error(`❌  ${r.file}`);
      for (const f of r.failures) {
        console.error(`     → ${f}`);
      }
      if (r.learnLinks.length > 0) {
        console.error(`     /learn links found: ${r.learnLinks.join(', ')}`);
      }
      if (r.calcLinks.length > 0) {
        console.error(`     calc links found: ${r.calcLinks.join(', ')}`);
      }
      if (r.attorneyLinks.length > 0) {
        console.error(`     attorney links found: ${r.attorneyLinks.join(', ')}`);
      }
    }
    console.error(`\n${failed.length} article(s) failed the internal-link audit.`);
    process.exit(1);
  }

  console.log(`\n✅  All ${passed.length} articles passed the internal-link audit.`);
  process.exit(0);
}

main();
