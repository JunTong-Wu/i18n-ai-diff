# i18n-ai-diff

**中文** | [English](./README.md)

前端项目在做多语言（i18n）时，通常以英文为基准维护一套 JSON 文件，其他语言的 JSON 需要人工翻译或外包，成本高、同步慢、容易遗漏。

`i18n-ai-diff` 通过 LLM 自动完成这个过程：它监控英文源文件的变化，精确识别哪些 key 是新增、修改还是删除的，只对变化的部分调用翻译 API，结果写回对应语言的 JSON 文件。翻译缓存 + 源文件快照确保重复运行零开销，`skipKeys` 配置保留品牌名等不需要翻译的字段。兼容任何 OpenAI 标准接口的模型服务。

## 安装

```bash
npm install i18n-ai-diff
```

## 直接翻译

扫描基准语言目录，对比目标语言文件，只翻译新增和修改的 key。无变化时零 API 调用。

```bash
npx i18n-ai-diff
```

## 翻译+监听

先执行一次完整翻译，然后持续监听基准语言文件变化，修改后自动同步翻译到所有目标语言。适合开发阶段使用，`Ctrl+C` 退出。

```bash
npx i18n-ai-diff -w
```

## 强制全量

清空缓存和快照，忽略现有翻译，对所有 key 重新调用 LLM 翻译。适用于更换模型或需要全量刷新翻译质量时。

```bash
npx i18n-ai-diff -f
```

## 指定语言

覆盖配置文件中的 `targetLangs`，只翻译指定的语言。可传多个语言代码（BCP 47）。

```bash
npx i18n-ai-diff -l fr ja ko
```

## 配置

创建 `i18n-translate.config.ts`：

```typescript
import { defineConfig } from 'i18n-ai-diff';

export default defineConfig({
  baseLang: 'en',
  targetLangs: ['zh', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru'],
  localesDir: './src/i18n/messages',

  skipKeys: [
    'common.brandName',
    'footer.**',
  ],

  llm: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4o-mini',
    baseURL: 'https://api.openai.com/v1',
    maxTokens: 4096,
    temperature: 0.3,
    timeout: 30000,
    retries: 3,
  },

  concurrency: 5,
  batchSize: 20,
  cachePath: '.i18n-translate-cache.json',
});
```

其他选项：

```bash
npx i18n-ai-diff -c ./path/to/config.ts   # 指定配置文件
npx i18n-ai-diff --verbose                 # 详细日志
```

## 目录结构

```
locales/
├── en/           # 基准语言
│   ├── common.json
│   └── pages/
│       └── home.json
├── de/           # 目标语言（自动翻译）
│   └── ...
└── ja/
    └── ...
```

## 工作原理

- 基于源文件快照检测 en 的变化，只翻译新增和修改的 key
- 删除的 key 自动从目标语言文件中移除
- 翻译结果缓存，相同文本不重复调用 API
- 兼容 OpenAI API 标准接口

## 常见问题

### `Batch translation failed: Translation failed after N retries: Request was aborted.`

请求在超时时间内未返回，被中止。排查顺序：

1. **检查网络代理** — 确认 VPN/代理已开启，且当前代理地区能正常访问你配置的 LLM 服务（如 OpenAI 需要海外节点，而腾讯 HunYuan 在海外节点则连通性不佳）
2. LLM 服务本身响应慢或不稳定
3. `timeout` 设置过小（默认 30000ms）
4. `batchSize` 过大，单次请求包含过多文本

调整配置：

```typescript
llm: {
  timeout: 60000,   // 增大超时（ms）
  retries: 5,       // 增加重试次数
},
batchSize: 10,      // 减小批次大小
concurrency: 3,     // 降低并发数
```

### `LLM returned empty content`

LLM 返回了空内容。通常是模型限流或 prompt 过长。减小 `batchSize` 或换用更稳定的模型。

### `Config file not found`

未找到配置文件。确保项目根目录有 `i18n-translate.config.ts` 或通过 `-c` 指定路径。

### `llm.apiKey is required`

未配置 API Key。在配置文件中设置 `llm.apiKey`，或设置环境变量 `OPENAI_API_KEY`。

### `Cache version mismatch, resetting`

缓存文件版本不匹配（通常是升级后），缓存会自动重置。首次运行会重新翻译所有 key，后续运行恢复增量模式。

### `N keys failed, see .i18n-translate-failures.md`

部分 key 翻译失败。查看项目根目录的 `.i18n-translate-failures.md` 获取失败详情。再次运行 `npx i18n-ai-diff` 会自动重试这些 key。

## License

MIT
