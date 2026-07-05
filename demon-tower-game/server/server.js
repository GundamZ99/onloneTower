// server.js — ศูนย์กลางของเกม Demon Tower
//
// หลักการสำคัญ: "server-authoritative" แปลว่า client ไม่มีสิทธิ์บอก server ว่า
// "ผลลัพธ์คืออะไร" (เช่น "ฉันชนะ ได้ทอง 500") client ทำได้แค่ "ขอทำ action"
// (เช่น "ฉันโจมตีมอนสเตอร์ตัวนี้ด้วยการ์ดนี้") แล้ว server เป็นคนคำนวณผลจริง
// เขียนกลับลง DB เอง — ผลที่ client เห็นคือสิ่งที่ server ส่งกลับมาเท่านั้น
//
// ไฟล์นี้ครอบคลุม: สมัครสมาชิก, ล็อกอิน (JWT), โหลด/บันทึกตัวละครแบบ persistent,
// และตัวอย่าง action เดียว (สู้มอนสเตอร์ฝึกหัด) ที่ทำตามหลัก server-authoritative
// เพื่อเป็นแบบอย่างให้ต่อยอดไปทำ PvP / Co-op ทั้งระบบ

const express = require('express');
const cors = require('cors');
const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const db = require('./db');
const Pvp = require('./pvpManager');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());

// ---------- password hashing (ใช้ crypto ในตัว Node ไม่ต้องพึ่ง bcrypt) ----------
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}
function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
}

// ---------- REST: สมัครสมาชิก ----------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'username ต้อง >=3 ตัวอักษร, password ต้อง >=6 ตัวอักษร' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' });

  const { hash, salt } = hashPassword(password);
  const now = Date.now();
  const info = db.prepare(
    'INSERT INTO users (username, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?)'
  ).run(username, hash, salt, now);

  // สร้างตัวละครตั้งต้นให้ทันที (ค่าเริ่มต้น = ground truth ฝั่ง server ล้วน ๆ)
  db.prepare(`INSERT INTO characters
    (user_id, name, level, hp, max_hp, atk, mag, luk, gold, exp, floor_demon, inventory_json, deck_json, updated_at)
    VALUES (?, ?, 1, 100, 100, 10, 10, 10, 0, 0, 1, '[]', '[]', ?)`
  ).run(info.lastInsertRowid, username, now);

  const token = jwt.sign({ uid: info.lastInsertRowid, username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username });
});

// ---------- REST: ล็อกอิน ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.pass_salt, user.pass_hash)) {
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  const token = jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username: user.username });
});

// ---------- REST: ล็อกอินผ่าน Google ----------
// รับ ID token จาก Google Identity Services (client ฝัง <script src="https://accounts.google.com/gsi/client">)
// ตรวจสอบ token ตรงกับ Google เอง (ไม่เชื่อ payload ที่ client ส่งมาโดยไม่ตรวจ) ผ่าน tokeninfo endpoint —
// เลือกวิธีนี้เพราะไม่ต้องเพิ่ม dependency ใหม่ (ใช้ fetch ที่มีในตัว Node 18+)
app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'ไม่มี idToken' });
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID' });

  let payload;
  try {
    const verifyRes = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
    if (!verifyRes.ok) return res.status(401).json({ error: 'token ไม่ถูกต้อง' });
    payload = await verifyRes.json();
  } catch (e) {
    return res.status(502).json({ error: 'ตรวจสอบ token กับ Google ไม่สำเร็จ: ' + e.message });
  }

  // ตรวจ audience ให้ตรงกับแอปเราเท่านั้น — กัน token จากแอปอื่นถูกเอามาใช้สวมรอย
  if (payload.aud !== GOOGLE_CLIENT_ID) return res.status(401).json({ error: 'token นี้ไม่ได้ออกให้แอปนี้' });
  if (payload.email_verified !== 'true' && payload.email_verified !== true) {
    return res.status(401).json({ error: 'อีเมล Google นี้ยังไม่ได้ยืนยัน' });
  }

  const googleSub = payload.sub;
  const email = payload.email;
  let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(googleSub);

  if (!user) {
    // ผู้ใช้ใหม่ — สร้างบัญชีให้ทันที ตั้งชื่อผู้ใช้จากอีเมล (กันชนกันด้วยการเติมเลขท้ายถ้าซ้ำ)
    let baseUsername = (email ? email.split('@')[0] : 'player').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 12) || 'player';
    let username = baseUsername;
    let n = 1;
    while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      username = baseUsername + n; n++;
    }
    const now = Date.now();
    const info = db.prepare(
      'INSERT INTO users (username, google_sub, email, created_at) VALUES (?, ?, ?, ?)'
    ).run(username, googleSub, email, now);
    db.prepare(`INSERT INTO characters
      (user_id, name, level, hp, max_hp, atk, mag, luk, gold, exp, floor_demon, inventory_json, deck_json, updated_at)
      VALUES (?, ?, 1, 100, 100, 10, 10, 10, 0, 0, 1, '[]', '[]', ?)`
    ).run(info.lastInsertRowid, username, now);
    user = { id: info.lastInsertRowid, username };
  }

  const token = jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username: user.username });
});

// ---------- Middleware: ตรวจ JWT สำหรับ REST endpoint ที่ต้องล็อกอิน ----------
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'ไม่มี token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'token ไม่ถูกต้องหรือหมดอายุ' });
  }
}

// ---------- REST: โหลดตัวละครของตัวเอง ----------
app.get('/api/character', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(req.user.uid);
  if (!row) return res.status(404).json({ error: 'ไม่พบตัวละคร' });
  res.json({
    ...row,
    inventory: JSON.parse(row.inventory_json),
    deck: JSON.parse(row.deck_json),
  });
});

// ---------- REST: (เฉพาะ dev/testing) ตั้งเด็คตัวอย่างให้ตัวละคร ----------
// ระบบสร้าง/แลก/แก้เด็คจริงยังไม่ได้ทำในเฟสนี้ — ใช้ endpoint นี้ตั้งข้อมูลทดสอบ
// เพื่อให้ทดลอง PvP ได้เท่านั้น ห้ามเปิดใช้ endpoint แบบนี้ใน production จริง
app.post('/api/debug/set-demo-deck', authMiddleware, (req, res) => {
  const demoDeck = [
    { name: 'ดาบเพลิง', element: 'fire', power: 18 },
    { name: 'หอกไม้', element: 'wood', power: 16 },
    { name: 'คทาสายน้ำ', element: 'water', power: 17 },
  ];
  db.prepare('UPDATE characters SET deck_json = ?, updated_at = ? WHERE user_id = ?')
    .run(JSON.stringify(demoDeck), Date.now(), req.user.uid);
  res.json({ ok: true, deck: demoDeck });
});

// ---------- Socket.io: การเชื่อมต่อ real-time (ต่อยอด PvP/Co-op ที่นี่) ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ตรวจ JWT ตอนเชื่อมต่อ socket ด้วย (กันคนไม่ได้ล็อกอินยิง event เข้ามา)
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('unauthorized'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.user.username} (${socket.id})`);
  Pvp.registerOnline(socket.user.uid, socket);

  // ---------- PvP: server-authoritative ทั้งหมด (ดู pvpManager.js) ----------
  // client ขอดวลด้วย "ชื่อผู้ใช้" ของคู่ต่อสู้ (แทน Room ID/Peer ID แบบเดิม)
  socket.on('pvp_challenge', ({ targetUsername }) => {
    const targetUser = db.prepare('SELECT id FROM users WHERE username = ?').get(targetUsername);
    if (!targetUser) return socket.emit('pvp_error', { message: 'ไม่พบผู้เล่นชื่อนี้' });
    const result = Pvp.challenge(db, socket.user.uid, socket, targetUser.id);
    if (result.error) socket.emit('pvp_error', { message: result.error });
  });

  // client ส่งแค่ index ของการ์ดที่เลือก — ไม่ส่งผลลัพธ์ใด ๆ มาเอง
  socket.on('pvp_select_card', ({ cardIndex }) => {
    const result = Pvp.selectCard(socket.user.uid, cardIndex);
    if (result.error) socket.emit('pvp_error', { message: result.error });
  });

  socket.on('pvp_leave', () => Pvp.leaveMatch(socket.user.uid));

  // ---------- ตัวอย่าง action ที่เป็น server-authoritative จริง ----------
  // Client ส่งมาแค่ "ฉันขอสู้มอนสเตอร์ฝึกหัด" — ไม่ได้ส่งผลลัพธ์มา
  // Server เป็นคนสุ่ม/คำนวณ/เขียนลง DB เอง แล้วส่งผลจริงกลับไปให้ client แสดง
  socket.on('fight_training_dummy', () => {
    const row = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(socket.user.uid);
    if (!row) return socket.emit('fight_result', { error: 'ไม่พบตัวละคร' });

    // ตัวอย่าง logic ง่าย ๆ: สุ่มผลที่ server ฝั่งเดียว ไคลเอนต์แก้ไขไม่ได้
    const win = Math.random() < 0.8; // 80% ชนะ
    const goldGain = win ? 10 + Math.floor(Math.random() * 15) : 0;
    const expGain = win ? 5 + Math.floor(Math.random() * 5) : 0;

    db.prepare('UPDATE characters SET gold = gold + ?, exp = exp + ?, updated_at = ? WHERE user_id = ?')
      .run(goldGain, expGain, Date.now(), socket.user.uid);

    const updated = db.prepare('SELECT gold, exp, level FROM characters WHERE user_id = ?').get(socket.user.uid);
    socket.emit('fight_result', { win, goldGain, expGain, character: updated });
  });

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.user.username}`);
    Pvp.unregisterOnline(socket.user.uid);
  });
});

server.listen(PORT, () => {
  console.log(`Demon Tower server listening on :${PORT}`);
});
