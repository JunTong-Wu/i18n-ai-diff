import type { TranslationKey } from '../../i18n';

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

export function formatPanelErrorMessage(error: unknown, t: Translate): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';

  return normalizePanelErrorMessage(message, t);
}

export function normalizePanelErrorMessage(message: string, t: Translate): string {
  const raw = message.trim();
  if (!raw) return t('errors.unexpected');

  const lower = raw.toLowerCase();

  if (
    lower.includes('llm.apikey is required')
    || lower.includes('llm.apikey')
    || lower.includes('openai_api_key')
    || lower.includes('api key is required')
  ) {
    return t('errors.llmApiKeyMissing');
  }

  if (
    lower.includes('incorrect api key')
    || lower.includes('invalid api key')
    || lower.includes('invalid_api_key')
    || lower.includes('unauthorized')
    || /\b401\b/u.test(lower)
  ) {
    return t('errors.llmAuthFailed');
  }

  if (lower.includes('api route not found')) {
    return t('errors.panelApiOutOfSync');
  }

  if (
    lower.includes('request was aborted')
    || lower.includes('aborterror')
    || lower.includes('timed out')
    || lower.includes('timeout')
    || lower.includes('aborted')
  ) {
    return t('errors.llmRequestAborted');
  }

  if (
    lower.includes('failed to fetch')
    || lower.includes('socket hang up')
    || lower.includes('econnrefused')
    || lower.includes('networkerror')
  ) {
    return t('errors.panelConnectionLost');
  }

  if (lower.includes('rate limit') || lower.includes('too many requests') || /\b429\b/u.test(lower)) {
    return t('errors.llmRateLimited');
  }

  if (
    lower.includes('service unavailable')
    || lower.includes('bad gateway')
    || /\b5(?:00|02|03|04)\b/u.test(lower)
  ) {
    return t('errors.llmProviderUnavailable');
  }

  return raw;
}
