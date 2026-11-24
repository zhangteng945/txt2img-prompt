/*
 * local-llm.js — 本地模型主流程
 *
 * 页面把用户「整体描述」直接交给本机 Ollama（qwen3.5:4b）：模型自己理解、
 * 拆成六个中英对照字段，并给出负向提示词。这里只负责：
 *   1. 构造 /api/chat 的非流式请求（think:false）；
 *   2. 清理 think 标签、解析唯一一个 JSON 对象；
 *   3. 校验六字段是否中英齐全、英文是否可用，并校验「补全」标记；
 *   4. 用户改中文后，用当前六个中文框 + 原始描述 + 现有英文作上下文，
 *      只重译待更新字段；
 *   5. 实际英文的独立回译、结构化比对、最多 1 轮有限修正和再次回译复核。
 *
 * 失败一律返回 status:'error'，绝不自动改成规则/词库结果；规则路径只能由
 * 页面上的「改用规则生成（次要）」显式触发。
 *
 * 成功路径不读取、不发送、不调用词库；模型英文原样进入六框。
 */
(function () {
  'use strict';

  const T2I = (window.T2I = window.T2I || {});
  const U = T2I.Utils;
  const BilingualVerify = T2I.BilingualVerify;

  const DEFAULT_API_ROOT = 'https://macbook-pro.tail349cac.ts.net:11434';
  const DEFAULT_MODEL = 'qwen3.5:4b';
  const STORAGE_KEY = 't2i.localLLM.v1';
  const TIMEOUT_MS = 50000;
  // 回译和修正各算一次串行请求；M1 16GB 上不并行，最多自动修正 1 轮。
  const BACKTRANSLATE_TIMEOUT_MS = 45000;
  const CORRECTION_TIMEOUT_MS = 50000;
  const MAX_CORRECTIONS = 1;
  const SLOTS = ['person', 'outfit', 'pose', 'scene', 'light', 'style'];
  const SLOT_LABELS = {
    person: '人物与外貌',
    outfit: '服装与造型',
    pose: '姿态与动作',
    scene: '场景与背景',
    light: '光线与镜头',
    style: '画风与质感'
  };
  const SLOT_ALIASES = {
    person: 'person',
    '人物': 'person',
    '人物与外貌': 'person',
    'subject': 'person',
    'appearance': 'person',
    outfit: 'outfit',
    '服装': 'outfit',
    '服装与造型': 'outfit',
    'clothing': 'outfit',
    pose: 'pose',
    '姿态': 'pose',
    '姿态与动作': 'pose',
    'action': 'pose',
    scene: 'scene',
    '场景': 'scene',
    '场景与背景': 'scene',
    'background': 'scene',
    light: 'light',
    '光线': 'light',
    '光线与镜头': 'light',
    'lighting': 'light',
    'camera': 'light',
    style: 'style',
    '画风': 'style',
    '画风与质感': 'style',
    'texture': 'style'
  };

  const BASE_PROMPT = [
    '你是中文文生图提示词的理解、拆解与翻译器。只输出一个 JSON 对象；不要 Markdown、代码围栏、解释或 <think> 标签。',
    '',
    '任务：读懂用户的整段中文描述，把它拆成六个中英对照字段，并由你自己把每个中文字段翻译成可直接粘贴到 Lustify Endgame（SDXL）/ ComfyUI 的英文生图提示词。',
    '',
    '英文 en 的产品形态（最重要，必须遵守）：',
    '- en 是逗号分隔的英文生图关键词/短语，不是英语叙述句，也不是把中文整句逐字翻译成句子。',
    '- 合格示例：short-haired woman, white shirt, jeans, reading a book by a window, morning cafe, soft window light',
    '- 允许用必要语法绑定谁做什么、在哪里：woman reading a book by a window；不要机械删掉介词，也不要把关系拆成孤立单词。',
    '- 有两个以上主体时，pose 的每个动作短语必须写清谁做什么：a girl standing next to a red car, her friend sitting on a bench waiting for her；不能只写 standing..., sitting...。人物已在 person 出现，也要在 pose 重复主体。',
    '- 禁止完整叙述句：不要写 A young woman is sitting by the window and reading a book.；也不要用 A scene of / This image depicts / There is / The picture shows / In this image / A photograph of 作为句子主体。',
    '- 每个 en 可以有多条逗号分隔短语；不要写成一段话，不要用句号结尾。句号换逗号但仍是完整句子的写法不合格。',
    '- 关系、动作主体/对象、方位和否定不能丢；否定按第 5 条放进 negative。',
    '',
    '六个字段（JSON key 固定）：',
    '- person：人物与外貌。身份、年龄、脸型、发型发色、眼睛、表情、妆容。',
    '- outfit：服装与造型。服装、颜色、材质、鞋包、首饰、妆造细节。',
    '- pose：姿态与动作。站坐行走、手势、视线、情绪动作，以及动作的主体、对象、方向和关系。',
    '- scene：场景与背景。地点、时间、天气、室内外、背景元素及物体关系。',
    '- light：光线与镜头。光源、光质、色温、焦段、景深、构图、机位。',
    '- style：画风与质感。摄影风格、电影感、胶片、调色、画风、质感。',
    '',
    '硬规则：',
    '1. 每个字段的 zh 也用简洁中文短语/短句写该维度内容；保留动作的主体/对象、否定、关系和范围，不写散文段落。',
    '2. 每个非空 zh 必须配 en；en 是你按整段上下文写出的英文提示词短语，不是中文标签的字面堆叠。',
    '3. 不要参照、检索或模仿任何外部词库、词典或固定译法；同一个中文词在不同上下文里可以译成不同英文。',
    '4. 不要编造用户没说的光线、镜头、景深、画风、身份、人数、服装、颜色、动作、视线、侧脸、表情或剧情。用户没提的字段留空字符串。',
    '4b. 光线/晨光/窗光只放 light，不要写进 scene；scene 只写地点、时间、天气和背景元素。不要把动作重复塞进 person 或 scene。',
    '5. 否定/禁止必须保持原意：画面里不要出现的东西放进 negative，不能变成正面肯定；局部否定要保留人物/背景/整体范围。',
    '6. negative 写一条可直接粘贴的英文负面提示词，并配中文对照；不要和正面内容冲突。',
    '7. 只使用 JSON 字符串，不要数组包字段；字段顺序按 person, outfit, pose, scene, light, style。',
    '',
    '输出结构（六个字段都要出现；没有内容的写空字符串）：',
    '{',
    ' "fields": {',
    '   "person": {"zh":"中文","en":"English"},',
    '   "outfit": {"zh":"中文","en":"English"},',
    '   "pose": {"zh":"中文","en":"English"},',
    '   "scene": {"zh":"中文","en":"English"},',
    '   "light": {"zh":"中文","en":"English"},',
    '   "style": {"zh":"中文","en":"English"}',
    ' },',
    ' "negative": {"zh":"中文对照","en":"low quality, blurry, watermark"},',
    ' "inferred": [],',
    ' "notes": []',
    '}',
    '',
    '英文形态对照（只示范写法，不要照抄内容）：',
    '不合格：A scene of a young woman. She is sitting by the window and reading a book.',
    '合格：young woman, sitting by the window, reading a book, morning cafe, soft window light',
    '关系句合格：a girl standing next to a red car, her friend sitting on a bench waiting for her',
    '',
    '输出前自查：每个非空 en 都不能是完整英语句子（不能出现主语 + is/are/was/were 的叙述），也不能只有 standing/sitting 而看不出谁在做；否定、动作对象和关系不能丢。',
    '',
    '示例（只示范粒度，不要照抄内容）：',
    '用户：短发女人穿米色风衣站在樱花树下，柔和自然光',
    '输出：{"fields":{"person":{"zh":"短发女人","en":"a woman with a short bob"},"outfit":{"zh":"米色风衣","en":"wearing a cream trench coat"},"pose":{"zh":"站在樱花树下","en":"standing beneath a cherry tree"},"scene":{"zh":"樱花树下","en":"beneath a cherry tree"},"light":{"zh":"柔和自然光","en":"soft natural light"},"style":{"zh":"","en":""}},"negative":{"zh":"低质量、模糊、水印","en":"low quality, blurry, watermark"},"inferred":[],"notes":[]}',
    '',
    '多主体关系示例（只示范如何把「谁做什么」留在 pose 里，不要照抄内容）：',
    '用户：一个女孩站在红色汽车旁，她的朋友坐在长椅上等她',
    '输出：{"fields":{"person":{"zh":"一个女孩，她的朋友","en":"a girl, her friend"},"outfit":{"zh":"","en":""},"pose":{"zh":"女孩站在红色汽车旁，朋友坐在长椅上等她","en":"a girl standing next to a red car, her friend sitting on a bench waiting for her"},"scene":{"zh":"红色汽车和长椅","en":"a red car and a bench"},"light":{"zh":"","en":""},"style":{"zh":"","en":""}},"negative":{"zh":"低质量、模糊、水印","en":"low quality, blurry, watermark"},"inferred":[],"notes":[]}'
  ];

  const INFER_ON = [
    '',
    '补全选项已开启：如果用户完全没有提到光线/镜头或画风，可以各补一条最常见、克制的英文，并在 inferred 数组里写 "light" 或 "style"。',
    '只允许补 light 和 style；绝不能补人物身份、剧情、服装、服装颜色、动作或物体。其他字段没提到就留空。'
  ];

  const INFER_OFF = [
    '',
    '补全选项已关闭：不要补任何用户没提到的光线、镜头、景深、画风或质感；对应字段必须留空字符串，inferred 必须是空数组。'
  ];

  const RETRANSLATE_PROMPT = [
    '你是中文文生图提示词的英文重译者。只输出一个 JSON 对象；不要 Markdown、代码围栏、解释或 <think> 标签。',
    '',
    '用户已经改过某些字段的中文。现在必须以 current_fields 里的当前中文为唯一依据重新翻译英文，并带上 original_idea 与其余字段作为上下文。',
    '',
    '英文 en 的产品形态（最重要，必须遵守）：',
    '- en 是可直接粘贴到 Lustify Endgame（SDXL）/ ComfyUI 的逗号分隔英文生图关键词/短语，不是英语叙述句，也不是中文整句的逐字翻译。',
    '- 合格示例：short-haired woman, white shirt, jeans, reading a book by a window, morning cafe, soft window light',
    '- 允许用必要语法绑定谁做什么、在哪里：woman reading a book by a window；不要机械删掉介词，也不要把关系拆成孤立单词。',
    '- 有两个以上主体时，pose 的每个动作短语必须写清谁做什么：a girl standing next to a red car, her friend sitting on a bench waiting for her；不能只写 standing..., sitting...。人物已在 person 出现，也要在 pose 重复主体。',
    '- 禁止完整叙述句：不要写 A young woman is sitting by the window and reading a book.；也不要用 A scene of / This image depicts / There is / The picture shows / In this image / A photograph of 作为句子主体。',
    '- 每个 en 可以有多条逗号分隔短语；不要写成一段话，不要用句号结尾。句号换逗号但仍是完整句子的写法不合格。',
    '',
    '硬规则：',
    '1. 绝不修改、回写或猜测中文；不要输出新的中文内容替代 current_fields。不要把用户改过的中文改回最初的整体描述或模型初稿。',
    '2. 对 pending 里的每个字段，必须给出准确英文提示词短语 en；也要给其余非空字段的 en 作为上下文（页面只会更新 pending 字段）。',
    '3. 保持动作的主体/对象、否定、关系、方位和范围，不能只剩孤立英文标签，也不能丢否定。',
    '4. 不要添加 current_fields 中文里没有的身份、人数、服装、颜色、动作、剧情、光线、镜头或画风。',
    '5. 不要参照、检索或模仿任何外部词库、词典或固定译法。',
    '6. 同时给出可直接粘贴的 negative 英文与中文对照；不要和当前正面内容冲突。',
    '',
    '英文形态示例（只示范写法）：',
    '不合格：The woman is sitting by the window and she is reading a book.',
    '合格：woman sitting by the window, reading a book, soft window light',
    '关系句合格：a girl standing next to a red car, her friend sitting on a bench waiting for her',
    '',
    '输出前自查：每个非空 en 都不能是完整英语句子（不能出现主语 + is/are/was/were 的叙述），也不能只有 standing/sitting 而看不出谁在做；否定、动作对象和关系不能丢。',
    '',
    '输出结构：',
    '{"fields":{"person":{"en":"..."},"outfit":{"en":"..."},"pose":{"en":"..."},"scene":{"en":"..."},"light":{"en":"..."},"style":{"en":"..."}},"negative":{"zh":"中文对照","en":"low quality, blurry, watermark"},"notes":[]}'
  ].join('\n');

  const BACKTRANSLATE_PROMPT = [
    '你是独立的英文生图提示词回译者。只输出一个 JSON 对象；不要 Markdown、代码围栏、解释或 <think> 标签。',
    '',
    '你会收到实际使用的英文生图提示词短语，按六个字段和 negative 分开。请把每个字段的英文忠实回译成简洁中文，只写英文实际表达的内容。',
    '',
    '硬规则：',
    '1. 不补全、不猜测、不美化，不添加英文里没有的主体、动作、服装、颜色、数量、物体、方位或否定。',
    '2. 保留主体、动作-对象关系、方位、数量、身体部位、服饰颜色和否定。',
    '3. 每个字段单独回译，不要合并，不要改写英文。',
    '4. 本次请求不会提供任何中文原文；不要参考任何中文原文，不要用外部词库或固定译法。',
    '5. 否定照实翻译：no text -> 没有文字；no watermark -> 没有水印。',
    '6. no smoking sign 是画面里的「禁止吸烟告示牌」，是标牌本身，不要改写成“不要出现吸烟”这类全局负面。',
    '',
    '输出结构（六个字段都要出现；英文为空的字段回译也留空）：',
    '{"fields":{"person":{"back_zh":""},"outfit":{"back_zh":""},"pose":{"back_zh":""},"scene":{"back_zh":""},"light":{"back_zh":""},"style":{"back_zh":""}},"negative":{"back_zh":""},"notes":[]}'
  ].join('\n');

  const CORRECTION_PROMPT = [
    '你是英文生图提示词的双向语义校对修正器。只输出一个 JSON 对象；不要 Markdown、代码围栏、解释或 <think> 标签。',
    '',
    '你会收到：current_fields（当前权威中文 + 实际英文）、backtranslation（实际英文的独立回译）、issues（结构化差异）、negative。',
    '任务：只修正英文 en 和 negative.en，使实际英文与当前中文一致；中文是权威，绝不修改、回写或替换。',
    '',
    '英文形态（必须保持）：',
    '- en 是逗号分隔的 SDXL / ComfyUI 生图提示词短语，不是英语叙述句。',
    '- 保留主体、动作-对象关系、方位、数量、身体部位、服饰颜色和否定；写明谁做什么。',
    '- 不参照、检索或模仿任何外部词库或固定译法。',
    '',
    '修正规则：',
    '1. 只改 fix_keys 里的字段英文；其余字段英文原样保留。绝不在 fields 里输出中文。fix_negative 为 false 时 negative 原样返回，不要借机加词。',
    '2. 修正漏译、凭空添加、主体/属性错绑、动作-对象关系、否定落位、数量、身体部位和重复罗列。',
    '3. 不添加当前中文没有的主体、身份、人数、服装、颜色、动作、物体、光线或画风；也不删除中文里已有的要素。',
    '4. 如果当前中文自身矛盾（例如下雨又晒太阳），或不同框的中文人物用词冲突（例如女孩/女人），不要擅自删掉一侧或替用户统一；两边都保留，并在 notes 里写明需要用户确认。',
    '5. 画面里的「禁止吸烟」告示牌 / no smoking sign 是正面物体；只有当前中文明确要求画面不要出现吸烟时，才把 smoking 放进 negative。不要看到 no 就把它扔进负面。',
    '6. 否定必须落位：中文说「不要文字，不要水印」，正面不能保留 no text / no watermark，负面要覆盖 text / watermark。',
    '7. 回译多出原文没有的人物、物体、颜色或数量时，删掉多出的部分，不要靠增加另一侧来圆场。',
    '',
    '输出结构：',
    '{"fields":{"person":{"en":""},"outfit":{"en":""},"pose":{"en":""},"scene":{"en":""},"light":{"en":""},"style":{"en":""}},"negative":{"zh":"中文对照","en":"low quality, blurry, watermark"},"notes":[]}'
  ].join('\n');

  const REASONS = {
    'empty-input': '没有可解析的想法文本',
    'empty-fields': '本地模型没有返回任何可用的六个字段内容',
    config: 'API 根地址不是 http(s) 地址，无法请求本机模型',
    network: '连不上本地模型。可能是模型没开、电脑休眠、Tailscale 未连上，或跨域未放行',
    cors: '浏览器拦截了跨域请求，可能是 Ollama 的 CORS 未放行当前 Origin',
    timeout: '本地模型超时未返回，已中止这次请求',
    aborted: '这次本地模型请求已中止',
    http: '本地模型返回了 HTTP 错误',
    server: '本地模型返回了错误信息',
    'invalid-json': '本地模型返回的不是有效 JSON',
    'invalid-spec': '本地模型返回的字段不完整或英文不可用',
    'missing-english': '某些中文片段没有可用的英文',
    'narrative-english': '本地模型返回的英文仍是叙述句，不是生图提示词短语',
    inferred: '模型补全了未提示要素，但「允许模型推测」处于关闭状态',
    'empty-negative': '本地模型没有给出可用的英文负面提示词',
    'empty-backtranslation': '本地模型没有给出可用的独立中文回译',
    'empty-english': '当前没有可回译的英文内容',
    'correction-failed': '英文有限修正失败，已保留修正前的内容',
    'no-pending': '没有需要重新生成英文的字段',
    'empty-current': '当前六个中文框都是空的，没有可重译内容',
    unexpected: '本地模型请求出现未预期错误'
  };

  const INFERRABLE = ['light', 'style'];
  // 模型有时用「无」表示这个字段没有内容；不能把它当成有中文却缺英文。
  const EMPTY_FIELD_RE = /^(?:无|没有|暂无|不适用|不涉及|none|n\/a|null|[-—–]+|（无）|\(无\))$/i;

  function fieldZh(value) {
    const text = asText(value);
    return EMPTY_FIELD_RE.test(text) ? '' : text;
  }

  function reasonText(code) {
    return REASONS[code] || REASONS.unexpected;
  }

  function normalizeApiRoot(value) {
    const text = String(value == null ? '' : value).trim().replace(/\/+$/, '');
    return text || DEFAULT_API_ROOT;
  }

  function normalizeModel(value) {
    const text = String(value == null ? '' : value).trim();
    return text || DEFAULT_MODEL;
  }

  function defaultSettings() {
    return { apiRoot: DEFAULT_API_ROOT, model: DEFAULT_MODEL, infer: false };
  }

  function loadSettings(storage) {
    const out = defaultSettings();
    if (!storage) return out;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return out;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return out;
      // 旧版存过 enabled:false；主流程现在固定使用本地模型，这个字段不再生效。
      if (typeof saved.apiRoot === 'string' && saved.apiRoot.trim()) out.apiRoot = normalizeApiRoot(saved.apiRoot);
      if (typeof saved.model === 'string' && saved.model.trim()) out.model = normalizeModel(saved.model);
      out.infer = saved.infer === true;
    } catch (err) {
      return defaultSettings();
    }
    return out;
  }

  function saveSettings(storage, settings) {
    if (!storage) return false;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({
        apiRoot: normalizeApiRoot(settings && settings.apiRoot),
        model: normalizeModel(settings && settings.model),
        infer: !!(settings && settings.infer)
      }));
      return true;
    } catch (err) {
      return false;
    }
  }

  function buildSystemPrompt(options) {
    const infer = !!(options && options.infer);
    return BASE_PROMPT.concat(infer ? INFER_ON : INFER_OFF).join('\n');
  }

  function buildRequest(settings, systemPrompt, userContent) {
    const apiRoot = normalizeApiRoot(settings && settings.apiRoot);
    const model = normalizeModel(settings && settings.model);
    return {
      apiRoot: apiRoot,
      model: model,
      url: apiRoot + '/api/chat',
      body: {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: String(userContent == null ? '' : userContent) }
        ],
        stream: false,
        // qwen3.5 不加 think:false 会先吐 <think>，污染 JSON。
        think: false,
        format: 'json',
        options: {
          temperature: 0,
          top_p: 0.9,
          num_ctx: 4096,
          num_predict: 1800
        }
      }
    };
  }

  function buildGenerateRequest(settings, idea, options) {
    return buildRequest(settings, buildSystemPrompt(options), String(idea == null ? '' : idea));
  }

  function buildRetranslateRequest(settings, payload) {
    const data = payload || {};
    const current = data.fields || {};
    const pending = Array.isArray(data.pending) ? data.pending.slice() : [];
    const user = {
      original_idea: String(data.idea == null ? '' : data.idea),
      pending: pending,
      current_fields: {},
      current_negative: data.negative || { zh: '', en: '' }
    };
    SLOTS.forEach(function (key) {
      const field = current[key] || {};
      user.current_fields[key] = {
        zh: String(field.zh == null ? '' : field.zh),
        en: String(field.en == null ? '' : field.en)
      };
    });
    return buildRequest(settings, RETRANSLATE_PROMPT, JSON.stringify(user, null, 2));
  }

  // 独立回译请求只携带实际英文，不携带 idea、current_fields.zh 或任何目标中文，
  // 防止模型把用户中文抄回来当回译。
  function buildBacktranslateRequest(settings, payload) {
    const data = payload || {};
    const fields = currentFieldPayload(data.fields);
    const negative = data.negative || {};
    const user = {
      fields: {},
      negative: { en: String(negative.en == null ? '' : negative.en) }
    };
    SLOTS.forEach(function (key) {
      user.fields[key] = { en: fields[key].en };
    });
    return buildRequest(settings, BACKTRANSLATE_PROMPT, JSON.stringify(user, null, 2));
  }

  // 有限修正请求允许携带权威中文，因为它要据此改英文；但它不是回译请求。
  function buildCorrectionRequest(settings, payload) {
    const data = payload || {};
    const fields = currentFieldPayload(data.fields);
    const keys = (Array.isArray(data.keys) ? data.keys : SLOTS).filter(function (key) {
      return SLOTS.indexOf(key) !== -1;
    });
    const user = {
      current_fields: fields,
      backtranslation: data.back || {},
      issues: Array.isArray(data.issues) ? data.issues : [],
      negative: data.negative || { zh: '', en: '' },
      fix_keys: keys,
      fix_negative: data.allowNegative === true
    };
    return buildRequest(settings, CORRECTION_PROMPT, JSON.stringify(user, null, 2));
  }

  function stripThinkAndFence(content) {
    let text = String(content == null ? '' : content);
    text = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
    text = text.replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '');
    text = text.replace(/<\/?think(?:ing)?\b[^>]*>/gi, '');
    text = text.replace(/```(?:json)?/gi, '').replace(/```/g, '');
    return text.trim();
  }

  function parseModelContent(content) {
    const text = stripThinkAndFence(content);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw codedError('invalid-json', '没有找到 JSON 对象');
    }
    let parsed;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch (err) {
      throw codedError('invalid-json', 'JSON 解析失败');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw codedError('invalid-json', '顶层不是 JSON 对象');
    }
    return parsed;
  }

  function codedError(code, message, extra) {
    const error = new Error(message || reasonText(code));
    error.code = code;
    if (extra) {
      Object.keys(extra).forEach(function (key) { error[key] = extra[key]; });
    }
    return error;
  }

  function asText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function cleanEn(value) {
    // 模型偶尔会把中文整句翻译成英语叙述句；在进入六框前压成提示词短语。
    // 这里只做形态清洗，不翻译、不增删内容，也不读取词库。
    return U.promptifyEnglish(asText(value));
  }

  function usableEn(value) {
    const text = cleanEn(value);
    if (!text || U.hasCjk(text) || !U.hasLatin(text)) return '';
    return text;
  }

  function assertPromptStyle(en, key) {
    if (!U.isPromptStyle(en)) {
      throw codedError(
        'narrative-english',
        (SLOT_LABELS[key] || key) + ' 的英文仍是叙述句，不能直接作为 SDXL/ComfyUI 提示词（' + snippet(en) + '）'
      );
    }
    return en;
  }

  function normalizeKey(key) {
    const text = String(key == null ? '' : key).trim();
    if (!text) return '';
    if (SLOTS.indexOf(text) !== -1) return text;
    const lower = text.toLowerCase();
    if (SLOT_ALIASES[lower]) return SLOT_ALIASES[lower];
    if (SLOT_ALIASES[text]) return SLOT_ALIASES[text];
    return '';
  }

  function fieldMap(data) {
    const source = data && data.fields;
    const out = Object.create(null);
    if (Array.isArray(source)) {
      source.forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        const key = normalizeKey(item.key || item.slot || item.name);
        if (key) out[key] = item;
      });
    } else if (source && typeof source === 'object') {
      Object.keys(source).forEach(function (rawKey) {
        const key = normalizeKey(rawKey);
        if (key && source[rawKey] && typeof source[rawKey] === 'object') out[key] = source[rawKey];
      });
    } else {
      SLOTS.forEach(function (key) {
        if (data && data[key] && typeof data[key] === 'object') out[key] = data[key];
      });
    }
    return out;
  }

  function normalizeInferred(data) {
    const raw = data && data.inferred;
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    const out = [];
    list.forEach(function (item) {
      const key = normalizeKey(item);
      if (key && out.indexOf(key) === -1) out.push(key);
    });
    return out;
  }

  function normalizeNotes(data) {
    if (!data || !Array.isArray(data.notes)) return [];
    return data.notes.slice(0, 12).map(function (item) { return asText(item); }).filter(Boolean);
  }

  function normalizeNegative(data) {
    let source = data && data.negative;
    if (typeof source === 'string') {
      source = { zh: '', en: source };
    } else if (!source || typeof source !== 'object') {
      source = {
        zh: data && (data.negative_zh || data.negativeZh),
        en: data && (data.negative_en || data.negativeEn)
      };
    }
    const en = usableEn(source && source.en);
    if (!en) {
      throw codedError('empty-negative', '没有可用的英文负面提示词');
    }
    return {
      zh: asText(source && (source.zh || source.negative_zh)),
      en: en
    };
  }

  function normalizeInitial(data, options) {
    const fields = fieldMap(data);
    const inferred = normalizeInferred(data);
    const inferEnabled = !!(options && options.infer);
    const out = Object.create(null);
    let contentCount = 0;
    let inferredCount = 0;

    SLOTS.forEach(function (key) {
      const source = fields[key] || {};
      const zh = fieldZh(source.zh);
      const en = usableEn(source.en);
      if (!zh && !en) {
        out[key] = { zh: '', en: '', inferred: false };
        return;
      }
      contentCount += 1;
      if (!zh) {
        throw codedError('invalid-spec', SLOT_LABELS[key] + ' 只有英文，没有中文对照');
      }
      if (!en) {
        throw codedError('missing-english', SLOT_LABELS[key] + ' 的中文缺少可用英文（' + zh + '）');
      }
      assertPromptStyle(en, key);
      out[key] = { zh: zh, en: en, inferred: inferred.indexOf(key) !== -1 };
      if (out[key].inferred) inferredCount += 1;
    });

    if (!contentCount) {
      throw codedError('empty-fields', '六个字段都是空的');
    }

    if (inferred.length) {
      inferred.forEach(function (key) {
        if (INFERRABLE.indexOf(key) === -1) {
          throw codedError('invalid-spec', '模型把「' + SLOT_LABELS[key] + '」标成了补全；只允许补光线/镜头和画风');
        }
        if (!out[key] || !out[key].zh || !out[key].en) {
          throw codedError('invalid-spec', '补全字段「' + SLOT_LABELS[key] + '」是空的');
        }
      });
      if (!inferEnabled) {
        throw codedError('inferred',
          '模型补全了 ' + inferred.map(function (key) { return SLOT_LABELS[key]; }).join('、') +
          '，但补全开关是关闭的。为了不把推测当成原文，这次结果没有采用。');
      }
    }

    return {
      fields: out,
      negative: normalizeNegative(data),
      inferred: inferred,
      inferredCount: inferredCount,
      notes: normalizeNotes(data)
    };
  }

  function normalizeRetranslation(data, pending, currentFields) {
    const fields = fieldMap(data);
    const out = Object.create(null);
    const missing = [];
    pending.forEach(function (key) {
      const currentZh = asText(currentFields && currentFields[key] && currentFields[key].zh);
      // 中文已被清空：这一项不再需要英文，允许返回空字符串。
      if (!currentZh) {
        out[key] = { en: '' };
        return;
      }
      const source = fields[key];
      const en = source ? usableEn(source.en) : '';
      if (!en) {
        missing.push(SLOT_LABELS[key] || key);
        return;
      }
      assertPromptStyle(en, key);
      out[key] = { en: en };
    });
    if (missing.length) {
      throw codedError('missing-english', '重译结果缺少：' + missing.join('、'));
    }
    let negative = null;
    if (data && data.negative) {
      negative = normalizeNegative(data);
    } else if (data && (data.negative_en || data.negativeEn)) {
      negative = normalizeNegative(data);
    }
    return {
      fields: out,
      negative: negative,
      notes: normalizeNotes(data)
    };
  }

  function currentFieldPayload(fields) {
    const out = Object.create(null);
    SLOTS.forEach(function (key) {
      const field = fields && fields[key] || {};
      out[key] = {
        zh: String(field.zh == null ? '' : field.zh),
        en: String(field.en == null ? '' : field.en)
      };
    });
    return out;
  }

  function cloneFieldPayload(fields) {
    return currentFieldPayload(fields);
  }

  function normalizeReviewNegative(source) {
    const raw = source && typeof source === 'object' ? source : {};
    return {
      zh: asText(raw.zh),
      en: asText(raw.en)
    };
  }

  function backEntry(source, key) {
    const entry = source && source[key];
    if (typeof entry === 'string') return asText(entry);
    if (!entry || typeof entry !== 'object') return '';
    return asText(entry.back_zh || entry.backtranslation || entry.backZh || entry.zh);
  }

  function normalizeBacktranslation(data, fields, negative) {
    const source = data && (data.fields || data.backtranslation || data.back || null);
    const root = source && typeof source === 'object' ? source : (data && typeof data === 'object' ? data : {});
    const out = Object.create(null);
    const missing = [];
    SLOTS.forEach(function (key) {
      const backZh = backEntry(root, key);
      if (fields[key].en && !backZh) missing.push(SLOT_LABELS[key] || key);
      out[key] = { back_zh: backZh };
    });
    let backNegative = '';
    if (data && typeof data.negative === 'string') {
      backNegative = asText(data.negative);
    } else if (data && data.negative && typeof data.negative === 'object') {
      backNegative = asText(data.negative.back_zh || data.negative.backtranslation || data.negative.zh);
    }
    if (!backNegative && data && (data.negative_back_zh || data.negativeBackZh)) {
      backNegative = asText(data.negative_back_zh || data.negativeBackZh);
    }
    if (negative && negative.en && !backNegative) missing.push('负面提示词');
    if (missing.length) {
      throw codedError('empty-backtranslation', '独立回译缺少：' + missing.join('、'));
    }
    return {
      fields: out,
      negative: { back_zh: backNegative },
      notes: normalizeNotes(data)
    };
  }

  function normalizeCorrection(data, fields, keys) {
    const source = fieldMap(data);
    const out = Object.create(null);
    const missing = [];
    keys.forEach(function (key) {
      const currentZh = asText(fields && fields[key] && fields[key].zh);
      const entry = source[key];
      const en = entry ? usableEn(entry.en) : '';
      if (currentZh && !en) {
        missing.push(SLOT_LABELS[key] || key);
        return;
      }
      if (!currentZh) {
        out[key] = { en: '' };
        return;
      }
      assertPromptStyle(en, key);
      out[key] = { en: en };
    });
    if (missing.length) {
      throw codedError('missing-english', '修正结果缺少：' + missing.join('、'));
    }
    let negative = null;
    if (data && data.negative && typeof data.negative === 'object' && data.negative.en) {
      negative = normalizeNegative(data);
    }
    return {
      fields: out,
      negative: negative,
      notes: normalizeNotes(data)
    };
  }

  function applyCorrection(fields, negative, correction, keys, allowNegative) {
    const nextFields = cloneFieldPayload(fields);
    const nextNegative = normalizeReviewNegative(negative);
    const changed = [];
    keys.forEach(function (key) {
      const entry = correction.fields && correction.fields[key];
      if (!entry) return;
      const en = String(entry.en == null ? '' : entry.en);
      if (en !== nextFields[key].en) {
        nextFields[key].en = en;
        if (changed.indexOf(key) === -1) changed.push(key);
      }
    });
    let negativeChanged = false;
    if (allowNegative && correction.negative) {
      nextNegative.zh = correction.negative.zh || nextNegative.zh;
      nextNegative.en = correction.negative.en || nextNegative.en;
      negativeChanged = true;
    }
    return {
      fields: nextFields,
      negative: nextNegative,
      changed: changed,
      negativeChanged: negativeChanged
    };
  }

  function snippet(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').slice(0, 180);
  }

  function resolveFetch(options) {
    return (options && options.fetchImpl) ||
      (typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) :
        (typeof fetch === 'function' ? fetch : null));
  }

  function runRequest(request, options, started) {
    const opts = options || {};
    return new Promise(function (resolve, reject) {
      if (!/^https?:\/\//i.test(request.apiRoot)) {
        reject(codedError('config'));
        return;
      }
      const fetchImpl = resolveFetch(opts);
      if (!fetchImpl) {
        reject(codedError('network', '当前环境没有 fetch'));
        return;
      }

      const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : TIMEOUT_MS;
      let abortReason = '';
      const controller = new AbortController();
      const external = opts.signal;
      let finished = false;

      function cleanup() {
        clearTimeout(timer);
        if (external && typeof external.removeEventListener === 'function') {
          external.removeEventListener('abort', onExternalAbort);
        }
      }
      function onExternalAbort() {
        abortReason = 'aborted';
        try { controller.abort(); } catch (err) { /* 忽略 */ }
      }
      if (external) {
        if (external.aborted) onExternalAbort();
        else if (typeof external.addEventListener === 'function') external.addEventListener('abort', onExternalAbort);
      }
      const timer = setTimeout(function () {
        abortReason = 'timeout';
        try { controller.abort(); } catch (err) { /* 忽略 */ }
      }, timeoutMs);

      let requestPromise;
      try {
        requestPromise = fetchImpl(request.url, {
          method: 'POST',
          mode: 'cors',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request.body),
          signal: controller.signal
        });
      } catch (fetchError) {
        if (finished) return;
        finished = true;
        cleanup();
        reject(codedError('network', fetchError && fetchError.message ? fetchError.message : 'fetch 同步失败'));
        return;
      }
      Promise.resolve(requestPromise).then(function (res) {
        if (!res || typeof res !== 'object') {
          throw codedError('network', '空的 fetch 响应');
        }
        if (!res.ok) {
          const status = Number(res.status) || 0;
          const code = status === 403 || status === 401 ? 'cors' : (status >= 500 ? 'server' : 'http');
          throw codedError(code, 'HTTP ' + status, { status: status });
        }
        return Promise.resolve().then(function () { return res.json(); }).catch(function () {
          throw codedError('invalid-json', 'HTTP 响应不是 JSON');
        });
      }).then(function (data) {
        if (data && typeof data === 'object' && data.error) {
          throw codedError('server', snippet(data.error));
        }
        const content = extractContent(data);
        if (!content) {
          throw codedError('invalid-json', '响应里没有 message.content');
        }
        if (finished) return;
        finished = true;
        cleanup();
        resolve({ content: content, elapsedMs: Date.now() - started });
      }).catch(function (err) {
        if (finished) return;
        finished = true;
        cleanup();
        let code = err && err.code;
        if (abortReason === 'timeout') code = 'timeout';
        else if (abortReason === 'aborted') code = 'aborted';
        if (!code || code === 'unexpected') {
          if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')))) {
            code = abortReason || 'timeout';
          } else if (err instanceof TypeError || /fetch|network|load failed/i.test(String(err.message || ''))) {
            code = 'network';
          } else {
            code = 'unexpected';
          }
        }
        const error = codedError(code, err && err.message ? err.message : reasonText(code));
        if (err && err.status) error.status = err.status;
        reject(error);
      });
    });
  }

  function extractContent(data) {
    if (!data || typeof data !== 'object') return '';
    if (data.message && data.message.content != null) {
      const content = data.message.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content.map(function (part) {
          return part && typeof part.text === 'string' ? part.text : '';
        }).join('');
      }
    }
    if (typeof data.response === 'string') return data.response;
    if (data.choices && data.choices[0] && data.choices[0].message &&
        typeof data.choices[0].message.content === 'string') {
      return data.choices[0].message.content;
    }
    return '';
  }

  function failure(code, request, started, extra) {
    const out = {
      status: 'error',
      requested: true,
      code: code,
      reason: reasonText(code),
      elapsedMs: Date.now() - started,
      model: request ? request.model : '',
      endpoint: request ? request.url : ''
    };
    if (extra) {
      Object.keys(extra).forEach(function (key) { out[key] = extra[key]; });
    }
    return out;
  }

  function reviewFailure(code, request, started, fields, negative, extra) {
    const reason = reasonText(code);
    const out = {
      status: 'error',
      requested: true,
      code: code,
      reason: reason,
      fields: cloneFieldPayload(fields),
      negative: normalizeReviewNegative(negative),
      elapsedMs: Date.now() - started,
      model: request ? request.model : '',
      endpoint: request ? request.url : '',
      review: {
        status: 'error',
        error: reason,
        issues: [],
        slots: {},
        negative: { zh: '', en: '', backZh: '', issues: [] },
        snapshot: BilingualVerify.snapshotOf(fields),
        checkedAt: Date.now(),
        model: request ? request.model : '',
        calls: []
      }
    };
    const baseReview = out.review;
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        if (key !== 'review') out[key] = extra[key];
      });
    }
    if (extra && extra.review) {
      out.review = Object.assign({}, baseReview, extra.review);
    }
    return out;
  }

  function backtranslate(settings, payload, options) {
    const opts = options || {};
    const started = Date.now();
    const data = payload || {};
    const fields = currentFieldPayload(data.fields);
    const negative = normalizeReviewNegative(data.negative);
    const hasEnglish = SLOTS.some(function (key) { return !!fields[key].en; }) || !!negative.en;
    if (!hasEnglish) {
      return Promise.resolve({
        status: 'error',
        requested: false,
        code: 'empty-english',
        reason: reasonText('empty-english'),
        elapsedMs: 0
      });
    }
    const request = buildBacktranslateRequest(settings, { fields: fields, negative: negative });
    return runRequest(request, {
      signal: opts.signal,
      fetchImpl: opts.fetchImpl,
      timeoutMs: Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : BACKTRANSLATE_TIMEOUT_MS
    }, started).then(function (response) {
      let parsed;
      try {
        parsed = parseModelContent(response.content);
      } catch (err) {
        throw codedError('invalid-json', '回译内容不是有效 JSON', {
          detail: snippet(stripThinkAndFence(response.content))
        });
      }
      const normalized = normalizeBacktranslation(parsed, fields, negative);
      return {
        status: 'ok',
        requested: true,
        code: 'ok',
        reason: '独立回译完成',
        fields: normalized.fields,
        negative: normalized.negative,
        notes: normalized.notes,
        model: request.model,
        endpoint: request.url,
        elapsedMs: Date.now() - started
      };
    }).catch(function (err) {
      const code = (err && err.code) || 'unexpected';
      return failure(code, request, started, {
        detail: err && err.message ? snippet(err.message) : ''
      });
    });
  }

  function correct(settings, payload, options) {
    const opts = options || {};
    const started = Date.now();
    const data = payload || {};
    const fields = currentFieldPayload(data.fields);
    const negative = normalizeReviewNegative(data.negative);
    const keys = (Array.isArray(data.keys) ? data.keys : SLOTS).filter(function (key) {
      return SLOTS.indexOf(key) !== -1;
    });
    const request = buildCorrectionRequest(settings, {
      fields: fields,
      back: data.back || {},
      issues: data.issues || [],
      negative: negative,
      keys: keys,
      allowNegative: data.allowNegative === true
    });
    return runRequest(request, {
      signal: opts.signal,
      fetchImpl: opts.fetchImpl,
      timeoutMs: Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : CORRECTION_TIMEOUT_MS
    }, started).then(function (response) {
      let parsed;
      try {
        parsed = parseModelContent(response.content);
      } catch (err) {
        throw codedError('invalid-json', '修正内容不是有效 JSON', {
          detail: snippet(stripThinkAndFence(response.content))
        });
      }
      const normalized = normalizeCorrection(parsed, fields, keys);
      return {
        status: 'ok',
        requested: true,
        code: 'ok',
        reason: '英文有限修正完成',
        keys: keys,
        fields: normalized.fields,
        negative: normalized.negative,
        notes: normalized.notes,
        model: request.model,
        endpoint: request.url,
        elapsedMs: Date.now() - started
      };
    }).catch(function (err) {
      const code = (err && err.code) || 'unexpected';
      return failure(code, request, started, {
        detail: err && err.message ? snippet(err.message) : ''
      });
    });
  }

  /*
   * 双向校对编排（串行，最多自动修正 1 轮）：
   *   1. 只拿实际英文做独立回译；
   *   2. 与权威中文比对，结构化记录差异；
   *   3. 有可修正差异时，按当前中文修一次英文；
   *   4. 再独立回译一次复核。
   * 任何一步失败都返回 error，并保留调用前的英文和中文；不回退词库。
   */
  async function review(settings, payload, options) {
    const opts = options || {};
    const started = Date.now();
    const data = payload || {};
    const originalFields = currentFieldPayload(data.fields);
    const originalNegative = normalizeReviewNegative(data.negative);
    const allowedKeys = (Array.isArray(opts.keys) ? opts.keys : SLOTS).filter(function (key) {
      return SLOTS.indexOf(key) !== -1;
    });
    const maxCorrections = Math.max(0, Math.min(MAX_CORRECTIONS,
      opts.maxCorrections == null ? MAX_CORRECTIONS : Number(opts.maxCorrections) || 0));
    const correctEnabled = opts.correct !== false && maxCorrections > 0;
    const calls = [];

    if (!SLOTS.some(function (key) { return !!originalFields[key].en; })) {
      return reviewFailure('empty-english', null, started, originalFields, originalNegative, {
        review: { error: reasonText('empty-english') }
      });
    }

    const first = await backtranslate(settings, {
      fields: originalFields,
      negative: originalNegative
    }, {
      signal: opts.signal,
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs
    });
    calls.push({ op: 'backtranslate', code: first.code, elapsedMs: first.elapsedMs });
    if (first.status !== 'ok') {
      return reviewFailure(first.code, first.request, started, originalFields, originalNegative, {
        detail: first.detail,
        calls: calls,
        review: { error: first.reason, calls: calls }
      });
    }

    const initialComparison = BilingualVerify.compare({
      fields: originalFields,
      back: first.fields,
      negative: originalNegative,
      backNegative: first.negative,
      idea: data.idea,
      compareIdea: data.compareIdea === true
    });
    const initial = {
      fields: cloneFieldPayload(originalFields),
      negative: normalizeReviewNegative(originalNegative),
      back: first.fields,
      backNegative: first.negative,
      issues: initialComparison.issues,
      status: initialComparison.status
    };

    let currentFields = cloneFieldPayload(originalFields);
    let currentNegative = normalizeReviewNegative(originalNegative);
    let finalComparison = initialComparison;
    let finalBack = first;
    let corrected = false;
    let correctedKeys = [];
    let correctionError = '';
    let recheckError = '';

    const fixable = initialComparison.issues.filter(function (issue) {
      if (!issue.fixable) return false;
      if (issue.slot === 'negative') return true;
      return allowedKeys.indexOf(issue.slot) !== -1;
    });
    const correctionKeys = [];
    fixable.forEach(function (issue) {
      if (issue.slot !== 'negative' && correctionKeys.indexOf(issue.slot) === -1) correctionKeys.push(issue.slot);
    });

    if (correctEnabled && fixable.length) {
      const correction = await correct(settings, {
        fields: currentFields,
        back: first.fields,
        issues: fixable,
        negative: currentNegative,
        keys: correctionKeys,
        allowNegative: fixable.some(function (issue) { return issue.slot === 'negative'; })
      }, {
        signal: opts.signal,
        fetchImpl: opts.fetchImpl,
        timeoutMs: opts.correctionTimeoutMs
      });
      calls.push({ op: 'correct', code: correction.code, elapsedMs: correction.elapsedMs });
      if (correction.status !== 'ok') {
        correctionError = correction.reason;
        return reviewFailure(correction.code, correction.request, started, currentFields, currentNegative, {
          detail: correction.detail,
          calls: calls,
          review: {
            status: 'error',
            error: '有限修正失败：' + correction.reason,
            issues: initialComparison.issues,
            slots: initialComparison.slots,
            negative: initialComparison.negative,
            snapshot: BilingualVerify.snapshotOf(currentFields),
            checkedAt: Date.now(),
            model: correction.model,
            calls: calls,
            initial: initial,
            corrected: false,
            correctedKeys: []
          }
        });
      }

      const applied = applyCorrection(currentFields, currentNegative, correction, correctionKeys,
        fixable.some(function (issue) { return issue.slot === 'negative'; }));
      currentFields = applied.fields;
      currentNegative = applied.negative;
      corrected = applied.changed.length > 0 || applied.negativeChanged;
      correctedKeys = applied.changed.slice();
      if (corrected) {
        const second = await backtranslate(settings, {
          fields: currentFields,
          negative: currentNegative
        }, {
          signal: opts.signal,
          fetchImpl: opts.fetchImpl,
          timeoutMs: opts.timeoutMs
        });
        calls.push({ op: 'backtranslate', code: second.code, elapsedMs: second.elapsedMs });
        if (second.status !== 'ok') {
          recheckError = second.reason;
          const errorReview = {
            status: 'error',
            error: '修正后的再次回译失败：' + second.reason,
            issues: initialComparison.issues,
            slots: initialComparison.slots,
            negative: initialComparison.negative,
            snapshot: BilingualVerify.snapshotOf(currentFields),
            checkedAt: Date.now(),
            model: second.model || first.model,
            calls: calls,
            initial: initial,
            corrected: true,
            correctedKeys: correctedKeys.slice(),
            round: 1
          };
          const out = reviewFailure(second.code, second.request, started, currentFields, currentNegative, {
            detail: second.detail,
            calls: calls,
            review: errorReview
          });
          out.review = errorReview;
          out.review.corrected = true;
          out.review.correctedKeys = correctedKeys.slice();
          return out;
        }
        finalBack = second;
        finalComparison = BilingualVerify.compare({
          fields: currentFields,
          back: second.fields,
          negative: currentNegative,
          backNegative: second.negative,
          idea: data.idea,
          compareIdea: data.compareIdea === true
        });
      }
    }

    const finalReview = {
      status: finalComparison.status,
      round: corrected ? 1 : 0,
      corrected: corrected,
      correctedKeys: correctedKeys.slice(),
      issues: finalComparison.issues,
      slots: finalComparison.slots,
      negative: finalComparison.negative,
      snapshot: BilingualVerify.snapshotOf(currentFields),
      checkedAt: Date.now(),
      model: first.model || (finalBack && finalBack.model) || '',
      auto: opts.auto === true,
      error: correctionError || recheckError,
      calls: calls,
      initial: initial,
      final: {
        fields: cloneFieldPayload(currentFields),
        negative: normalizeReviewNegative(currentNegative),
        back: finalBack.fields,
        backNegative: finalBack.negative,
        issues: finalComparison.issues,
        status: finalComparison.status
      }
    };

    return {
      status: 'ok',
      requested: true,
      code: 'ok',
      reason: finalComparison.status === 'clean'
        ? '独立回译复核完成，未见明显差异'
        : '独立回译复核完成，存在需要确认的差异',
      reviewStatus: finalComparison.status,
      fields: currentFields,
      negative: currentNegative,
      review: finalReview,
      model: finalReview.model,
      endpoint: first.endpoint,
      elapsedMs: Date.now() - started,
      calls: calls
    };
  }


  function generate(settings, idea, options) {
    const opts = options || {};
    const started = Date.now();
    const raw = U.normalizeSpace(idea);
    if (!raw) {
      return Promise.resolve({
        status: 'error',
        requested: false,
        code: 'empty-input',
        reason: reasonText('empty-input'),
        elapsedMs: 0
      });
    }
    const infer = opts.infer === undefined ? !!(settings && settings.infer) : !!opts.infer;
    const request = buildGenerateRequest(settings, raw, { infer: infer });
    return runRequest(request, opts, started).then(function (response) {
      let data;
      try {
        data = parseModelContent(response.content);
      } catch (err) {
        throw codedError('invalid-json', '返回内容不是有效 JSON', {
          detail: snippet(stripThinkAndFence(response.content))
        });
      }
      let normalized;
      try {
        normalized = normalizeInitial(data, { infer: infer });
      } catch (err) {
        throw err;
      }
      return {
        status: 'ok',
        requested: true,
        code: 'ok',
        reason: '本地模型拆解与翻译完成',
        raw: raw,
        fields: normalized.fields,
        negative: normalized.negative,
        inferred: normalized.inferred,
        inferredCount: normalized.inferredCount,
        notes: normalized.notes,
        model: request.model,
        endpoint: request.url,
        elapsedMs: Date.now() - started,
        inferRequested: infer
      };
    }).catch(function (err) {
      const code = (err && err.code) || 'unexpected';
      return failure(code, request, started, {
        detail: err && err.message ? snippet(err.message) : '',
        missing: err && err.missing ? err.missing : undefined
      });
    });
  }

  function retranslate(settings, payload, options) {
    const opts = options || {};
    const started = Date.now();
    const data = payload || {};
    const fields = currentFieldPayload(data.fields);
    const pending = (Array.isArray(data.pending) ? data.pending : [])
      .map(normalizeKey)
      .filter(function (key) { return !!key; });
    if (!pending.length) {
      return Promise.resolve({
        status: 'error',
        requested: false,
        code: 'no-pending',
        reason: reasonText('no-pending'),
        elapsedMs: 0
      });
    }
    const hasChinese = SLOTS.some(function (key) { return !!asText(fields[key].zh); });
    if (!hasChinese) {
      return Promise.resolve({
        status: 'error',
        requested: false,
        code: 'empty-current',
        reason: reasonText('empty-current'),
        elapsedMs: 0
      });
    }
    const request = buildRetranslateRequest(settings, {
      idea: data.idea,
      fields: fields,
      pending: pending,
      negative: data.negative
    });
    return runRequest(request, opts, started).then(function (response) {
      let parsed;
      try {
        parsed = parseModelContent(response.content);
      } catch (err) {
        throw codedError('invalid-json', '返回内容不是有效 JSON', {
          detail: snippet(stripThinkAndFence(response.content))
        });
      }
      const normalized = normalizeRetranslation(parsed, pending, fields);
      return {
        status: 'ok',
        requested: true,
        code: 'ok',
        reason: '英文重译完成',
        pending: pending,
        fields: normalized.fields,
        negative: normalized.negative,
        notes: normalized.notes,
        model: request.model,
        endpoint: request.url,
        elapsedMs: Date.now() - started
      };
    }).catch(function (err) {
      const code = (err && err.code) || 'unexpected';
      return failure(code, request, started, {
        detail: err && err.message ? snippet(err.message) : ''
      });
    });
  }

  // 兼容旧调用名：compile 现在也绝不返回 fallback；失败即 error。
  function compile(settings, idea, options) {
    return generate(settings, idea, options);
  }

  T2I.LocalLLM = {
    DEFAULT_API_ROOT: DEFAULT_API_ROOT,
    DEFAULT_MODEL: DEFAULT_MODEL,
    STORAGE_KEY: STORAGE_KEY,
    TIMEOUT_MS: TIMEOUT_MS,
    BACKTRANSLATE_TIMEOUT_MS: BACKTRANSLATE_TIMEOUT_MS,
    CORRECTION_TIMEOUT_MS: CORRECTION_TIMEOUT_MS,
    MAX_CORRECTIONS: MAX_CORRECTIONS,
    SLOTS: SLOTS,
    SLOT_LABELS: SLOT_LABELS,
    defaultSettings: defaultSettings,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    normalizeApiRoot: normalizeApiRoot,
    normalizeModel: normalizeModel,
    buildSystemPrompt: buildSystemPrompt,
    buildRequest: buildRequest,
    buildGenerateRequest: buildGenerateRequest,
    buildRetranslateRequest: buildRetranslateRequest,
    buildBacktranslateRequest: buildBacktranslateRequest,
    buildCorrectionRequest: buildCorrectionRequest,
    parseModelContent: parseModelContent,
    normalizeInitial: normalizeInitial,
    normalizeRetranslation: normalizeRetranslation,
    normalizeBacktranslation: normalizeBacktranslation,
    normalizeCorrection: normalizeCorrection,
    generate: generate,
    retranslate: retranslate,
    backtranslate: backtranslate,
    correct: correct,
    review: review,
    compile: compile,
    reasonText: reasonText
  };
})();
