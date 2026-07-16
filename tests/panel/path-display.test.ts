import { describe, expect, it } from 'vitest';
import { projectDirectoryName, projectRelativePath } from '../../panel/src/path-display';

describe('panel path display', () => {
  it('shows only the project directory name in the local session', () => {
    expect(projectDirectoryName('/private/var/folders/example/T/i18n-ai-diff-consumer'))
      .toBe('i18n-ai-diff-consumer');
    expect(projectDirectoryName('C:\\work\\headless-global-site\\'))
      .toBe('headless-global-site');
  });

  it('shows project-owned paths relative to the project root', () => {
    const root = '/private/var/folders/example/T/i18n-ai-diff-consumer';
    expect(projectRelativePath(`${root}/i18n-translate.config.mjs`, root))
      .toBe('./i18n-translate.config.mjs');
    expect(projectRelativePath(`${root}/locales`, root))
      .toBe('./locales');
  });

  it('keeps external paths absolute so their location is not misrepresented', () => {
    expect(projectRelativePath('/shared/locales', '/work/project')).toBe('/shared/locales');
  });
});
