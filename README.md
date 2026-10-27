# Toolbox

เว็บแอป mobile-first สำหรับดาวน์โหลดสื่อจาก YouTube, TikTok และ Instagram และบีบอัดภาพ/วิดีโอ พร้อม UI ภาษาไทย

## เริ่มใช้งาน

ต้องมี Node.js 20.9+ และ FFmpeg ในระบบ ส่วน standalone `yt-dlp` จะติดตั้งให้อัตโนมัติตามระบบปฏิบัติการ

```bash
npm install
npm run dev
```

เปิด `http://localhost:5173`

## ใช้งานผ่าน Docker (พอร์ต 1111)

ติดตั้ง Docker แล้วรัน:

```bash
docker compose up -d --build
```

เปิด `http://localhost:1111` — image รวม Node.js, FFmpeg และ standalone yt-dlp ไว้แล้ว ไม่ต้องติดตั้งบนเครื่องเอง

```bash
docker compose logs -f toolbox
docker compose down
```

หากต้องการใช้ Docker โดยตรง:

```bash
docker build -t toolbox:local .
docker run -d --name toolbox --init --restart unless-stopped -p 1111:1111 toolbox:local
```

Container ใช้ผู้ใช้ที่ไม่ใช่ root และมี health check ที่ `/api/health` ไฟล์ประมวลผลชั่วคราวอยู่ใน container และไม่ต้องใช้ volume

## หน้าเว็บบน Vercel และ API ใน Docker

`vercel.json` กำหนดให้ Vercel build หน้าเว็บด้วย Vite และส่ง `/api/*` ไปยัง
`https://bn-tools.basnana.com/api/*` ผ่าน Cloudflare Tunnel โดยคง path และ query ไว้
จึงใช้ได้ทั้งอ่านข้อมูลคลิป, progress, รับไฟล์ และบีบอัดวิดีโอ ส่วน Docker
ยังเป็นผู้รัน Express, yt-dlp และ FFmpeg และต้องเปิดเครื่องไว้ขณะใช้งาน

หน้าเว็บ `tools.basnana.com` ผูกกับโปรเจกต์ Vercel เดียวกับ
`tools-puce-nu.vercel.app` ส่วน `bn-tools.basnana.com` ใช้เป็น API origin
ต้องใช้คนละ hostname เพื่อไม่ให้ API rewrite วนกลับเข้าหน้าเว็บ

DNS ของ `basnana.com` สำหรับหน้าเว็บ:

- Type: `CNAME`
- Name: `tools`
- Target: `cname.vercel-dns.com` (ค่าที่ Vercel แนะนำสำหรับโดเมนนี้)
- Proxy status: **DNS only**

Cloudflare Tunnel ที่กำหนด hostname `bn-tools.basnana.com` ต้องชี้ไป
`http://host.docker.internal:1111` และมี DNS สำหรับ API ดังนี้:

- Type: `CNAME`
- Name: `bn-tools`
- Target: `19cf8c54-3b82-4793-8f72-a300614864d2.cfargotunnel.com`
- Proxy status: **Proxied**

ตรวจให้ `https://bn-tools.basnana.com/api/health` คืน JSON `{"ok":true,...}`
ก่อน deploy หน้าเว็บ แล้วตรวจ `https://tools.basnana.com/api/health` และ
`https://tools-puce-nu.vercel.app/api/health`
อีกครั้งหลัง deploy การ deploy แบบ Vite อย่างเดียวจะไม่รัน `server/index.ts`
และ proxy ใน `vite.config.ts` ใช้เฉพาะ dev server

ไฟล์และสถานะดาวน์โหลดอยู่ใน Docker instance เดิม ห้ามเปลี่ยน API ชุดนี้เป็น
Vercel Functions โดยเก็บสถานะใน memory และไฟล์ใน `/tmp` เหมือนเดิม เพราะ
คำขอดาวน์โหลดไฟล์ภายหลังอาจไปคนละ instance

ข้อจำกัดของเส้นทางนี้: Vercel external rewrites มี timeout สูงสุด 120 วินาที
([เอกสาร](https://vercel.com/docs/limits)) งานที่ใช้เวลานานกว่านั้นควรเปิด
`https://bn-tools.basnana.com` โดยตรง เพื่อตัด Vercel proxy ออกจากเส้นทาง
ขนาดอัปโหลดและ timeout ยังขึ้นกับแผน Cloudflare ด้วย

## การทำงาน

- รูป JPEG, PNG และ WebP ประมวลผลในเบราว์เซอร์ด้วย libwebp/WebAssembly (`@jsquash/webp`) ใน Web Worker โดยไม่อัปโหลดรูปไปยังเซิร์ฟเวอร์ ค่า quality ใช้กับตัวเข้ารหัสจริงและเก็บพื้นโปร่งใสไว้ จึงไม่พึ่ง `canvas.toBlob('image/webp')` ที่อาจคืน PNG บน Safari
- ตรวจ MIME และลายเซ็น WebP ก่อนให้ดาวน์โหลด หากไฟล์ที่เข้ารหัสใหญ่กว่าต้นฉบับ จะแจ้งขนาดที่ได้และเลือกเก็บต้นฉบับแทน ต้องกดเริ่มบีบอัดใหม่หลังปรับ quality
- วิดีโอ MP4/MOV ส่งไปยัง local API และเข้ารหัสด้วย FFmpeg (H.264/AAC, CRF ตามค่า quality)
- ทั้งรูปและวิดีโอจะส่งไฟล์บีบอัดกลับเฉพาะเมื่อเล็กกว่าต้นฉบับจริง หากเท่ากัน/ใหญ่ขึ้นจะเก็บไฟล์ต้นฉบับ พร้อมแจ้งว่าลดขนาดไม่ได้ มีการตรวจทั้งที่เซิร์ฟเวอร์และก่อนแสดงไฟล์ดาวน์โหลด
- วิดีโอคงจำนวนเฟรมและ timestamp ด้วย `fps_mode=passthrough` และ timebase ต้นฉบับ ไม่ผูก FPS กับ quality และตรวจจำนวนเฟรม/FPS/ความยาวหลังเข้ารหัสก่อนส่งกลับ หากไม่ตรงจะคืนต้นฉบับเพื่อไม่ให้เฟรมหาย รองรับ 60, 59.94 และ VFR โดยแสดง FPS ก่อน–หลังในหน้าเว็บ
- ดาวน์โหลด YouTube, TikTok และ Instagram ด้วย `yt-dlp` และให้ FFmpeg รวมภาพ/เสียงหรือแปลงเป็น MP3
- MP4 ใช้ H.264 แบบ 8-bit YUV420 และเสียง AAC-LC stereo พร้อม faststart เพื่อรองรับ iPhone/QuickTime และเครื่องเล่นทั่วไป ตรวจ codec จริงด้วย ffprobe ก่อนและหลังประมวลผล หากต้นฉบับเป็น AV1, VP9, HEVC หรือ H.264 แบบ 10-bit จะเข้ารหัสเป็น H.264 โดยคง FPS/timebase ไม่ลดความละเอียดที่เลือก (เติมขอบได้ 1 pixel หากขนาดเป็นเลขคี่) ส่วน H.264 ที่รองรับอยู่แล้วจะคัดลอกภาพเพื่อลดเวลาและคงคุณภาพเดิม วิดีโอ HDR แปลงเป็น SDR BT.709 เมื่อเข้ารหัส
- รองรับลิงก์ TikTok แบบเต็มและแบบสั้น (`vm.tiktok.com`, `vt.tiktok.com`, `/t/`) และลิงก์ Instagram Post/Reel รวมถึงการวางข้อความแชร์ที่มีลิงก์อยู่ภายใน
- ใช้ชื่อคลิปเต็ม รวมภาษาไทย โดยไม่เติมรหัสคลิปท้ายชื่อ และแสดงเปอร์เซ็นต์ระหว่างดาวน์โหลด เตรียมไฟล์ และรับไฟล์ลงเครื่อง
- วางลิงก์แล้วเลือกความละเอียด MP4 จากรายการที่คลิปมีจริง หรือเลือก MP3 แบบ VBR สูงสุด/64/96/128/192/256/320 kbps โดย bitrate ขาออกไม่ได้เพิ่มคุณภาพเกินต้นฉบับ
- ช่วงอ่าน metadata จะแสดงสถานะรอ ส่วนเปอร์เซ็นต์ดาวน์โหลดคำนวณจากจำนวนไบต์ (ใช้ขนาดประมาณเมื่อยังไม่ทราบขนาดจริง) และช่วงเตรียมไฟล์คำนวณจากเวลาที่ FFmpeg ประมวลผลแล้ว
- Instagram โพสต์หลายรายการจะเลือกวิดีโอแรก คลิปที่แพลตฟอร์มกำหนดให้ล็อกอินหรือจำกัดการเข้าถึงอาจดาวน์โหลดไม่ได้ ระบบจะแจ้งสาเหตุแทนการแสดงว่าเสร็จแล้ว
- API ใหม่คือ `/api/media/info`, `/api/media` และ `/api/media/files/:id` โดยยังรองรับ `/api/youtube` เดิม
- จำกัดวิดีโออัปโหลดไว้ที่ 500 MB และลบไฟล์ชั่วคราวหลังส่งกลับเสร็จ

ควรดาวน์โหลดเฉพาะเนื้อหาที่คุณเป็นเจ้าของ หรือมีสิทธิ์ดาวน์โหลดและใช้งาน

## คำสั่ง

```bash
npm run typecheck
npm run build
npm start
```

Production server ใช้พอร์ต `8787` โดยตั้งค่า `PORT` เพื่อเปลี่ยนพอร์ตได้
# tools
