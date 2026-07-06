// friendManager.js — ระบบเพื่อน + สถานะออนไลน์ + คำเชิญเข้าปาร์ตี้
//
// หลักการ: ระบบเพื่อน/สถานะออนไลน์ต้องพึ่งเซิร์ฟเวอร์กลาง (Socket.io) เพราะ PeerJS
// เพียงอย่างเดียวรู้จักแค่คนที่ "เชื่อมต่อ P2P ถึงกันอยู่แล้ว" เท่านั้น มันไม่มีทางรู้ว่า
// เพื่อนที่ยังไม่ได้เชื่อมต่อ ตอนนี้ออนไลน์อยู่หรือเปล่า — ต้องมีที่กลาง (server) คอย
// จับคู่ username <-> online socket ให้ ส่วนตัวเกม/ปาร์ตี้จริงยังคงวิ่งผ่าน PeerJS (P2P)
// เหมือนเดิมทุกอย่าง คำเชิญที่ส่งผ่านตรงนี้แค่ "แจ้งเตือน" ให้เพื่อนกดยืนยัน แล้วส่ง
// Peer ID ของผู้เชิญกลับไปให้ client เอาไปต่อ P2P เอง

// userId -> live socket (สำหรับหาว่าใครออนไลน์ + ส่ง event หา)
const onlineByUser = new Map();

function registerOnline(userId, socket) { onlineByUser.set(userId, socket); }
function unregisterOnline(userId) { onlineByUser.delete(userId); }
function socketFor(userId) { return onlineByUser.get(userId); }
function isOnline(userId) { return onlineByUser.has(userId); }

// แจ้งเพื่อนทุกคนของ userId ว่าสถานะออนไลน์เปลี่ยน (เรียกตอน connect/disconnect)
function broadcastPresence(db, userId, username, online) {
  const rows = db.prepare(
    `SELECT friend_id FROM friends WHERE user_id = ? AND status = 'accepted'`
  ).all(userId);
  for (const row of rows) {
    const sock = onlineByUser.get(row.friend_id);
    if (sock) sock.emit('friend_presence', { userId, username, online });
  }
}

// ---------- บล็อก/เช็กบล็อก ----------
// เช็กทั้งสองทิศทาง: ถ้าใครฝ่ายใดฝ่ายหนึ่งบล็อกอีกฝ่าย ถือว่า "บล็อกอยู่" (ทำอะไรต่อกันไม่ได้ทั้งคู่)
function isBlocked(db, userIdA, userIdB) {
  const row = db.prepare(
    `SELECT 1 FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)`
  ).get(userIdA, userIdB, userIdB, userIdA);
  return !!row;
}

function blockUser(db, userId, targetUsername) {
  const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(targetUsername);
  if (!target) return { error: 'ไม่พบผู้เล่นชื่อนี้' };
  if (target.id === userId) return { error: 'บล็อกตัวเองไม่ได้' };
  db.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)')
    .run(userId, target.id, Date.now());
  // บล็อกแล้วตัดความเป็นเพื่อนทั้งสองทิศทางไปด้วย เพื่อไม่ให้ยังเห็นกันในลิสต์เพื่อน
  db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)')
    .run(userId, target.id, target.id, userId);
  return { ok: true, blockedId: target.id, blockedUsername: target.username };
}

function unblockUser(db, userId, blockedId) {
  db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(userId, blockedId);
  return { ok: true };
}

function listBlocked(db, userId) {
  return db.prepare(`
    SELECT u.id, u.username FROM blocks b
    JOIN users u ON u.id = b.blocked_id
    WHERE b.user_id = ?
    ORDER BY u.username COLLATE NOCASE
  `).all(userId);
}

// ---------- รายงานผู้เล่น ----------
const REPORT_REASONS = ['คำพูดไม่เหมาะสม/หยาบคาย', 'โกง/ใช้บั๊กเอาเปรียบ', 'สแปม', 'ชื่อผู้ใช้ไม่เหมาะสม', 'อื่นๆ'];
function reportUser(db, reporterId, targetUsername, reason, details) {
  const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(targetUsername);
  if (!target) return { error: 'ไม่พบผู้เล่นชื่อนี้' };
  if (target.id === reporterId) return { error: 'รายงานตัวเองไม่ได้' };
  if (!REPORT_REASONS.includes(reason)) return { error: 'เหตุผลไม่ถูกต้อง' };
  db.prepare('INSERT INTO reports (reporter_id, reported_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(reporterId, target.id, reason, (details || '').slice(0, 500), Date.now());
  return { ok: true };
}

// ---------- ส่งคำขอเป็นเพื่อน (ด้วยชื่อผู้ใช้) ----------
function sendRequest(db, fromUserId, fromUsername, targetUsername) {
  const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(targetUsername);
  if (!target) return { error: 'ไม่พบผู้เล่นชื่อนี้' };
  if (target.id === fromUserId) return { error: 'เพิ่มตัวเองเป็นเพื่อนไม่ได้' };
  if (isBlocked(db, fromUserId, target.id)) return { error: 'ไม่สามารถส่งคำขอถึงผู้เล่นนี้ได้' };

  const existing = db.prepare(
    'SELECT status FROM friends WHERE user_id = ? AND friend_id = ?'
  ).get(fromUserId, target.id);
  if (existing) {
    return { error: existing.status === 'accepted' ? 'เป็นเพื่อนกันอยู่แล้ว' : 'ส่งคำขอไปแล้ว รอเพื่อนตอบรับ' };
  }
  // เขาเคยส่งคำขอมาหาเราอยู่ก่อนแล้ว -> ตอบรับให้เลยทั้งสองทิศทางแทนที่จะส่งซ้ำ
  const reverse = db.prepare(
    'SELECT status FROM friends WHERE user_id = ? AND friend_id = ?'
  ).get(target.id, fromUserId);
  const now = Date.now();
  if (reverse && reverse.status === 'pending') {
    db.prepare('UPDATE friends SET status = ? WHERE user_id = ? AND friend_id = ?').run('accepted', target.id, fromUserId);
    db.prepare('INSERT INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, ?, ?)')
      .run(fromUserId, target.id, 'accepted', now);
    const targetSock = onlineByUser.get(target.id);
    if (targetSock) targetSock.emit('friend_request_accepted', { userId: fromUserId, username: fromUsername });
    return { ok: true, autoAccepted: true, friend: { id: target.id, username: target.username } };
  }

  db.prepare('INSERT INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, ?, ?)')
    .run(fromUserId, target.id, 'pending', now);
  const targetSock = onlineByUser.get(target.id);
  if (targetSock) targetSock.emit('friend_request_incoming', { userId: fromUserId, username: fromUsername });
  return { ok: true };
}

// ---------- ตอบรับ/ปฏิเสธคำขอเป็นเพื่อน ----------
function respondRequest(db, userId, username, fromUserId, accept) {
  const row = db.prepare(
    `SELECT status FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'pending'`
  ).get(fromUserId, userId);
  if (!row) return { error: 'ไม่พบคำขอนี้ (อาจถูกยกเลิกไปแล้ว)' };

  if (!accept) {
    db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(fromUserId, userId);
    return { ok: true, accepted: false };
  }
  const now = Date.now();
  db.prepare('UPDATE friends SET status = ? WHERE user_id = ? AND friend_id = ?').run('accepted', fromUserId, userId);
  db.prepare('INSERT OR REPLACE INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, fromUserId, 'accepted', now);

  const fromRow = db.prepare('SELECT username FROM users WHERE id = ?').get(fromUserId);
  const fromSock = onlineByUser.get(fromUserId);
  if (fromSock) fromSock.emit('friend_request_accepted', { userId, username });
  return { ok: true, accepted: true, friend: { id: fromUserId, username: fromRow ? fromRow.username : '' } };
}

// ---------- รายชื่อเพื่อนทั้งหมด (พร้อมสถานะออนไลน์) + คำขอค้างที่รอเรา ----------
function listFriends(db, userId) {
  const friends = db.prepare(`
    SELECT u.id, u.username FROM friends f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? AND f.status = 'accepted'
    ORDER BY u.username COLLATE NOCASE
  `).all(userId).map(f => ({ id: f.id, username: f.username, online: isOnline(f.id) }));

  const incoming = db.prepare(`
    SELECT u.id, u.username FROM friends f
    JOIN users u ON u.id = f.user_id
    WHERE f.friend_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `).all(userId).map(r => ({ id: r.id, username: r.username }));

  return { friends, incoming };
}

function removeFriend(db, userId, friendId) {
  db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)')
    .run(userId, friendId, friendId, userId);
  return { ok: true };
}

// ---------- คำเชิญเข้าปาร์ตี้ ----------
// ผู้เชิญต้องเป็นเพื่อนกับเป้าหมายอยู่แล้ว และเป้าหมายต้องออนไลน์อยู่ตอนนี้
// payload ที่ส่งไปหาเป้าหมายพก peerId ของผู้เชิญไปด้วย -> client กดยืนยันแล้วต่อ P2P เองทันที
function inviteToParty(db, fromUserId, fromUsername, targetUserId, peerId) {
  if (isBlocked(db, fromUserId, targetUserId)) return { error: 'ไม่สามารถเชิญผู้เล่นนี้ได้' };
  const isFriend = db.prepare(
    `SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'accepted'`
  ).get(fromUserId, targetUserId);
  if (!isFriend) return { error: 'ต้องเป็นเพื่อนกันก่อนถึงจะเชิญเข้าปาร์ตี้ได้' };

  const targetSock = onlineByUser.get(targetUserId);
  if (!targetSock) return { error: 'เพื่อนไม่ได้ออนไลน์อยู่ตอนนี้' };
  if (!peerId) return { error: 'ยังไม่พร้อมเชื่อมต่อ P2P (รอสักครู่แล้วลองใหม่)' };

  targetSock.emit('party_invite', { fromUserId, fromUsername, peerId });
  return { ok: true };
}

// ---------- ค้นหาผู้ใช้ด้วยชื่อ (บางส่วนของชื่อก็ได้) เพื่อเพิ่มเป็นเพื่อน ----------
// คืนสถานะความสัมพันธ์ปัจจุบันของแต่ละคนไปด้วย เพื่อให้ client โชว์ปุ่มถูกต้อง
// ('self' | 'friend' | 'pending_sent' | 'pending_incoming' | 'none')
function searchUsers(db, userId, query) {
  const q = (query || '').trim();
  if (q.length < 1) return [];
  const rows = db.prepare(
    `SELECT id, username FROM users WHERE username LIKE ? AND id != ? ORDER BY username COLLATE NOCASE LIMIT 20`
  ).all('%' + q + '%', userId);

  return rows.map(r => {
    if (isBlocked(db, userId, r.id)) return null;
    const out = db.prepare('SELECT status FROM friends WHERE user_id = ? AND friend_id = ?').get(userId, r.id);
    const inn = db.prepare('SELECT status FROM friends WHERE user_id = ? AND friend_id = ?').get(r.id, userId);
    let status = 'none';
    if (out && out.status === 'accepted') status = 'friend';
    else if (out && out.status === 'pending') status = 'pending_sent';
    else if (inn && inn.status === 'pending') status = 'pending_incoming';
    return { id: r.id, username: r.username, status };
  }).filter(Boolean);
}

module.exports = {
  registerOnline, unregisterOnline, socketFor, isOnline, broadcastPresence,
  sendRequest, respondRequest, listFriends, removeFriend, inviteToParty, searchUsers,
  isBlocked, blockUser, unblockUser, listBlocked, reportUser, REPORT_REASONS,
};
