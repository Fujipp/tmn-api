# TMW Topup API (Render Free, Playwright)

## Deploy (Render)
1. สร้าง GitHub repo แล้ว push ไฟล์ทั้งหมดชุดนี้ขึ้นไป
2. เข้าหน้า Render -> New -> Web Service -> เลือก repo นี้
3. Environment = Docker (Render อ่าน Dockerfile ให้เอง), Plan = Free
4. (แนะนำ) ตั้ง ENV `API_KEY` เพื่อป้องกันสาธารณะ
5. Deploy ให้เสร็จ -> จะได้ URL เช่น https://tmw-topup-api.onrender.com

## Local dev
```bash
npm i
npm run dev
# เปิด http://localhost:8080/healthz
```

## Endpoints
- GET /healthz
- GET /tmw/test
- POST /tmw/redeem  body: { "voucherUrl": "...?v=HASH", "mobile": "0831234567" }
  - ใช้ header `x-api-key: <your-key>` ถ้าตั้ง API_KEY

## หมายเหตุ
- ใช้ Playwright + Chromium ในคอนเทนเนอร์ -> ผ่าน WAF ได้เสถียรกว่า Workers ในบางช่วงเวลา
- เปิดหน้า voucher ก่อน, ยิง /configuration -> /verify -> /redeem พร้อม referrer/credentials
