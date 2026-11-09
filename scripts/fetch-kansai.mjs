// 간사이 조이패스 이용 가능 시설을 travelcontentsapp.com 에서 받아 kansai/data.json 으로 저장한다.
// - 목록 페이지는 매번 전부 읽고, 상세 페이지는 새로 생긴 시설만 읽는다 (매월 첫 주, 또는 FULL=1 이면 전부 다시).
// - 좌표: kansai/overrides.json(수동) > 교환 장소의 구글맵 링크 > 주소 지오코딩(OSM) > 지역 중심 순.
// - 시설 수가 지난번보다 크게 줄면 사이트 구조가 바뀐 것으로 보고 덮어쓰지 않는다.
import { readFile, writeFile } from 'node:fs/promises';

const SITE = 'https://travelcontentsapp.com';
const LIST_URL = (p) => `${SITE}/kr/have-fun-pass/kansai/?_page=${p}`;
const DATA_FILE = 'kansai/data.json';
const OVERRIDE_FILE = 'kansai/overrides.json';
const UA = 'Mozilla/5.0 (compatible; joypass-map/1.0; +https://lsj1137.github.io/kansai/)';
const MAX_PAGES = 40;
const CONCURRENCY = 4;
const MIN_KEEP_RATIO = 0.8;

const REGION_ORDER = ['osaka', 'kyoto', 'hyogo', 'shiga', 'nara', 'wakayama', 'aichi'];
// 좌표를 끝내 못 찾을 때 쓰는 지역 중심
const REGION_CENTER = {
  osaka: [34.6937, 135.5023], kyoto: [35.0116, 135.7681], hyogo: [34.6901, 135.1955], shiga: [35.0045, 135.8686],
  nara: [34.6851, 135.8048], wakayama: [34.226, 135.1675], aichi: [35.1815, 136.9066],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, opts = {}) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000), ...opts });
      if (res.status >= 500 && i < 2) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (i >= 2) throw new Error(`${url} 요청 실패: ${e.message}`);
      await sleep(2000 * (i + 1));
    }
  }
}

async function pool(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// ---------- HTML 정리 ----------
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function unescape(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1));
    return NAMED[e.toLowerCase()] ?? m;
  });
}
function clean(html = '') {
  return unescape(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
}
const hrefOf = (html = '') => unescape((/href="([^"]+)"/.exec(html) || [])[1] || '');

// ---------- 목록 ----------
function parseCards(html) {
  const cards = [];
  for (const chunk of html.split('data-elementor-type="loop-item"').slice(1)) {
    if (!chunk.slice(0, 800).includes('type-attraction')) continue;
    const cls = (/class="([^"]+)"/.exec(chunk) || [])[1] || '';
    const m = /title="([^"]+)" href="(https:\/\/travelcontentsapp\.com\/kr\/attraction\/[^"]+)"/.exec(chunk);
    if (!m || !cls.includes('ticket-type-have-fun')) continue;
    cards.push({
      url: m[2],
      name: unescape(m[1]),
      region: (/attraction-regional-(\S+)/.exec(cls) || [])[1] || '',
      types: [...cls.matchAll(/attraction-type-(\S+)/g)].map((x) => x[1]),
    });
  }
  return cards;
}

async function fetchList() {
  const found = new Map();
  for (let p = 1; p <= MAX_PAGES; p++) {
    const html = await (await get(LIST_URL(p))).text();
    let added = 0;
    for (const c of parseCards(html)) if (!found.has(c.url)) { found.set(c.url, c); added++; }
    console.log(`목록 ${p}쪽: 새 시설 ${added}`);
    // 마지막 쪽을 넘기면 추천 카드만 반복되어 새 시설이 0이 된다
    if (!added) break;
    await sleep(500);
  }
  return [...found.values()];
}

// ---------- 상세 ----------
async function fetchDetail(card) {
  const html = await (await get(card.url)).text();
  const start = html.indexOf('<h2>체험 내용</h2>');
  const body = start >= 0 ? html.slice(start, html.indexOf('</div>', start)) : '';
  const parts = body.split(/<h2>(.*?)<\/h2>/);
  const sec = {};
  for (let k = 1; k < parts.length; k += 2) sec[clean(parts[k])] = parts[k + 1];
  const og = (prop) => unescape((new RegExp(`property="og:${prop}" content="([^"]*)"`).exec(html) || [])[1] || '');
  return {
    ...card,
    offer: clean(sec['체험 내용']),
    howto: clean(sec['이용 방법 & 주의 사항']),
    maplink: hrefOf(sec['교환 장소']),
    address: clean(sec['교환 장소']).replaceAll('📍', '').trim(),
    site: hrefOf(sec['관련 링크']),
    img: og('image'),
    desc: og('description'),
  };
}

// 구글맵 단축 링크를 따라가 !3d<lat>!4d<lng> 또는 @lat,lng 를 꺼낸다
async function coordsFromLink(link) {
  if (!/^https:\/\/(maps\.app\.goo\.gl|(www\.)?google\.[a-z.]+\/maps|goo\.gl\/maps)/.test(link)) return null;
  let u = link;
  for (let i = 0; i < 6; i++) {
    const m = /!3d(-?[\d.]+)!4d(-?[\d.]+)/.exec(u) || /@(-?[\d.]+),(-?[\d.]+)/.exec(u)
      || /[?&](?:ll|q|query)=(-?[\d.]+),(-?[\d.]+)/.exec(decodeURIComponent(u));
    if (m) return [+m[1], +m[2]];
    const res = await get(u, { redirect: 'manual' });
    const loc = res.headers.get('location');
    if (!loc) return null;
    u = new URL(loc, u).href;
  }
  return null;
}

// OSM 지오코딩: 정책상 초당 1건, 식별 가능한 User-Agent 필수
let lastGeocode = 0;
async function geocode(q) {
  await sleep(Math.max(0, lastGeocode + 1100 - Date.now()));
  lastGeocode = Date.now();
  const res = await get(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=jp&q=${encodeURIComponent(q)}`);
  if (!res.ok) return null;
  const [hit] = await res.json();
  return hit ? [+hit.lat, +hit.lon] : null;
}

async function locate(d, overrides) {
  const ov = overrides[d.url];
  if (ov) return { lat: ov.lat, lng: ov.lng, approx: ov.approx || '수동', gmap: '' };
  const ll = d.maplink && (await coordsFromLink(d.maplink).catch(() => null));
  if (ll) return { lat: ll[0], lng: ll[1], approx: '', gmap: d.maplink };
  const addr = d.address.split('\n')[0];
  if (addr && !addr.startsWith('http')) {
    const g = await geocode(addr).catch(() => null);
    if (g) return { lat: g[0], lng: g[1], approx: '주소', gmap: '' };
  }
  const c = REGION_CENTER[d.region] || REGION_CENTER.osaka;
  return { lat: c[0], lng: c[1], approx: '지역 중심(위치 미확인)', gmap: '' };
}

// ---------- 실행 ----------
const old = JSON.parse(await readFile(DATA_FILE, 'utf8').catch(() => '{"items":[]}'));
const overrides = JSON.parse(await readFile(OVERRIDE_FILE, 'utf8').catch(() => '{}'));
const oldByUrl = new Map(old.items.map((x) => [x.url, x]));
const kstDay = new Date(Date.now() + 9 * 3600 * 1000).getUTCDate();
const full = process.env.FULL === '1' || kstDay <= 7;

const cards = await fetchList();
if (cards.length < old.items.length * MIN_KEEP_RATIO) {
  console.error(`시설 ${cards.length}곳 - 지난번 ${old.items.length}곳보다 너무 적음. 사이트 구조 변경 의심, 갱신 안 함`);
  process.exit(1);
}

const todo = cards.filter((c) => full || !oldByUrl.has(c.url));
console.log(`시설 ${cards.length}곳, 상세 수집 ${todo.length}곳 (${full ? '전체' : '신규만'})`);

const fresh = new Map();
await pool(todo, async (c, i) => {
  const d = await fetchDetail(c);
  fresh.set(c.url, { ...d, ...(await locate(d, overrides)) });
  if ((i + 1) % 20 === 0) console.log(`상세 ${i + 1}/${todo.length}`);
});

const emptyOffer = [...fresh.values()].filter((d) => !d.offer && !d.desc).length;
if (fresh.size >= 10 && emptyOffer > fresh.size * 0.3) {
  console.error(`상세 ${fresh.size}곳 중 ${emptyOffer}곳이 내용 없음. 상세 페이지 구조 변경 의심, 갱신 안 함`);
  process.exit(1);
}

const FIELDS = ['name', 'region', 'types', 'offer', 'howto', 'address', 'site', 'img', 'desc', 'url', 'lat', 'lng', 'approx', 'gmap'];
const items = cards.map((c) => {
  // 상세를 다시 안 읽은 시설은 이름·지역·분류만 목록 값으로 갱신하고 나머지는 지난번 값을 쓴다
  const d = fresh.get(c.url) || { ...oldByUrl.get(c.url), ...c };
  const ov = overrides[c.url];
  if (ov) Object.assign(d, { lat: ov.lat, lng: ov.lng, approx: ov.approx || '수동' });
  return Object.fromEntries(FIELDS.map((k) => [k, d[k] ?? '']));
});
const rank = (r) => (REGION_ORDER.indexOf(r) + 1) || 99;
items.sort((a, b) => rank(a.region) - rank(b.region) || a.name.localeCompare(b.name, 'ko'));

const added = items.filter((x) => !oldByUrl.has(x.url)).length;
const removed = old.items.filter((x) => !cards.some((c) => c.url === x.url)).length;
const unlocated = items.filter((x) => x.approx.startsWith('지역 중심')).map((x) => x.name);
if (unlocated.length) console.log(`위치 미확인(overrides.json 에 좌표 추가 필요): ${unlocated.join(', ')}`);

if (JSON.stringify(items) === JSON.stringify(old.items)) {
  console.log('변경 없음');
} else {
  await writeFile(DATA_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 1) + '\n');
  console.log(`저장 완료: ${items.length}곳 (추가 ${added}, 제외 ${removed})`);
}
