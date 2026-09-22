import { scrypt, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// PIN hashing, kept free of any Next.js or database imports so that CLI
// scripts (seeding, PIN resets) can use exactly the same code the app does.

const scryptAsync = promisify(scrypt);

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(pin, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPinHash(pin: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = (await scryptAsync(pin, salt, 64)) as Buffer;
  const expected = Buffer.from(key, "hex");
  // Lengths must match before timingSafeEqual, which throws otherwise.
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export function generatePin(): string {
  // randomInt avoids the modulo bias of Math.random-based generators.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
