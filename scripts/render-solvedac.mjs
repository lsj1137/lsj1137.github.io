// solved.ac(백준) 프로필을 받아 대시보드와 같은 담백한 스타일의 SVG(다크/라이트)로 그린다.
// 사용법: node scripts/render-solvedac.mjs <출력 폴더>   (공개 API라 토큰 불필요)
// 조회에 실패하면 기존 파일을 그대로 두고 실패 코드로 끝낸다.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HANDLE = 'lsj1137';
const COLUMNS = 6; // 위 대시보드 수치 줄과 세로선 위치를 맞춘다
const [outDir] = process.argv.slice(2);
if (!outDir) { console.error('사용법: render-solvedac.mjs <출력 폴더>'); process.exit(1); }

// tier 0 = Unrated, 1~30 = Bronze V ~ Ruby I, 31 = Master
const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ruby'];
const TIER_COLORS = ['#ad5600', '#435f7a', '#ec9a00', '#27e2a4', '#00b4fc', '#ff0062'];
const ROMAN = ['V', 'IV', 'III', 'II', 'I'];
// solved.ac 레이팅 → 티어 하한(1=Bronze V ... 30=Ruby I, 31=Master)
const TIER_MIN_RATING = [
  30, 60, 90, 120, 150, 200, 300, 400, 500, 650, 800, 950, 1100, 1250, 1400,
  1600, 1750, 1900, 2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2850, 2900, 2950, 3000,
];
const tierFromRating = (r) => TIER_MIN_RATING.filter((min) => r >= min).length;

function tierOf(t) {
  if (!t) return { name: 'Unrated', color: '#8b949e' };
  if (t >= 31) return { name: 'Master', color: '#b491ff' };
  const g = Math.floor((t - 1) / 5);
  return { name: `${TIERS[g]} ${ROMAN[(t - 1) % 5]}`, color: TIER_COLORS[g] };
}

// 1순위: solved.ac 공식 API (Cloudflare가 Actions·사내망을 403으로 막는 경우가 많다)
async function fromApi() {
  const res = await fetch(`https://solved.ac/api/v3/user/show?handle=${HANDLE}`, {
    headers: { Accept: 'application/json', 'User-Agent': `${HANDLE}-github-profile` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const u = await res.json();
  return {
    tier: u.tier, rating: u.rating, solved: u.solvedCount,
    cls: u.class ? `${u.class}${u.classDecoration === 'gold' ? '++' : u.classDecoration === 'silver' ? '+' : ''}` : '-',
    rank: u.rank, maxStreak: u.maxStreak,
  };
}

// 2순위: 기존에 쓰던 mazassumnida 배지 SVG에서 값만 뽑는다(순위·스트릭은 없음)
async function fromBadge() {
  const res = await fetch(`http://mazassumnida.wtf/api/v2/generate_badge?boj=${HANDLE}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const svg = await res.text();
  const pick = (cls) => {
    const m = svg.match(new RegExp(`class="${cls} value">([^<]+)<`));
    if (!m) throw new Error(`배지에서 ${cls} 값을 못 찾음`);
    return Number(m[1].replace(/,/g, ''));
  };
  const rating = pick('rate');
  return { tier: tierFromRating(rating), rating, solved: pick('solved'), cls: String(pick('class')) };
}

let user;
for (const [name, source] of [['solved.ac API', fromApi], ['mazassumnida 배지', fromBadge]]) {
  try {
    user = await source();
    console.log(`${name}에서 조회`);
    break;
  } catch (e) {
    console.error(`${name} 실패: ${e.message}`);
  }
}
if (!user) process.exit(1);

const tier = tierOf(user.tier);
const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');
const items = [
  { label: 'Tier', value: tier.name, color: tier.color },
  { label: 'Rating', value: fmt(user.rating) },
  { label: 'Solved', value: fmt(user.solved) },
  { label: 'Class', value: user.cls },
];
if (user.rank) items.push({ label: 'Rank', value: `#${fmt(user.rank)}` });
if (user.maxStreak) items.push({ label: 'Max Streak', value: fmt(user.maxStreak), unit: user.maxStreak === 1 ? 'day' : 'days' });

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
  const colW = W / COLUMNS;
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="solved.ac ${HANDLE}">
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
