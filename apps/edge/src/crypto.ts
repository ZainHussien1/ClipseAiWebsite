function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(secretMaterial: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secretMaterial),
  );
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSecret(
  plaintext: string,
  secretMaterial: string,
): Promise<string> {
  const key = await deriveAesKey(secretMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipherBuffer))}`;
}

export async function decryptSecret(
  token: string,
  secretMaterial: string,
): Promise<string> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Unsupported encrypted secret format');
  }
  const iv = fromBase64Url(parts[1] ?? '');
  const ciphertext = fromBase64Url(parts[2] ?? '');
  const key = await deriveAesKey(secretMaterial);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plainBuffer);
}
