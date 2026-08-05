/**
 * Auth constants shared by server actions and client components.
 *
 * Kept in its own module because `"use server"` files may only export async
 * functions, and `src/lib/auth.ts` is server-only — neither can hand a plain
 * constant to a client component.
 */

/** Minimum password length. Longer beats complex: length is what actually
 *  resists guessing, and arbitrary symbol rules push people toward
 *  predictable substitutions. */
export const MIN_PASSWORD_LENGTH = 10;
