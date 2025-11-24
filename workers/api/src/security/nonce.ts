export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  let base64: string;
  if (typeof btoa === "function") {
    base64 = btoa(binary);
  } else if (typeof Buffer !== "undefined") {
    base64 = Buffer.from(bytes).toString("base64");
  } else {
    base64 = "";
  }
  return base64.replace(/[^a-zA-Z0-9]/g, "").slice(0, 22) || Date.now().toString(36);
}
