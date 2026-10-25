/**
 * Admin roles.
 *
 *  - owner: the shop owner(s). Full access, plus the only role that can create,
 *           re-role, reset or delete other Owner logins.
 *  - it:    IT / technical staff. Full access to every admin section; manages
 *           IT logins but cannot touch Owner logins.
 *
 * Legacy rows created before roles existed carry "admin" — treated as owner.
 */
export type Role = "owner" | "it";

export const ROLES: Role[] = ["owner", "it"];

export function normalizeRole(raw: string | null | undefined): Role {
  const r = (raw ?? "").toLowerCase();
  if (r === "it" || r === "staff") return "it";
  return "owner"; // "owner", legacy "admin", or anything unknown
}

export function roleLabel(role: string | null | undefined): string {
  return normalizeRole(role) === "it" ? "IT" : "Owner";
}

export function isOwner(role: string | null | undefined): boolean {
  return normalizeRole(role) === "owner";
}
