// Compares the website calendar against eSpace's own Agenda view.
//
// For the next WEEKS weeks it reads every event (date, start, end, title) from:
//   1. eSpace's public Agenda page (the source of truth), and
//   2. the calendar as visitors see it (the GitHub Pages preview, which runs the live calendar.js),
// then reports anything that appears in one but not the other.
//
// Writes a Markdown report to report.md and exits with code 1 if there are differences
// or if either side could not be read.

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const WEEKS = Number(process.env.WEEKS || 13); // 13 weeks = 91 days
const ESPACE_URL = process.env.ESPACE_URL || 'https://app.espace.cool/ClientApi/Monthly/13786?view=a&calendarId=1884';
const SITE_URL = process.env.SITE_URL || 'https://calvarymediateam.github.io/website-calendar/';
const TZ = 'America/New_York';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function toMin(t, ap) {
  let [h, m] = t.split(':').map(Number);
  m = m || 0;
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}
// eSpace: "8:00 AM-9:10 AM" or "all day"
function espaceTime(s) {
  s = norm(s);
  if (/^all day$/i.test(s)) return 'all day';
  const m = s.match(/(\d+:\d+)\s*(AM|PM)\s*-\s*(\d+:\d+)\s*(AM|PM)/i);
  return m ? `${toMin(m[1], m[2].toUpperCase())}-${toMin(m[3], m[4].toUpperCase())}` : `? ${s}`;
}
// Website: "9:30 – 11 AM", "11 AM – 12 PM" or "All day"
function siteTime(s) {
  s = norm(s);
  if (/^all day$/i.test(s)) return 'all day';
  const m = s.match(/^([\d:]+)\s*(AM|PM)?\s*–\s*([\d:]+)\s*(AM|PM)$/);
  if (!m) return `? ${s}`;
  return `${toMin(m[1], m[2] || m[4])}-${toMin(m[3], m[4])}`;
}
function fmtMin(v) {
  if (v === 'all day' || v.startsWith('?')) return v;
  return v.split('-').map((n) => {
    n = Number(n);
    let h = Math.floor(n / 60), m = n % 60, ap = h < 12 ? 'AM' : 'PM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ap}`;
  }).join('–');
}

function todayParts() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = p.split('-').map(Number);
  return { y, m, d };
}
const iso = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.toISOString().slice(0, 10);
};

async function readEspace(context, start) {
  const page = await context.newPage();
  await page.goto(ESPACE_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.$ && $('#scheduler').data('kendoScheduler'), null, { timeout: 30000 });
  const rows = [];
  for (let w = 0; w < WEEKS; w++) {
    const lo = iso(start.y, start.m, start.d + 7 * w);
    const hi = iso(start.y, start.m, start.d + 7 * (w + 1));
    await page.evaluate(([y, m, d]) => $('#scheduler').data('kendoScheduler').date(new Date(y, m - 1, d)),
      [start.y, start.m, start.d + 7 * w]);
    await sleep(600);
    await page.waitForFunction(() => !document.querySelector('.k-loading-mask'), null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await sleep(600);
    const week = await page.evaluate(() => {
      const MON = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
      const out = []; let day = null;
      document.querySelectorAll('.k-scheduler-content tr').forEach((tr) => {
        const dc = tr.querySelector('.k-scheduler-datecolumn');
        if (dc) {
          const t = dc.innerText.replace(/\s+/g, ' ').trim().match(/^(\d+) \w+ (\w+), (\d+)/);
          if (t) day = `${t[3]}-${String(MON[t[2]]).padStart(2, '0')}-${t[1].padStart(2, '0')}`;
        }
        const tc = tr.querySelector('.k-scheduler-timecolumn');
        const cells = [...tr.children];
        if (!tc || !day) return;
        out.push({ day, time: tc.innerText, title: cells[cells.length - 1].innerText });
      });
      return out;
    });
    for (const r of week) if (r.day >= lo && r.day < hi) rows.push(`${r.day}|${espaceTime(r.time)}|${norm(r.title)}`);
  }
  await page.close();
  return rows;
}

async function readSite(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 }); // desktop: agenda table
  await page.goto(SITE_URL + (SITE_URL.includes('?') ? '&' : '?') + 'check=' + Date.now(), { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#cvcal .cvcal-range', { timeout: 30000 });
  const rows = [];
  let lastRange = '';
  for (let w = 0; w < WEEKS; w++) {
    // wait until this week's events (or the "no events" message) are on screen
    await page.waitForFunction((prev) => {
      const root = document.getElementById('cvcal');
      const range = root.querySelector('.cvcal-range').textContent;
      const msg = root.querySelector('.cvcal-msg');
      if (msg && /couldn/.test(msg.textContent)) return true;
      const loading = msg && /Loading/.test(msg.textContent);
      return range !== prev && !loading && (root.querySelector('tbody') || msg);
    }, lastRange, { timeout: 30000 });
    const week = await page.evaluate(() => {
      const root = document.getElementById('cvcal');
      const err = root.querySelector('.cvcal-msg');
      if (err && /couldn/.test(err.textContent)) return { error: err.textContent };
      const MON = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
      const out = []; let day = null;
      root.querySelectorAll('tbody tr').forEach((tr) => {
        const dc = tr.querySelector('td.cvcal-day');
        if (dc) {
          const n = dc.querySelector('.cvcal-daynum').textContent.trim();
          const [mn, yr] = dc.querySelector('.cvcal-daymonth').textContent.trim().split(' ');
          day = `${yr}-${String(MON[mn]).padStart(2, '0')}-${n.padStart(2, '0')}`;
        }
        out.push({ day, time: tr.querySelector('td.cvcal-time').textContent, title: tr.querySelector('.cvcal-title').textContent });
      });
      return { range: root.querySelector('.cvcal-range').textContent, rows: out };
    });
    if (week.error) throw new Error('The website calendar showed its error message: ' + norm(week.error));
    lastRange = week.range;
    for (const r of week.rows) rows.push(`${r.day}|${siteTime(r.time)}|${norm(r.title)}`);
    await page.click('#cvcal .cvcal-nav [data-act=next]');
  }
  await page.close();
  return rows;
}

function diff(a, b) {
  const count = (list) => list.reduce((m, k) => m.set(k, (m.get(k) || 0) + 1), new Map());
  const ca = count(a), cb = count(b), onlyA = [], onlyB = [];
  for (const [k, n] of ca) for (let i = 0; i < n - (cb.get(k) || 0); i++) onlyA.push(k);
  for (const [k, n] of cb) for (let i = 0; i < n - (ca.get(k) || 0); i++) onlyB.push(k);
  return { onlyA: onlyA.sort(), onlyB: onlyB.sort() };
}
const line = (k) => { const [d, t, title] = k.split('|'); return `| ${d} | ${fmtMin(t)} | ${title} |`; };

const start = todayParts();
const from = iso(start.y, start.m, start.d);
const to = iso(start.y, start.m, start.d + 7 * WEEKS - 1);
let report, ok;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ timezoneId: TZ, locale: 'en-US' });
  const [espace, site] = [await readEspace(context, start), await readSite(context)];
  const { onlyA, onlyB } = diff(espace, site);
  const unreadable = [...espace, ...site].filter((k) => k.split('|')[1].startsWith('?'));
  ok = espace.length > 0 && onlyA.length === 0 && onlyB.length === 0 && unreadable.length === 0;

  report = `## Calendar accuracy check: ${ok ? 'no differences' : 'differences found'}\n\n` +
    `Checked **${from} to ${to}** (${WEEKS * 7} days).\n\n` +
    `- eSpace Agenda view: **${espace.length}** events\n- Website calendar: **${site.length}** events\n\n`;
  if (espace.length === 0) report += 'eSpace returned no events at all, which usually means its page failed to load. Re-run the check, and if it happens again, open the eSpace link by hand.\n\n';
  if (onlyA.length) report += `### In eSpace but missing or different on the website (${onlyA.length})\n\n| Date | Time | Event |\n| --- | --- | --- |\n${onlyA.map(line).join('\n')}\n\n`;
  if (onlyB.length) report += `### On the website but not in eSpace (${onlyB.length})\n\n| Date | Time | Event |\n| --- | --- | --- |\n${onlyB.map(line).join('\n')}\n\n`;
  if (unreadable.length) report += `### Times the check couldn't read (${unreadable.length})\n\n${unreadable.map((k) => '- `' + k + '`').join('\n')}\n\n`;
  if (!ok && (onlyA.length || onlyB.length)) report += 'An event that changed time shows up in both lists: the eSpace version above, the website version below.\n';
} catch (err) {
  ok = false;
  report = `## Calendar accuracy check: the check could not run\n\nChecking ${from} to ${to} failed with:\n\n\`\`\`\n${err.stack || err}\n\`\`\`\n\nThis can be a temporary problem with eSpace or GitHub. Re-run the workflow; if it fails again, the eSpace page or its data may have changed.\n`;
} finally {
  await browser.close();
}

writeFileSync('report.md', report);
console.log(report);
process.exit(ok ? 0 : 1);
