// 지하 매장처럼 인터넷이 약한 곳에서도 목록·쇼핑 목록·팁이 열리게 캐시한다.
// 앱 파일을 바꿨는데 반영이 안 되면 CACHE 버전을 올린다.
const CACHE = 'jp-shop-v2';
const IMG_CACHE = 'jp-shop-img';
// 제품 사진은 외부 사이트 이미지라 본 것만 담아 두고, 너무 많아지면 오래된 것부터 지운다
const IMG_MAX = 400;
const SHELL = ['./', 'app.js', 'style.css', 'data.json', 'manifest.webmanifest', 'icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== IMG_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith(new URL('./', location).pathname)) e.respondWith(networkFirst(req));
  } else if (req.destination === 'image') {
    e.respondWith(imageCache(req));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(cacheFirst(req));
  }
});

// 글꼴: 거의 안 바뀌니 캐시 우선
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function imageCache(req) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - IMG_MAX))) await cache.delete(k);
  }
  return res;
}

// 앱 파일·목록 데이터: 최신을 받되, 캐시가 있으면 3초까지만 기다리고 캐시로 보여준다
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  try {
    const net = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    return await (hit ? Promise.race([net, new Promise((_, rej) => setTimeout(rej, 3000))]) : net);
  } catch {
    return hit ?? (await cache.match('./')) ?? Response.error();
  }
}
