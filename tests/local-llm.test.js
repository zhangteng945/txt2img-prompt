/*
 * 本地解析模型（Ollama）接入回归测试：全部用 mock fetch，不依赖本机服务。
 * 运行：node tests/local-llm.test.js
 */
'use strict';

const path = require('path');
const assert = require('assert');

global.window = global;

['utils', 'lexicon', 'translator', 'scene', 'parser', 'slot-fill', 'complete', 'assemble', 'negative', 'feedback', 'local-llm']
  .forEach(function (name) {
    require(path.join(__dirname, '..', 'js', name + '.js'));
  });

const T = global.T2I;
const LocalLLM = T.LocalLLM;
const Parser = T.Parser;
const SF = T.SlotFill;
const Scene = T.Scene;
const Assemble = T.Assemble;
const Negative = T.Negative;

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

function enabled(overrides) {
  return Object.assign({
    enabled: true,
    apiRoot: LocalLLM.DEFAULT_API_ROOT,
    model: LocalLLM.DEFAULT_MODEL
  }, overrides || {});
}

const SUCCESS_IDEA = '短发女人穿米色风衣站在樱花树下，柔和自然光';
const SUCCESS_SPEC = {
  units: [
    { text: '短发女人', slot: 'person', role: 'subject' },
    { text: '米色风衣', slot: 'outfit', role: 'outfit' },
    { text: '站在樱花树下', slot: 'pose', role: 'action' },
    { text: '柔和自然光', slot: 'light', role: 'light' }
  ],
  subjects: [{ text: '短发女人', attributes: ['短发'] }],
  outfits: [{ text: '米色风衣', color: '米色', owner: '短发女人' }],
  objects: [{ text: '樱花树', attributes: [] }],
  relations: [{ type: 'located', from: '短发女人', to: '樱花树', text: '站在樱花树下' }]
};

test('成功 JSON：场景树、六框、正负面与守恒检查都能用', function () {
  return LocalLLM.compile(enabled(), SUCCESS_IDEA, {
    fetchImpl: function () { return Promise.resolve(responseWith(JSON.stringify(SUCCESS_SPEC))); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.strictEqual(result.requested, true);
    assert.strictEqual(result.scene.origin, 'local-llm');
    assert.ok(result.scene.structured);
    assert.strictEqual(result.scene.subjects.length, 1);
    assert.strictEqual(result.scene.subjects[0].zh, '女人');
    assert.ok(result.scene.subjects[0].attributes.some(function (a) { return a.zh === '短发'; }));
    assert.strictEqual(result.scene.outfits.length, 1);
    assert.ok(result.scene.outfits[0].color && result.scene.outfits[0].color.en === 'beige');
    assert.strictEqual(result.scene.objects.length, 1);
    assert.ok(result.scene.relations.some(function (r) { return r.type === 'located'; }));
    assert.deepStrictEqual(result.verify.issues, []);

    const slots = result.slots;
    assert.ok(/woman with short hair/.test(slots.person.en));
    assert.ok(/wearing a beige trench coat/.test(slots.outfit.en));
    assert.ok(/standing/.test(slots.pose.en));
    assert.ok(/under a cherry blossom tree/.test(slots.scene.en));
    assert.ok(/soft natural light/.test(slots.light.en));
    assert.ok(/beige trench coat/.test(result.assembled.positiveEn));
    assert.ok(/cherry blossom tree/.test(result.assembled.positiveEn));
    assert.ok(result.negative.negativeEn.length > 0);
  });
});

test('think 标签与代码围栏残留会被清掉，JSON 仍可解析', function () {
  const content = '<think>先想一下...</think>\n```json\n' + JSON.stringify(SUCCESS_SPEC) + '\n```';
  return LocalLLM.compile(enabled(), SUCCESS_IDEA, {
    fetchImpl: function () { return Promise.resolve(responseWith(content)); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason);
    assert.ok(result.scene.units.length >= 4);
    assert.ok(result.scene.units.some(function (u) { return u.slot === 'pose' && /standing/.test(u.en); }));
    assert.ok(result.scene.units.some(function (u) { return u.slot === 'scene' && /cherry blossom tree/.test(u.en); }));
  });
});

test('无效 JSON → 回退 invalid-json，不抛异常', function () {
  return LocalLLM.compile(enabled(), SUCCESS_IDEA, {
    fetchImpl: function () { return Promise.resolve(responseWith('抱歉，我无法输出 JSON。')); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'fallback');
    assert.strictEqual(result.code, 'invalid-json');
    assert.ok(result.reason);
    assert.strictEqual(result.scene, undefined);
  });
});

test('JSON 结构不合法 → 回退 invalid-spec', function () {
  const bad = { units: [{ text: '短发女人', slot: 'body' }] };
  return LocalLLM.compile(enabled(), SUCCESS_IDEA, {
    fetchImpl: function () { return Promise.resolve(responseWith(JSON.stringify(bad))); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'fallback');
    assert.strictEqual(result.code, 'invalid-spec');
    assert.ok(/slot/.test(result.detail));
  });
});

test('模型改写原文 → 回退 invalid-spec，不能假装完整', function () {
  const rewritten = { units: [{ text: '少女', slot: 'person', role: 'subject' }] };
  return LocalLLM.compile(enabled(), SUCCESS_IDEA, {
    fetchImpl: function () { return Promise.resolve(responseWith(JSON.stringify(rewritten))); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'fallback');
    assert.strictEqual(result.code, 'invalid-spec');
    assert.ok(/少女/.test(result.detail));
  });
});

test('模型漏掉片段 → 回退 coverage 并指出漏掉的原文', function () {
  const incomplete = {
    units: [
      { text: '短发女人', slot: 'person', role: 'subject' },
      { text: '站在樱花树下', slot: 'pose', role: 'action' }
    ]
  };
  return LocalLLM.compile(enabled(), SUCCESS_IDEA, {
    fetchImpl: function () { return Promise.resolve(responseWith(JSON.stringify(incomplete))); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'fallback');
    assert.strictEqual(result.code, 'coverage');
    assert.ok(/米色风衣|柔和自然光/.test(result.detail));
  });
});

test('模型把否定改写成肯定 → 回退 negation', function () {
  const lost = { units: [{ text: '不要吸烟', slot: 'pose', role: 'action' }] };
  return LocalLLM.compile(enabled(), '不要吸烟', {
    fetchImpl: function () { return Promise.resolve(responseWith(JSON.stringify(lost))); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'fallback');
    assert.strictEqual(result.code, 'negation');
  });
});

test('否定结构成功：正面不出现吸烟，负面补上 smoking', function () {
  const spec = {
    units: [],
    negations: [{ text: '画面里不要有水印', target: '水印', scope: 'global' }]
  };
  return LocalLLM.compile(enabled(), '画面里不要有水印', {
    fetchImpl: function () { return Promise.resolve(responseWith(JSON.stringify(spec))); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.strictEqual(result.assembled.positiveEn, '');
    assert.ok(/watermark/.test(result.negative.negativeEn));
    assert.strictEqual(result.scene.negations[0].scope, 'global');
    assert.strictEqual(result.scene.negations[0].targets[0].en, 'watermark');
  });
});

test('只给排除作用域也能保留否定并生成负面', function () {
  const idea = '背景里不要有水印';
  const spec = {
    units: [],
    scopes: [{ text: idea, scope: 'background', polarity: 'exclude', target: '水印' }]
  };
  return LocalLLM.compile(enabled(), idea, {
    fetchImpl: function () { return Promise.resolve(responseWith(JSON.stringify(spec))); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.strictEqual(result.scene.negations.length, 1);
    assert.strictEqual(result.scene.negations[0].scope, 'background');
    assert.ok(/watermark on background/.test(result.negative.negativeEn));
  });
});

test('「禁止吸烟」作为告示牌保留禁止含义，不退成单纯 smoking', function () {
  const spec = { units: [{ text: '禁止吸烟', slot: 'scene', role: 'sign' }] };
  return LocalLLM.compile(enabled(), '禁止吸烟', {
    fetchImpl: function () { return Promise.resolve(responseWith(JSON.stringify(spec))); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason);
    assert.ok(/prohibited/.test(result.assembled.positiveEn));
    assert.ok(!/(^|,\s*)smoking(,|$)/.test(result.assembled.positiveEn));
  });
});

test('超时 → 回退 timeout，并中止挂起的 fetch', function () {
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
  return LocalLLM.compile(enabled(), SUCCESS_IDEA, {
    fetchImpl: hanging,
    timeoutMs: 30
  }).then(function (result) {
    assert.strictEqual(result.status, 'fallback');
    assert.strictEqual(result.code, 'timeout');
    assert.strictEqual(sawAbort, true);
  });
});

test('网络错误 → 回退 network，并提示模型没开/休眠/Tailscale/跨域', function () {
  return LocalLLM.compile(enabled(), SUCCESS_IDEA, {
    fetchImpl: function () { return Promise.reject(new TypeError('Failed to fetch')); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'fallback');
    assert.strictEqual(result.code, 'network');
    assert.ok(/模型没开/.test(result.reason));
    assert.ok(/休眠/.test(result.reason));
    assert.ok(/Tailscale/.test(result.reason));
    assert.ok(/跨域/.test(result.reason));
  });
});

test('HTTP 403 → 回退 cors', function () {
  return LocalLLM.compile(enabled(), SUCCESS_IDEA, {
    fetchImpl: function () { return Promise.resolve(responseWith('', 403)); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'fallback');
    assert.strictEqual(result.code, 'cors');
  });
});

test('开关关闭 → disabled 且零请求；规则路径仍能给出可用结果', function () {
  let calls = 0;
  const settings = enabled({ enabled: false });
  return LocalLLM.compile(settings, SUCCESS_IDEA, {
    fetchImpl: function () {
      calls += 1;
      return Promise.resolve(responseWith(JSON.stringify(SUCCESS_SPEC)));
    }
  }).then(function (result) {
    assert.strictEqual(result.status, 'disabled');
    assert.strictEqual(result.requested, false);
    assert.strictEqual(calls, 0);

    const parsed = Parser.parse(SUCCESS_IDEA);
    const filled = SF.fill(parsed);
    const assembled = Assemble.assemble(filled.slots, { quality: false });
    const negative = Negative.build(assembled.positiveEn, Scene.negativePlan(parsed.scene));
    assert.ok(assembled.positiveEn.length > 0);
    assert.ok(negative.negativeEn.length > 0);
  });
});

test('请求体只含系统说明 + 用户原文，thinking 关闭，非流式', function () {
  const request = LocalLLM.buildRequest(enabled(), '女孩站在海边');
  assert.strictEqual(request.url, LocalLLM.DEFAULT_API_ROOT + '/api/chat');
  assert.strictEqual(request.body.stream, false);
  assert.strictEqual(request.body.think, false);
  assert.strictEqual(request.body.format, 'json');
  assert.strictEqual(request.body.model, 'qwen3.5:4b');
  assert.strictEqual(request.body.messages.length, 2);
  assert.strictEqual(request.body.messages[0].role, 'system');
  assert.strictEqual(request.body.messages[1].role, 'user');
  assert.strictEqual(request.body.messages[1].content, '女孩站在海边');
  assert.ok(/JSON/.test(request.body.messages[0].content));
  assert.ok(/不要编造/.test(request.body.messages[0].content));
  // 不把整部词库塞进请求。
  assert.ok(request.body.messages[0].content.length < 4000);
  assert.strictEqual(request.body.messages[0].content.indexOf('词典已载入'), -1);
});

test('设置读写：默认关闭、默认 Tailscale HTTPS 与 qwen3.5:4b', function () {
  const memory = Object.create(null);
  const storage = {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null; },
    setItem: function (key, value) { memory[key] = String(value); }
  };
  const fresh = LocalLLM.loadSettings(storage);
  assert.strictEqual(fresh.enabled, false);
  assert.strictEqual(fresh.apiRoot, 'https://macbook-pro.tail349cac.ts.net:11434');
  assert.strictEqual(fresh.model, 'qwen3.5:4b');

  LocalLLM.saveSettings(storage, { enabled: true, apiRoot: 'http://localhost:11434/', model: ' qwen3.5:4b ' });
  const loaded = LocalLLM.loadSettings(storage);
  assert.strictEqual(loaded.enabled, true);
  assert.strictEqual(loaded.apiRoot, 'http://localhost:11434');
  assert.strictEqual(loaded.model, 'qwen3.5:4b');

  LocalLLM.saveSettings(storage, { enabled: false, apiRoot: '', model: '' });
  const fallback = LocalLLM.loadSettings(storage);
  assert.strictEqual(fallback.apiRoot, LocalLLM.DEFAULT_API_ROOT);
  assert.strictEqual(fallback.model, LocalLLM.DEFAULT_MODEL);
});

test('场景接入：对象属性、颜色绑定、关系、例外都进入同一棵树', function () {
  const raw = '除了眼睛，其他部分都使用低饱和色彩';
  const spec = {
    units: [{ text: '低饱和色彩', slot: 'style', role: 'style' }],
    scopes: [{ text: raw, scope: 'all', polarity: 'apply', target: '低饱和色彩', exception: '眼睛' }],
    exceptions: [{ text: '眼睛' }]
  };
  const validation = LocalLLM.validateSpec(spec, raw);
  assert.strictEqual(validation.ok, true, validation.message);
  const scene = Scene.fromSpec(spec, raw);
  assert.strictEqual(scene.scopes.length, 1);
  assert.strictEqual(scene.scopes[0].polarity, 'apply');
  assert.strictEqual(scene.scopes[0].exception, '眼睛');
  assert.strictEqual(scene.exceptions[0].zh, '眼睛');
  assert.ok(/desaturated colors/.test(scene.units[0].en));
});

test('关系句复用规则拆分：颜色绑到物体，方位短语进场景框', function () {
  const idea = '穿红色裙子的女孩站在蓝色汽车旁';
  const spec = {
    units: [
      { text: '女孩', slot: 'person', role: 'subject' },
      { text: '红色裙子', slot: 'outfit', role: 'outfit' },
      { text: '站在蓝色汽车旁', slot: 'pose', role: 'action' }
    ],
    subjects: [{ text: '女孩' }],
    outfits: [{ text: '红色裙子', color: '红色', owner: '女孩' }],
    objects: [{ text: '蓝色汽车', color: '蓝色' }],
    relations: [{ type: 'located', from: '女孩', to: '蓝色汽车', text: '站在蓝色汽车旁' }]
  };
  return LocalLLM.compile(enabled(), idea, {
    fetchImpl: function () { return Promise.resolve(responseWith(JSON.stringify(spec))); }
  }).then(function (result) {
    assert.strictEqual(result.status, 'ok', result.reason + ' / ' + result.detail);
    assert.ok(/standing/.test(result.slots.pose.en));
    assert.ok(/next to a blue car/.test(result.slots.scene.en));
    assert.ok(/a girl wearing a red dress, standing next to a blue car/.test(result.assembled.positiveEn));
    assert.deepStrictEqual(result.verify.issues, []);
  });
});

test('coverageGaps 不把标点和虚词算成漏写，但会抓住实义片段', function () {
  const gaps = LocalLLM.coverageGaps({ units: [{ text: '女孩', slot: 'person' }] }, '女孩，站在樱花树下');
  assert.strictEqual(gaps.join(''), '站樱花树下');
  assert.ok(gaps.indexOf('樱花树下') !== -1);
  const clean = LocalLLM.coverageGaps({ units: [{ text: '女孩', slot: 'person' }] }, '女孩的');
  assert.deepStrictEqual(clean, []);
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
