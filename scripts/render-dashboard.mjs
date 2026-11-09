// GitHub 활동을 GraphQL로 받아 프로필 README용 대시보드 SVG(다크/라이트)를 그린다.
// README는 HTML·JS가 막혀 있어 SVG 이미지로 그린다.
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
      { label: 'Contributions (1y)', value: user.contributionsCollection.contributionCalendar.totalContributions },
      { label: 'Commits (1y)', value: user.contributionsCollection.totalCommitContributions },
      { label: 'Pull Requests', value: user.pullRequests.totalCount },
      { label: 'Stars', value: user.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0) },
      { label: 'Current Streak', value: current, unit: 'day' },
      { label: 'Longest Streak', value: longest, unit: 'day' },
    ],
    langs: top,
  };
}

// ── 그리기 ────────────────────────────────────────────────────
// 담백하게: 배경·테두리·여백 없이 README에 녹아들게, 얇은 선, 무채색 잔디, 애니메이션 없음.
// 언어 색만 GitHub 표준색을 쓴다. 배경이 투명이라 다크/라이트는 글자·선 색만 다르다.

const THEMES = {
  dark: {
    border: '#30363d', text: '#e6edf3', muted: '#8b949e',
    heat: ['#161b22', '#2f353d', '#4b535d', '#7d8590', '#c9d1d9'],
  },
  light: {
    border: '#d0d7de', text: '#1f2328', muted: '#656d76',
    heat: ['#ebedf0', '#c8ccd1', '#9aa1a9', '#6e7781', '#24292f'],
  },
};

const W = 840;
const PAD = 0;
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
  const inner = W - PAD * 2;

  // 수치 한 줄(세로 구분선)
  const statsTop = 66;
  const colW = inner / data.stats.length;
  const stats = data.stats.map((s, i) => {
    const x = PAD + i * colW;
    const divider = i === 0 ? '' : `<line x1="${x}" y1="${statsTop}" x2="${x}" y2="${statsTop + 48}" stroke="${t.border}"/>`;
    const tx = x + (i === 0 ? 0 : 16);
    return `${divider}
    <text x="${tx}" y="${statsTop + 22}" class="value">${fmt(s.value)}${s.unit ? `<tspan class="label muted"> ${s.unit}${s.value === 1 ? '' : 's'}</tspan>` : ''}</text>
    <text x="${tx}" y="${statsTop + 42}" class="label muted">${esc(s.label)}</text>`;
  }).join('');

  // 언어 비율 막대 + 한 줄 범례
  const langTop = 170;
  const shown = data.langs.reduce((a, l) => a + l.pct, 0) || 1;
  let acc = 0;
  const bar = data.langs.map((l) => {
    const w = (l.pct / shown) * inner;
    const seg = `<rect x="${(PAD + acc).toFixed(1)}" y="${langTop}" width="${w.toFixed(1)}" height="8" fill="${l.color}"/>`;
    acc += w;
    return seg;
  }).join('');
  const legendW = inner / data.langs.length;
  const legend = data.langs.map((l, i) => {
    const x = PAD + i * legendW;
    return `<rect x="${x}" y="${langTop + 22}" width="8" height="8" fill="${l.color}"/>
    <text x="${x + 14}" y="${langTop + 30}" class="label">${esc(l.name)}<tspan class="muted"> ${l.pct.toFixed(1)}%</tspan></text>`;
  }).join('');

  // 잔디(최근 53주)
  const gap = 3;
  const weeks = [];
  for (let i = 0; i < data.days.length; i += 7) weeks.push(data.days.slice(i, i + 7));
  const cell = (inner + gap) / weeks.length - gap;
  const level = heatLevels(data.days);
  const heatTop = 256;
  const heat = weeks.map((week, wi) => week.map((d, di) =>
    `<rect x="${(PAD + wi * (cell + gap)).toFixed(1)}" y="${(heatTop + di * (cell + gap)).toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" rx="2" fill="${t.heat[level(d.contributionCount)]}"><title>${d.date}: ${d.contributionCount}</title></rect>`,
  ).join('')).join('');
  const H = Math.round(heatTop + 7 * (cell + gap) - gap + 1);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(data.name)}'s GitHub activity">
  <style>
    text { font-family: ${FONT}; fill: ${t.text}; }
    .name { font-size: 20px; font-weight: 600; }
    .muted { fill: ${t.muted}; }
    .section { font-size: 12px; fill: ${t.muted}; }
    .value { font-size: 20px; font-weight: 600; }
    .label { font-size: 12px; }
  </style>
  <text x="${PAD}" y="22" class="name">${esc(data.name)}</text>
  <text x="${PAD}" y="42" class="label muted">@${esc(data.login)}</text>
  ${stats}

  <line x1="${PAD}" y1="${statsTop + 66}" x2="${W - PAD}" y2="${statsTop + 66}" stroke="${t.border}"/>

  <text x="${PAD}" y="${langTop - 12}" class="section">Languages</text>
  ${bar}
  ${legend}

  <text x="${PAD}" y="${heatTop - 12}" class="section">Contributions in the last year</text>
  ${heat}
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
