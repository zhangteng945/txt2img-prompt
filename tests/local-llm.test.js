/*
 * 本地模型主流程回归测试：全部使用 mock fetch，不依赖 Ollama 正在运行。
 * 运行：node tests/local-llm.test.js
 *
 * 覆盖重点：
 *   - 整体描述 → 六字段中英对照 + 负向提示词；
 *   - 成功路径零 Translator / 词库调用；
 *   - 中文改动 → 英文字段 stale；重译只更新待更新字段，中文原样保留；
 *   - 失败（超时/网络/无效 JSON/HTTP）只报 error，绝不自动走规则；
 *   - 补全默认关闭、开启后标 inferred；
 *   - 规则路径只在测试显式调用时才产生结果。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');

global.window = global;

['utils', 'lexicon', 'translator', 'scene', 'parser', 'slot-fill', 'complete', 'assemble', 'negative', 'feedback', 'local-llm', 'prompt-flow']
  .forEach(function (name) {
    require(path.join(__dirname, '..', 'js', name + '.js'));
  });

const T = global.T2I;
const LocalLLM = T.LocalLLM;
const PromptFlow = T.PromptFlow;
const Parser = T.Parser;
const SF = T.SlotFill;
const Assemble = T.Assemble;
const Negative = T.Negative;
const Scene = T.Scene;
const TR = T.Translator;

let passed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

function responseWith(content, status) {
  const code = status || 200;
  return {
    ok: code >= 200 && code < 300,
    status: code,
    json: function () {
      return Promise.resolve({ message: { role: 'assistant', content: content } });
    }
  };
}

function settings(overrides) {
  return Object.assign({
    apiRoot: LocalLLM.DEFAULT_API_ROOT,
    model: LocalLLM.DEFAULT_MODEL,
    infer: false
  }, overrides || {});
}

function successPayload(overrides) {
  const base = {
    fields: {
      person: {
        zh: '短发女人，侧脸看向远处',
        en: 'a woman with a short bob, seen in profile looking into the distance'
      },
      outfit: { zh: '米色风衣', en: 'wearing a cream trench coat' },
      pose: { zh: '站在樱花树下', en: 'standing beneath a cherry tree' },
      scene: { zh: '樱花树下', en: 'beneath a cherry tree' },
      light: { zh: '柔和自然光', en: 'soft natural light' },
      style: { zh: '', en: '' }
    },
    negative: { zh: '低质量、模糊、水印', en: 'low quality, blurry, watermark' },
    inferred: [],
    notes: []
  };
  return Object.assign(base, overrides || {});
}

const SUCCESS_IDEA = '短发女人穿米色风衣站在樱花树下，侧脸看向远处，柔和自然光';

function okFetch(payload) {
  return function () {
    return Promise.resolve(responseWith(JSON.stringify(payload)));
  };
}

function fieldState(payload) {
  const fields = JSON.parse(JSON.stringify(payload.fields));
  const slots = PromptFlow.normalizeSlots(fields);
  return slots;
}

test('成功：整体描述拆成六字段中英对照、负向提示词，英文直接来自模型', function () {
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: okFetch(successPayload())
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.strictEqual(result.requested, true);
    assert.strictEqual(result.model, 'qwen3.5:4b');
    assert.strictEqual(result.fields.person.zh, '短发女人，侧脸看向远处');
    assert.ok(/short bob/.test(result.fields.person.en));
    assert.ok(/cream trench coat/.test(result.fields.outfit.en));
    assert.ok(/beneath a cherry tree/.test(result.fields.pose.en));
    assert.ok(/soft natural light/.test(result.fields.light.en));
    assert.strictEqual(result.fields.style.zh, '');
    assert.strictEqual(result.fields.style.en, '');
    assert.strictEqual(result.fields.style.inferred, false);
    assert.ok(/watermark/.test(result.negative.en));
    assert.strictEqual(result.negative.zh, '低质量、模糊、水印');
    assert.deepStrictEqual(result.inferred, []);
    assert.strictEqual(result.parsed, undefined);
    assert.strictEqual(result.scene, undefined);
  });
});

test('成功路径不调用 Translator / 词库补英文', function () {
  const calls = [];
  const originals = {
    translateZh: TR.translateZh,
    translateEn: TR.translateEn,
    translateZhPhrase: TR.translateZhPhrase
  };
  ['translateZh', 'translateEn', 'translateZhPhrase'].forEach(function (name) {
    TR[name] = function () {
      calls.push(name);
      return { zh: '', en: '', unknown: [], matches: [] };
    };
  });
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: okFetch(successPayload())
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.deepStrictEqual(calls, []);
    assert.ok(/cream/.test(result.fields.outfit.en));
  }).finally(function () {
    Object.keys(originals).forEach(function (name) { TR[name] = originals[name]; });
  });
});

test('成功路径不调用 Parser / 规则编译器（不静默走规则）', function () {
  let parserCalls = 0;
  const original = Parser.parse;
  Parser.parse = function () {
    parserCalls += 1;
    throw new Error('模型成功路径不应调用 Parser');
  };
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: okFetch(successPayload())
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason);
    assert.strictEqual(parserCalls, 0);
  }).finally(function () {
    Parser.parse = original;
  });
});

test('请求体：系统说明 + 用户原文，think:false、非流式，不包含词库', function () {
  const request = LocalLLM.buildGenerateRequest(settings(), '女孩站在海边', { infer: false });
  assert.strictEqual(request.url, LocalLLM.DEFAULT_API_ROOT + '/api/chat');
  assert.strictEqual(request.body.stream, false);
  assert.strictEqual(request.body.think, false);
  assert.strictEqual(request.body.format, 'json');
  assert.strictEqual(request.body.model, 'qwen3.5:4b');
  assert.strictEqual(request.body.messages.length, 2);
  assert.strictEqual(request.body.messages[0].role, 'system');
  assert.strictEqual(request.body.messages[1].role, 'user');
  assert.strictEqual(request.body.messages[1].content, '女孩站在海边');
  const system = request.body.messages[0].content;
  assert.ok(/JSON/.test(system));
  assert.ok(/不要参照、检索或模仿任何外部词库/.test(system));
  assert.ok(/不要编造/.test(system));
  assert.ok(/person/.test(system) && /style/.test(system));
  assert.ok(/补全选项已关闭/.test(system));
  assert.ok(system.length < 4000);
  assert.strictEqual(system.indexOf('词典已载入'), -1);
  assert.strictEqual(system.indexOf('14,482'), -1);
});

test('补全开关：关闭时提示不要补，开启时只允许 light/style', function () {
  const off = LocalLLM.buildSystemPrompt({ infer: false });
  const on = LocalLLM.buildSystemPrompt({ infer: true });
  assert.ok(/补全选项已关闭/.test(off));
  assert.ok(/inferred 必须是空数组/.test(off));
  assert.ok(/补全选项已开启/.test(on));
  assert.ok(/只允许补 light 和 style/.test(on));
  assert.ok(/绝不能补人物身份、剧情、服装/.test(on));
});

test('think 标签与代码围栏残留会被清掉，JSON 仍可解析', function () {
  const content = '<think>先想一下...</think>\n```json\n' + JSON.stringify(successPayload()) + '\n```';
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: function () { return Promise.resolve(responseWith(content)); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason);
    assert.ok(/short bob/.test(result.fields.person.en));
  });
});

test('无效 JSON → status:error / invalid-json，不伪造 fallback', function () {
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: function () { return Promise.resolve(responseWith('抱歉，我无法输出 JSON。')); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'invalid-json');
    assert.ok(result.reason);
    assert.strictEqual(result.fields, undefined);
    assert.strictEqual(result.scene, undefined);
  });
});

test('中文有内容但英文缺失 → status:error / missing-english，绝不用词库补', function () {
  const bad = successPayload();
  bad.fields.pose = { zh: '站在樱花树下', en: '' };
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: okFetch(bad)
  }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'missing-english');
    assert.ok(/姿态与动作/.test(result.detail));
    assert.strictEqual(result.fields, undefined);
  });
});

test('英文里残留中文 → 判为不可用，不把中文当英文', function () {
  const bad = successPayload();
  bad.fields.person = { zh: '女孩', en: 'a girl 在看海' };
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: okFetch(bad)
  }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'missing-english');
  });
});

test('缺少英文负向提示词 → status:error / empty-negative', function () {
  const bad = successPayload({ negative: { zh: '低质量', en: '' } });
  bad.negative = { zh: '低质量', en: '' };
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: okFetch(bad)
  }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'empty-negative');
  });
});

test('补全默认关闭：模型返回 inferred 时拒绝，避免把推测当原文', function () {
  const payload = successPayload({ inferred: ['light'] });
  return LocalLLM.generate(settings({ infer: false }), SUCCESS_IDEA, {
    fetchImpl: okFetch(payload)
  }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'inferred');
    assert.ok(/补全开关是关闭的/.test(result.detail));
  });
});

test('补全开启：light 允许 inferred 并标记；人物补全仍拒绝', function () {
  const payload = successPayload({ inferred: ['light'] });
  return LocalLLM.generate(settings({ infer: true }), SUCCESS_IDEA, {
    fetchImpl: okFetch(payload)
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.strictEqual(result.fields.light.inferred, true);
    assert.strictEqual(result.fields.person.inferred, false);
    assert.deepStrictEqual(result.inferred, ['light']);
    assert.strictEqual(result.inferredCount, 1);
  });
});

test('补全开启也只允许 light/style：inferred 里出现 person 直接报错', function () {
  const payload = successPayload({ inferred: ['person'] });
  return LocalLLM.generate(settings({ infer: true }), SUCCESS_IDEA, {
    fetchImpl: okFetch(payload)
  }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'invalid-spec');
    assert.ok(/只允许补光线\/镜头和画风/.test(result.detail));
  });
});

test('超时 → status:error / timeout，挂起 fetch 被中止；不返回规则结果', function () {
  let sawAbort = false;
  const hanging = function (url, init) {
    return new Promise(function (resolve, reject) {
      init.signal.addEventListener('abort', function () {
        sawAbort = true;
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  };
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: hanging,
    timeoutMs: 30
  }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'timeout');
    assert.strictEqual(sawAbort, true);
    assert.strictEqual(result.fields, undefined);
  });
});

test('网络错误 → status:error / network，并提示模型没开/休眠/Tailscale/跨域', function () {
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: function () { return Promise.reject(new TypeError('Failed to fetch')); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'network');
    assert.ok(/模型没开/.test(result.reason));
    assert.ok(/休眠/.test(result.reason));
    assert.ok(/Tailscale/.test(result.reason));
    assert.ok(/跨域/.test(result.reason));
  });
});

test('HTTP 403 → status:error / cors，不返回任何槽位', function () {
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: function () { return Promise.resolve(responseWith('', 403)); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'cors');
    assert.strictEqual(result.fields, undefined);
  });
});

test('中文改动 → 对应英文 stale；重译成功更新英文且保留用户中文', function () {
  const slots = fieldState(successPayload());
  assert.strictEqual(PromptFlow.pendingKeys(slots).length, 0);
  slots.pose.zh = '转身走向街角，手里拿着一束花';
  PromptFlow.markChineseEdited(slots, 'pose');
  assert.strictEqual(slots.pose.stale, true);
  assert.strictEqual(slots.person.stale, false);
  assert.deepStrictEqual(PromptFlow.pendingKeys(slots), ['pose']);

  const response = successPayload({
    fields: Object.assign({}, successPayload().fields, {
      // 故意让模型回写中文：页面必须忽略，保留用户当前中文。
      pose: {
        zh: '站在樱花树下（模型初稿）',
        en: 'turning toward the street corner, holding a bouquet'
      }
    })
  });
  let requestBody = null;
  const fetchImpl = function (url, init) {
    requestBody = JSON.parse(init.body);
    return Promise.resolve(responseWith(JSON.stringify(response)));
  };
  return LocalLLM.retranslate(settings(), {
    idea: SUCCESS_IDEA,
    fields: JSON.parse(JSON.stringify(slots)),
    pending: PromptFlow.pendingKeys(slots),
    negative: { zh: '低质量、模糊、水印', en: 'low quality, blurry, watermark' }
  }, { fetchImpl: fetchImpl }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.deepStrictEqual(result.pending, ['pose']);
    assert.ok(/turning toward the street corner/.test(result.fields.pose.en));

    const beforePersonEn = slots.person.en;
    const applied = PromptFlow.applyEnglish(slots, result.fields, result.pending);
    assert.strictEqual(applied.ok, true);
    assert.deepStrictEqual(applied.updated, ['pose']);
    assert.strictEqual(slots.pose.zh, '转身走向街角，手里拿着一束花');
    assert.ok(/turning toward the street corner/.test(slots.pose.en));
    assert.strictEqual(slots.pose.stale, false);
    assert.strictEqual(slots.person.en, beforePersonEn);
    assert.strictEqual(slots.person.zh, '短发女人，侧脸看向远处');
    assert.deepStrictEqual(PromptFlow.pendingKeys(slots), []);

    // 重译请求带的是当前改过的中文 + 原始描述 + 当前英文上下文，
    // 不是最初模型初稿中文。
    const user = JSON.parse(requestBody.messages[1].content);
    assert.strictEqual(user.original_idea, SUCCESS_IDEA);
    assert.deepStrictEqual(user.pending, ['pose']);
    assert.strictEqual(user.current_fields.pose.zh, '转身走向街角，手里拿着一束花');
    assert.ok(/a woman with a short bob/.test(user.current_fields.person.en));
    assert.strictEqual(user.current_fields.person.zh, '短发女人，侧脸看向远处');
    assert.notStrictEqual(user.current_fields.pose.zh, '站在樱花树下');
    assert.ok(!/模型初稿/.test(requestBody.messages[1].content));
    assert.ok(requestBody.think === false);
    assert.ok(/不要参照、检索或模仿任何外部词库/.test(requestBody.messages[0].content));
  });
});

test('中文清空 → 英文标 stale；重译返回空英文时清空对应英文，其他字段不动', function () {
  const slots = fieldState(successPayload());
  slots.light.zh = '';
  PromptFlow.markChineseEdited(slots, 'light');
  assert.strictEqual(slots.light.stale, true);
  assert.deepStrictEqual(PromptFlow.pendingKeys(slots), ['light']);
  const beforePersonEn = slots.person.en;
  const response = {
    fields: { light: { en: '' } },
    negative: { zh: '低质量', en: 'low quality' }
  };
  return LocalLLM.retranslate(settings(), {
    idea: SUCCESS_IDEA,
    fields: JSON.parse(JSON.stringify(slots)),
    pending: ['light'],
    negative: { zh: '低质量', en: 'low quality' }
  }, {
    fetchImpl: function () { return Promise.resolve(responseWith(JSON.stringify(response))); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    const applied = PromptFlow.applyEnglish(slots, result.fields, ['light']);
    assert.strictEqual(applied.ok, true);
    assert.strictEqual(slots.light.en, '');
    assert.strictEqual(slots.light.stale, false);
    assert.strictEqual(slots.person.en, beforePersonEn);
    assert.deepStrictEqual(PromptFlow.pendingKeys(slots), []);
  });
});

test('重译失败（网络）保留已有中文、英文和 stale 标记，不自动用词库', function () {
  const slots = fieldState(successPayload());
  slots.pose.zh = '转身走向街角';
  PromptFlow.markChineseEdited(slots, 'pose');
  const before = JSON.parse(JSON.stringify(slots));
  return LocalLLM.retranslate(settings(), {
    idea: SUCCESS_IDEA,
    fields: before,
    pending: ['pose'],
    negative: { zh: '低质量', en: 'low quality' }
  }, {
    fetchImpl: function () { return Promise.reject(new TypeError('Failed to fetch')); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'network');
    assert.strictEqual(result.fields, undefined);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(slots)), before);
    assert.strictEqual(slots.pose.stale, true);
    assert.deepStrictEqual(PromptFlow.pendingKeys(slots), ['pose']);
  });
});

test('重译结果缺 pending 字段 → error / missing-english，整体不落盘', function () {
  const slots = fieldState(successPayload());
  slots.pose.zh = '转身走向街角';
  PromptFlow.markChineseEdited(slots, 'pose');
  const before = JSON.parse(JSON.stringify(slots));
  const response = {
    fields: { pose: { en: '' } },
    negative: { zh: '低质量', en: 'low quality' }
  };
  return LocalLLM.retranslate(settings(), {
    idea: SUCCESS_IDEA,
    fields: before,
    pending: ['pose'],
    negative: { zh: '低质量', en: 'low quality' }
  }, {
    fetchImpl: function () { return Promise.resolve(responseWith(JSON.stringify(response))); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'missing-english');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(slots)), before);
    assert.strictEqual(PromptFlow.applyEnglish(slots, result.fields || {}, ['pose']).ok, false);
    assert.strictEqual(slots.pose.stale, true);
  });
});

test('重译超时 → error / timeout，已有编辑不变', function () {
  const slots = fieldState(successPayload());
  slots.light.zh = '夜晚霓虹光';
  PromptFlow.markChineseEdited(slots, 'light');
  const before = JSON.parse(JSON.stringify(slots));
  const hanging = function (url, init) {
    return new Promise(function (resolve, reject) {
      init.signal.addEventListener('abort', function () {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  };
  return LocalLLM.retranslate(settings(), {
    idea: SUCCESS_IDEA,
    fields: before,
    pending: ['light'],
    negative: { zh: '低质量', en: 'low quality' }
  }, { fetchImpl: hanging, timeoutMs: 25 }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'timeout');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(slots)), before);
  });
});

test('规则路径只在显式调用时执行：模型失败后手动跑 Parser 仍可用', function () {
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: function () { return Promise.reject(new TypeError('Failed to fetch')); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.scene, undefined);

    // 模拟用户点「改用规则生成（次要）」；这是显式调用，不是自动回退。
    const parsed = Parser.parse(SUCCESS_IDEA);
    const filled = SF.fill(parsed);
    const assembled = Assemble.assemble(filled.slots, { quality: false });
    const negative = Negative.build(assembled.positiveEn, Scene.negativePlan(parsed.scene));
    assert.ok(assembled.positiveEn.length > 0);
    assert.ok(negative.negativeEn.length > 0);
    assert.ok(assembled.positiveEn.indexOf('beige trench coat') !== -1);
  });
});

test('设置读写：默认主流程、infer 默认关闭、旧 enabled:false 不再关掉模型', function () {
  const memory = Object.create(null);
  const storage = {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null; },
    setItem: function (key, value) { memory[key] = String(value); }
  };
  const fresh = LocalLLM.loadSettings(storage);
  assert.strictEqual(fresh.apiRoot, 'https://macbook-pro.tail349cac.ts.net:11434');
  assert.strictEqual(fresh.model, 'qwen3.5:4b');
  assert.strictEqual(fresh.infer, false);

  memory[LocalLLM.STORAGE_KEY] = JSON.stringify({ enabled: false, apiRoot: 'http://localhost:11434', model: 'qwen3.5:4b' });
  const old = LocalLLM.loadSettings(storage);
  assert.strictEqual(old.apiRoot, 'http://localhost:11434');
  assert.strictEqual(old.infer, false);

  LocalLLM.saveSettings(storage, { apiRoot: ' http://127.0.0.1:11434/ ', model: ' qwen3.5:4b ', infer: true });
  const loaded = LocalLLM.loadSettings(storage);
  assert.strictEqual(loaded.apiRoot, 'http://127.0.0.1:11434');
  assert.strictEqual(loaded.model, 'qwen3.5:4b');
  assert.strictEqual(loaded.infer, true);
});

test('历史兼容：旧记录 pendingEnglish 会恢复为字段 stale', function () {
  const saved = {
    person: { zh: '女孩', en: 'a girl' },
    outfit: { zh: '红裙', en: 'red dress' },
    pose: { zh: '站着', en: 'standing' },
    scene: { zh: '', en: '' },
    light: { zh: '', en: '' },
    style: { zh: '', en: '' }
  };
  const slots = PromptFlow.normalizeSlots(saved, ['outfit']);
  assert.strictEqual(slots.outfit.stale, true);
  assert.strictEqual(slots.person.stale, false);
  assert.deepStrictEqual(PromptFlow.pendingKeys(slots), ['outfit']);

  const legacy = PromptFlow.normalizeSlots({
    person: { zh: '女孩', en: '' }
  });
  assert.deepStrictEqual(PromptFlow.pendingKeys(legacy), ['person']);
});

test('中文改动 / 英文手改的 stale 规则可逆，重译只碰传入字段', function () {
  const slots = PromptFlow.normalizeSlots(successPayload().fields);
  slots.person.zh = '银发女人';
  PromptFlow.markChineseEdited(slots, 'person');
  assert.strictEqual(slots.person.stale, true);
  slots.person.en = 'a silver-haired woman';
  PromptFlow.markEnglishEdited(slots, 'person');
  assert.strictEqual(slots.person.stale, false);

  slots.person.zh = '银发女人，侧脸';
  PromptFlow.markChineseEdited(slots, 'person');
  slots.outfit.zh = '黑色长裙';
  PromptFlow.markChineseEdited(slots, 'outfit');
  const applied = PromptFlow.applyEnglish(slots, {
    person: { en: 'a silver-haired woman in profile' },
    outfit: { en: 'wearing a black long dress' }
  }, ['person']);
  assert.strictEqual(applied.ok, true);
  assert.strictEqual(slots.person.en, 'a silver-haired woman in profile');
  assert.strictEqual(slots.person.stale, false);
  assert.strictEqual(slots.outfit.en, 'wearing a cream trench coat');
  assert.strictEqual(slots.outfit.stale, true);
});

test('app.js 的主流程失败路径不调用 fillFromParsed（静态护栏）', function () {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const finishStart = app.indexOf('function finishLocalFill');
  const nextFunction = app.indexOf('function currentFieldPayload', finishStart);
  const block = app.slice(finishStart, nextFunction > finishStart ? nextFunction : finishStart + 4000);
  assert.ok(/setLocalStatus\(\s*'error'/.test(block), '失败时应显示 error 状态');
  assert.ok(block.indexOf('fillFromParsed') === -1, '模型失败不应自动调用规则路径');
  assert.ok(block.indexOf('Parser.parse') === -1, '模型失败不应自动调用 Parser');
});

(async function run() {
  for (let i = 0; i < tests.length; i += 1) {
    const item = tests[i];
    try {
      await item.fn();
      passed += 1;
      console.log('ok  ' + item.name);
    } catch (error) {
      console.error('FAIL ' + item.name);
      throw error;
    }
  }
  console.log(passed + ' tests passed.');
})().catch(function (error) {
  process.exitCode = 1;
  console.error(error && error.stack ? error.stack : error);
});
