const $ = (s) => document.querySelector(s);
const CATS = {
  med: ['의약품', '💊'], beauty: ['화장품', '🧴'], daily: ['생활', '🧼'], snack: ['과자', '🍫'],
  food: ['식품·술', '🍜'], goods: ['잡화', '🍳'], stationery: ['문구', '✏️'], kansai: ['간사이', '🏯'],
};
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
  cat: 'all',
  sort: localStorage.getItem('jp-shop-sort') || 'default',
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

function row(it) {
  return `
  <li class="row${inCart(it) ? ' in' : ''}" data-id="${it.id}">
    <div class="head">
      ${pic(it)}
      <div class="body">
        <p class="name">${esc(it.ko)}</p>
        <p class="sub">${esc(it.ja)}</p>
        <p class="pp"><b>${yen(it.price)}</b><span class="krw">${won(it.price * state.rate)}</span><span class="where">${esc(it.where)}</span></p>
      </div>
      <button type="button" class="pick" aria-label="${inCart(it) ? '목록에서 빼기' : '쇼핑 목록에 담기'}">${inCart(it) ? CHECK : PLUS}</button>
    </div>
  </li>`;
}

const SORTS = {
  priceAsc: (a, b) => a.price - b.price,
  priceDesc: (a, b) => b.price - a.price,
  name: (a, b) => a.ko.localeCompare(b.ko, 'ko'),
};

function render() {
  const items = search($('#q').value).filter((it) => state.cat === 'all' || it.cat === state.cat);
  if (SORTS[state.sort]) items.sort(SORTS[state.sort]);
  $('#list').innerHTML = items.length
    ? items.map(row).join('')
    : `<li class="empty">찾는 제품이 없어요. 일본어 이름으로도 검색해 보세요.</li>`;
  $('#count').textContent = `${items.length}개`;
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

function toggleCart(it) {
  if (inCart(it)) delete state.cart[it.ja];
  else state.cart[it.ja] = false;
  saveCart();
}

function openCart() {
  const items = cartItems();
  if (!items.length) return $('#cart').close();
  const sum = items.reduce((n, it) => n + it.price, 0);
  const left = items.filter((it) => !state.cart[it.ja]);
  const done = items.length - left.length;
  $('#cart .content').innerHTML = `
    <h2 tabindex="-1">쇼핑 목록 <small>${items.length}개</small></h2>
    <div class="meter" style="--w:${(done / items.length) * 100}%">
      <p><span>산 것</span><b>${done} / ${items.length}</b></p><i></i>
    </div>
    <div class="meter">
      <p><span>예상 합계</span><b>${yen(sum)} · ${won(sum * state.rate)}</b></p>
    </div>
    <ul class="items">
      ${items.map((it) => `
        <li class="${state.cart[it.ja] ? 'bought' : ''}" data-ja="${esc(it.ja)}">
          <label><input type="checkbox" ${state.cart[it.ja] ? 'checked' : ''} /><span class="nm">${esc(it.ko)} <small>${esc(it.where)}</small></span></label>
          <span class="yen">${yen(it.price)}</span>
          <button type="button" class="del" aria-label="빼기">✕</button>
        </li>`).join('')}
    </ul>
    <p class="note">한 매장에서 세금 제외 ¥5,000(세금 포함 약 ¥5,500) 이상이면 면세 환급 대상이에요. 체크하면 산 것으로 표시돼요.</p>
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
  toggleCart(state.list[+b.dataset.id]);
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
    toggleCart(it);
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
    return { ...it, id, _hay: names.join('|') + '|' + norm(it.where), _cho: chosung(it.ko.replace(/\s/g, '')) };
  });
} catch {
  $('#list').innerHTML = '<li class="empty">목록을 불러오지 못했어요.</li>';
}
renderCats();
renderRate();
render();
renderCart();
loadRate();
