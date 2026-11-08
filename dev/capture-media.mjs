// Regenerates the README screenshots and GIFs in docs/media from the running app
// (production bundle under `vite preview` on a fresh demo database), using the
// installed Chrome via playwright-core and ffmpeg for the GIFs.
//
//   npm run build && ARCRX_DATA_DIR=/tmp/arcrx-media npx vite preview
//   node dev/capture-media.mjs            # BASE=http://localhost:4173 by default
//
// The camera scenes use Demo simulation (a synthetic patient through the same
// pipeline); the signed-in identity is the synthetic demo clinician.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:4173';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = join(import.meta.dirname, '..', 'docs', 'media');
const TMP = join(OUT, '.video');
mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });

const ME = { user: { id: null, issuer: 'informer', name: 'Dr. Ada Okafor', username: 'dr.okafor', email: null }, roles: ['clinician', 'patient'], platform: { version: 'preview', originMode: true } };
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function page({ width = 1440, height = 900, video = false, signedOut = false, me = ME } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...(video ? { recordVideo: { dir: TMP, size: { width, height } } } : {}) });
  const p = await context.newPage();
  await p.route(/\/api\/me(\?|$)/, (r) => (signedOut
    ? r.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Authentication required"}' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(me) })));
  await p.goto(BASE, { waitUntil: 'load' });
  return { context, p };
}
const tab = (p, name) => p.locator('header nav button', { hasText: name }).click();
const reps = async (p) => Number(await p.locator('xpath=//span[text()="Reps this session"]/following-sibling::span').textContent());
async function waitReps(p, n) { for (let i = 0; i < 200 && (await reps(p)) < n; i++) await p.waitForTimeout(200); }
const shot = (p, name, opts = {}) => p.screenshot({ path: join(OUT, `${name}.png`), ...opts });
function gif(src, name, { start = 0, duration, width = 900, fps = 10 } = {}) {
  const dst = join(OUT, `${name}.gif`);
  const trim = ['-ss', String(start), ...(duration ? ['-t', String(duration)] : [])];
  const vf = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...trim, '-i', src, '-vf', vf, '-loop', '0', dst]);
  return `${name}.gif ${(statSync(dst).size / 1048576).toFixed(1)} MB`;
}
async function recorded(p, context, name) {
  const v = p.video();
  await context.close();
  const path = await v.path();
  const dst = join(TMP, `${name}.webm`);
  renameSync(path, dst);
  return dst;
}
const log = (...a) => console.log('·', ...a);

// 1. Session GIF + session screenshots (Maya, plateaued around 120°: the simulated
//    patient reaches her usual range, so triage raises a plateau alert, progresses
//    the plan within its guard rails and writes the note).
{
  const maya = { ...ME, user: { ...ME.user, name: 'Maya Chen', username: 'maya.chen' } };
  const { context, p } = await page({ width: 1280, height: 760, video: true, me: maya });
  const t0 = Date.now();
  await p.getByText("Today's exercise").waitFor();
  const picker = p.locator('select').first();
  await picker.selectOption(await picker.locator('option', { hasText: 'Maya Chen' }).getAttribute('value'));
  await p.waitForTimeout(800);
  const startAt = (Date.now() - t0) / 1000;
  await p.getByRole('button', { name: 'Demo simulation' }).first().click();
  const simPanel = p.locator('.panel', { hasText: 'Simulated patient reaches' });
  await simPanel.waitFor();
  await simPanel.locator('input[type=range]').fill('121');
  await waitReps(p, 2);
  await p.waitForTimeout(2200);
  await shot(p, 'exercise-session');
  await waitReps(p, 3);
  await p.waitForTimeout(1500);
  await p.getByRole('button', { name: /Finish & save session/ }).click();
  await p.getByText(/Agent ran \d+ tool calls/).waitFor({ timeout: 15000 });
  await p.getByText('Session saved · triage agent').scrollIntoViewIfNeeded();
  await p.waitForTimeout(2500);
  const endAt = (Date.now() - t0) / 1000;
  const card = p.locator('.panel', { hasText: 'Session saved · triage agent' }).last();
  await card.screenshot({ path: join(OUT, 'session-result.png') });
  const webm = await recorded(p, context, 'session');
  log(gif(webm, 'session', { start: Math.max(0, startAt - 0.3), duration: endAt - startAt + 0.3, width: 900, fps: 10 }));
}

// 2. Clinic screenshots + tour GIF (dashboard → Priya's chart → Ask → Agents run).
{
  const { context, p } = await page({ width: 1280, height: 760, video: true });
  const t0 = Date.now();
  await p.getByText("Today's exercise").waitFor();
  const startAt = (Date.now() - t0) / 1000;
  await tab(p, 'Clinic');
  await p.getByText('Alert queue').waitFor();
  await p.waitForTimeout(1800);
  await shot(p, 'clinic-dashboard', { fullPage: true });
  await p.locator('table.data tr', { hasText: 'Priya Natarajan' }).click();
  await p.getByText(/Peak ROM regressed|Regression/).first().waitFor();
  await p.waitForTimeout(2200);
  await shot(p, 'patient-chart', { fullPage: true });
  await p.mouse.wheel(0, 500);
  await p.waitForTimeout(1200);
  await tab(p, 'Ask');
  await p.getByRole('button', { name: /Show compensation by patient/i }).first().click();
  await p.getByText(/Highest compensation this week/i).first().waitFor();
  await p.waitForTimeout(2200);
  await shot(p, 'ask', { fullPage: true });
  await tab(p, 'Agents');
  await p.getByRole('button', { name: 'Run now' }).nth(1).click();
  await p.getByText(/Last run · weekly_caseload_report/).waitFor();
  await p.waitForTimeout(2200);
  await shot(p, 'agents', { fullPage: true });
  const endAt = (Date.now() - t0) / 1000;
  const webm = await recorded(p, context, 'clinic');
  log(gif(webm, 'clinic-tour', { start: startAt, duration: endAt - startAt, width: 900, fps: 8 }));
}

// 3. Phone screenshots: signed-out landing page and the clinic as cards.
{
  const { context, p } = await page({ width: 390, height: 844, signedOut: true });
  await p.getByText(/webcam goniometer/i).waitFor();
  await p.waitForTimeout(500);
  await shot(p, 'phone-signin');
  await context.close();
}
{
  const { context, p } = await page({ width: 390, height: 844 });
  await p.getByText("Today's exercise").waitFor();
  await p.locator('nav[aria-label="Sections"] button', { hasText: 'Clinic' }).last().click();
  await p.getByText('Caseload').waitFor();
  await p.waitForTimeout(1200);
  await p.mouse.wheel(0, 640);
  await p.waitForTimeout(600);
  await shot(p, 'phone-clinic');
  await context.close();
}

await browser.close();
rmSync(TMP, { recursive: true, force: true });
for (const f of readdirSync(OUT).filter((f) => existsSync(join(OUT, f)))) log(f, `${(statSync(join(OUT, f)).size / 1024).toFixed(0)} KB`);
