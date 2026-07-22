# i18n-ai-diff

**中文** | [English](https://github.com/JunTong-Wu/i18n-ai-diff/blob/master/README.md)

`i18n-ai-diff` 是一个增量式 AI 国际化翻译工具。你只需要维护母版语言 JSON，它会找出新增、修改和删除的 key，只对需要更新的文本调用 LLM，并将结果同步到目标语言文件。

项目既支持所有目标语言来自同一个母版的单母版模式，也支持日、韩文来自中文母版，德、意、法、西文来自英文母版这样的多母版模式。已有目标译文会被视为经过确认的资产；修改翻译路由不会自动重翻，只有母版文本后续发生变化或显式使用 `-f` 时才会刷新。

## 安装

需要 Node.js 18.19 或更高版本。

在项目中安装：

```bash
npm install i18n-ai-diff
```

也可以直接使用 `npx i18n-ai-diff`，无需全局安装。

## 第一步：准备语言目录

在项目中创建一个语言目录。每种语言占一个子目录，内部可以包含任意层级的 JSON 文件。

最简单的单母版模式项目只需要先创建母版目录：

```text
src/i18n/messages/
└── en/
    ├── common.json
    └── pages/
        └── home.json
```

例如 `en/common.json`：

```json
{
  "common": {
    "confirm": "Confirm",
    "cancel": "Cancel"
  },
  "brandName": "DWARFLAB"
}
```

目标语言目录和对应 JSON 文件可以不存在，首次翻译时会自动创建：

```text
src/i18n/messages/
├── en/           # 母版
├── ja/           # 自动创建
├── ko/           # 自动创建
└── fr/           # 自动创建
```

语言 JSON 当前只处理字符串值。嵌套对象支持任意深度；数字、布尔值、数组和 `null` 不会参与翻译。

## 第二步：创建配置

在项目根目录创建 `i18n-translate.config.ts`：

```typescript
import { defineConfig } from 'i18n-ai-diff';

export default defineConfig({
  baseLang: 'en',
  targetLangs: ['ja', 'ko', 'fr'],
  localesDir: './src/i18n/messages',

  llm: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4o-mini',
  },
});
```

然后设置 API Key：

```bash
export OPENAI_API_KEY="your-api-key"
```

也可以通过 `baseURL` 使用任何兼容 OpenAI Chat Completions API 的服务。

## 单母版模式

所有目标语言都来自同一个母版时，使用 `baseLang + targetLangs`：

```typescript
export default defineConfig({
  baseLang: 'en',
  targetLangs: ['zh-CN', 'ja', 'ko', 'fr', 'de'],
  localesDir: './src/i18n/messages',
  llm: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4o-mini',
  },
});
```

对应翻译路线：

```text
en → zh-CN, ja, ko, fr, de
```

这是配置最少、最适合首次使用的模式。

## 多母版模式

不同目标语言需要来自不同母版时，使用 `routes`：

```typescript
import { defineConfig } from 'i18n-ai-diff';

export default defineConfig({
  routes: [
    {
      sourceLang: 'zh-CN',
      targetLangs: ['ja', 'ko'],
    },
    {
      sourceLang: 'en',
      targetLangs: ['de', 'it', 'fr', 'es'],
    },
  ],
  localesDir: './src/i18n/messages',

  llm: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4o-mini',
  },
});
```

对应目录和翻译路线：

```text
src/i18n/messages/
├── zh-CN/        # 中文母版 ─→ ja, ko
├── en/           # 英文母版 ─→ de, it, fr, es
├── ja/
├── ko/
├── de/
├── it/
├── fr/
└── es/
```

多母版模式规则：

- 每个母版语言只能配置一条路由
- 每个目标语言只能属于一个母版路由
- 同一种语言不能同时作为母版语言和目标语言，以免 Watch 模式产生链式回写
- 多母版模式 `routes` 使用 `sourceLang + targetLangs`，不能与顶层 `baseLang + targetLangs` 混用
- 将目标语言改分配给其他母版时，会保留已有译文并建立新的增量基线

无论使用哪种模式，内部都会统一转换为 `sourceLang → targetLang` 翻译任务，缓存和快照也使用同一套隔离规则。
旧版多母版模式 route 中的 `baseLang` 字段仍可被读取，用于兼容已有项目；新配置建议使用 `sourceLang`。

## 常用配置

完整配置示例：

```typescript
export default defineConfig({
  routes: [
    { sourceLang: 'zh-CN', targetLangs: ['ja', 'ko'] },
    { sourceLang: 'en', targetLangs: ['de', 'it', 'fr', 'es'] },
  ],
  localesDir: './src/i18n/messages',

  skipKeys: [
    'common.brandName',
    'footer.**',
  ],

  prompt: '"DWARF" and "DWARFLAB" are brand names and must NOT be translated. Use terminology appropriate for astrophotography.',

  llm: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4o-mini',
    baseURL: 'https://api.openai.com/v1',
    maxTokens: 4096,
    temperature: 0.3,
    timeout: 60000,
    retries: 3,
  },

  concurrency: 3,
  batchSize: 20,
  watch: {
    debounceMs: 300,
    ignored: ['node_modules/**', '**/*.ts'],
  },
  cachePath: '.i18n-translate-cache.json',
});
```

`skipKeys` 支持 glob 形式的点路径。例如 `footer.**` 会让 `footer` 下的全部字符串保持母版原文。
`watch` 只配置 CLI 监听循环的参数，不会自动启用监听模式。

## 使用本地面板检查项目

完成配置后，可以打开项目面板：

```bash
npx i18n-ai-diff panel
```

面板只监听 `127.0.0.1`，并默认使用系统浏览器打开。项目概览保持只读：它可以展示单母版模式或多母版模式路由、扫描源文件与目标文件差异，并查看缓存和快照状态，但不会调用 LLM，也不会写入翻译文件。

**表格编辑器（Table editor）**会把所有已配置语言中的现有字符串 key 对齐到一张表格中。面板默认仍为只读；需要保存人工校对的文案时，必须显式启用编辑权限：

```bash
npx i18n-ai-diff panel --edit
```

选择一个逻辑 JSON 文件后，可以修改已有单元格或补齐缺失语言，最后点击 **Save N changes**。每行内部使用 JSON Pointer 标识，因此嵌套路径以及真实包含 `.`, `/`, `~` 的 key 都不会被破坏。数组、对象、数字、布尔值与 `null` 不进入可编辑表格，也不会被表格写入覆盖。

保存边界是显式且保守的：服务端只接受已配置语言与 manifest 中的逻辑 JSON 文件，写入前核对所有文件 revision，使用同目录临时文件原子替换，并且绝不会触发机器翻译。人工修改目标语言会把该目标对应的母版快照标记为已复核；修改母版不会同步更新其他目标，它们会进入 Pending。人工编辑不会写入或删除翻译缓存。

**CLI shortcut** 页面用于处理跨文件操作，行为应当与命令行一致。只读模式下它可以生成可复制命令；使用 `--edit` 启动面板后，它可以直接执行项目级流程：增量翻译 Pending、按语言范围强制刷新、以及一次性的母版到母版翻译。与 Table editor 中先进入浏览器草稿的 AI 翻译不同，CLI shortcut 执行后会立即写入本地文件、缓存和快照。

**Settings** 页面用于可视化编辑 `i18n-translate.config.mjs` 中的项目结构、语言路由、locale/cache 路径，以及 Prompt、skip keys、concurrency、batch size、CLI watch 防抖和忽略规则等 AI behavior 配置。它在只读模式下可查看，保存必须使用 `panel --edit`。Settings 保存时只会在导出的配置对象里 patch 受管字段，会保留自定义 imports、辅助函数、未修改字段外的注释，以及用户自有的 `llm` 运行时配置。保存配置不会触碰语言 JSON、缓存或快照。Panel style 中的面板语言等偏好属于个人浏览器偏好，保存在 localStorage，不会写入项目配置；保存项目配置后需要重启面板，新的路由、路径、Prompt、批处理或 watch 参数才会成为当前运行时配置。

```bash
npx i18n-ai-diff panel --port 4180   # 指定本地端口
npx i18n-ai-diff panel --no-open     # 启动但不自动打开浏览器
npx i18n-ai-diff panel --edit        # 显式启用表格编辑器保存
```

## 第三步：执行第一次翻译

配置完成后，在项目根目录运行：

```bash
npx i18n-ai-diff
```

工具会：

1. 加载并验证配置
2. 扫描所有母版目录中的 JSON 文件
3. 为每个文件找到对应的目标语言路由
4. 翻译缺失或需要更新的 key
5. 创建或更新目标语言 JSON
6. 保存翻译缓存和源文快照

再次运行时，如果母版没有变化，就不会调用翻译 API。

## 开发时持续监听

先执行一次增量翻译，然后持续监听所有母版目录：

```bash
npx i18n-ai-diff -w
```

某个母版文件变化时，只会更新该母版路由下的目标语言。按 `Ctrl+C` 退出。

可以在 `i18n-translate.config.mjs` 中调整监听循环参数：

```typescript
export default defineConfig({
  // ...
  watch: {
    debounceMs: 300, // 文件变化后的防抖等待时间
    ignored: ['node_modules/**', '**/*.ts'], // chokidar 忽略规则
  },
});
```

`watch` 对象只控制监听参数。进入监听模式始终需要显式执行 `-w` / `--watch`。

## 只处理指定语言

```bash
npx i18n-ai-diff -l fr ja ko
```

多母版模式会保留原有路线。例如配置为 `zh-CN → ja, ko` 和 `en → de, it, fr, es` 时，这条命令实际执行：

```text
zh-CN → ja, ko
en    → fr
```

多母版模式只能选择已经配置在某条路由中的语言。单母版模式保持原有行为，可以临时覆盖配置中的目标语言。该参数只影响本次运行，不会修改配置文件。

## 强制全量刷新

需要明确刷新现有译文时运行：

```bash
npx i18n-ai-diff -f
```

它会清空翻译缓存、忽略已有目标译文，并重新翻译所有非跳过 key。修改模型、prompt 或母版路线本身不会自动刷新已经成型的译文。

可以与语言筛选组合，只刷新指定语言：

```bash
npx i18n-ai-diff -f -l fr ja ko
```

## 其他 CLI 选项

```bash
npx i18n-ai-diff -c ./path/to/config.ts   # 指定配置文件
npx i18n-ai-diff --verbose                # 输出详细日志
npx i18n-ai-diff -v                       # 查看版本
```

## 工作原理

- 每条母版路由独立扫描、比较和生成目标文件
- 源文快照用于判断母版文本是否发生变化
- 翻译缓存按 `sourceLang + sourceText + targetLang` 隔离
- 只翻译新增、源文变化或仍为母版原文的 key
- 已有目标译文默认视为经过确认的资产
- 删除的 key 会从目标语言文件中移除
- Watch 模式删除母版文件时，会删除该路由对应的目标文件
- 每次完整运行后会清理已经不再使用的缓存条目

## 常见问题

### `Config file not found`

确保项目根目录存在 `i18n-translate.config.ts`，或者通过 `-c` 指定配置文件。

### `llm.apiKey is required`

在配置文件中设置 `llm.apiKey`，或设置环境变量 `OPENAI_API_KEY`。

### `Batch translation failed: Translation failed after N retries: Request was aborted.`

请求在超时时间内没有返回。建议依次检查：

1. 网络代理或 VPN 是否能访问配置的 LLM 服务
2. LLM 服务是否限流或响应不稳定
3. `timeout` 是否过小
4. `batchSize` 是否过大
5. `concurrency` 是否过高

可以尝试：

```typescript
llm: {
  timeout: 120000,
  retries: 5,
},
batchSize: 10,
concurrency: 2,
```

### `LLM returned empty content`

模型返回了空内容。可以降低批次大小、降低并发或更换模型。

### `Cache version mismatch, resetting`

升级后缓存格式发生变化，旧缓存会自动重置。已有目标译文不会因此重翻；工具会保留这些译文并建立新的增量快照。

### `N keys failed, see .i18n-translate-failures.md`

部分 key 翻译失败。查看项目根目录的 `.i18n-translate-failures.md`，再次运行普通翻译即可重试失败项。

## License

MIT
