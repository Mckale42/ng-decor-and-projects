// .github/scripts/seo-check.mjs
// Dependency-free SEO checklist. Fetches SITE_URL, runs a checklist against the
// live page, and upserts ONE GitHub issue with the score + top suggestions.
// Runs on Node 20+ (global fetch). No npm install needed.

const SITE_URL = process.env.SITE_URL;
const SITE_NAME = process.env.SITE_NAME || SITE_URL;
const REPO = process.env.REPO;        // "owner/name"
const TOKEN = process.env.GH_TOKEN;   // GITHUB_TOKEN

if (!SITE_URL || !REPO || !TOKEN) {
  console.error("Missing SITE_URL / REPO / GH_TOKEN env vars");
  process.exit(1);
}

const UA = "Mozilla/5.0 (compatible; SEO-Health-Bot/1.0; +https://github.com) Chrome/120.0 Safari/537.36";

async function fetchText(url) {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": UA, accept: "text/html,*/*" } });
    return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : "" };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

const one = (html, re) => { const m = html.match(re); return m ? m[1].trim() : null; };

const res = await fetchText(SITE_URL);
const html = res.text || "";
if (!res.ok) console.error("Warning: could not fetch site, status", res.status);

const origin = new URL(SITE_URL).origin;
const robots = await fetchText(origin + "/robots.txt");
const sitemap = await fetchText(origin + "/sitemap.xml");

const checks = [];
const add = (ok, severity, message, fix) => checks.push({ ok, severity, message, fix });

const title = one(html, /<title[^>]*>([^<]*)<\/title>/i);
add(!!title && title.length >= 20 && title.length <= 65, "high",
  title ? `Title (${title.length} chars): "${title}"` : "Missing <title> tag",
  "Use a 30–60 char title with your main service + location.");

const desc = one(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
add(!!desc && desc.length >= 70 && desc.length <= 165, "high",
  desc ? `Meta description (${desc.length} chars)` : "Missing meta description",
  "Write a 120–160 char meta description that sells the click.");

add(/<html[^>]+lang=/i.test(html), "low", "html lang attribute", 'Add lang="en" to the <html> tag.');
add(/<meta[^>]+name=["']viewport["']/i.test(html), "high", "Mobile viewport meta", "Add a responsive viewport meta tag.");
add(/<link[^>]+rel=["']canonical["']/i.test(html), "medium", "Canonical link", "Add <link rel=\"canonical\"> to avoid duplicate-content issues.");
add(/property=["']og:title["']/i.test(html), "medium", "Open Graph title", "Add og:title for social/link previews.");
add(/property=["']og:description["']/i.test(html), "medium", "Open Graph description", "Add og:description.");
add(/property=["']og:image["']/i.test(html), "medium", "Open Graph image", "Add og:image (1200×630) so shared links show a picture.");
add(/name=["']twitter:card["']/i.test(html), "low", "Twitter card", "Add twitter:card = summary_large_image.");

const h1 = (html.match(/<h1[\s>]/gi) || []).length;
add(h1 >= 1, "medium", `H1 headings found: ${h1}`, "Include one clear <h1> with your primary keyword.");

const imgs = html.match(/<img\b[^>]*>/gi) || [];
const noAlt = imgs.filter(t => !/\balt\s*=/.test(t)).length;
add(imgs.length === 0 || noAlt === 0, "low", `Images missing alt: ${noAlt}/${imgs.length}`, "Add descriptive alt text to images (SEO + accessibility).");

add(/application\/ld\+json/i.test(html), "medium", "Structured data (JSON-LD)", "Add LocalBusiness / Organization schema.");
add(robots.ok, "medium", "robots.txt reachable", "Add /robots.txt with a Sitemap: line.");
add(sitemap.ok, "medium", "sitemap.xml reachable", "Add /sitemap.xml and submit it in Google Search Console.");

const passed = checks.filter(c => c.ok).length;
const total = checks.length;
const rank = { high: 0, medium: 1, low: 2 };
const failing = checks.filter(c => !c.ok).sort((a, b) => rank[a.severity] - rank[b.severity]);

const date = new Date().toISOString().slice(0, 10);
let body = `<!-- seo-health-bot -->\n`;
body += `**Automated SEO check for [${SITE_NAME}](${SITE_URL})** — updated ${date}\n\n`;
body += `**Score: ${passed}/${total} checks passing**\n\n`;
if (failing.length) {
  body += `### 🔧 Top things to improve\n`;
  failing.slice(0, 3).forEach((c, i) => { body += `${i + 1}. **${c.message}** — ${c.fix}\n`; });
  body += `\n`;
} else {
  body += `🎉 Everything on the automated checklist is passing.\n\n`;
}
body += `<details><summary>Full checklist</summary>\n\n`;
checks.forEach(c => { body += `- ${c.ok ? "✅" : "❌"} ${c.message}${c.ok ? "" : " — _" + c.fix + "_"}\n`; });
body += `\n</details>\n\n`;
body += `> Updated automatically each day. Reminder: real content, a Google Business Profile, and Search Console move rankings more than any single tag.`;

const issueTitle = `🔎 SEO health — ${SITE_NAME}`;
const api = "https://api.github.com";
const headers = {
  authorization: `Bearer ${TOKEN}`,
  accept: "application/vnd.github+json",
  "content-type": "application/json",
  "user-agent": "seo-health-bot",
};

const list = await fetch(`${api}/repos/${REPO}/issues?state=open&per_page=100`, { headers }).then(r => r.json());
const existing = Array.isArray(list) ? list.find(i => i.title === issueTitle && !i.pull_request) : null;

if (existing) {
  await fetch(`${api}/repos/${REPO}/issues/${existing.number}`, { method: "PATCH", headers, body: JSON.stringify({ body }) });
  console.log(`Updated issue #${existing.number} — score ${passed}/${total}`);
} else {
  const created = await fetch(`${api}/repos/${REPO}/issues`, { method: "POST", headers, body: JSON.stringify({ title: issueTitle, body }) }).then(r => r.json());
  console.log(`Created issue #${created.number} — score ${passed}/${total}`);
}
