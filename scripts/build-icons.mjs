// 프로필 README의 기술 스택 아이콘 줄을 SVG 한 장으로 만든다.
// skillicons.dev에 없는 아이콘(Swagger, PWA)은 simple-icons 로고로 같은 모양(어두운 둥근 사각형)을 만들어 끼운다.
// 사용법: node scripts/build-icons.mjs   → icons/<줄 이름>.svg   (스택이 바뀔 때만 다시 실행)
import { mkdir, writeFile } from 'node:fs/promises';

const ROWS = {
  tools: ['git', 'github', 'githubactions', 'docker', 'ubuntu', 'aws', 'vite', 'figma', 'si:swagger', 'si:pwa'],
};

// simple-icons 로고 색. skillicons처럼 어두운 배경에서 잘 보이는 색을 쓴다.
const CUSTOM_COLORS = { swagger: '#85EA2D', pwa: '#ffffff' };
const SIZE = 256;
const PITCH = 300; // skillicons와 같은 아이콘 간격
const HEIGHT = 48;

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

// skillicons 단일 아이콘 응답에서 안쪽 <svg>만 꺼낸다
async function skillIcon(id) {
  const svg = await get(`https://skillicons.dev/icons?i=${id}`);
  const m = svg.match(/<g transform="translate\(0, 0\)">\s*([\s\S]*?)\s*<\/g>\s*<\/svg>\s*$/);
  if (!m) throw new Error(`skillicons ${id}: 형식이 예상과 다름`);
  return m[1];
}

async function simpleIcon(slug) {
  const svg = await get(`https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg`);
  const d = svg.match(/<path d="([^"]+)"/)?.[1];
  if (!d) throw new Error(`simple-icons ${slug}: path 없음`);
  // 24x24 로고를 256 칸 가운데 180px로
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" fill="none" viewBox="0 0 ${SIZE} ${SIZE}">`
    + `<rect width="${SIZE}" height="${SIZE}" rx="60" fill="#242938"/>`
    + `<path transform="translate(38 38) scale(7.5)" fill="${CUSTOM_COLORS[slug]}" d="${d}"/></svg>`;
}

await mkdir('icons', { recursive: true });
for (const [name, ids] of Object.entries(ROWS)) {
  const icons = await Promise.all(ids.map((id) => (id.startsWith('si:') ? simpleIcon(id.slice(3)) : skillIcon(id))));
  const vbW = ids.length * PITCH - (PITCH - SIZE);
  const body = icons.map((svg, i) => `<g transform="translate(${i * PITCH}, 0)">${svg}</g>`).join('\n');
  const out = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${(vbW / SIZE) * HEIGHT}" height="${HEIGHT}" viewBox="0 0 ${vbW} ${SIZE}" fill="none" version="1.1">\n${body}\n</svg>\n`;
  await writeFile(`icons/${name}.svg`, out);
  console.log(`icons/${name}.svg (${ids.length}개)`);
}
