const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

// salt is stored as part of the iv_b64 field: first 16 bytes = salt, next 12 bytes = IV
async function encryptFile(fileBuffer, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    fileBuffer
  );

  // Pack: [salt (16)] + [iv (12)] = 28 bytes, base64-encode for storage
  const combined = new Uint8Array(28);
  combined.set(salt, 0);
  combined.set(iv, 16);
  const ivB64 = btoa(String.fromCharCode(...combined));

  return { ciphertext, ivB64 };
}

async function decryptFile(cipherBuffer, ivB64, passphrase) {
  const combined = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const key = await deriveKey(passphrase, salt);

  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherBuffer);
}

window.FreeCrypto = { encryptFile, decryptFile };
