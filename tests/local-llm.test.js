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

['utils', 'lexicon', 'translator', 'scene', 'parser', 'slot-fill', 'complete', 'assemble', 'negative', 'feedback', 'bilingual-verify', 'local-llm', 'prompt-flow']
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
const BV = T.BilingualVerify;

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

// 最终产物只允许生图提示词短语；这里只检查形态，不检查具体某个词。
const NARRATIVE_RE = [
  /(?:^|,\s*)(?:a scene of|this image depicts|the picture shows|there is|there are|in this image|a photograph of)\b/i,
  /\b(?:is|are|was|were|has|have|had|will|would|can|could|does|do|did)\b/i,
  /\b(?:stands|sits|reads|looks|wears|holds|walks|watches|smiles|waits|cooks|eats|drinks|talks|leans|carries|runs|sleeps|works|writes|paints|plays|sings|dances|smokes)\b/i,
  /[.!?。！？]\s*$/
];

function assertPromptStyle(text, label) {
  const value = String(text == null ? '' : text);
  NARRATIVE_RE.forEach(function (re) {
    assert.ok(!re.test(value), (label || '英文') + ' 仍是叙述句：' + value);
  });
  assert.ok(!/[\u3400-\u9fff]/.test(value), (label || '英文') + ' 不应残留中文：' + value);
}

function assertNoNarrativeOpeners(text, label) {
  const value = String(text == null ? '' : text);
  [
    /a scene of/i,
    /this image depicts/i,
    /there is/i,
    /there are/i,
    /the picture shows/i,
    /in this image/i,
    /a photograph of/i
  ].forEach(function (re) {
    assert.ok(!re.test(value), (label || '最终正面') + ' 含叙述套话：' + value);
  });
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

test('提示词形态：初次拆解的字段英文和最终正面都是逗号分隔短语，不是叙述句', function () {
  const payload = successPayload({
    fields: {
      person: { zh: '年轻女人', en: 'A young woman is sitting by the window.' },
      outfit: { zh: '白衬衫和牛仔裤', en: 'wearing a white shirt and jeans' },
      pose: { zh: '坐在窗边看书', en: 'Reading a book by the window.' },
      scene: { zh: '清晨的咖啡馆', en: 'There is a cafe in the morning.' },
      light: { zh: '柔和窗光', en: 'The picture shows soft window light.' },
      style: { zh: '', en: '' }
    },
    negative: { zh: '低质量、模糊、水印、禁止吸烟', en: 'low quality, blurry, watermark, no smoking' }
  });
  return LocalLLM.generate(settings(), '年轻女人坐在清晨的咖啡馆窗边看书，柔和窗光', {
    fetchImpl: okFetch(payload)
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    LocalLLM.SLOTS.forEach(function (key) {
      if (result.fields[key].en) assertPromptStyle(result.fields[key].en, key);
    });
    assert.ok(/a young woman sitting by the window/.test(result.fields.person.en), result.fields.person.en);
    assert.ok(!/\bis\b/i.test(result.fields.person.en), 'be 动词叙述谓语应被转成短语');
    assert.ok(/white shirt and jeans/.test(result.fields.outfit.en));
    assert.ok(/reading a book by the window/i.test(result.fields.pose.en));
    assert.ok(/a cafe in the morning/.test(result.fields.scene.en));
    assert.ok(!/there is/i.test(result.fields.scene.en));
    assert.ok(/soft window light/.test(result.fields.light.en));
    assert.ok(!/picture shows/i.test(result.fields.light.en));
    assert.ok(/no smoking/.test(result.negative.en), '负面提示词不能丢否定');

    const assembled = Assemble.assemble(PromptFlow.normalizeSlots(result.fields), {
      noLexicon: true,
      quality: false
    });
    assertPromptStyle(assembled.positiveEn, '最终正面');
    assertNoNarrativeOpeners(assembled.positiveEn, '最终正面');
    assert.ok(/reading a book by the window/i.test(assembled.positiveEn), assembled.positiveEn);
    assert.ok(/a cafe in the morning/.test(assembled.positiveEn), assembled.positiveEn);
    assert.ok(/soft window light/.test(assembled.positiveEn), assembled.positiveEn);
  });
});

test('句号换逗号不算修复：is/was 等叙述谓语必须被改写', function () {
  const payload = successPayload();
  payload.fields.person = {
    zh: '年轻女人',
    en: 'A young woman is sitting by the window and reading a book.'
  };
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: okFetch(payload)
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    const en = result.fields.person.en;
    assertPromptStyle(en, 'person');
    assert.ok(!/\bis sitting\b/i.test(en), en);
    assert.ok(!/[.!?。！？]\s*$/.test(en), en);
    assert.notStrictEqual(en, 'A young woman is sitting by the window and reading a book,');
    assert.ok(/a young woman sitting by the window and reading a book/.test(en), en);
  });
});

test('系统提示与重译提示都明确：逗号分隔提示词，禁止叙述句和套话', function () {
  const retranslate = LocalLLM.buildRetranslateRequest(settings(), {
    idea: '女人在窗边看书',
    fields: { pose: { zh: '女人在窗边看书', en: 'woman reading a book by a window' } },
    pending: ['pose'],
    negative: { zh: '', en: '' }
  });
  [LocalLLM.buildSystemPrompt({ infer: false }), retranslate.body.messages[0].content]
    .forEach(function (prompt) {
      assert.ok(/逗号分隔/.test(prompt));
      assert.ok(/不是英语叙述句|不是英语句子/.test(prompt));
      ['A scene of', 'This image depicts', 'There is', 'The picture shows', 'In this image', 'A photograph of']
        .forEach(function (phrase) { assert.ok(prompt.indexOf(phrase) !== -1, '缺少反例：' + phrase); });
      assert.ok(/woman reading a book by a window/.test(prompt), '缺少动作短语正例');
      assert.ok(/her friend sitting on a bench waiting for her/.test(prompt), '缺少多主体关系正例');
      assert.ok(/句号换逗号但仍是完整句子/.test(prompt), '缺少「句号换逗号不合格」说明');
    });
});

test('中文修改后重译：新英文仍是提示词短语，保留用户中文和动作关系', function () {
  const slots = fieldState(successPayload());
  slots.pose.zh = '女人转身走向街角，手里拿着一束花';
  PromptFlow.markChineseEdited(slots, 'pose');
  assert.deepStrictEqual(PromptFlow.pendingKeys(slots), ['pose']);
  const response = {
    fields: {
      pose: {
        zh: '站在樱花树下（模型初稿）',
        en: 'The woman is turning toward the street corner, holding a bouquet.'
      }
    },
    negative: { zh: '低质量、模糊、水印', en: 'low quality, blurry, watermark' }
  };
  return LocalLLM.retranslate(settings(), {
    idea: SUCCESS_IDEA,
    fields: JSON.parse(JSON.stringify(slots)),
    pending: ['pose'],
    negative: { zh: '低质量、模糊、水印', en: 'low quality, blurry, watermark' }
  }, {
    fetchImpl: function () { return Promise.resolve(responseWith(JSON.stringify(response))); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assertPromptStyle(result.fields.pose.en, '重译 pose');
    assert.ok(/turning toward the street corner/.test(result.fields.pose.en), result.fields.pose.en);
    assert.ok(/holding a bouquet/.test(result.fields.pose.en), result.fields.pose.en);
    assert.ok(!/\bis\b/i.test(result.fields.pose.en), result.fields.pose.en);

    const applied = PromptFlow.applyEnglish(slots, result.fields, result.pending);
    assert.strictEqual(applied.ok, true);
    assert.strictEqual(slots.pose.zh, '女人转身走向街角，手里拿着一束花');
    assert.deepStrictEqual(PromptFlow.pendingKeys(slots), []);

    const assembled = Assemble.assemble(slots, { noLexicon: true, quality: false });
    assertPromptStyle(assembled.positiveEn, '重译后最终正面');
    assert.ok(/turning toward the street corner/.test(assembled.positiveEn), assembled.positiveEn);
    assert.ok(/holding a bouquet/.test(assembled.positiveEn), assembled.positiveEn);
  });
});

test('最终拼装：动作短语允许保留语法连接，关系与否定都不丢', function () {
  const slots = PromptFlow.normalizeSlots({
    person: { zh: '女人', en: 'A woman is standing beside a red car.' },
    outfit: { zh: '白衬衫', en: 'wearing a white shirt' },
    pose: {
      zh: '女人站在红色汽车旁，她的朋友坐在长椅上等她',
      en: 'The woman is standing beside a red car while her friend sits on a bench waiting for her.'
    },
    scene: { zh: '红色汽车和长椅', en: 'a red car and a bench' },
    light: { zh: '', en: '' },
    style: { zh: '', en: '' }
  });
  const assembled = Assemble.assemble(slots, { noLexicon: true, quality: false });
  assertPromptStyle(assembled.positiveEn, '最终正面');
  assertNoNarrativeOpeners(assembled.positiveEn, '最终正面');
  assert.ok(/standing beside a red car/.test(assembled.positiveEn), assembled.positiveEn);
  assert.ok(/friend sitting on a bench waiting for her/.test(assembled.positiveEn), assembled.positiveEn);
  assert.ok(
    /woman standing beside a red car/.test(assembled.positiveEn),
    '人物与关系动作应连成短语，不能只剩孤立标签：' + assembled.positiveEn
  );
});

test('多主体关系：pose 自带主体时不重复输出单独的人物列表', function () {
  const slots = PromptFlow.normalizeSlots({
    person: { zh: '一个女孩，她的朋友', en: 'a girl, her friend' },
    outfit: { zh: '', en: '' },
    pose: {
      zh: '女孩站在红色汽车旁，朋友坐在长椅上等她',
      en: 'a girl standing next to a red car, her friend sitting on a bench waiting for her'
    },
    scene: { zh: '红色汽车和长椅', en: 'a red car and a bench' },
    light: { zh: '', en: '' },
    style: { zh: '', en: '' }
  });
  const assembled = Assemble.assemble(slots, { noLexicon: true, quality: false });
  assertPromptStyle(assembled.positiveEn, '多主体最终正面');
  assert.strictEqual(
    assembled.positiveEn,
    'a girl standing next to a red car, her friend sitting on a bench waiting for her, a red car and a bench'
  );
});

test('允许动作短语：woman reading a book by a window 不会被拆成单词标签', function () {
  const slots = PromptFlow.normalizeSlots({
    person: { zh: '女人', en: 'woman' },
    outfit: { zh: '', en: '' },
    pose: { zh: '在窗边看书', en: 'reading a book by a window' },
    scene: { zh: '', en: '' },
    light: { zh: '', en: '' },
    style: { zh: '', en: '' }
  });
  const assembled = Assemble.assemble(slots, { noLexicon: true, quality: false });
  assert.ok(/woman reading a book by a window/.test(assembled.positiveEn), assembled.positiveEn);
  assert.ok(assembled.positiveEn.split(',').some(function (part) {
    return part.trim().split(/\s+/).length > 1;
  }), '不能强制每项只有一个词');
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

test('模型用「无」表示空字段时不误报缺英文，空字段保持为空', function () {
  const payload = successPayload();
  payload.fields.person = { zh: '无', en: '' };
  return LocalLLM.generate(settings(), SUCCESS_IDEA, {
    fetchImpl: okFetch(payload)
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.strictEqual(result.fields.person.zh, '');
    assert.strictEqual(result.fields.person.en, '');
    assert.ok(/cream trench coat/.test(result.fields.outfit.en));
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


test('独立回译请求只带实际英文，不携带权威中文/整体描述作为抄写目标', function () {
  const request = LocalLLM.buildBacktranslateRequest(settings(), {
    fields: {
      person: { zh: '一只橘猫', en: 'an orange cat' },
      pose: { zh: '一只橘猫趴在窗台上晒太阳', en: 'an orange cat lying on the windowsill' }
    },
    negative: { zh: '不要文字，不要水印', en: 'no text, no watermark' }
  });
  const user = request.body.messages[1].content;
  const system = request.body.messages[0].content;
  assert.ok(/an orange cat lying on the windowsill/.test(user));
  assert.ok(/no text, no watermark/.test(user));
  ['一只橘猫', '晒太阳', '不要文字', '不要水印', 'current_fields', 'original_idea'].forEach(function (forbidden) {
    assert.strictEqual(user.indexOf(forbidden), -1, '回译请求不应携带目标中文：' + forbidden);
  });
  assert.ok(/独立/.test(system));
  assert.ok(/不要参考任何中文原文/.test(system));
  assert.ok(/不补全|不要补全/.test(system));
  assert.strictEqual(request.body.think, false);
  assert.strictEqual(request.body.format, 'json');
});

test('独立回译：实际英文回译成中文，英文为空时允许空回译', function () {
  return LocalLLM.backtranslate(settings(), {
    fields: {
      person: { zh: '一只橘猫', en: 'an orange cat' },
      pose: { zh: '趴在窗台上', en: 'lying on the windowsill' }
    },
    negative: { zh: '不要文字', en: 'no text' }
  }, {
    fetchImpl: okFetch({
      fields: {
        person: { back_zh: '一只橘猫' },
        outfit: { back_zh: '' },
        pose: { back_zh: '趴在窗台上' },
        scene: { back_zh: '' },
        light: { back_zh: '' },
        style: { back_zh: '' }
      },
      negative: { back_zh: '没有文字' }
    })
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.strictEqual(result.fields.person.back_zh, '一只橘猫');
    assert.strictEqual(result.fields.pose.back_zh, '趴在窗台上');
    assert.strictEqual(result.negative.back_zh, '没有文字');
  });
});

test('结构化差异：漏译「晒太阳」并保留原文自相矛盾提示，不擅自删一侧', function () {
  const fields = {
    person: { zh: '', en: '' },
    outfit: { zh: '', en: '' },
    pose: { zh: '一只橘猫趴在窗台上晒太阳', en: 'an orange cat lying on the windowsill' },
    scene: { zh: '窗外下着雨的街道', en: 'a rainy street outside the window' },
    light: { zh: '', en: '' },
    style: { zh: '', en: '' }
  };
  const result = BV.compare({
    fields: fields,
    back: {
      pose: { back_zh: '一只橘猫趴在窗台上' },
      scene: { back_zh: '窗外下雨的街道' }
    },
    negative: { zh: '', en: 'low quality' },
    backNegative: { back_zh: '低质量' }
  });
  assert.strictEqual(result.status, 'mismatch');
  assert.ok(result.issues.some(function (issue) {
    return issue.type === 'missing-content' && issue.slot === 'pose' && /晒太阳/.test(issue.title + issue.detail);
  }), '应发现晒太阳漏译');
  const conflict = result.issues.find(function (issue) { return issue.type === 'input-conflict'; });
  assert.ok(conflict, '下雨 + 晒太阳应提示原文冲突');
  assert.strictEqual(conflict.fixable, false);
  assert.strictEqual(result.slots.pose.zh, '一只橘猫趴在窗台上晒太阳', '中文不得被回译覆盖');
});

test('结构化差异：否定落位与「禁止吸烟」告示牌区分', function () {
  const fields = {
    person: { zh: '', en: '' },
    outfit: { zh: '', en: '' },
    pose: { zh: '', en: '' },
    scene: {
      zh: '画面里的告示牌写着禁止吸烟，不要文字，不要水印',
      en: 'a no smoking sign, no text, no watermark'
    },
    light: { zh: '', en: '' },
    style: { zh: '', en: '' }
  };
  const result = BV.compare({
    fields: fields,
    back: {
      scene: { back_zh: '一块写着禁止吸烟的告示牌，没有文字，没有水印' }
    },
    negative: { zh: '文字、水印、吸烟', en: 'text, watermark, smoking' },
    backNegative: { back_zh: '文字、水印、吸烟' }
  });
  assert.strictEqual(result.status, 'mismatch');
  assert.ok(result.issues.some(function (issue) {
    return issue.type === 'negation-placement' && issue.target === '文字';
  }), '正面 no text 应被标出');
  assert.ok(result.issues.some(function (issue) {
    return issue.type === 'negation-placement' && issue.target === '水印';
  }), '正面 no watermark 应被标出');
  assert.ok(result.issues.some(function (issue) {
    return issue.type === 'sign-negation';
  }), '标牌语义被扔进负面应被标出');
});

test('结构化差异：人物用词冲突、多人物重复罗列、数量与身体部位', function () {
  const fields = {
    person: { zh: '一个女孩，她有一头长发', en: 'a family of three, the father, the mother, the child' },
    outfit: { zh: '', en: '' },
    pose: { zh: '女人转身走向门口，手里拿着一束花', en: 'a girl turning toward the door' },
    scene: { zh: '公园里，一家三口', en: 'a family of three in the park' },
    light: { zh: '', en: '' },
    style: { zh: '', en: '' }
  };
  const result = BV.compare({
    fields: fields,
    back: {
      person: { back_zh: '一家三口，父亲、母亲和孩子，父亲、母亲和孩子' },
      pose: { back_zh: '一个女孩转身走向门口' },
      scene: { back_zh: '公园里的一家三口' }
    },
    negative: { zh: '', en: 'low quality' },
    backNegative: { back_zh: '低质量' }
  });
  assert.ok(result.issues.some(function (issue) { return issue.type === 'identity-conflict'; }), '女孩/女人冲突应被发现');
  assert.ok(result.issues.some(function (issue) { return issue.type === 'duplicate-subjects'; }), '重复罗列应被发现');
  assert.ok(result.issues.some(function (issue) { return issue.type === 'body-part' && /头发/.test(issue.title); }), '头发漏译应被发现');
  assert.ok(result.issues.some(function (issue) { return issue.type === 'action-object' && /花/.test(issue.title); }), '花漏译应被发现');
});


test('原文权威：模型中文框漏掉「晒太阳」时，回译核对也要暴露，不悄悄圆过去', function () {
  const fields = {
    person: { zh: '', en: '' },
    outfit: { zh: '', en: '' },
    pose: { zh: '一只橘猫趴在窗台上', en: 'an orange cat lying on the windowsill' },
    scene: { zh: '窗外下着雨的街道', en: 'a rainy street outside the window' },
    light: { zh: '', en: '' },
    style: { zh: '', en: '' }
  };
  const result = BV.compare({
    fields: fields,
    back: {
      pose: { back_zh: '一只橙色的猫趴在窗台上' },
      scene: { back_zh: '窗外的雨街' }
    },
    negative: { zh: '低质量', en: 'low quality' },
    backNegative: { back_zh: '低质量' },
    idea: '窗外下着雨的街道，一只橘猫趴在窗台上晒太阳',
    compareIdea: true
  });
  assert.ok(result.issues.some(function (issue) {
    return issue.type === 'input-omitted' && /晒太阳/.test(issue.title);
  }), '模型把晒太阳从中文框漏掉时，也必须暴露');
  assert.ok(result.issues.some(function (issue) { return issue.type === 'input-conflict'; }));
  assert.strictEqual(result.slots.pose.zh, '一只橘猫趴在窗台上', '不自动补写中文');
});

test('修正只允许在确有负面差异时改 negative，避免把标牌语义越修越错', function () {
  const slots = fieldState(successPayload());
  slots.pose.zh = '女人转身走向门口';
  slots.pose.en = 'girl turning towards the door';
  const negative = { zh: '文字、水印', en: 'text, watermark' };
  let correctionCalls = 0;
  const fetchImpl = function (url, init) {
    const system = JSON.parse(init.body).messages[0].content;
    if (/修正器/.test(system)) {
      correctionCalls += 1;
      return Promise.resolve(responseWith(JSON.stringify({
        fields: {
          person: { en: 'a woman with a short bob, seen in profile looking into the distance' },
          outfit: { en: 'wearing a cream trench coat' },
          pose: { en: 'woman turning and walking towards the door' },
          scene: { en: 'beneath a cherry tree' },
          light: { en: 'soft natural light' },
          style: { en: '' }
        },
        // 故意多返回 negative：没有负面差异时页面不得采用。
        negative: { zh: '文字、水印、吸烟', en: 'text, watermark, smoking' },
        notes: []
      })));
    }
    return Promise.resolve(responseWith(JSON.stringify({
      fields: {
        person: { back_zh: '一个短发女人，侧脸看向远处' },
        outfit: { back_zh: '穿着米色风衣' },
        pose: { back_zh: '女孩转身走向门口' },
        scene: { back_zh: '樱花树下' },
        light: { back_zh: '柔和的自然光' },
        style: { back_zh: '' }
      },
      negative: { back_zh: '文字、水印' },
      notes: []
    })));
  };
  return LocalLLM.review(settings(), {
    fields: slots,
    negative: negative
  }, { fetchImpl: fetchImpl }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.strictEqual(correctionCalls, 1);
    assert.strictEqual(result.negative.en, 'text, watermark', '没有负面差异时不得采用模型多返回的 smoking');
  });
});


test('双向校对成功路径不调用 Translator / 词库，也不调用规则 Parser', function () {
  const originals = {
    translateZh: TR.translateZh,
    translateEn: TR.translateEn,
    translateZhPhrase: TR.translateZhPhrase
  };
  const calls = [];
  ['translateZh', 'translateEn', 'translateZhPhrase'].forEach(function (name) {
    TR[name] = function () {
      calls.push(name);
      throw new Error('双向校对不应调用词库');
    };
  });
  const fields = fieldState(successPayload());
  return LocalLLM.review(settings(), {
    fields: fields,
    negative: { zh: '低质量、模糊、水印', en: 'low quality, blurry, watermark' }
  }, {
    fetchImpl: okFetch({
      fields: {
        person: { back_zh: '一个短发女人，侧脸看向远处' },
        outfit: { back_zh: '穿着米色风衣' },
        pose: { back_zh: '站在樱花树下' },
        scene: { back_zh: '樱花树下' },
        light: { back_zh: '柔和的自然光' },
        style: { back_zh: '' }
      },
      negative: { back_zh: '低质量、模糊、水印' }
    })
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(result.review.status, 'clean');
  }).finally(function () {
    Object.keys(originals).forEach(function (name) { TR[name] = originals[name]; });
  });
});

test('有限修正：发现差异后只修 1 轮，再独立回译复核；中文始终不动', function () {
  const slots = fieldState(successPayload());
  slots.person.zh = '短发女人';
  slots.person.en = 'a woman with a short bob';
  slots.pose.zh = '一只橘猫趴在窗台上晒太阳';
  slots.pose.en = 'an orange cat lying on the windowsill';
  let backCount = 0;
  let correctionCalls = 0;
  const sent = [];
  const fetchImpl = function (url, init) {
    const body = JSON.parse(init.body);
    sent.push(body);
    const system = body.messages[0].content;
    if (/修正器/.test(system)) {
      correctionCalls += 1;
      return Promise.resolve(responseWith(JSON.stringify({
        fields: {
          person: { en: 'a woman with a short bob' },
          outfit: { en: 'wearing a cream trench coat' },
          pose: { en: 'an orange cat lying on the windowsill in the sun' },
          scene: { en: 'beneath a cherry tree' },
          light: { en: 'soft natural light' },
          style: { en: '' }
        },
        negative: { zh: '低质量、模糊、水印', en: 'low quality, blurry, watermark' },
        notes: []
      })));
    }
    backCount += 1;
    return Promise.resolve(responseWith(JSON.stringify({
      fields: {
        person: { back_zh: '一个短发女人' },
        outfit: { back_zh: '穿着米色风衣' },
        pose: { back_zh: backCount === 1 ? '一只橘猫趴在窗台上' : '一只橘猫趴在窗台上晒太阳' },
        scene: { back_zh: '樱花树下' },
        light: { back_zh: '柔和的自然光' },
        style: { back_zh: '' }
      },
      negative: { back_zh: '低质量、模糊、水印' },
      notes: []
    })));
  };
  return LocalLLM.review(settings(), {
    fields: slots,
    negative: { zh: '低质量、模糊、水印', en: 'low quality, blurry, watermark' }
  }, { fetchImpl: fetchImpl }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.strictEqual(result.review.corrected, true);
    assert.strictEqual(result.review.round, 1);
    assert.ok(result.review.correctedKeys.indexOf('pose') !== -1, 'pose 应被修正');
    assert.strictEqual(result.review.initial.issues.length > 0, true);
    assert.strictEqual(result.review.issues.length, 0, JSON.stringify(result.review.issues));
    assert.strictEqual(result.review.status, 'clean');
    assert.strictEqual(result.fields.pose.zh, '一只橘猫趴在窗台上晒太阳', '回译/修正不得改中文');
    assert.ok(/in the sun/.test(result.fields.pose.en));
    assert.strictEqual(backCount, 2, '修正后必须再做一次独立回译');
    assert.strictEqual(correctionCalls, 1, '最多自动修正 1 轮');
    const backRequests = sent.filter(function (body) { return /回译者/.test(body.messages[0].content); });
    assert.strictEqual(backRequests.length, 2);
    backRequests.forEach(function (body) {
      assert.strictEqual(body.messages[1].content.indexOf('一只橘猫趴在窗台上晒太阳'), -1);
      assert.strictEqual(body.messages[1].content.indexOf('晒太阳'), -1);
    });
    const fixRequest = sent.find(function (body) { return /修正器/.test(body.messages[0].content); });
    assert.ok(fixRequest, '应发出修正请求');
    const fixUser = JSON.parse(fixRequest.messages[1].content);
    assert.ok(/晒太阳/.test(fixUser.current_fields.pose.zh), '修正请求允许携带权威中文');
    assert.ok(fixUser.fix_keys.indexOf('pose') !== -1, '修正请求应包含 pose');
  });
});

test('有限修正：修正后仍有差异不无限调用，状态保持需确认', function () {
  const slots = fieldState(successPayload());
  slots.pose.zh = '一只橘猫趴在窗台上晒太阳';
  slots.pose.en = 'an orange cat on the windowsill';
  let backCount = 0;
  let correctionCalls = 0;
  const fetchImpl = function (url, init) {
    const system = JSON.parse(init.body).messages[0].content;
    if (/修正器/.test(system)) {
      correctionCalls += 1;
      return Promise.resolve(responseWith(JSON.stringify({
        fields: {
          person: { en: 'a woman with a short bob, seen in profile looking into the distance' },
          outfit: { en: 'wearing a cream trench coat' },
          pose: { en: 'an orange cat sitting on the windowsill' },
          scene: { en: 'beneath a cherry tree' },
          light: { en: 'soft natural light' },
          style: { en: '' }
        },
        negative: { zh: '低质量', en: 'low quality' },
        notes: []
      })));
    }
    backCount += 1;
    return Promise.resolve(responseWith(JSON.stringify({
      fields: {
        person: { back_zh: '一个短发女人' },
        outfit: { back_zh: '穿着米色风衣' },
        pose: { back_zh: '一只橘猫坐在窗台上' },
        scene: { back_zh: '樱花树下' },
        light: { back_zh: '柔和的自然光' },
        style: { back_zh: '' }
      },
      negative: { back_zh: '低质量' },
      notes: []
    })));
  };
  return LocalLLM.review(settings(), {
    fields: slots,
    negative: { zh: '低质量', en: 'low quality' }
  }, { fetchImpl: fetchImpl }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.strictEqual(result.review.status, 'mismatch');
    assert.strictEqual(result.review.corrected, true);
    assert.strictEqual(result.review.round, 1);
    assert.strictEqual(correctionCalls, 1, '不能进行第二轮自动修正');
    assert.strictEqual(backCount, 2);
    assert.ok(result.review.issues.some(function (issue) { return /晒太阳/.test(issue.title + issue.detail); }));
    assert.strictEqual(result.review.status === BV.STATUS.verified, false, '不一致不得自动标已确认');
  });
});

test('修正请求失败：保留修正前英文和中文，报 error，不回退词库', function () {
  const slots = fieldState(successPayload());
  slots.pose.zh = '一只橘猫趴在窗台上晒太阳';
  slots.pose.en = 'an orange cat on the windowsill';
  const before = JSON.parse(JSON.stringify(slots));
  let correctionCalls = 0;
  const fetchImpl = function (url, init) {
    const system = JSON.parse(init.body).messages[0].content;
    if (/修正器/.test(system)) {
      correctionCalls += 1;
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    return Promise.resolve(responseWith(JSON.stringify({
      fields: {
        person: { back_zh: '一个短发女人' },
        outfit: { back_zh: '穿着米色风衣' },
        pose: { back_zh: '一只橘猫趴在窗台上' },
        scene: { back_zh: '樱花树下' },
        light: { back_zh: '柔和的自然光' },
        style: { back_zh: '' }
      },
      negative: { back_zh: '低质量' },
      notes: []
    })));
  };
  return LocalLLM.review(settings(), {
    fields: before,
    negative: { zh: '低质量', en: 'low quality' }
  }, { fetchImpl: fetchImpl }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'network');
    assert.strictEqual(correctionCalls, 1);
    assert.deepStrictEqual(PromptFlow.normalizeSlots(result.fields), PromptFlow.normalizeSlots(before), '修正失败必须保留修正前英文');
    assert.strictEqual(result.review.status, 'error');
    assert.ok(result.review.initial.issues.length > 0, '仍应保留已发现的差异');
  });
});

test('回译超时：保留当前英文，报 error，不伪造回译', function () {
  const steps = fieldState(successPayload());
  const before = JSON.parse(JSON.stringify(steps));
  const hanging = function (url, init) {
    return new Promise(function (resolve, reject) {
      init.signal.addEventListener('abort', function () {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  };
  return LocalLLM.review(settings(), {
    fields: before,
    negative: { zh: '低质量', en: 'low quality' }
  }, { fetchImpl: hanging, timeoutMs: 25 }).then(function (result) {
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.code, 'timeout');
    assert.deepStrictEqual(PromptFlow.normalizeSlots(result.fields), PromptFlow.normalizeSlots(before));
    assert.strictEqual(result.review.status, 'error');
    assert.ok(/超时/.test(result.review.error));
  });
});

test('校对状态：确认后才已校对，不一致不自动确认，编辑后失效，历史可恢复', function () {
  const slots = fieldState(successPayload());
  const clean = BV.normalizeReview({
    status: BV.STATUS.clean,
    issues: [],
    slots: {},
    negative: { zh: '', en: '', backZh: '', issues: [] },
    snapshot: BV.snapshotOf(slots),
    checkedAt: 1
  });
  assert.strictEqual(clean.status, 'clean');
  const confirmed = BV.confirm(clean, slots);
  assert.strictEqual(confirmed.status, 'verified');
  assert.strictEqual(confirmed.confirmedWithIssues, false);

  const mismatch = BV.normalizeReview({
    status: BV.STATUS.mismatch,
    issues: [{ type: 'missing-content', slot: 'pose', title: '漏译', detail: '少了晒太阳' }],
    slots: {},
    negative: { zh: '', en: '', backZh: '', issues: [] },
    snapshot: BV.snapshotOf(slots),
    checkedAt: 1
  });
  assert.notStrictEqual(mismatch.status, 'verified', '不一致不得自动标已确认');
  const confirmedMismatch = BV.confirm(mismatch, slots);
  assert.strictEqual(confirmedMismatch.status, 'verified');
  assert.strictEqual(confirmedMismatch.confirmedWithIssues, true, '用户明确确认时保留差异记录');

  const serialized = BV.serialize(confirmedMismatch);
  const restored = BV.restore(serialized, slots);
  assert.strictEqual(restored.status, 'verified');
  assert.strictEqual(restored.confirmedWithIssues, true);

  const edited = JSON.parse(JSON.stringify(slots));
  edited.pose.zh = '女人转身走向门口';
  PromptFlow.markChineseEdited(edited, 'pose');
  const stale = BV.restore(serialized, edited);
  assert.strictEqual(stale.status, 'unverified', '改中文后已校对状态必须失效');
  assert.ok(/失效/.test(stale.staleReason));

  const invalidated = BV.invalidate(confirmed);
  assert.strictEqual(invalidated.status, 'unverified');
  assert.strictEqual(BV.confirm(invalidated, slots).status, 'unverified', '未核对不能直接确认');
});

test('历史记录：校对状态、差异和回译快照可保存/恢复，旧记录按未核对处理', function () {
  const slots = fieldState(successPayload());
  const review = BV.normalizeReview({
    status: BV.STATUS.mismatch,
    corrected: true,
    correctedKeys: ['pose'],
    round: 1,
    issues: [{ type: 'identity-conflict', slot: 'pose', title: '人物用词冲突', detail: '女人 vs 女孩' }],
    slots: { pose: { zh: slots.pose.zh, en: slots.pose.en, backZh: '一个女孩转身', issues: [] } },
    negative: { zh: '低质量', en: 'low quality', backZh: '低质量', issues: [] },
    snapshot: BV.snapshotOf(slots),
    checkedAt: 123
  });
  const record = {
    id: 'r1',
    slots: PromptFlow.serialize(slots),
    review: BV.serialize(review),
    reviewStatus: review.status,
    reviewIssueCount: review.issues.length
  };
  const restoredSlots = PromptFlow.normalizeSlots(record.slots);
  const restored = BV.restore(record.review, restoredSlots);
  assert.strictEqual(restored.status, BV.STATUS.mismatch);
  assert.strictEqual(restored.issues.length, 1);
  assert.strictEqual(restored.corrected, true);
  assert.strictEqual(restored.round, 1);
  assert.strictEqual(restored.slots.pose.backZh, '一个女孩转身');

  const legacy = BV.restore(undefined, restoredSlots);
  assert.strictEqual(legacy.status, 'unverified');
});

test('app.js 接入：主流程自动回译、编辑失效、确认、历史保存校对状态', function () {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.ok(/LocalLLM\.review\(/.test(app), '应调用独立回译校对');
  assert.ok(/startReview\(\{\s*correct: true,\s*auto: true,\s*compareIdea: true\s*\}\)/.test(app), '初稿后应自动回译');
  assert.ok(/startReview\(\{\s*correct: true,\s*keys: applied\.updated\.slice\(\)/.test(app), '重译后应回译');
  assert.ok(/BilingualVerify\.invalidate\(state\.review\)/.test(app), '编辑后应使校对失效');
  assert.ok(/BilingualVerify\.confirm\(review, state\.slots\)/.test(app), '确认按钮应进入已校对');
  assert.ok(/review: BilingualVerify\.serialize\(state\.review\)/.test(app), '历史应保存校对状态');
  assert.ok(/BilingualVerify\.restore\(record\.review, state\.slots\)/.test(app), '历史打开应恢复校对状态');
  assert.ok(app.indexOf("setStatus('英文已按当前中文重译；中文未被改回。已刷新正/负提示词。'") === -1,
    '重译后不应跳过回译直接宣称完成');

  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/id="reviewPanel"/.test(html), '页面应有校对面板');
  assert.ok(html.indexOf('js/bilingual-verify.js') !== -1, '页面应加载校对模块');
  assert.ok(html.indexOf('js/bilingual-verify.js') < html.indexOf('js/local-llm.js'),
    'bilingual-verify 必须在 local-llm 之前加载');
});

test('修订失败/超时保留编辑的静态护栏：finishReview 不调用 fillFromParsed', function () {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const start = app.indexOf('function finishReview');
  const end = app.indexOf('function fillFromModel', start);
  const block = app.slice(start, end > start ? end : start + 9000);
  assert.ok(block.length > 1000);
  assert.ok(block.indexOf('fillFromParsed') === -1);
  assert.ok(block.indexOf('Parser.parse') === -1);
  assert.ok(/已有编辑已保留/.test(block));
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
