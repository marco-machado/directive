// Save codes are 12 Crockford base32 characters (60 random bits), shown as XXXX-XXXX-XXXX.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateSaveCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, b => ALPHABET[b & 31]).join('');
}
export function normalizeSaveCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(code) ? code : null;
}
export const formatSaveCode = (code: string) => code.match(/.{1,4}/g)!.join('-');
