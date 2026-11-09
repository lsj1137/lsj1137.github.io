// github-readme-stats(lsj1137 fork)의 카드 핸들러를 서버 없이 호출해 SVG 파일로 저장한다.
// GitHub Pages는 정적 파일만 서빙하므로, Actions가 주기적으로 그려서 stats/*.svg 로 커밋한다.
// 사용법: node scripts/render-stats.mjs <readme-stats 체크아웃 경로> <출력 폴더>
// 토큰은 환경변수 PAT_1 (readme-stats 규약)로 받는다.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [statsDir, outDir] = process.argv.slice(2);
if (!statsDir || !outDir) { console.error('사용법: render-stats.mjs <readme-stats 경로> <출력 폴더>'); process.exit(1); }
if (!process.env.PAT_1) { console.error('환경변수 PAT_1 없음'); process.exit(1); }

// 프로필 README에서 쓰는 카드. 대시보드(render-dashboard.mjs)와 같은 보라·청록 색감으로 다크/라이트 2벌씩 만든다.
const base = { username: 'lsj1137', hide_border: 'true', title_color: '7c5cff', icon_color: '22d3ee', ring_color: '7c5cff' };
const palettes = {
  dark: { bg_color: '0d1117', text_color: 'e6edf3' },
  light: { bg_color: 'ffffff', text_color: '1f2328' },
};
const cards = Object.entries(palettes).flatMap(([mode, colors]) => [
  { file: `stats-${mode}.svg`, handler: 'api/index.js', query: { ...base, ...colors, show_icons: 'true' } },
  { file: `top-langs-${mode}.svg`, handler: 'api/top-langs.js', query: { ...base, ...colors, layout: 'compact', langs_count: '8' } },
]);
// 예전 README 링크 호환용 기본 카드
cards.push({ file: 'stats.svg', handler: 'api/index.js', query: { username: 'lsj1137' } });

let failed = false;
for (const { file, handler, query } of cards) {
  const { default: render } = await import(pathToFileURL(path.resolve(statsDir, handler)).href);
  let body = '';
  // 템플릿 문자열이라 앞에 공백·줄바꿈이 붙어 나온다
  const res = { setHeader() {}, status() { return res; }, send(b) { body = String(b).trim(); return res; } };
  await render({ query }, res);

  // 실패해도 핸들러는 에러 카드 SVG를 돌려주므로 내용으로 판별한다. 기존 정상 카드는 덮어쓰지 않는다.
  if (!body.startsWith('<svg') || body.includes('Something went wrong')) {
    console.error(`${file}: 생성 실패`);
    failed = true;
    continue;
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, file), body);
  console.log(`${file}: ${body.length} bytes`);
}
process.exit(failed ? 1 : 0);
