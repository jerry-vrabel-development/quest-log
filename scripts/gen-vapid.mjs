// Generates a VAPID key pair for Web Push.
// Usage: node scripts/gen-vapid.mjs
import { webcrypto as crypto } from "node:crypto";

const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const b64u = (b) => Buffer.from(b).toString("base64url");

console.log("\n1) Put this in wrangler.jsonc under vars.VAPID_PUBLIC_KEY:\n");
console.log(b64u(raw));
console.log("\n2) Run `npx wrangler secret put VAPID_PRIVATE_JWK` and paste this when asked:\n");
console.log(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
console.log("");
