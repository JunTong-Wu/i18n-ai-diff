import { describe, expect, it } from 'vitest';
import { normalizePanelErrorMessage } from '../../panel/src/components/feedback/panelErrorMessages';
import type { TranslationKey } from '../../panel/src/i18n';

const t = (key: TranslationKey) => key;

describe('panel error messages', () => {
  it('maps LLM retry aborts to an actionable panel message', () => {
    expect(normalizePanelErrorMessage(
      'Translation failed after 3 retries: Request was aborted.',
      t,
    )).toBe('errors.llmRequestAborted');
  });

  it('maps missing or invalid API keys to setup guidance', () => {
    expect(normalizePanelErrorMessage(
      'llm.apiKey is required (set OPENAI_API_KEY env or specify in config)',
      t,
    )).toBe('errors.llmApiKeyMissing');

    expect(normalizePanelErrorMessage(
      'Translation failed after 3 retries: 401 Incorrect API key provided',
      t,
    )).toBe('errors.llmAuthFailed');
  });

  it('maps stale panel routes to a restart hint', () => {
    expect(normalizePanelErrorMessage('API route not found', t)).toBe('errors.panelApiOutOfSync');
  });
});
