const $ = (s) => document.querySelector(s);
const CATS = {
  med: ['의약품', '💊'], beauty: ['화장품', '🧴'], daily: ['생활', '🧼'], snack: ['과자', '🍫'],
  food: ['식품·술', '🍜'], goods: ['잡화', '🍳'], stationery: ['문구', '✏️'], kansai: ['간사이', '🏯'],
};
// 구매처 그룹: where 문자열에 든 단어로 분류한다. 순서가 곧 우선순위(쇼핑 목록 묶음 기준)
const STORES = [
  ['drug', '드럭스토어', ['드럭']],
  ['donki', '돈키호테·마트', ['돈키', '마트', '슈퍼']],
  ['conv', '편의점', ['편의점']],
  ['loft', '로프트·문구점', ['로프트', '핸즈', '문구', '화방']],
  ['yen100', '100엔샵', ['100엔']],
  ['elec', '가전양판점', ['가전']],
  ['dept', '백화점·공항', ['백화점', '공항', '한큐']],
  ['local', '간사이 현지 매장', ['교토', '오사카', '고베', '나라', '와카야마', '시가', '난바', '사카이', '니시키', '도구야스지', '아리마', '우지']],
  ['etc', '기타 전문점', []],
];
const storeOf = (part) => (STORES.find(([, , keys]) => keys.some((k) => part.includes(k))) || STORES.at(-1))[0];
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const RATE_TTL = 12 * 3600 * 1000;

// 쇼핑 목록: { 일본어명: 샀는지 } — 예전 체크 목록(jp-shop-checked)은 담은 것으로 옮긴다
function loadCart() {
  const saved = localStorage.getItem('jp-shop-cart');
  if (saved) return JSON.parse(saved);
  const old = JSON.parse(localStorage.getItem('jp-shop-checked') || '[]');
  return Object.fromEntries(old.map((ja) => [ja, false]));
}

const state = {
  list: [],
  cart: loadCart(),
  rate: Number(localStorage.getItem('krwPerJpy')) || 8.6,
  // 주소 끝 #med 등으로 탭을, #tips 로 팁 창을 바로 열 수 있다
  cat: Object.keys(CATS).includes(location.hash.slice(1)) ? location.hash.slice(1) : 'all',
  sort: localStorage.getItem('jp-shop-sort') || 'default',
  store: localStorage.getItem('jp-shop-store') || 'all',
  hideBan: localStorage.getItem('jp-shop-hideban') === '1',
};
const saveCart = () => localStorage.setItem('jp-shop-cart', JSON.stringify(state.cart));

// 검색용 정규화: 대소문자·전각·히라가나/가타카나·띄어쓰기·기호 차이 무시
const norm = (s) =>
  s
    .normalize('NFKC')
    // NFKC가 초성 입력(ㅎ)을 조합용 자모(ᄒ)로 바꾸므로 되돌린다
    .replace(/[ᄀ-ᄒ]/g, (c) => CHO[c.charCodeAt(0) - 0x1100])
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s\-'’.,·・&!()「」『』]/g, '');
const chosung = (s) =>
  [...s].map((c) => {
    const i = c.charCodeAt(0) - 0xac00;
    return i >= 0 && i < 11172 ? CHO[Math.floor(i / 588)] : c;
  }).join('');
const isChosung = (s) => /^[ㄱ-ㅎ0-9]+$/.test(s);

function search(q) {
  const tokens = q.trim().split(/\s+/).map(norm).filter(Boolean);
  if (!tokens.length) return [...state.list];
  return state.list.filter((it) => tokens.every((t) => it._hay.includes(t) || (isChosung(t) && it._cho.includes(t))));
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const yen = (n) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const won = (n) => `${(Math.round(n / 100) * 100).toLocaleString('ko-KR')}원`;
const inCart = (it) => it.ja in state.cart;

// 제품 사진은 외부 이미지라 막히면 검색 썸네일 → 그래도 안 되면 분류 이모지로 바꾼다
function pic(it, cls = 'pic') {
  const fallback = `<span class="${cls} none">${CATS[it.cat][1]}</span>`;
  const src = it.img || it.thumb;
  if (!src) return fallback;
  return `<img class="${cls}" src="${esc(src)}" data-alt="${esc(it.thumb)}" data-cat="${it.cat}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
}
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.cat) return;
  if (img.dataset.alt && img.src !== img.dataset.alt) { img.src = img.dataset.alt; img.dataset.alt = ''; return; }
  img.replaceWith(Object.assign(document.createElement('span'), { className: `${img.className} none`, textContent: CATS[img.dataset.cat][1] }));
}, true);

const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>';

// 한국 반입 금지·주의 표시 (warn: { level: 'ban' | 'caution', reason })
const TAG = { ban: '반입금지', caution: '주의' };
const tag = (it) => (it.warn ? `<span class="tag ${it.warn.level}">${TAG[it.warn.level]}</span>` : '');

function row(it) {
  return `
  <li class="row${inCart(it) ? ' in' : ''}${it.warn?.level === 'ban' ? ' banned' : ''}" data-id="${it.id}">
    <div class="head">
      ${pic(it)}
      <div class="body">
        <p class="name">${tag(it)}<span>${esc(it.ko)}</span></p>
        <p class="sub">${esc(it.ja)}</p>
        <p class="pp"><b>${yen(it.price)}</b><span class="krw">${won(it.price * state.rate)}</span><span class="where">${esc(it.where)}</span></p>
      </div>
      <button type="button" class="pick" aria-label="${inCart(it) ? '목록에서 빼기' : '쇼핑 목록에 담기'}">${inCart(it) ? CHECK : PLUS}</button>
    </div>
  </li>`;
}

// ---------- 면세·반입 팁 ----------
// 규정은 2026년 11월 기준. 바뀌면 이 함수만 고친다.
function tipsHtml() {
  const banned = state.list.filter((it) => it.warn?.level === 'ban');
  const link = (u, t) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`;
  return `
  <section>
    <h2>🇯🇵 일본 면세 <small>2026.11.1부터 환급 방식</small></h2>
    <p class="lead">매장에서 바로 깎아 주던 면세가 끝났어요. <b>세금까지 다 내고 사고, 출국할 때 공항에서 돌려받는</b> 방식이에요.</p>
    <ol>
      <li><b>같은 날 같은 매장에서 세금 제외 ¥5,000 이상</b>(세금 포함 약 ¥5,500)이면 대상이에요. 화장품·식품 같은 소모품과 일반 물건을 합쳐도 되고, 소모품 ¥50만 상한은 없어졌어요.</li>
      <li>계산할 때 <b>여권을 보여 주고</b> 세금 포함 가격으로 결제해요. 환급받을 방법(카드 등)을 이때 등록하는 매장이 많아요.</li>
      <li>출국하는 날 <b>짐을 부치기 전에</b> 출국장 세관 키오스크에서 여권을 스캔해요. GREEN이면 끝, RED면 물건을 보여 줘야 해요. <b>짐을 먼저 부치면 환급을 못 받아요.</b></li>
      <li>세관 확인이 끝나면 등록한 방법으로 소비세(10%, 식품 8%)를 돌려받아요. 수수료를 떼는 곳도 있어요.</li>
    </ol>
    <div class="callout">
      <p><b>꼭 지킬 것</b></p>
      <ul>
        <li>영수증 한 장에 적힌 물건 중 <b>하나라도 없으면 그 영수증 전체</b>가 환급이 안 돼요. 여행 중에 먹거나 쓸 건 따로 계산하세요.</li>
        <li>면세로 산 화장품·과자·약은 <b>출국 전에 뜯거나 쓰면 안 돼요.</b></li>
        <li>산 날부터 <b>90일 안에</b> 출국해야 해요.</li>
        <li>공항 세관 줄이 길 수 있으니 <b>평소보다 일찍</b> 가세요.</li>
      </ul>
    </div>
    <p class="tip">💡 드럭스토어는 한 곳에서 몰아 사서 ¥5,000을 넘기는 게 유리해요. 돈키호테처럼 여러 층인 매장은 계산대 한 곳에서 합쳐 계산하면 돼요.</p>
  </section>

  <section>
    <h2>🇰🇷 한국 입국 면세 한도</h2>
    <table>
      <tr><th>기본</th><td>1인 <b>$800</b> 이하</td></tr>
      <tr><th>술</th><td>병 수 상관없이 <b>합계 2L · $400</b> 이하 (기본 한도와 별도)</td></tr>
      <tr><th>담배</th><td>궐련 200개비 (별도)</td></tr>
      <tr><th>향수</th><td>100mL (별도)</td></tr>
      <tr><th>의약품</th><td>본인이 쓸 만큼, 품목당 <b>6병(통) 이하</b> 또는 3개월분</td></tr>
    </table>
    <p class="tip">💡 한도를 넘으면 입국할 때 <b>자진 신고</b>하세요. 관세 30%를 깎아 주고(최대 20만 원), 신고 안 하고 걸리면 가산세 40%가 붙어요.</p>
  </section>

  <section>
    <h2>🚫 한국에 가져올 수 없는 것</h2>
    <ul>
      <li><b>마약류 성분이 든 일본 약</b> — 알릴이소프로필아세틸요소(이브 등 진통제), 코데인·디히드로코데인(파브론 골드 등 감기약), 슈도에페드린(벤자블록 L 등). 제품 이름이 아니라 <b>성분</b>으로 판단하니 같은 브랜드도 제품마다 달라요.</li>
      <li><b>고기가 든 식품</b> — 부타망·만두·슈마이·육포·소시지·햄·고기 든 레토르트 카레 등 축산물은 검역증명서 없이 반입 금지예요. 걸리면 과태료가 수백만 원이에요(2026년 고기맛 컵라면 500만 원 부과 사례).</li>
      <li><b>컵라면은 건더기를 보세요</b> — 고기 건더기(다진 고기·차슈)가 든 컵누들·UFO·페양구 등은 금지, 분말·액상 스프만 든 봉지라면은 가능해요. 애매하면 입국할 때 검역 신고하세요.</li>
      <li><b>양귀비씨(けしの実)가 든 식품</b> — 케시모치, 일부 시치미 등. 마약류로 분류돼요. 대마씨(麻の実)가 든 시치미도 압수될 수 있어요.</li>
      <li><b>생과일·채소·씨앗·흙·살아 있는 식물</b></li>
    </ul>
    ${banned.length ? `<p class="lead">이 목록에서 반입 금지로 표시한 제품 <b>${banned.length}개</b>: ${banned.map((it) => esc(it.ko)).join(', ')}</p>` : ''}
  </section>

  <section>
    <h2>✈️ 짐 쌀 때</h2>
    <ul>
      <li><b>칼·가위·면도날</b>은 부치는 짐으로. 기내 반입 안 돼요.</li>
      <li><b>보조배터리·리튬 배터리</b>는 반드시 들고 타는 짐으로. 2026년 4월부터 1인 2개·160Wh 이하만 되고, 기내에서 충전·사용은 금지예요.</li>
      <li><b>표백제(하이터·카비키라 등)</b>는 기내·위탁 모두 비행기에 실을 수 없어요.</li>
      <li><b>100mL 넘는 액체·젤·스프레이</b>(화장수, 샴푸, 술 등)는 부치는 짐으로.</li>
      <li>면세 환급받을 물건은 <b>세관 확인 뒤에</b> 부치는 짐에 넣으세요.</li>
    </ul>
  </section>

  <p class="src">출처: ${link('https://pievat.com/tourist-contents/tax-free-system-changes-2026', 'PIE VAT 면세 개정 해설')} · ${link('https://www.japan.travel/ko/kr/topic/2026nyeon-11weol-1ilbuteo-sobise-myeonse-jedoga-byeongyeongdoebnida/', 'JNTO')} · ${link('https://matcha-jp.com/ko/27460', 'MATCHA')} · ${link('https://www.customs.go.kr', '관세청')} · ${link('https://www.qia.go.kr', '농림축산검역본부')} · ${link('https://airport.kr/ap_ko/916/subview.do', '인천공항 검역 안내')} · ${link('https://www.molit.go.kr/USR/policyTarget/dtl.jsp?idx=209', '국토교통부 항공 반입금지')} · ${link('https://whic.mofa.go.kr/whic/safety/info_view.jsp?idx=16961', '영사관 일본 의약품 안내')}. 규정은 바뀔 수 있으니 출발 전에 한 번 더 확인하세요.</p>`;
}

const SORTS = {
  priceAsc: (a, b) => a.price - b.price,
  priceDesc: (a, b) => b.price - a.price,
  name: (a, b) => a.ko.localeCompare(b.ko, 'ko'),
};

function render() {
  const items = search($('#q').value).filter((it) =>
    (state.cat === 'all' || it.cat === state.cat)
    && (state.store === 'all' || it._stores.includes(state.store))
    && !(state.hideBan && it.warn?.level === 'ban'));
  if (SORTS[state.sort]) items.sort(SORTS[state.sort]);
  $('#list').innerHTML = items.length
    ? items.map(row).join('')
    : `<li class="empty">찾는 제품이 없어요. 일본어 이름으로도 검색해 보세요.</li>`;
  $('#count').textContent = `${items.length}개`;
  $('#hideBan').classList.toggle('on', state.hideBan);
}

function renderStores() {
  const count = (k) => state.list.filter((it) => it._stores.includes(k)).length;
  $('#store').innerHTML = `<option value="all">모든 구매처</option>`
    + STORES.map(([k, label]) => `<option value="${k}">${label} (${count(k)})</option>`).join('');
  $('#store').value = state.store;
}

function renderCats() {
  $('#cats').innerHTML = [['all', '전체'], ...Object.entries(CATS).map(([k, [label]]) => [k, label])]
    .map(([k, label]) => `<button type="button" data-cat="${k}" class="${state.cat === k ? 'on' : ''}">${label}</button>`).join('');
}

function renderRate() {
  $('#rate').textContent = `환율 ¥100 = ${(state.rate * 100).toFixed(1)}원`;
}

async function loadRate() {
  const at = Number(localStorage.getItem('krwPerJpyAt')) || 0;
  if (Date.now() - at < RATE_TTL) return;
  try {
    const d = await (await fetch('https://open.er-api.com/v6/latest/JPY')).json();
    if (d.result !== 'success' || !d.rates?.KRW) return;
    state.rate = d.rates.KRW;
    localStorage.setItem('krwPerJpy', state.rate);
    localStorage.setItem('krwPerJpyAt', Date.now());
    renderRate();
    render();
    renderCart();
  } catch {
    // 오프라인이면 저장된 환율 사용
  }
}

// ---------- 쇼핑 목록 ----------
function cartItems() {
  return state.list.filter(inCart);
}

function renderCart() {
  const items = cartItems();
  const bar = $('#cartbar');
  bar.hidden = !items.length;
  if (!items.length) return;
  const sum = items.reduce((n, it) => n + it.price, 0);
  const bought = items.filter((it) => state.cart[it.ja]).length;
  bar.querySelector('.sum').textContent = `${items.length}개 · ${yen(sum)}`;
  bar.querySelector('.flag').textContent = bought === items.length ? '다 샀어요' : bought ? `${bought}개 샀음` : '';
}

// 반입 금지 품목은 한 번 더 확인하고 담는다 (일본에서 쓸 용도일 수도 있어서 막지는 않는다)
function toggleCart(it) {
  if (inCart(it)) delete state.cart[it.ja];
  else if (it.warn?.level === 'ban' && !confirm(`${it.ko}은(는) 한국에 가져갈 수 없는 품목이에요.\n${it.warn.reason}\n\n일본에서 쓸 용도로 담을까요?`)) return false;
  else state.cart[it.ja] = false;
  saveCart();
  return true;
}

// 면세 기준은 세금 제외 금액. 식품은 소비세 8%, 술·그 밖의 물건은 10%로 보고 뺀다
const TAX_FREE_MIN = 5000;
const isAlcohol = (it) => /주류/.test(it.warn?.reason || '');
const exTax = (it) => it.price / ((['snack', 'kansai'].includes(it.cat) || (it.cat === 'food' && !isAlcohol(it))) ? 1.08 : 1.1);

function cartRow(it) {
  return `
        <li class="${state.cart[it.ja] ? 'bought' : ''}" data-ja="${esc(it.ja)}">
          <label><input type="checkbox" ${state.cart[it.ja] ? 'checked' : ''} /><span class="nm">${tag(it)}${esc(it.ko)}</span></label>
          <span class="yen">${yen(it.price)}</span>
          <button type="button" class="del" aria-label="빼기">✕</button>
        </li>`;
}

function openCart() {
  const items = cartItems();
  if (!items.length) return $('#cart').close();
  const sum = items.reduce((n, it) => n + it.price, 0);
  const done = items.filter((it) => state.cart[it.ja]).length;
  // 같은 구매처끼리 묶어서, 한 매장에서 다 산다고 할 때 면세 기준을 넘는지 보여 준다
  const groups = STORES.map(([k, label]) => [label, items.filter((it) => it._store === k)]).filter(([, list]) => list.length);
  $('#cart .content').innerHTML = `
    <h2 tabindex="-1">쇼핑 목록 <small>${items.length}개</small></h2>
    <div class="meter" style="--w:${(done / items.length) * 100}%">
      <p><span>산 것</span><b>${done} / ${items.length}</b></p><i></i>
    </div>
    <div class="meter">
      <p><span>예상 합계</span><b>${yen(sum)} · ${won(sum * state.rate)}</b></p>
    </div>
    ${groups.map(([label, list]) => {
      const total = list.reduce((n, it) => n + it.price, 0);
      const ex = list.reduce((n, it) => n + exTax(it), 0);
      const left = Math.ceil(TAX_FREE_MIN - ex);
      return `
    <section class="store">
      <h3><span>${label}</span><small>${yen(total)}</small>${left <= 0 ? '<em class="ok">면세 가능</em>' : `<em>면세까지 ${yen(left)}</em>`}</h3>
      <ul class="items">${list.map(cartRow).join('')}</ul>
    </section>`;
    }).join('')}
    ${items.some((it) => it.warn?.level === 'ban') ? `<p class="note ban">반입금지 표시가 있는 물건은 한국에 가져갈 수 없어요. 일본에서 다 쓰거나 두고 오세요.</p>` : ''}
    <p class="note">면세는 <b>같은 날 같은 매장</b>에서 세금 제외 ¥5,000 이상일 때예요. 구매처별 합계는 한 매장에서 다 산다고 가정한 값이고, 세금은 식품 8%·그 외 10%로 계산했어요. 환급받을 물건은 수하물을 부치기 전에 공항 세관 확인을 받아야 해요.</p>
    <div class="actions">
      <button type="button" data-act="clear">비우기</button>
      <button type="button" class="primary" data-act="close">닫기</button>
    </div>`;
  if (!$('#cart').open) $('#cart').showModal();
  $('#cart h2').focus();
}

$('#cart').addEventListener('change', (e) => {
  const li = e.target.closest('[data-ja]');
  if (!li) return;
  state.cart[li.dataset.ja] = e.target.checked;
  saveCart();
  openCart();
  renderCart();
});
$('#cart').addEventListener('click', (e) => {
  if (e.target === $('#cart')) return $('#cart').close();
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'close') return $('#cart').close();
  if (act === 'clear') {
    if (!confirm('쇼핑 목록을 모두 비울까요?')) return;
    state.cart = {};
  } else if (e.target.closest('.del')) {
    delete state.cart[e.target.closest('[data-ja]').dataset.ja];
  } else return;
  saveCart();
  render();
  renderCart();
  openCart();
});
$('#cartbar').addEventListener('click', openCart);

// ---------- 제품 상세 ----------
function openViewer(it) {
  $('#viewer .content').innerHTML = `
    <div class="photo">${pic(it, 'big')}</div>
    <div class="info">
      <p class="ja">${esc(it.ja)}</p>
      <p class="ko">${esc(it.ko)}</p>
      ${it.warn ? `<p class="alert ${it.warn.level}"><b>${it.warn.level === 'ban' ? '한국에 가져갈 수 없어요' : '가져갈 때 주의'}</b>${esc(it.warn.reason)}</p>` : ''}
      <p class="ask">これはどこにありますか？<small>이거 어디에 있나요? — 점원에게 이 화면을 보여 주세요</small></p>
      <dl>
        <dt>참고가</dt><dd>${yen(it.price)} · ${won(it.price * state.rate)}</dd>
        <dt>살 수 있는 곳</dt><dd>${esc(it.where)}</dd>
      </dl>
      <div class="actions">
        <a href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent(it.ja)}" target="_blank" rel="noopener">사진 더 보기</a>
        <button type="button" class="primary${inCart(it) ? ' in' : ''}" data-id="${it.id}">${inCart(it) ? '목록에서 빼기' : '쇼핑 목록에 담기'}</button>
      </div>
    </div>`;
  $('#viewer').showModal();
}
$('#viewer').addEventListener('click', (e) => {
  if (e.target === $('#viewer')) return $('#viewer').close();
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  if (!toggleCart(state.list[+b.dataset.id])) return;
  render();
  renderCart();
  $('#viewer').close();
});

// ---------- 목록 이벤트 ----------
$('#list').addEventListener('click', (e) => {
  const li = e.target.closest('.row');
  if (!li) return;
  const it = state.list[+li.dataset.id];
  if (e.target.closest('.pick')) {
    if (!toggleCart(it)) return;
    li.outerHTML = row(it);
    renderCart();
    return;
  }
  openViewer(it);
});
$('#cats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  state.cat = b.dataset.cat;
  renderCats();
  render();
  window.scrollTo({ top: 0 });
});
$('#q').addEventListener('input', render);

function openTips() {
  $('#tips .content').innerHTML = tipsHtml();
  $('#tips').showModal();
  $('#tips').scrollTop = 0;
}
$('#tipsBtn').addEventListener('click', openTips);
$('#tips').addEventListener('click', (e) => {
  if (e.target === $('#tips') || e.target.closest('.close')) $('#tips').close();
});
$('#store').addEventListener('change', () => {
  state.store = $('#store').value;
  localStorage.setItem('jp-shop-store', state.store);
  render();
});
$('#hideBan').addEventListener('click', () => {
  state.hideBan = !state.hideBan;
  localStorage.setItem('jp-shop-hideban', state.hideBan ? '1' : '');
  render();
});
$('#sort').value = state.sort;
$('#sort').addEventListener('change', () => {
  state.sort = $('#sort').value;
  localStorage.setItem('jp-shop-sort', state.sort);
  render();
});

try {
  const d = await (await fetch('data.json', { cache: 'no-cache' })).json();
  state.list = d.items.map((it, id) => {
    const names = [it.ko, it.ja].map(norm);
    const parts = it.where.split('·');
    return {
      ...it, id,
      _hay: names.join('|') + '|' + norm(it.where),
      _cho: chosung(it.ko.replace(/\s/g, '')),
      _stores: [...new Set(parts.map(storeOf))],
      _store: storeOf(parts[0]),
    };
  });
} catch {
  $('#list').innerHTML = '<li class="empty">목록을 불러오지 못했어요.</li>';
}
renderCats();
renderStores();
renderRate();
render();
renderCart();
loadRate();
if (location.hash === '#tips') openTips();

// 오프라인에서도 열리게 서비스 워커 등록 (범위는 /jp-shop/ 아래)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
