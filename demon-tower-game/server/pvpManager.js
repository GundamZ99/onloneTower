// pvpManager.js — คู่ดวล PvP ทั้งหมดตัดสินที่นี่ ไม่ใช่ที่ client
//
// รูปแบบเดิม (PeerJS): แต่ละฝั่งทอยเต๋า+คำนวณดาเมจเอง แล้วส่งผลให้อีกฝั่ง "เชื่อ" ตรง ๆ
// รูปแบบใหม่: client ส่งมาแค่ "ฉันเลือกการ์ดใบไหน" (แค่ index ไม่ใช่ผลลัพธ์)
// server เป็นคนทอยเต๋า/คำนวณดาเมจ/ตัดสินแพ้ชนะทั้งหมด client ทำได้แค่รอผลจาก server

const { rollSuccess, toD20, statValFor, resolvePvpRound } = require('./gameLogic');

// matchId -> match state
const matches = new Map();
// userId -> matchId (กันคนหนึ่งอยู่หลายห้องพร้อมกัน)
const userToMatch = new Map();
// userId -> live socket (สำหรับหาคู่ต่อสู้ตอน challenge)
const onlineByUser = new Map();

function registerOnline(userId, socket) { onlineByUser.set(userId, socket); }
function unregisterOnline(userId) {
  onlineByUser.delete(userId);
  const matchId = userToMatch.get(userId);
  if (matchId) endMatch(matchId, 'opponent_disconnected');
}

function makePlayerState(userId, socket, charRow) {
  const deck = JSON.parse(charRow.deck_json || '[]');
  return {
    userId, socket,
    name: charRow.name,
    hp: charRow.max_hp, maxHp: charRow.max_hp,
    atk: charRow.atk, mag: charRow.mag, luk: charRow.luk,
    deck: deck.slice(0, Math.max(0, Math.min(3, deck.length))), // active hand เหมือน client เดิม (activeCount = min(3, deck.length))
    selection: null, // การ์ดที่ล็อกไว้ในยกนี้ (ยังไม่ทอยผล — ทอยตอน resolve)
  };
}

function findMatch(userId) {
  const matchId = userToMatch.get(userId);
  return matchId ? matches.get(matchId) : null;
}

function challenge(db, fromUserId, fromSocket, targetUserId) {
  if (fromUserId === targetUserId) return { error: 'ท้าดวลตัวเองไม่ได้' };
  if (userToMatch.has(fromUserId)) return { error: 'คุณอยู่ในการดวลอยู่แล้ว' };
  if (userToMatch.has(targetUserId)) return { error: 'คู่ต่อสู้อยู่ในการดวลอื่นอยู่' };
  const targetSocket = onlineByUser.get(targetUserId);
  if (!targetSocket) return { error: 'คู่ต่อสู้ไม่ได้ออนไลน์อยู่' };

  const fromRow = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(fromUserId);
  const targetRow = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(targetUserId);
  if (!fromRow || !targetRow) return { error: 'ไม่พบตัวละคร' };
  if (!fromRow.deck_json || fromRow.deck_json === '[]') return { error: 'คุณยังไม่มีการ์ดในเด็ค ใส่การ์ดก่อนดวล' };

  const matchId = `pvp_${fromUserId}_${targetUserId}_${Date.now()}`;
  const p1 = makePlayerState(fromUserId, fromSocket, fromRow);
  const p2 = makePlayerState(targetUserId, targetSocket, targetRow);
  const match = { matchId, round: 0, players: { [fromUserId]: p1, [targetUserId]: p2 } };
  matches.set(matchId, match);
  userToMatch.set(fromUserId, matchId);
  userToMatch.set(targetUserId, matchId);

  const payloadFor = (me, opp) => ({
    matchId,
    myName: me.name, myHp: me.hp, myMax: me.maxHp, myDeck: me.deck,
    oppName: opp.name, oppHp: opp.hp, oppMax: opp.maxHp,
  });
  fromSocket.emit('pvp_matched', payloadFor(p1, p2));
  targetSocket.emit('pvp_matched', payloadFor(p2, p1));
  return { ok: true, matchId };
}

// cardIndex: index เข้า me.deck (0..2) — server เป็นคนอ่านการ์ดจริงจาก deck ที่โหลดจาก DB
// ไม่เชื่อ "ชื่อการ์ด/พลัง" ใด ๆ ที่ client ส่งมาเอง
function selectCard(userId, cardIndex) {
  const match = findMatch(userId);
  if (!match) return { error: 'ไม่ได้อยู่ในการดวล' };
  const me = match.players[userId];
  if (me.selection) return { error: 'ล็อกการ์ดไปแล้วในยกนี้' };
  const card = me.deck[cardIndex];
  if (!card) return { error: 'ไม่พบการ์ดนี้ในมือ' };

  const statVal = statValFor(card, me.atk, me.mag);
  const { roll, success } = rollSuccess(me.luk);
  me.selection = {
    cardName: card.name, cardElement: card.element, cardPower: card.power,
    statVal, success, diceNumber: toD20(roll),
  };

  const otherId = Object.keys(match.players).find(id => id !== String(userId) && id !== userId);
  const opp = match.players[otherId];
  if (opp && opp.selection) {
    return resolveRound(match);
  }
  return { ok: true, waiting: true };
}

function resolveRound(match) {
  const ids = Object.keys(match.players);
  const [id1, id2] = ids;
  const p1 = match.players[id1], p2 = match.players[id2];
  const { dmgToMine: dmgTo1, dmgToTheirs: dmgTo2 } = resolvePvpRound(p1.selection, p2.selection);
  p1.hp -= dmgTo1; p2.hp -= dmgTo2;
  match.round++;

  const result1 = {
    round: match.round, mine: p1.selection, theirs: p2.selection,
    dmgToMe: dmgTo1, dmgToOpp: dmgTo2, myHp: p1.hp, oppHp: p2.hp,
  };
  const result2 = {
    round: match.round, mine: p2.selection, theirs: p1.selection,
    dmgToMe: dmgTo2, dmgToOpp: dmgTo1, myHp: p2.hp, oppHp: p1.hp,
  };
  p1.socket.emit('pvp_round_result', result1);
  p2.socket.emit('pvp_round_result', result2);

  p1.selection = null; p2.selection = null;

  if (p1.hp <= 0 || p2.hp <= 0) {
    const outcome = p1.hp <= 0 && p2.hp <= 0 ? 'draw' : (p1.hp <= 0 ? 'p2_win' : 'p1_win');
    p1.socket.emit('pvp_end', { result: outcome === 'draw' ? 'draw' : (outcome === 'p1_win' ? 'win' : 'lose') });
    p2.socket.emit('pvp_end', { result: outcome === 'draw' ? 'draw' : (outcome === 'p2_win' ? 'win' : 'lose') });
    endMatch(match.matchId);
  }
  return { ok: true };
}

function endMatch(matchId, reason) {
  const match = matches.get(matchId);
  if (!match) return;
  for (const uid of Object.keys(match.players)) {
    userToMatch.delete(Number(uid)) || userToMatch.delete(uid);
    if (reason === 'opponent_disconnected') {
      const p = match.players[uid];
      if (p.socket && p.socket.connected) p.socket.emit('pvp_end', { result: 'opponent_disconnected' });
    }
  }
  matches.delete(matchId);
}

function leaveMatch(userId) {
  const matchId = userToMatch.get(userId);
  if (matchId) endMatch(matchId, 'opponent_disconnected');
}

module.exports = { registerOnline, unregisterOnline, challenge, selectCard, leaveMatch };
