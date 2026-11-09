// GitHub 활동을 GraphQL로 받아 프로필 README용 대시보드 SVG(다크/라이트)를 그린다.
// README는 HTML·JS가 막혀 있어 SVG 이미지(CSS 애니메이션은 동작)로 꾸민다.
// 사용법: node scripts/render-dashboard.mjs <출력 폴더>   (토큰: 환경변수 STATS_TOKEN, Classic PAT)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const USER = 'lsj1137';
const [outDir] = process.argv.slice(2);
const { STATS_TOKEN } = process.env;
if (!outDir) { console.error('사용법: render-dashboard.mjs <출력 폴더>'); process.exit(1); }
if (!STATS_TOKEN) { console.error('환경변수 STATS_TOKEN 없음'); process.exit(1); }

const QUERY = `
query($login: String!) {
  user(login: $login) {
    name
    login
    followers { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, orderBy: { field: PUSHED_AT, direction: DESC }) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function fetchUser() {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${STATS_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': USER },
    body: JSON.stringify({ query: QUERY, variables: { login: USER } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GraphQL 실패: ${res.status} ${JSON.stringify(json.errors ?? json.message)}`);
  return json.data.user;
}

// ── 데이터 가공 ───────────────────────────────────────────────

function summarize(user) {
  const days = user.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);

  // 오늘 기여가 아직 없으면 어제부터 센다(하루가 끝나기 전에 끊긴 것으로 보지 않음)
  let current = 0;
  let i = days.length - 1;
  if (days[i]?.contributionCount === 0) i--;
  for (; i >= 0 && days[i].contributionCount > 0; i--) current++;

  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  const langs = new Map();
  for (const repo of user.repositories.nodes) {
    for (const { size, node } of repo.languages.edges) {
      const prev = langs.get(node.name) ?? { size: 0, color: node.color ?? '#8b949e' };
      langs.set(node.name, { ...prev, size: prev.size + size });
    }
  }
  const total = [...langs.values()].reduce((a, l) => a + l.size, 0) || 1;
  const top = [...langs.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 6)
    .map(([name, l]) => ({ name, color: l.color, pct: (l.size / total) * 100 }));

  return {
    name: user.name || user.login,
    login: user.login,
    days,
    stats: [
      { label: 'Contributions', sub: 'last year', value: user.contributionsCollection.contributionCalendar.totalContributions },
      { label: 'Commits', sub: 'last year', value: user.contributionsCollection.totalCommitContributions },
      { label: 'Pull Requests', sub: 'all time', value: user.pullRequests.totalCount },
      { label: 'Stars', sub: 'earned', value: user.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0) },
      { label: 'Current Streak', sub: 'days', value: current },
      { label: 'Longest Streak', sub: 'days', value: longest },
    ],
    langs: top,
  };
}

// ── 그리기 ────────────────────────────────────────────────────

const THEMES = {
  dark: {
    bg1: '#0d1117', bg2: '#161b2e', border: '#30363d', text: '#e6edf3', muted: '#8b949e',
    tile: '#161b22', empty: '#1f2530', heat: ['#1f2530', '#2d2a6e', '#4f46e5', '#7c5cff', '#22d3ee'],
  },
  light: {
    bg1: '#ffffff', bg2: '#f3f4ff', border: '#d0d7de', text: '#1f2328', muted: '#656d76',
    tile: '#f6f8fa', empty: '#ebedf0', heat: ['#ebedf0', '#c7d2fe', '#818cf8', '#6366f1', '#06b6d4'],
  },
};

const W = 840;
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => n.toLocaleString('en-US');

// GitHub 잔디처럼 기여 있는 날의 분위수(25/50/75%)로 4단계를 나눈다(하루 몰빵에 전체가 옅어지지 않게)
function heatLevels(days) {
  const counts = days.map((d) => d.contributionCount).filter((c) => c > 0).sort((a, b) => a - b);
  const q = (p) => counts[Math.floor((counts.length - 1) * p)] ?? 1;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  return (c) => (c === 0 ? 0 : c <= q1 ? 1 : c <= q2 ? 2 : c <= q3 ? 3 : 4);
}

function render(data, t) {
  const pad = 28;

  // 통계 타일 3x2
  const tileW = 150;
  const tileH = 64;
  const gap = 12;
  const tilesTop = 92;
  const tiles = data.stats.map((s, i) => {
    const x = pad + (i % 3) * (tileW + gap);
    const y = tilesTop + Math.floor(i / 3) * (tileH + gap);
    return `
    <g class="fade" style="animation-delay:${0.1 + i * 0.08}s" transform="translate(${x},${y})">
      <rect width="${tileW}" height="${tileH}" rx="12" fill="${t.tile}" stroke="${t.border}"/>
      <text x="14" y="30" class="value">${fmt(s.value)}</text>
      <text x="14" y="50" class="label">${esc(s.label)} <tspan fill="${t.muted}" opacity="0.7">· ${esc(s.sub)}</tspan></text>
    </g>`;
  }).join('');

  // 언어 비율 막대 + 범례
  const langX = pad + 3 * (tileW + gap) + 16;
  const langW = W - langX - pad;
  let acc = 0;
  const bar = data.langs.map((l) => {
    const w = (l.pct / 100) * langW;
    const seg = `<rect x="${acc.toFixed(1)}" width="${w.toFixed(1)}" height="10" fill="${l.color}"/>`;
    acc += w;
    return seg;
  }).join('');
  const legend = data.langs.map((l, i) => {
    const x = (i % 2) * (langW / 2);
    const y = 34 + Math.floor(i / 2) * 26;
    return `
      <g class="fade" style="animation-delay:${0.5 + i * 0.06}s" transform="translate(${x},${y})">
        <circle cx="5" cy="-4" r="5" fill="${l.color}"/>
        <text x="16" y="0" class="label">${esc(l.name)} <tspan fill="${t.muted}">${l.pct.toFixed(1)}%</tspan></text>
      </g>`;
  }).join('');

  // 잔디(최근 53주)
  const cell = 11;
  const cgap = 3;
  const weeks = [];
  for (let i = 0; i < data.days.length; i += 7) weeks.push(data.days.slice(i, i + 7));
  const level = heatLevels(data.days);
  const heatW = weeks.length * (cell + cgap) - cgap;
  const heatX = (W - heatW) / 2;
  const heatTop = 268;
  const heat = weeks.map((week, wi) => week.map((d, di) =>
    `<rect class="cell" style="animation-delay:${(0.6 + wi * 0.015).toFixed(3)}s" x="${wi * (cell + cgap)}" y="${di * (cell + cgap)}" width="${cell}" height="${cell}" rx="2.5" fill="${t.heat[level(d.contributionCount)]}"><title>${d.date}: ${d.contributionCount}</title></rect>`,
  ).join('')).join('');
  const H = heatTop + 7 * (cell + cgap) + 24;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(data.name)}'s GitHub dashboard">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.bg1}"/><stop offset="1" stop-color="${t.bg2}"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <clipPath id="barClip"><rect width="${langW}" height="10" rx="5"/></clipPath>
  </defs>
  <style>
    text { font-family: ${FONT}; fill: ${t.text}; }
    .title { font-size: 26px; font-weight: 800; }
    .sub { font-size: 13px; fill: ${t.muted}; }
    .section { font-size: 12px; font-weight: 700; letter-spacing: 1.5px; fill: ${t.muted}; }
    .value { font-size: 22px; font-weight: 800; }
    .label { font-size: 12px; }
    .fade, .cell { opacity: 0; animation: fadeIn 0.6s ease forwards; }
    .grow { transform-box: fill-box; transform-origin: left; animation: grow 1.2s cubic-bezier(.2,.8,.2,1) forwards; transform: scaleX(0); }
    @keyframes fadeIn { to { opacity: 1; } }
    @keyframes grow { to { transform: scaleX(1); } }
    @media (prefers-reduced-motion: reduce) { .fade, .cell { animation: none; opacity: 1; } .grow { animation: none; transform: none; } }
  </style>

  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="url(#bg)" stroke="${t.border}"/>
  <rect x="${pad}" y="26" width="4" height="40" rx="2" fill="url(#accent)"/>
  <text x="${pad + 16}" y="50" class="title">${esc(data.name)}</text>
  <text x="${pad + 16}" y="70" class="sub">@${esc(data.login)} · GitHub activity</text>

  ${tiles}

  <g transform="translate(${langX},${tilesTop})">
    <text x="0" y="-12" class="section">TOP LANGUAGES</text>
    <g clip-path="url(#barClip)"><g class="grow">${bar}</g></g>
    <g transform="translate(0,14)">${legend}</g>
  </g>

  <text x="${heatX}" y="${heatTop - 12}" class="section">CONTRIBUTIONS · LAST 12 MONTHS</text>
  <g transform="translate(${heatX},${heatTop})">${heat}</g>
</svg>
`;
}

const data = summarize(await fetchUser());
await mkdir(outDir, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  const file = path.join(outDir, `dashboard-${name}.svg`);
  await writeFile(file, render(data, theme));
  console.log(`${file} 저장`);
}
