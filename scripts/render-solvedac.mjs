// solved.ac(백준) 프로필을 받아 대시보드와 같은 담백한 스타일의 SVG(다크/라이트)로 그린다.
// 사용법: node scripts/render-solvedac.mjs <출력 폴더>   (공개 API라 토큰 불필요)
// 조회에 실패하면 기존 파일을 그대로 두고 실패 코드로 끝낸다.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HANDLE = 'lsj1137';
const [outDir] = process.argv.slice(2);
if (!outDir) { console.error('사용법: render-solvedac.mjs <출력 폴더>'); process.exit(1); }

const res = await fetch(`https://solved.ac/api/v3/user/show?handle=${HANDLE}`, {
  headers: { Accept: 'application/json', 'User-Agent': `${HANDLE}-github-profile` },
});
const text = await res.text();
let user;
try { user = JSON.parse(text); } catch { user = null; }
if (!res.ok || !user?.handle) {
  console.error(`solved.ac 조회 실패: HTTP ${res.status}`);
  process.exit(1);
}

// tier 0 = Unrated, 1~30 = Bronze V ~ Ruby I, 31 = Master
const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ruby'];
const TIER_COLORS = ['#ad5600', '#435f7a', '#ec9a00', '#27e2a4', '#00b4fc', '#ff0062'];
const ROMAN = ['V', 'IV', 'III', 'II', 'I'];
function tierOf(t) {
  if (!t) return { name: 'Unrated', color: '#8b949e' };
  if (t >= 31) return { name: 'Master', color: '#b491ff' };
  const g = Math.floor((t - 1) / 5);
  return { name: `${TIERS[g]} ${ROMAN[(t - 1) % 5]}`, color: TIER_COLORS[g] };
}

const tier = tierOf(user.tier);
const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');
const items = [
  { label: 'Tier', value: tier.name, color: tier.color },
  { label: 'Rating', value: fmt(user.rating) },
  { label: 'Solved', value: fmt(user.solvedCount) },
  { label: 'Class', value: user.class ? `${user.class}${user.classDecoration === 'gold' ? '++' : user.classDecoration === 'silver' ? '+' : ''}` : '-' },
  { label: 'Rank', value: `#${fmt(user.rank)}` },
  { label: 'Max Streak', value: fmt(user.maxStreak), unit: user.maxStreak === 1 ? 'day' : 'days' },
];

const THEMES = {
  dark: { border: '#30363d', text: '#e6edf3', muted: '#8b949e' },
  light: { border: '#d0d7de', text: '#1f2328', muted: '#656d76' },
};
const W = 840;
const H = 70;
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function render(t) {
  const top = 24;
  const colW = W / items.length;
  const cols = items.map((it, i) => {
    const x = i * colW;
    const divider = i === 0 ? '' : `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + 46}" stroke="${t.border}"/>`;
    const tx = x + (i === 0 ? 0 : 16);
    const mark = it.color ? `<rect x="${tx}" y="${top + 8}" width="8" height="8" fill="${it.color}"/>` : '';
    const vx = it.color ? tx + 14 : tx;
    return `${divider}${mark}
    <text x="${vx}" y="${top + 20}" class="value">${esc(it.value)}${it.unit ? `<tspan class="label muted"> ${it.unit}</tspan>` : ''}</text>
    <text x="${tx}" y="${top + 40}" class="label muted">${esc(it.label)}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="solved.ac ${esc(user.handle)}">
  <style>
    text { font-family: ${FONT}; fill: ${t.text}; }
    .muted { fill: ${t.muted}; }
    .section { font-size: 12px; fill: ${t.muted}; }
    .value { font-size: 20px; font-weight: 600; }
    .label { font-size: 12px; }
  </style>
  <text x="0" y="12" class="section">Baekjoon · solved.ac</text>
  ${cols}
</svg>
`;
}

await mkdir(outDir, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  const file = path.join(outDir, `solvedac-${name}.svg`);
  await writeFile(file, render(theme));
  console.log(`${file} 저장`);
}
