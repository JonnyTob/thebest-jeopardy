import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function useQrCode(value: string) {
  const [result, setResult] = useState<{ value: string; image: string; error: boolean }>({ value: '', image: '', error: false });
  useEffect(() => {
    if (!value) return;
    let active = true;
    void QRCode.toDataURL(value, { width: 512, margin: 4, color: { dark: '#132425', light: '#ffffff' } })
      .then((image) => { if (active) setResult({ value, image, error: false }); })
      .catch(() => { if (active) setResult({ value, image: '', error: true }); });
    return () => { active = false; };
  }, [value]);
  return result.value === value ? result : { value, image: '', error: false };
}
