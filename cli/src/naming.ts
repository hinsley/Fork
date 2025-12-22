const NAME_REGEX = /^[a-zA-Z0-9_]+$/;

/**
 * Validates a branch/object/system name.
 *
 * Names must be alphanumeric with underscores only (no spaces or special characters).
 */
export function isValidName(name: string): boolean | string {
  if (!name || name.length === 0) return 'Name cannot be empty.';
  if (!NAME_REGEX.test(name)) {
    return 'Name must contain only alphanumeric characters and underscores (no spaces).';
  }
  return true;
}


