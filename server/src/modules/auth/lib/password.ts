/**
 * Password hashing. bcrypt with a work factor high enough to matter and low
 * enough that a login stays interactive — and a `verify` that runs the same
 * comparison whether or not the account exists, so response timing never
 * tells an attacker which emails are registered.
 */
import bcrypt from 'bcrypt';

const ROUNDS = 12;

/** A valid bcrypt hash of a random string — compared against when no user exists, purely to burn the same time a real check would. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(plain, DUMMY_HASH).catch(() => false);
    return false;
  }
  return bcrypt.compare(plain, hash);
}
