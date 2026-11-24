// Takes the README screenshots: builds the app, serves it, and photographs every screen with
// headless Chromium (phone size). Usage: pnpm screenshots
import { execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = 'docs/screenshots';
mkdirSync(out, { recursive: true });
execSync('pnpm build', { stdio: 'inherit' });
const server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '4319', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = process.env.CHROMIUM ?? 'chromium';
const shots = [
  ['welcome', 'light', 'de'],
  ['riding', 'dark', 'de'],
  ['ride', 'light', 'en'],
  ['rides', 'light', 'de'],
  ['details', 'light', 'de'],
  ['map', 'dark', 'de'],
  ['routes', 'light', 'de'],
  ['share', 'light', 'de'],
  ['settings', 'light', 'de'],
  ['help', 'dark', 'en'],
];
try {
  for (const [name, theme, lang] of shots) {
    const url = `http://localhost:4319/?shot=${name}&theme=${theme}&lang=${lang}`;
    execSync(
      `${browser} --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=400,860 ` +
        `--virtual-time-budget=9000 --screenshot=${out}/${name}.png "${url}"`,
      { stdio: 'ignore' },
    );
    console.log('✔', `${out}/${name}.png`);
  }
} finally {
  server.kill();
}
