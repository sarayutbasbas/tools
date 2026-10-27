function unavailableMessage(response: Response): string {
  if (response.status === 404) return 'ไม่พบ API บนเซิร์ฟเวอร์ กรุณารีเฟรชหน้าเว็บแล้วลองอีกครั้ง (HTTP 404)';
  if (response.status === 413) return 'ไฟล์ใหญ่เกินขีดจำกัดของเซิร์ฟเวอร์ กรุณาใช้ไฟล์ที่เล็กลง';
  if (response.status === 429) return 'มีคำขอมากเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง';
  if (response.status === 401 || response.status === 403) return 'เซิร์ฟเวอร์ปฏิเสธการเข้าถึง กรุณาตรวจสิทธิ์การใช้งาน';
  return `เชื่อมต่อบริการประมวลผลไม่สำเร็จ กรุณารอสักครู่แล้วลองอีกครั้ง (HTTP ${response.status})`;
}

export async function readApiJson<T>(response: Response): Promise<T> {
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mime !== 'application/json' && !mime?.endsWith('+json')) throw new Error(unavailableMessage(response));
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error('เซิร์ฟเวอร์ส่งข้อมูลไม่ครบ กรุณาลองอีกครั้ง'); }
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
    throw new Error(typeof error === 'string' ? error : unavailableMessage(response));
  }
  if (!data || typeof data !== 'object') throw new Error('รูปแบบข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง กรุณาลองอีกครั้ง');
  return data as T;
}

export async function requireApiStream(response: Response): Promise<void> {
  if (!response.ok) {
    await readApiJson(response);
    return;
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/x-ndjson')) {
    throw new Error(unavailableMessage(response));
  }
}
