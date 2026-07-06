# Demon Tower — Online

- `server/` — Node.js backend (Express + Socket.io + SQLite), server-authoritative account/login + PvP
- `server/public/index.html` — เกม client เดิม เสิร์ฟตรงจาก server ตัวเดียวกัน (ไม่ต้องแยกโฮสต์ที่อื่น)

## รัน (ทดสอบในเครื่อง)
```bash
cd server
npm install
JWT_SECRET="ของคุณเอง" GOOGLE_CLIENT_ID="ของคุณเอง" npm start
```
เปิดเบราว์เซอร์ไปที่ `http://localhost:3000` จะเจอหน้าเกมทันที (server เสิร์ฟไฟล์ให้เองจาก `server/public/`)

## Production (Railway)

Deploy แล้วที่: `https://onlonetower-production.up.railway.app`
เข้า URL นี้ตรง ๆ ก็เจอหน้าเกมเลย ไม่ต้องมี GitHub Pages หรือโฮสต์แยกอีกที่

**Environment variables ที่ต้องตั้งบน Railway:**
- `JWT_SECRET` — ค่าสุ่มยาว ๆ (Railway generate ให้อัตโนมัติได้)
- `GOOGLE_CLIENT_ID` — จาก Google Cloud Console (ดู `server/README.md` วิธีสร้าง)

**ถ้าแก้โค้ดฝั่งเกม (`server/public/index.html`)** ต้องแก้ค่า `GOOGLE_CLIENT_ID` ในไฟล์นั้นให้ตรงกับตัวเดียวกันที่ตั้งบน Railway ด้วย (คนละที่ ต้องตรงกันทั้งสองฝั่ง)

รายละเอียดเพิ่มเติม (Google login, PvP, testing) ดูใน `server/README.md`
