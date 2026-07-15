import { ResolvedTranslateConfig } from '../types/index.js';

/**
 * 将 CLI 的语言筛选应用到已经归一化的路由配置。
 * 单母版模式允许临时覆盖目标语言；多母版模式只允许筛选已有路由。
 */
export function selectTargetLanguages(config: ResolvedTranslateConfig, languages: string[]): void {
  if (languages.length === 0) return;

  const requestedLangs = [...new Set(languages)];
  if (config.routes.length === 1) {
    const route = config.routes[0];
    if (requestedLangs.includes(route.baseLang)) {
      throw new Error(`Target languages must not contain the master language: ${route.baseLang}`);
    }
    route.targetLangs = requestedLangs as typeof route.targetLangs;
  } else {
    const configuredTargets = new Set(config.routes.flatMap(route => route.targetLangs));
    const unknownTargets = requestedLangs.filter(
      lang => ![...configuredTargets].some(configured => configured === lang)
    );
    if (unknownTargets.length > 0) {
      throw new Error(`Target languages are not configured in any master route: ${unknownTargets.join(', ')}`);
    }

    const selectedTargets = new Set(requestedLangs);
    config.routes = config.routes
      .map(route => ({
        ...route,
        targetLangs: route.targetLangs.filter(lang => selectedTargets.has(lang)),
      }))
      .filter(route => route.targetLangs.length > 0);
  }

  config.targetLangs = config.routes.flatMap(route => route.targetLangs);
}
