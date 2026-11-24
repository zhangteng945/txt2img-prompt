/*
 * local-llm.js — 可选的本机 Ollama 结构化解析
 *
 * 只做四件事：
 *   1. 生成 POST {apiRoot}/api/chat 的非流式请求（关闭 thinking）；
 *   2. 去掉模型可能残留的 think 标签，解析唯一一个 JSON 对象；
 *   3. 校验模型给的是不是「原文片段的精确标注」，漏写/改写/编造就判失败；
 *   4. 交给 scene.js 的 fromSpec 建同一棵场景树，再走原来的六框/组装/负面/守恒。
 *
 * 任何失败都以 status:'fallback' 返回原因，由 app.js 回退规则编译器。
 * 开关关闭时 compile() 直接返回 disabled，不发任何请求。
 */
(function () {
  'use strict';

  const T2I = (window.T2I = window.T2I || {});
  const U = T2I.Utils;

  const DEFAULT_API_ROOT = 'https://macbook-pro.tail349cac.ts.net:11434';
  const DEFAULT_MODEL = 'qwen3.5:4b';
  const STORAGE_KEY = 't2i.localLLM.v1';
  const TIMEOUT_MS = 50000;
  const SLOTS = ['person', 'outfit', 'pose', 'scene', 'light', 'style'];
  const SCOPES = ['global', 'subject', 'background'];

  const SYSTEM_PROMPT = [
    '你是中文文生图提示词的结构化解析器。只输出一个 JSON 对象，不要输出 Markdown、代码围栏、解释或 <think> 标签。',
    '',
    '任务：把用户的整段想法拆成不重叠、不遗漏的原文片段，并标注六个月框槽位和语义角色。',
    '所有 text 字段必须是用户原文里的连续子串，逐字复制；不要翻译、改写、缩写或补写。',
    '',
    '槽位 slot 只能是：person, outfit, pose, scene, light, style。',
    '角色 role 只能是：subject, attribute, outfit, object, action, place, light, camera, style, mood, sign, other。',
    '',
    '输出结构：',
    '{',
    '  "units": [{"text":"原文片段","slot":"person|outfit|pose|scene|light|style","role":"上面列出的角色"}],',
    '  "subjects": [{"text":"人物原文","attributes":["原文属性"],"outfit_color":"原文颜色"}],',
    '  "objects": [{"text":"物体或地点原文","attributes":["原文属性"],"color":"原文颜色","distance":"原文距离词"}],',
    '  "outfits": [{"text":"服装原文","color":"原文颜色","owner":"人物原文"}],',
    '  "relations": [{"type":"wearing|located|next_to|holding|pose|distance|other","from":"原文","to":"原文","text":"关系原文"}],',
    '  "negations": [{"text":"否定原文","target":"被否定的原文","scope":"global|subject|background","topic":"范围原文"}],',
    '  "scopes": [{"text":"范围原文","scope":"global|subject|background|all","polarity":"exclude|allow|apply","target":"原文","exception":"例外原文"}],',
    '  "exceptions": [{"text":"例外原文","target":"作用原文"}],',
    '  "notes": []',
    '}',
    '',
    '硬规则：',
    '1. units 必须覆盖用户原文的全部实义内容。每个片段只放一次；标点、语气词可以不放。',
    '2. 不要编造用户没说的光线、镜头、景深、画风、身份、人数、服装、颜色、动作或剧情。用户没提就留空数组。',
    '3. 否定、禁止、允许、例外和作用范围必须原样保留，不能改写成肯定。',
    '   例如「禁止吸烟」必须保持禁止含义：如果它是画面里的告示牌，放进 units（role=sign, slot=scene），不要只输出 smoking；如果是要求画面里不要出现吸烟，写进 negations，target 填「吸烟」。',
    '4. 词库不做去敏感化，保留原意和程度词；不要替换成更温和或更宽泛的说法。',
    '5. 「除了A，其他都用B」：B 放进 units，A 放进 exceptions，并在 scopes 写 scope=all, polarity=apply, target=B, exception=A。',
    '6. 穿着、拿着、站在/坐在某处、旁边、远处等关系写进 relations；人物、服装、物体也要各自出现在 units 和 subjects/outfits/objects 中。',
    '7. 一个地点动作可以写成 pose 的完整片段（如「站在樱花树下」），物体再单独放进 objects；允许局部重复，但不要引入原文没有的字。',
    '8. 没有把握的片段宁可按原文放进 units，也不要用同义词替换。',
    '',
    '格式示例（只是示例，换成用户原文；不得照抄示例内容）：',
    '用户：短发女人穿米色风衣站在樱花树下，柔和自然光',
    '输出：{"units":[{"text":"短发女人","slot":"person","role":"subject"},{"text":"米色风衣","slot":"outfit","role":"outfit"},{"text":"站在樱花树下","slot":"pose","role":"action"},{"text":"柔和自然光","slot":"light","role":"light"}],"subjects":[{"text":"短发女人","attributes":["短发"]}],"outfits":[{"text":"米色风衣","color":"米色","owner":"短发女人"}],"objects":[{"text":"樱花树"}],"relations":[{"type":"located","from":"短发女人","to":"樱花树","text":"站在樱花树下"}],"negations":[],"scopes":[],"exceptions":[]}'
  ].join('\n');

  const REASONS = {
    disabled: '本地解析模型未开启，使用规则编译器',
    'empty-input': '没有可解析的想法文本',
    config: 'API 根地址不是 http(s) 地址，无法请求本机模型',
    network: '连不上本地模型。可能是模型没开、电脑休眠、Tailscale 未连上，或跨域未放行',
    cors: '浏览器拦截了跨域请求，可能是 Ollama 的 CORS 未放行当前 Origin',
    timeout: '本地模型超时未返回，已中止这次请求',
    aborted: '这次本地解析已中止',
    http: '本地模型返回了 HTTP 错误',
    server: '本地模型返回了错误信息',
    'invalid-json': '本地模型返回的不是有效 JSON',
    'invalid-spec': '本地模型返回的 JSON 不符合场景结构，或包含原文没有的文字',
    coverage: '本地模型漏掉或改写了原文片段',
    negation: '本地模型把原文里的否定/禁止改成了肯定或漏掉了',
    'empty-scene': '本地模型没有给出可用的场景内容',
    conservation: '本地模型结果没有通过语义守恒检查',
    unexpected: '本地解析出现未预期错误'
  };

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
    return { enabled: false, apiRoot: DEFAULT_API_ROOT, model: DEFAULT_MODEL };
  }

  function loadSettings(storage) {
    const out = defaultSettings();
    if (!storage) return out;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return out;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return out;
      out.enabled = saved.enabled === true;
      if (typeof saved.apiRoot === 'string' && saved.apiRoot.trim()) out.apiRoot = normalizeApiRoot(saved.apiRoot);
      if (typeof saved.model === 'string' && saved.model.trim()) out.model = normalizeModel(saved.model);
    } catch (err) {
      return defaultSettings();
    }
    return out;
  }

  function saveSettings(storage, settings) {
    if (!storage) return false;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({
        enabled: !!(settings && settings.enabled),
        apiRoot: normalizeApiRoot(settings && settings.apiRoot),
        model: normalizeModel(settings && settings.model)
      }));
      return true;
    } catch (err) {
      return false;
    }
  }

  function buildRequest(settings, idea) {
    const apiRoot = normalizeApiRoot(settings && settings.apiRoot);
    const model = normalizeModel(settings && settings.model);
    return {
      apiRoot: apiRoot,
      model: model,
      url: apiRoot + '/api/chat',
      body: {
        model: model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: String(idea == null ? '' : idea) }
        ],
        stream: false,
        // Ollama 0.40 的字段；qwen3.5 模板不加这个会先吐 <think>，污染 JSON。
        think: false,
        format: 'json',
        options: {
          temperature: 0,
          top_p: 0.9,
          num_ctx: 4096,
          num_predict: 1400
        }
      }
    };
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
      const error = new Error('没有找到 JSON 对象');
      error.code = 'invalid-json';
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch (err) {
      const error = new Error('JSON 解析失败');
      error.code = 'invalid-json';
      throw error;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const error = new Error('顶层不是 JSON 对象');
      error.code = 'invalid-json';
      throw error;
    }
    return parsed;
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function asText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  // 收集模型声明用到的所有原文片段。只校验 text 类字段，不要求英文。
  function collectAllSpans(spec) {
    const spans = [];
    function add(value) {
      const text = asText(value).replace(/\s+/g, ' ');
      if (!text) return;
      if (spans.indexOf(text) === -1) spans.push(text);
    }
    function collectItem(item) {
      if (!item || typeof item !== 'object') return;
      add(item.text);
      add(item.target);
      add(item.exception);
      add(item.color);
      add(item.distance);
      add(item.outfit_color);
      if (Array.isArray(item.attributes)) item.attributes.forEach(add);
    }
    ['units', 'subjects', 'objects', 'outfits', 'relations', 'negations', 'scopes', 'exceptions']
      .forEach(function (key) {
        if (Array.isArray(spec[key])) spec[key].forEach(collectItem);
      });
    return spans;
  }

  // 覆盖检查只认真正承载内容的片段：六框单元、实体、否定、例外。
  // relation / scope 的 text 只是结构重述，不能拿来掩盖单元漏写。
  function collectCoverageSpans(spec) {
    const spans = [];
    function add(value) {
      const text = asText(value).replace(/\s+/g, ' ');
      if (!text) return;
      if (spans.indexOf(text) === -1) spans.push(text);
    }
    (Array.isArray(spec.units) ? spec.units : []).forEach(function (item) {
      if (item && typeof item === 'object') add(item.text);
    });
    ['subjects', 'objects', 'outfits'].forEach(function (key) {
      (Array.isArray(spec[key]) ? spec[key] : []).forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        add(item.text);
        add(item.color);
        add(item.distance);
        add(item.outfit_color);
        if (Array.isArray(item.attributes)) item.attributes.forEach(add);
      });
    });
    (Array.isArray(spec.negations) ? spec.negations : []).forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      add(item.text);
      add(item.target);
    });
    (Array.isArray(spec.scopes) ? spec.scopes : []).forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      add(item.target);
      add(item.exception);
      // 纯排除作用域可能没有单独的 negation 记录；它的整句就是约束内容。
      const scopeText = asText(item.text);
      if (scopeText && (item.polarity === 'exclude' ||
          NEGATION_CUES.some(function (cue) { return scopeText.indexOf(cue) !== -1; }))) {
        add(scopeText);
      }
    });
    (Array.isArray(spec.exceptions) ? spec.exceptions : []).forEach(function (item) {
      if (typeof item === 'string') add(item);
      else if (item && typeof item === 'object') add(item.text || item.exception);
    });
    return spans;
  }

  const AUTO_COVERED = Object.create(null);
  ('的了着过和与及或而并也都就还很更最把被给让使对为以于地得在是有可所其之此那这我你他她它们' +
    '个位名件条双只张座片群套头身款种些点分一二两三几每各另穿戴着系围披除部分使用剩余外').split('').forEach(function (ch) {
    AUTO_COVERED[ch] = true;
  });

  function isIgnorableChar(ch) {
    return /[\s，,。.、；;：:！!？?（）()【】\[\]{}<>《》〈〉「」『』“”‘’"'…—\-·/\\|+*=&%#@~`^]/.test(ch) ||
      !!AUTO_COVERED[ch];
  }

  function coverageGaps(spec, raw) {
    const source = String(raw || '');
    const covered = new Array(source.length);
    const spans = collectCoverageSpans(spec).sort(function (a, b) { return b.length - a.length; });
    spans.forEach(function (span) {
      let index = source.indexOf(span);
      while (index !== -1) {
        for (let i = index; i < index + span.length; i += 1) covered[i] = true;
        index = source.indexOf(span, index + 1);
      }
    });
    const gaps = [];
    let buffer = '';
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      if (covered[i] || isIgnorableChar(ch)) {
        if (buffer) {
          gaps.push(buffer);
          buffer = '';
        }
        continue;
      }
      buffer += ch;
    }
    if (buffer) gaps.push(buffer);
    return gaps;
  }

  function inventedSpans(spec, raw) {
    const source = String(raw || '');
    return collectAllSpans(spec).filter(function (span) {
      return source.indexOf(span) === -1;
    });
  }

  const NEGATION_PRESERVED = /\b(no|not|without|prohibit(?:ed)?|forbid(?:den)?|banned|free of|avoid|never|none)\b/i;
  const NEGATION_CUES = ['禁止', '严禁', '请勿', '切勿', '不要', '不能', '不可', '避免', '没有', '不含', '去除', '去掉', '排除', '勿'];

  function splitClauses(text) {
    return U.splitPhrases(text);
  }

  function clauseHasCue(clause) {
    if (NEGATION_CUES.some(function (cue) { return clause.indexOf(cue) !== -1; })) return true;
    return /(^|[，,。；;])\s*别/.test(clause);
  }

  function negationPreserved(clause, spec) {
    const negations = Array.isArray(spec.negations) ? spec.negations : [];
    if (negations.some(function (item) {
      if (!item || typeof item !== 'object') return false;
      const text = asText(item.text);
      const target = asText(item.target);
      return (text && clause.indexOf(text) !== -1) || (target && clause.indexOf(target) !== -1);
    })) return true;

    const scopes = Array.isArray(spec.scopes) ? spec.scopes : [];
    if (scopes.some(function (item) {
      if (!item || typeof item !== 'object' || item.polarity !== 'exclude') return false;
      const text = asText(item.text);
      const target = asText(item.target);
      return (text && clause.indexOf(text) !== -1) || (target && clause.indexOf(target) !== -1);
    })) return true;

    // 告示牌类整句不一定要进 negations，但英文必须保留「禁止 / 请勿」。
    return (Array.isArray(spec.units) ? spec.units : []).some(function (unit) {
      if (!unit || typeof unit !== 'object') return false;
      const text = asText(unit.text);
      if (!text || clause.indexOf(text) === -1) return false;
      const span = T2I.Scene && T2I.Scene.translateSpan
        ? T2I.Scene.translateSpan(text, unit.slot || 'scene')
        : { en: '' };
      const en = String(span.en || '');
      if (!en || /[\u3400-\u9fff]/.test(en)) return false;
      return NEGATION_PRESERVED.test(en);
    });
  }

  function validateSpec(spec, raw) {
    if (!isPlainObject(spec)) {
      return { ok: false, code: 'invalid-spec', message: '顶层不是 JSON 对象' };
    }
    if (!Array.isArray(spec.units)) {
      return { ok: false, code: 'invalid-spec', message: '缺少 units 数组' };
    }
    if (spec.units.length > 80) {
      return { ok: false, code: 'invalid-spec', message: 'units 过多（' + spec.units.length + ' 段）' };
    }
    for (let i = 0; i < spec.units.length; i += 1) {
      const unit = spec.units[i];
      if (!isPlainObject(unit)) {
        return { ok: false, code: 'invalid-spec', message: 'units[' + i + '] 不是对象' };
      }
      const text = asText(unit.text);
      if (!text) {
        return { ok: false, code: 'invalid-spec', message: 'units[' + i + '] 缺少 text' };
      }
      if (SLOTS.indexOf(unit.slot) === -1) {
        return { ok: false, code: 'invalid-spec', message: 'units[' + i + '] 的 slot 不合法：' + String(unit.slot) };
      }
    }

    const arrayFields = ['negations', 'scopes', 'relations', 'subjects', 'objects', 'outfits', 'exceptions'];
    for (let i = 0; i < arrayFields.length; i += 1) {
      const key = arrayFields[i];
      if (spec[key] != null && !Array.isArray(spec[key])) {
        return { ok: false, code: 'invalid-spec', message: key + ' 必须是数组' };
      }
    }

    const invented = inventedSpans(spec, raw);
    if (invented.length) {
      return {
        ok: false,
        code: 'invalid-spec',
        message: '模型给出了原文没有的文字：' + invented.slice(0, 3).join('、')
      };
    }

    const gaps = coverageGaps(spec, raw);
    if (gaps.length) {
      return {
        ok: false,
        code: 'coverage',
        message: '模型漏掉或改写了原文：' + gaps.slice(0, 5).join('、')
      };
    }

    const clauses = splitClauses(raw);
    for (let i = 0; i < clauses.length; i += 1) {
      const clause = clauses[i];
      if (!clauseHasCue(clause)) continue;
      if (!negationPreserved(clause, spec)) {
        return {
          ok: false,
          code: 'negation',
          message: '原文里的否定/禁止没有按原样保留：' + clause
        };
      }
    }

    const meaningful = (Array.isArray(spec.units) ? spec.units.length : 0) +
      (Array.isArray(spec.negations) ? spec.negations.length : 0) +
      (Array.isArray(spec.scopes) ? spec.scopes.length : 0);
    if (!meaningful && asText(raw)) {
      return { ok: false, code: 'empty-scene', message: 'units 与 negations 都是空的' };
    }

    return {
      ok: true,
      spans: collectCoverageSpans(spec).length,
      unitCount: spec.units.length
    };
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

  function snippet(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').slice(0, 180);
  }

  function compile(settings, idea, options) {
    const opts = options || {};
    const started = Date.now();
    const raw = U.normalizeSpace(idea);

    if (!settings || settings.enabled !== true) {
      return Promise.resolve({
        status: 'disabled',
        requested: false,
        code: 'disabled',
        reason: reasonText('disabled'),
        elapsedMs: 0
      });
    }

    if (!raw) {
      return Promise.resolve({
        status: 'fallback',
        requested: false,
        code: 'empty-input',
        reason: reasonText('empty-input'),
        elapsedMs: Date.now() - started
      });
    }

    const request = buildRequest(settings, raw);
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : TIMEOUT_MS;
    const fetchImpl = opts.fetchImpl ||
      (typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) :
        (typeof fetch === 'function' ? fetch : null));

    function fallback(code, extra) {
      const out = {
        status: 'fallback',
        requested: true,
        code: code,
        reason: reasonText(code),
        elapsedMs: Date.now() - started,
        model: request.model,
        endpoint: request.url
      };
      if (extra) {
        Object.keys(extra).forEach(function (key) { out[key] = extra[key]; });
      }
      return out;
    }

    if (!/^https?:\/\//i.test(request.apiRoot)) {
      return Promise.resolve(fallback('config'));
    }
    if (!fetchImpl) {
      return Promise.resolve(fallback('network', { detail: '当前环境没有 fetch' }));
    }

    let abortReason = '';
    const controller = new AbortController();
    const external = opts.signal;
    function onExternalAbort() {
      abortReason = 'aborted';
      controller.abort();
    }
    if (external) {
      if (external.aborted) onExternalAbort();
      else if (typeof external.addEventListener === 'function') external.addEventListener('abort', onExternalAbort);
    }
    const timer = setTimeout(function () {
      abortReason = 'timeout';
      controller.abort();
    }, timeoutMs);

    return Promise.resolve()
      .then(function () {
        return fetchImpl(request.url, {
          method: 'POST',
          mode: 'cors',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request.body),
          signal: controller.signal
        });
      })
      .then(function (res) {
        if (!res || typeof res !== 'object') {
          throw Object.assign(new Error('空的 fetch 响应'), { code: 'network' });
        }
        if (!res.ok) {
          const status = Number(res.status) || 0;
          const code = status === 403 || status === 401 ? 'cors' : (status >= 500 ? 'server' : 'http');
          throw Object.assign(new Error('HTTP ' + status), { code: code, status: status });
        }
        return res.json();
      })
      .then(function (data) {
        if (data && typeof data === 'object' && data.error) {
          throw Object.assign(new Error(snippet(data.error)), { code: 'server' });
        }
        const content = extractContent(data);
        if (!content) {
          throw Object.assign(new Error('响应里没有 message.content'), { code: 'invalid-json' });
        }
        let spec;
        try {
          spec = parseModelContent(content);
        } catch (err) {
          throw Object.assign(new Error('返回内容不是有效 JSON'), {
            code: 'invalid-json',
            detail: snippet(content)
          });
        }
        const validation = validateSpec(spec, raw);
        if (!validation.ok) {
          throw Object.assign(new Error(validation.message), {
            code: validation.code,
            validation: validation
          });
        }
        let scene;
        try {
          scene = T2I.Scene.fromSpec(spec, raw);
        } catch (err) {
          throw Object.assign(new Error('场景树构建失败：' + snippet(err && err.message)), { code: 'invalid-spec' });
        }
        if (!scene || (!scene.units.length && !scene.negations.length && !scene.scopes.length)) {
          throw Object.assign(new Error('场景树是空的'), { code: 'empty-scene' });
        }

        // 用与界面完全相同的六框 / 组装 / 负面 / 守恒链路预检一次。
        const parsed = { raw: raw, scene: scene, segments: [] };
        const filled = T2I.SlotFill.fill(parsed);
        const completed = T2I.Complete.complete(filled.slots, { enabled: opts.completion === true });
        const assembled = T2I.Assemble.assemble(completed.slots, { quality: opts.quality === true });
        const negative = T2I.Negative.build(assembled.positiveEn, T2I.Scene.negativePlan(scene));
        const verify = T2I.Scene.verify(scene, completed.slots, assembled, negative);
        const errors = (verify.issues || []).filter(function (issue) { return issue.severity === 'error'; });
        if (errors.length) {
          throw Object.assign(new Error(errors[0].message), {
            code: 'conservation',
            issue: errors[0],
            verify: verify
          });
        }

        return {
          status: 'ok',
          requested: true,
          code: 'ok',
          reason: '本地解析完成',
          raw: raw,
          spec: spec,
          scene: scene,
          parsed: parsed,
          slots: completed.slots,
          assembled: assembled,
          negative: negative,
          verify: verify,
          model: request.model,
          endpoint: request.url,
          elapsedMs: Date.now() - started,
          validation: validation
        };
      })
      .catch(function (err) {
        const originalCode = err && err.code;
        let code = originalCode;
        if (!code || code === 'unexpected') {
          if (abortReason === 'timeout') code = 'timeout';
          else if (abortReason === 'aborted') code = 'aborted';
          else if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')))) {
            code = abortReason || 'timeout';
          } else if (err instanceof TypeError || /fetch|network|load failed/i.test(String(err.message || ''))) {
            code = 'network';
          } else {
            code = 'unexpected';
          }
        }
        if (abortReason === 'timeout') code = 'timeout';
        else if (abortReason === 'aborted') code = 'aborted';
        const out = fallback(code);
        if (err && err.message) out.detail = snippet(err.message);
        if (err && err.status) out.httpStatus = err.status;
        if (err && err.validation) out.validation = err.validation;
        if (err && err.verify) out.verify = err.verify;
        out.elapsedMs = Date.now() - started;
        return out;
      })
      .then(function (result) {
        clearTimeout(timer);
        if (external && typeof external.removeEventListener === 'function') {
          external.removeEventListener('abort', onExternalAbort);
        }
        return result;
      });
  }

  T2I.LocalLLM = {
    DEFAULT_API_ROOT: DEFAULT_API_ROOT,
    DEFAULT_MODEL: DEFAULT_MODEL,
    STORAGE_KEY: STORAGE_KEY,
    TIMEOUT_MS: TIMEOUT_MS,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    defaultSettings: defaultSettings,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    normalizeApiRoot: normalizeApiRoot,
    normalizeModel: normalizeModel,
    buildRequest: buildRequest,
    parseModelContent: parseModelContent,
    validateSpec: validateSpec,
    coverageGaps: coverageGaps,
    compile: compile,
    reasonText: reasonText
  };
})();
