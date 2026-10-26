// ============================================================
//  나선 시네마 서버 — Render 같은 곳에서 계속 켜 두는 버전
//  같은 폴더의 index.html 안에 있는 서버 코드(예약·투표·좌석·가방·주먹다짐 판정)를
//  그대로 꺼내 써요. 그래서 index.html만 고쳐 올려도 서버가 같이 바뀌어요.
//
//  운영진 비밀번호: Render의 Environment 설정에 ADMIN_PASSWORD 를 넣으면 돼요.
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const shared = html.match(/\/\*@shared-start\*\/([\s\S]*?)\/\*@shared-end\*\//);
if (!shared) throw new Error('index.html에서 서버 코드를 찾지 못했어요. 같은 폴더에 최신 index.html을 올려 주세요.');

// 무료 서버는 디스크가 없어서 게시판 등은 메모리에만 저장 (서버가 잠들면 초기화)
const memory = new Map();
const sandbox = {
  console, setTimeout, setInterval, clearTimeout, clearInterval, queueMicrotask, URL, structuredClone,
  crypto: globalThis.crypto,
  localStorage: {
    getItem: k => (k === 'starlight:adminpw' ? (process.env.ADMIN_PASSWORD || '') : (memory.has(k) ? memory.get(k) : null)),
    setItem: (k, v) => { if (k !== 'starlight:adminpw') memory.set(k, String(v)); },
  },
};
vm.createContext(sandbox);
const { CONFIG, CinemaServer } = vm.runInContext(shared[1] + '\n;({ CONFIG, CinemaServer })', sandbox, { filename: 'index.html' });

// 페이지에 '서버 모드' 표시를 붙여서 보냄 → 브라우저가 이 서버에 웹소켓으로 붙음
const page = html.replace('<head>', '<head>\n<script>window.__WS_SERVER__ = true;</script>');
const httpServer = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(page);
  }
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('없는 주소예요');
});

const sockets = new Map();
function send(to, msg) {
  const data = JSON.stringify(msg);
  if (to === '*') { for (const ws of sockets.values()) if (ws.readyState === 1) ws.send(data); }
  else { const ws = sockets.get(to); if (ws && ws.readyState === 1) ws.send(data); }
}
const cinema = new CinemaServer(send, null);

let seq = 0;
const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', ws => {
  const id = 'w-' + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
  sockets.set(id, ws);
  ws.on('message', raw => { let m; try { m = JSON.parse(raw); } catch { return; } cinema.receive(id, m); });
  ws.on('close', () => { sockets.delete(id); cinema.receive(id, { t: 'bye' }); });
  ws.on('error', () => {});
});

httpServer.listen(PORT, () => console.log(`${CONFIG.ROOM_NAME} 서버가 ${PORT}번 포트에서 켜졌어요`));
