// 이번 주(주말이면 다음 주) 월~금 식단을 받아 lunch/menu.json 으로 저장한다.
// 접속 정보는 전부 환경변수(Actions Secrets)로 받는다 - 저장소가 공개라 코드에 남기지 않는다.
// 응답 원문은 로그에 찍지 않는다. Actions 로그도 공개다.
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const { MENU_BASE_URL, MENU_USER_ID, MENU_USER_PW, MENU_SITE_CD } = process.env;
for (const [k, v] of Object.entries({ MENU_BASE_URL, MENU_USER_ID, MENU_USER_PW, MENU_SITE_CD })) {
  if (!v) { console.error(`환경변수 ${k} 없음`); process.exit(1); }
}

const base = MENU_BASE_URL.replace(/\/+$/, '');
// 웹(W)으로 로그인하면 9912 로 막히므로 안드로이드 앱 웹뷰처럼 보낸다.
// 앱 버전·단말ID는 Secrets 로 덮을 수 있다. 버전 기본값은 Play 스토어 공개 버전(com.ehyundai.greenfood 4.0.23).
// 단말ID가 없으면 계정 ID 해시 16자리(Android ID 형식)로 매번 같은 기기처럼 보낸다.
const OS_DV_CD = 'A';
const APP_VER = process.env.MENU_APP_VER || '4.0.23';
const TRML_ID = process.env.MENU_TRML_ID || createHash('sha256').update(MENU_USER_ID).digest('hex').slice(0, 16);
const APP_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36';
const commonHeaders = { 'Content-Type': 'application/json', Origin: base, 'User-Agent': APP_UA };

// KST 기준 오늘. 토·일이면 다음 주 월요일부터 본다.
function weekdaysKst() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const dow = now.getUTCDay();
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + (dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow));
  return [0, 1, 2, 3, 4].map((i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  });
}

// Set-Cookie 의 name=value 를 기존 쿠키에 합친다. 같은 이름은 새 값으로 덮는다.
function mergeCookie(prev, res) {
  const jar = new Map(prev ? prev.split('; ').map((c) => [c.split('=')[0], c]) : []);
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(';')[0];
    jar.set(pair.split('=')[0], pair);
  }
  return [...jar.values()].join('; ');
}

// 앱 웹뷰가 로그인 전에 하는 기기정보 등록. 서버가 이 쿠키로 앱 환경을 판정한다.
async function registerApp() {
  const appInfo = { osDvCd: OS_DV_CD, userCurrAppVer: APP_VER, mobiPhTrmlId: TRML_ID, trmlTokenVal: '', id: '', pw: '' };
  const res = await fetch(`${base}/api/common/setCookie.do`, {
    method: 'POST',
    headers: commonHeaders,
    body: JSON.stringify({ appInfo }),
  });
  if (res.status !== 200) throw new Error(`앱 정보 등록 실패 (HTTP ${res.status})`);
  return mergeCookie('', res);
}

async function login(appCookie) {
  const res = await fetch(`${base}/api/com/login.do`, {
    method: 'POST',
    headers: appCookie ? { ...commonHeaders, Cookie: appCookie } : commonHeaders,
    body: JSON.stringify({ userId: MENU_USER_ID, userData: MENU_USER_PW }),
  });
  if (res.status !== 200) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  // 실패해도 200 + 쿠키를 주므로 본문 errorCode 로 판정한다. (9912 = 웹 로그인 차단)
  const body = await res.json().catch(() => ({}));
  if (body.errorCode) throw new Error(`로그인 거절 (errorCode ${body.errorCode}: ${body.errorMsg ?? ''})`);
  const cookie = mergeCookie(appCookie, res);
  if (!cookie) throw new Error('로그인 응답에 쿠키 없음');
  return cookie;
}

async function fetchDay(cookie, yyyymmdd) {
  const res = await fetch(`${base}/api/menu/todayMenu/selectTodayMenuList.do`, {
    method: 'POST',
    headers: { ...commonHeaders, Cookie: cookie },
    body: JSON.stringify({ bizplcCd: MENU_SITE_CD, prvdDt: yyyymmdd }),
  });
  if (res.status !== 200) throw new Error(`${yyyymmdd} 조회 실패 (HTTP ${res.status})`);
  const json = await res.json();
  const list = json?.dataSets?.menuList ?? [];
  // 이미지 경로는 업체 도메인이 드러나므로 담지 않는다.
  return list.map((o) => ({
    meal: o.mealDvNm ?? '',
    corner: o.conerNm ?? '',
    name: o.dispNm ?? '',
    detail: o.mnuNms ?? '',
    kcal: o.totCaloryQt ?? '',
  }));
}

const cookie = await login(await registerApp());
const days = {};
for (const ymd of weekdaysKst()) {
  days[ymd] = await fetchDay(cookie, ymd);
  console.log(`${ymd}: ${days[ymd].length}건`);
}

const total = Object.values(days).reduce((n, l) => n + l.length, 0);
if (total === 0) {
  // 전부 비면 기존 파일을 덮지 않는다 - 세션 만료·차단을 빈 식단으로 착각하지 않게.
  console.error('식단 0건 - menu.json 갱신 안 함');
  process.exit(1);
}

await writeFile('lunch/menu.json', JSON.stringify({ updatedAt: new Date().toISOString(), days }, null, 2) + '\n');
console.log(`저장 완료: 총 ${total}건`);
