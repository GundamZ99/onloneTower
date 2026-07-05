# Demon Tower — Online

- `server/` — Node.js backend (Express + Socket.io + SQLite), server-authoritative account/login + PvP
- `client-index.html` — เกม client เดิม ต่อเข้ากับ server ผ่าน Socket.io

## รัน
```bash
cd server
npm install
JWT_SECRET="ของคุณเอง" npm start
```
เปิด `client-index.html` ในเบราว์เซอร์ (แก้ค่า `SERVER_URL` ในไฟล์ให้ตรงกับ server ที่รัน)

รายละเอียดเพิ่มเติมดูใน `server/README.md`
