# 词库反馈文件说明（给大肥鱼）

这个目录存放「未收录」反馈的固定格式说明。页面本身是 GitHub Pages 静态站，没有后端，也不会自动改仓库；用户只负责在本机收集、导出，大肥鱼按导出的文件补词。

- 固定格式：`t2i.lexicon-feedback/v1`
- Schema：`feedback/schema.json`
- 导出文件名：`lexicon-feedback-YYYYMMDD.json`
- 数据只来自用户浏览器 `localStorage`，键名 `t2i.lexiconFeedback.v1`；页面不会上传，也不会读取密钥。

## 1. 文件长什么样

顶层字段：

| 字段 | 含义 |
| --- | --- |
| `schema` | 固定为 `t2i.lexicon-feedback/v1` |
| `schemaUrl` | 固定为 `feedback/schema.json` |
| `generator` | 固定为 `txt2img-prompt` |
| `pageVersion` | 导出页面的版本 |
| `exportedAt` | 导出时间（ISO 8601） |
| `source` | 页面版本 + 当时词库规范词/中文 alias/英文 alias 规模 |
| `terms` | 待补录词数组，最多 300 条 |

每个 `terms[]` 词条：

| 字段 | 含义 |
| --- | --- |
| `term` | 未收录片段原文，已去掉首尾空白和纯标点 |
| `count` | 累计出现次数；每次拆解或生成命中一次加一 |
| `contexts` | 最近 5 条上下文，每条含 `idea`（完整想法原文）、`slot`、`slotLabel`、`at` |
| `slotHints` | 可能所在框：`person` / `outfit` / `pose` / `scene` / `light` / `style` |
| `note` | 用户可选备注：大概意思 / 想译成的英文 / 所属类别 |
| `createdAt` | 首次记录时间 |
| `updatedAt` | 最近记录时间 |
| `source` | 记录该词时的页面版本 / 词库标识 |

`contexts[].slot` 只是「可能所在框」，不是最终分类依据；同一个词在多个框出现时，`slotHints` 会合并。`count` 是操作级计数（一次拆解/生成算一次），不是逐字统计。

## 2. 补录流程（建议）

1. **先看 `source` 和 `pageVersion`**：确认反馈对应哪一版冻结词库。如果用户已经用新版本打开过页面且词条显示「词库已可命中，可移除」，优先复核，不要重复补。
2. **先跑去重**：
   - 用 `term` 在 `js/lexicon.js` 的规范词、中文 alias、英文 alias 里查一遍；
   - 同义/近义说法挂到已有规范词上，不要新建重复概念；
   - 与已有条目只有大小写、空格、全半角差异的，按同一条处理。
3. **按正确类别补规范词**：选择 `subject`、`appearance`、`hair`、`eyes`、`expression`、`outfit`、`pose`、`scene`、`object`、`light`、`camera`、`style`、`mood` 等实际类别，不要为了「能命中」全塞进 `scene` 或 `style`。
4. **规范词 + 常用 alias**：一条规范中文、一条规范英文；把上下文里出现的口语、简称、错别字、英文常见写法挂成 alias。alias 要能独立成词，不要制造会切开长词的短别名。
5. **不做颜色 × 物体笛卡尔积**：颜色、材质、图案只补常用搭配；不要为了增加条目数批量生成「颜色 + 所有物体」。物体词条按独立概念补，现有 `object` 约 2,859 条，继续遵守 2,500–4,000 的边界。
6. **补回归测试**：在 `tests/core.test.js` 增加至少一条能复现用户上下文的测试，断言：
   - 该说法能命中正确类别；
   - 英文稳定；
   - 不把长词切成短别名；
   - 最终组装不残留中文。
   运行 `node tests/core.test.js`，全部通过再收工。
7. **不要宣称 99% 覆盖**：这是规则 + 词典，不是语义模型；报告里写清楚新增词条、测试和仍可能缺的类别，不写「覆盖 99%」或类似承诺。
8. **不自行 push / 发布 Pages**：补完词库、测试和报告后交给用户确认。不要执行 `git push`，不要发布 GitHub Pages，不要改 `ant-architect`，不要调用网络大模型接口。
9. **处理用户备注**：`note` 里的「大概是什么意思 / 想译成什么英文 / 属于哪一类」只作为线索；如果与上下文冲突，以 `contexts[].idea` 的实际语境为准，拿不准就保留原文，不要瞎编。

## 3. 快速检查命令

```bash
# 跑全量回归
node tests/core.test.js

# 查当前词库统计
node -e "global.window=global; require('./js/lexicon.js'); console.log(window.T2I.Lexicon.stats)"

# 查某个词是否已经能命中
node -e "global.window=global; ['utils','lexicon','translator'].forEach(n=>require('./js/'+n+'.js')); console.log(window.T2I.Translator.translateZh('待查词'))"
```

## 4. 边界

- 页面不会自动建 GitHub issue；「在 GitHub 提交反馈」只是打开预填了标题和正文的 `issues/new` 页面，最终由用户确认提交。
- 页面里没有 token，也没有任何网络写入逻辑。
- 反馈 JSON 只在本机生成和下载；不要把它改成需要后端或第三方接口的流程。
