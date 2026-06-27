/**
 * Hash SHA-256 do conteúdo via Web Crypto.
 * Retorna base64 string.
 */
export async function hashContent(content: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', content);
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
