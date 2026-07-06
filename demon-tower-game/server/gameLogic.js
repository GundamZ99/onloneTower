// gameLogic.js — สูตรคำนวณที่พอร์ตมาจาก client เดิม (index.html) ทุกตัวเลข
// ต้องตรงกับต้นฉบับ 100% เพื่อให้ผลการเล่นรู้สึกเหมือนเดิม แต่ตอนนี้รันที่ server
// เท่านั้น — client ไม่มีสิทธิ์ทอยเต๋าหรือคำนวณดาเมจเองอีกต่อไป

const ELEM_CYCLE = { fire: 'wood', wood: 'water', water: 'fire' };

function elemMultiplier(atkElem, defElem) {
  if (atkElem === 'physical' || defElem === 'physical') return 1;
  if (ELEM_CYCLE[atkElem] === defElem) return 1.5;
  if (ELEM_CYCLE[defElem] === atkElem) return 0.6;
  if ((atkElem === 'light' && defElem === 'dark') || (atkElem === 'dark' && defElem === 'light')) return 1.6;
  return 1;
}

function lukSuccessChance(luk) {
  return Math.min(100, 50 + Math.min(80, luk * 0.8));
}

// ใช้ crypto.randomInt แทน Math.random ธรรมดา — ไม่ใช่เพราะ Math.random ไม่สุ่มพอ
// แต่เพราะตอนนี้โค้ดนี้รันบน server ที่ตัดสินผลจริง จึงคุ้มที่จะใช้ตัวสุ่มที่
// รับประกัน uniform distribution มากกว่า
const crypto = require('crypto');
function rollSuccess(luk) {
  const chance = lukSuccessChance(luk);
  const roll = crypto.randomInt(0, 100000) / 1000; // 0.000 - 99.999
  return { roll, chance, success: roll < chance };
}

function toD20(roll) {
  return Math.max(1, Math.min(20, Math.ceil((roll / 100) * 20)));
}

// ผลของการ์ดหนึ่งใบที่ผู้เล่นเลือก -> คำนวณ statVal ตามธาตุ (ตรงกับ _lockPvpAction เดิม)
function statValFor(card, atk, mag) {
  if (card.element === 'physical') return atk;
  if (card.element === 'light' || card.element === 'dark') return Math.max(atk, mag);
  return mag;
}

// คำนวณยกหนึ่งของ PvP แบบ simultaneous — พอร์ตตรงจาก resolvePvpRound เดิม
// mine/theirs: { cardName, cardElement, cardPower, statVal, success, diceNumber }
function resolvePvpRound(mine, theirs) {
  const emultMine = elemMultiplier(mine.cardElement, theirs.cardElement);
  const emultTheirs = elemMultiplier(theirs.cardElement, mine.cardElement);
  const myDmgIfLands = Math.max(1, Math.round(mine.cardPower * (mine.statVal / 10) * emultMine));
  const theirDmgIfLands = Math.max(1, Math.round(theirs.cardPower * (theirs.statVal / 10) * emultTheirs));
  const dmgToMine = (theirs.success && !mine.success) ? theirDmgIfLands : 0;
  const dmgToTheirs = (mine.success && !theirs.success) ? myDmgIfLands : 0;
  return { dmgToMine, dmgToTheirs, myDmgIfLands, theirDmgIfLands };
}

module.exports = { elemMultiplier, lukSuccessChance, rollSuccess, toD20, statValFor, resolvePvpRound };
