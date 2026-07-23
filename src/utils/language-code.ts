const MAX_LANGUAGE_CODE_LENGTH = 128;
const SAFE_LANGUAGE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export function normalizeLanguageCode(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export function validateLanguageCode(value: unknown, field = 'language'): string | null {
  if (typeof value !== 'string') {
    return `${field} must be a string`;
  }

  const normalized = value.trim();
  if (!normalized) {
    return `${field} is required`;
  }

  if (normalized.length > MAX_LANGUAGE_CODE_LENGTH) {
    return `${field} must be ${MAX_LANGUAGE_CODE_LENGTH} characters or fewer`;
  }

  if (normalized === '.' || normalized === '..') {
    return `${field} must not be "." or ".."`;
  }

  if (
    normalized.includes('\0')
    || normalized.includes('/')
    || normalized.includes('\\')
    || normalized.includes(':')
  ) {
    return `${field} must be a safe language identifier without path separators, colon, or NUL bytes`;
  }

  if (!SAFE_LANGUAGE_CODE_PATTERN.test(normalized)) {
    return `${field} must start with a letter or number and may contain only letters, numbers, ".", "_", and "-"`;
  }

  return null;
}

export function assertLanguageCode(value: unknown, field = 'language'): string {
  const error = validateLanguageCode(value, field);
  if (error) throw new Error(error);
  return (value as string).trim();
}
