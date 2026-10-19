// 이번 주(주말이면 다음 주) 월~금 식단을 받아 lunch/menu.json 으로 저장한다.
// 접속 정보는 전부 환경변수(Actions Secrets)로 받는다 - 저장소가 공개라 코드에 남기지 않는다.
// 응답 원문은 로그에 찍지 않는다. Actions 로그도 공개다.
import { writeFile } from 'node:fs/promises';

const { MENU_BASE_URL, MENU_USER_ID, MENU_USER_PW, MENU_SITE_CD } = process.env;
for (const [k, v] of Object.entries({ MENU_BASE_URL, MENU_USER_ID, MENU_USER_PW, MENU_SITE_CD })) {
  if (!v) { console.error(`환경변수 ${k} 없음`); process.exit(1); }
}

const base = MENU_BASE_URL.replace(/\/+$/, '');
const commonHeaders = { 'Content-Type': 'application/json', Origin: base };

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

async function login() {
  const res = await fetch(`${base}/api/com/login.do`, {
    method: 'POST',
    headers: commonHeaders,
    body: JSON.stringify({ userId: MENU_USER_ID, userData: MENU_USER_PW }),
  });
  if (res.status !== 200) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  // Set-Cookie 에서 name=value 만 모아 다음 요청 Cookie 로 쓴다.
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
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

const cookie = await login();
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
