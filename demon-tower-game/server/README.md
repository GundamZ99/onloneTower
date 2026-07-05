[README.md](https://github.com/user-attachments/files/29676769/README.md)
# Demon Tower — Server (Proof of Concept)

ฐานราก server-authoritative: Account/Login + persistent character state + ตัวอย่าง
action แบบ server-authoritative (`fight_training_dummy`)

## วิธีรัน (ในเครื่องคุณ ต้องมีอินเทอร์เน็ต + Node.js 18+)

```bash
cd demon-tower-server
npm install
JWT_SECRET="ใส่ค่าลับยาวๆของคุณเอง" npm start
```

Server จะรันที่ `http://localhost:3000`

## ทดสอบด้วย curl

```bash
# สมัครสมาชิก
curl -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"hero1","password":"secret123"}'

# ล็อกอิน (จะได้ token กลับมา)
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"hero1","password":"secret123"}'

# โหลดตัวละคร (ใส่ token ที่ได้จากด้านบน)
curl http://localhost:3000/api/character \
  -H "Authorization: Bearer <TOKEN>"
```

## ต่อจาก client เดิม (index.html)

ในเกม client เดิมต้องเพิ่ม:

1. หน้าจอ Login/Register (เรียก `/api/register`, `/api/login` ด้วย `fetch`)
2. เก็บ `token` ที่ได้ไว้ (เช่น `localStorage`)
3. เชื่อม Socket.io ไปที่ server แทนการต่อ PeerJS ตรง ๆ:

```html
<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
<script>
const socket = io('http://localhost:3000', {
  auth: { token: localStorage.getItem('dt_token') }
});
socket.on('connect', () => console.log('connected as', socket.id));
socket.emit('fight_training_dummy');
socket.on('fight_result', (data) => {
  console.log('ผลการต่อสู้จาก server:', data);
  // อัปเดต UI ตามค่าที่ server ส่งมา — ไม่ใช่คำนวณเองที่ client แล้ว
});
</script>
```

## Deploy ให้เล่นจริงข้ามเครื่อง

แนะนำ Railway หรือ Render (มี free tier, รองรับ WebSocket, deploy จาก GitHub repo
ได้ในไม่กี่คลิก) — เมื่อ deploy แล้วเปลี่ยน URL `localhost:3000` ในโค้ด client
เป็น URL จริงของ server ที่ deploy ไว้

**ข้อควรระวังก่อนขึ้น production จริง:**
- ตั้ง `JWT_SECRET` เป็นค่าสุ่มยาว ๆ ผ่าน environment variable ห้าม hardcode
- จำกัด `cors: { origin: '*' }` ให้เหลือเฉพาะ domain ที่โฮสต์เกมจริง
- เพิ่ม rate-limiting กับ `/api/register` และ `/api/login` กันบอทยิงสมัครสแปม
- ย้ายจาก SQLite ไป PostgreSQL ถ้าคาดว่าจะมีผู้เล่นพร้อมกันจำนวนมาก (SQLite เขียนพร้อมกันได้จำกัด)

## PvP แบบ server-authoritative (ใหม่)

พอร์ตสูตร dice/ธาตุ/ดาเมจจาก client เดิม (`rollSuccess`, `elemMultiplier`,
`resolvePvpRound`) มาไว้ที่ `gameLogic.js` และ `pvpManager.js` แล้ว — ตอนนี้
**client ไม่ทอยเต๋าเอง ไม่คำนวณดาเมจเอง** ทำได้แค่ "เลือกการ์ดใบไหน" (ส่ง index)
ส่วนที่เหลือ server ตัดสินทั้งหมดจากข้อมูล atk/mag/luk ที่โหลดจาก DB ตรง

### ทดสอบ PvP ด้วย 2 บัญชี

```bash
# ตั้งเด็คตัวอย่างให้ทั้งสองบัญชี (ระบบสร้างเด็คจริงยังไม่ได้ทำ)
curl -X POST http://localhost:3000/api/debug/set-demo-deck -H "Authorization: Bearer <TOKEN_A>"
curl -X POST http://localhost:3000/api/debug/set-demo-deck -H "Authorization: Bearer <TOKEN_B>"
```

จากนั้นเชื่อม socket ทั้งสองฝั่ง (คอนโซล browser 2 แท็บ หรือสอง client):

```js
// ฝั่ง A
socketA.emit('pvp_challenge', { targetUsername: 'hero2' });
socketA.on('pvp_matched', d => console.log('matched', d));
socketA.on('pvp_round_result', d => console.log('round result', d));
socketA.on('pvp_end', d => console.log('end', d));

// ทั้งสองฝั่งเลือกการ์ด (index 0-2) เมื่อพร้อม
socketA.emit('pvp_select_card', { cardIndex: 0 });
socketB.emit('pvp_select_card', { cardIndex: 1 });
// เมื่อทั้งสองฝั่งเลือกครบ server จะทอยเต๋า/คำนวณดาเมจ/ส่ง pvp_round_result กลับให้ทั้งคู่
```

**สิ่งที่ตัดออกจากเวอร์ชัน client เดิมในเฟสนี้ (เพื่อความง่ายของ PoC):**
- ช่องอาวุธพิเศษ (godly weapon ultimate effects) — ยังไม่พอร์ต ใช้แค่การ์ดในมือ 3 ใบ
- ระบบสร้าง/แก้เด็คจริง — ใช้ debug endpoint แทนไปก่อน
- Reconnect กลางแมทช์ — ถ้าใครหลุดกลางดวล อีกฝั่งจะได้ `pvp_end` ทันที (ไม่มี grace period)

## ตั้งค่า Google Login

1. ไปที่ https://console.cloud.google.com/apis/credentials
2. สร้างโปรเจกต์ใหม่ (ถ้ายังไม่มี) → กด **"Create Credentials" → "OAuth client ID"**
3. เลือก Application type: **Web application**
4. ที่ "Authorized JavaScript origins" ใส่ URL ที่จะใช้เปิดไฟล์เกม เช่น `http://localhost` หรือถ้าใช้ GitHub Pages ก็ใส่ URL นั้น (Google Sign-In ต้องรันจาก URL จริง เปิดไฟล์ตรง ๆ จาก `file://` จะใช้ไม่ได้)
5. จะได้ **Client ID** ลงท้ายด้วย `.apps.googleusercontent.com`
6. เอา Client ID นี้ไปแทนที่ `GOOGLE_CLIENT_ID` ในไฟล์ `client-index.html`
7. ที่ server ให้เพิ่ม environment variable `GOOGLE_CLIENT_ID` ด้วย (ค่าเดียวกัน) ใน Railway Variables

**ข้อจำกัด:** เพราะ Google Sign-In ต้องรันจาก URL จริง (ไม่ใช่ไฟล์ในเครื่อง) เกมต้องถูกโฮสต์ไว้ที่ไหนสักที่ (เช่น GitHub Pages, Netlify, Vercel) ก่อนปุ่ม Google Login จะใช้งานได้จริง — ระบบ username/password แบบเดิมยังใช้ได้จากไฟล์ในเครื่องตามปกติ

## ขั้นต่อไป

เหลือ **Co-op combat** (จากเดิม `CoopCombat.hostBeginFight` ที่ host client เป็นคนคำนวณ)
ที่ยังต้องย้ายมาเป็น server-authoritative ตามแบบเดียวกับ PvP ข้างบน รวมถึงระบบ
สร้าง/แก้เด็คจริงที่ยังไม่ได้ทำ (ตอนนี้ใช้ debug endpoint แทนอยู่)
