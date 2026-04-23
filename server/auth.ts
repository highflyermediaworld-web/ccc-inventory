import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";

export const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h
export const SESSION_COOKIE = "ccc_session";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  };
}

// Parse a raw Cookie header into a name→value map.
export function parseCookieHeader(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const session = await storage.getSession(token);
  if (!session || session.expiresAt < Math.floor(Date.now() / 1000)) {
    res.status(401).json({ error: "Session expired" });
    return;
  }
  const user = await storage.getUserById(session.userId);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  (req as any).user = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
  next();
}
