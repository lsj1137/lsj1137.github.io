// solved.ac(백준) 프로필을 받아 대시보드 톤의 SVG(다크/라이트)로 그린다. 티어 색·엠블럼·진행 막대만 색을 쓴다.
// 사용법: node scripts/render-solvedac.mjs <출력 폴더>   (공개 API라 토큰 불필요)
// 조회에 실패하면 기존 파일을 그대로 두고 실패 코드로 끝낸다.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HANDLE = 'lsj1137';
const COLUMNS = 6;
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

// 다음 티어까지 진행도(예전 배지의 레벨 막대). 현재 티어 하한~다음 티어 하한 구간 기준.
const lo = user.tier ? TIER_MIN_RATING[user.tier - 1] : 0;
const hi = TIER_MIN_RATING[user.tier] ?? null;
const progress = hi ? Math.min(1, Math.max(0, (user.rating - lo) / (hi - lo))) : 1;
const nextTier = hi ? tierOf(user.tier + 1).name : null;
const level = user.tier && user.tier < 31 ? 5 - ((user.tier - 1) % 5) : '';

const items = [
  { label: 'Rating', value: fmt(user.rating) },
  { label: 'Solved', value: fmt(user.solved) },
  { label: 'Class', value: user.cls },
];
if (user.rank) items.push({ label: 'Rank', value: `#${fmt(user.rank)}` });

const THEMES = {
  dark: { border: '#30363d', track: '#21262d', text: '#e6edf3', muted: '#8b949e' },
  light: { border: '#d0d7de', track: '#eaeef2', text: '#1f2328', muted: '#656d76' },
};
const W = 840;
const H = 104;
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 티어 엠블럼: 티어 색 육각형 + 단계 숫자(solved.ac 아이콘 느낌만, 공식 이미지는 Cloudflare에 막혀 직접 그림)
function emblem(cx, cy, r) {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return `<polygon points="${pts}" fill="${tier.color}"/>
  <text x="${cx}" y="${cy + 7}" text-anchor="middle" class="emblem">${level}</text>`;
}

function render(t) {
  const colW = W / COLUMNS; // 위 대시보드 수치 줄과 세로선 위치를 맞춘다
  const statsTop = 4;
  const cols = items.map((it, i) => {
    const x = (i + 2) * colW;
    return `<line x1="${x}" y1="${statsTop}" x2="${x}" y2="${statsTop + 48}" stroke="${t.border}"/>
    <text x="${x + 16}" y="${statsTop + 22}" class="value">${esc(it.value)}</text>
    <text x="${x + 16}" y="${statsTop + 42}" class="label muted">${esc(it.label)}</text>`;
  }).join('');

  const barY = 74;
  const caption = nextTier
    ? `${fmt(user.rating)} / ${fmt(hi)} · ${Math.floor(progress * 100)}% to ${nextTier}`
    : `${fmt(user.rating)} · Master`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="solved.ac ${HANDLE}: ${esc(tier.name)}">
  <style>
    text { font-family: ${FONT}; fill: ${t.text}; }
    .muted { fill: ${t.muted}; }
    .tier { font-size: 20px; font-weight: 700; fill: ${tier.color}; }
    .emblem { font-size: 20px; font-weight: 800; fill: #ffffff; }
    .value { font-size: 20px; font-weight: 600; }
    .label { font-size: 12px; }
  </style>
  ${emblem(22, 28, 24)}
  <text x="60" y="26" class="tier">${esc(tier.name)}</text>
  <text x="60" y="46" class="label muted">${HANDLE} · solved.ac</text>
  ${cols}
  <rect x="0" y="${barY}" width="${W}" height="6" fill="${t.track}"/>
  <rect x="0" y="${barY}" width="${(W * progress).toFixed(1)}" height="6" fill="${tier.color}"/>
  <text x="${W}" y="${barY + 26}" text-anchor="end" class="label muted">${esc(caption)}</text>
</svg>
`;
}

await mkdir(outDir, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  const file = path.join(outDir, `solvedac-${name}.svg`);
  await writeFile(file, render(theme));
  console.log(`${file} 저장`);
}
