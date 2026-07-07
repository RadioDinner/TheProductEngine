/** Normalize any typed US phone number to bare 10 digits, or null. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 ? ten : null;
}

/** "3305550142" → "(330) 555-0142" */
export function formatPhone(ten: string): string {
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
