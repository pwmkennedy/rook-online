'use strict';
// Rook Online: serves the page and runs every table on the server so nobody can see anyone else's cards.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { createEngine } = require('./engine');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const BOTS = ['Robin', 'Wren', 'Jay', 'Finch'];
const LEVELS = ['easy', 'medium', 'hard'];
const AWAY_AFTER_MS = 20000;
const SPEED = Number(process.env.ROOK_SPEED) || 1; // lower = faster computer players (for testing)

/* ---------- static files ---------- */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  const rel = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
  const fp = path.normalize(path.join(PUB, rel));
  if (!fp.startsWith(PUB)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUB, 'index.html'), (e2, d2) => {
        res.writeHead(e2 ? 404 : 200, { 'Content-Type': TYPES['.html'] });
        res.end(e2 ? 'Not found' : d2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

/* ---------- tables ---------- */
const rooms = new Map();
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c));
  return c;
}
const cleanName = s => String(s || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

class Room {
  constructor(level) {
    this.code = newCode();
    this.seats = [0, 1, 2, 3].map(() => ({ id: null, name: null, connected: false, away: false, awayTimer: null }));
    this.level = LEVELS.includes(level) ? level : 'medium';
    this.clients = new Set();
    this.started = false;
    this.timer = null;
    this.events = [];
    this.touched = Date.now();
    this.engine = createEngine({
      names: () => this.seats.map((s, i) => (s.id ? s.name : BOTS[i])),
      isHuman: p => !!this.seats[p].id && !this.seats[p].away,
      level: () => this.level,
      onEvent: ev => this.events.push(ev),
    });
    rooms.set(this.code, this);
  }
  seatOf(id) { return this.seats.findIndex(s => s.id === id); }
  viewFor(id) {
    const me = this.seatOf(id);
    return {
      code: this.code, level: this.level, started: this.started, me: me < 0 ? null : me,
      seats: this.seats.map((s, i) => ({ name: s.id ? s.name : BOTS[i], human: !!s.id, connected: s.connected, away: s.away, you: !!id && s.id === id })),
      game: this.started ? this.engine.view(me < 0 ? null : me) : null,
    };
  }
  broadcast() {
    const events = this.events; this.events = [];
    for (const ws of this.clients) send(ws, { type: 'state', view: this.viewFor(ws.clientId), events });
    this.touched = Date.now();
  }
  step() {
    clearTimeout(this.timer);
    if (!this.started) return;
    const p = this.engine.pending();
    if (!p) return;
    this.timer = setTimeout(() => {
      try { p.run(); } catch (e) { console.error('step failed', e); }
      this.broadcast();
      this.step();
    }, p.delay * SPEED);
  }
  sit(ws, seat) {
    const s = this.seats[seat];
    if (!s || (s.id && s.id !== ws.clientId)) return 'That seat is taken.';
    const cur = this.seatOf(ws.clientId);
    if (cur === seat) return null;
    if (cur >= 0) this.vacate(cur);
    s.id = ws.clientId; s.name = ws.name; s.connected = true; s.away = false;
    return null;
  }
  vacate(seat) {
    const s = this.seats[seat];
    clearTimeout(s.awayTimer);
    Object.assign(s, { id: null, name: null, connected: false, away: false, awayTimer: null });
  }
  destroy() { clearTimeout(this.timer); for (const s of this.seats) clearTimeout(s.awayTimer); rooms.delete(this.code); }
}

function leaveRoom(ws, { vacate }) {
  const r = ws.room; if (!r) return;
  r.clients.delete(ws); ws.room = null;
  const seat = r.seatOf(ws.clientId);
  if (seat >= 0) {
    // Another open tab for the same player keeps the seat connected.
    const stillHere = [...r.clients].some(c => c.clientId === ws.clientId);
    if (vacate) r.vacate(seat);
    else if (!stillHere) {
      const s = r.seats[seat];
      s.connected = false;
      clearTimeout(s.awayTimer);
      s.awayTimer = setTimeout(() => { s.away = true; r.broadcast(); r.step(); }, AWAY_AFTER_MS);
    }
  }
  r.broadcast(); r.step();
}

function joinRoom(ws, r) {
  if (ws.room && ws.room !== r) leaveRoom(ws, { vacate: false });
  ws.room = r; r.clients.add(ws);
  const seat = r.seatOf(ws.clientId);
  if (seat >= 0) {
    const s = r.seats[seat];
    clearTimeout(s.awayTimer); s.awayTimer = null;
    s.connected = true; s.away = false; if (ws.name) s.name = ws.name;
  } else {
    const free = r.seats.findIndex(s => !s.id);
    if (free >= 0) r.sit(ws, free);
  }
  send(ws, { type: 'joined', code: r.code });
  r.broadcast(); r.step();
}

/* ---------- messages ---------- */
function handle(ws, m) {
  const r = ws.room;
  switch (m.type) {
    case 'hello':
      ws.clientId = typeof m.id === 'string' && /^[\w-]{8,40}$/.test(m.id) ? m.id : crypto.randomUUID();
      ws.name = cleanName(m.name) || 'Player';
      return;
    case 'ping': return;
    case 'name':
      ws.name = cleanName(m.name) || ws.name;
      if (r) { const i = r.seatOf(ws.clientId); if (i >= 0) r.seats[i].name = ws.name; r.broadcast(); }
      return;
    case 'create': {
      if (m.name) ws.name = cleanName(m.name) || ws.name;
      const room = new Room(m.level);
      return joinRoom(ws, room);
    }
    case 'join': {
      if (m.name) ws.name = cleanName(m.name) || ws.name;
      const room = rooms.get(String(m.code || '').trim().toUpperCase());
      if (!room) return send(ws, { type: 'error', msg: 'No table with that code. Check the code or create a new table.', gone: true });
      return joinRoom(ws, room);
    }
    case 'leave': leaveRoom(ws, { vacate: true }); return send(ws, { type: 'left' });
  }
  if (!r) return send(ws, { type: 'error', msg: 'Join a table first.' });
  switch (m.type) {
    case 'sit': {
      const err = r.sit(ws, Number(m.seat));
      if (err) return send(ws, { type: 'error', msg: err });
      r.broadcast(); return r.step();
    }
    case 'stand': {
      const i = r.seatOf(ws.clientId); if (i >= 0) r.vacate(i);
      r.broadcast(); return r.step();
    }
    case 'level':
      if (LEVELS.includes(m.level)) { r.level = m.level; r.broadcast(); }
      return;
    case 'start':
      if (r.started) return;
      if (r.seatOf(ws.clientId) < 0) return send(ws, { type: 'error', msg: 'Take a seat to start the game.' });
      r.started = true; r.engine.newGame(); r.broadcast(); return r.step();
    case 'act': {
      const p = r.seatOf(ws.clientId);
      if (p < 0) return send(ws, { type: 'error', msg: 'You are watching this table. Take a seat to play.' });
      const err = r.engine.act(p, m.action || {});
      if (err) return send(ws, { type: 'error', msg: err });
      r.broadcast(); return r.step();
    }
  }
}

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
wss.on('connection', ws => {
  ws.clientId = crypto.randomUUID(); ws.name = 'Player'; ws.room = null; ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m && typeof m.type === 'string') { try { handle(ws, m); } catch (e) { console.error('message failed', e); } }
  });
  ws.on('close', () => leaveRoom(ws, { vacate: false }));
});

// Drop dead connections, and tables nobody has looked at for an hour.
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  const now = Date.now();
  for (const r of rooms.values()) if (!r.clients.size && now - r.touched > 60 * 60 * 1000) r.destroy();
}, 30000);

server.listen(PORT, () => console.log('Rook Online listening on port ' + PORT));
