const PATH_SEPARATOR = /[\\/]/;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

/**
 * Validates a branch/object/system name.
 */
export function isValidName(name: string): boolean | string {
  const normalized = normalizeName(name);
  if (!normalized) return 'Name cannot be empty.';
  if (containsControlCharacter(normalized)) return 'Name cannot contain control characters.';
  if (PATH_SEPARATOR.test(normalized)) return 'Name cannot contain path separators.';
  if (normalized === '.' || normalized === '..') return 'Name cannot be "." or "..".';
  return true;
}

export function normalizeName(name: string): string {
  return name.trim();
}

export function isValidEquationName(name: string): boolean | string {
  const displayNameValidity = isValidName(name);
  if (displayNameValidity !== true) return displayNameValidity;
  if (name.includes('`')) return 'Name cannot contain backticks.';
  return true;
}
