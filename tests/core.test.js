/*
 * 核心算法回归测试：无第三方依赖。
 * 运行：node tests/core.test.js
 */
'use strict';

const path = require('path');
const assert = require('assert');

global.window = global;

['utils', 'lexicon', 'translator', 'parser', 'slot-fill', 'complete', 'assemble', 'negative']
  .forEach(function (name) {
    require(path.join(__dirname, '..', 'js', name + '.js'));
  });

const T = global.T2I;
const Parser = T.Parser;
const TR = T.Translator;
const SF = T.SlotFill;
const Complete = T.Complete;
const Assemble = T.Assemble;
const Negative = T.Negative;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('ok  ' + name);
  } catch (error) {
    console.error('FAIL ' + name);
    throw error;
  }
}

function pipeline(text) {
  const parsed = Parser.parse(text);
  const filled = SF.fill(parsed);
  const completed = Complete.complete(filled.slots);
  return { parsed: parsed, slots: completed.slots, added: completed.added };
}

test('词典规模足够', function () {
  assert.ok(T.Lexicon.stats.canonicalEntries >= 15000);
  assert.ok(T.Lexicon.stats.manualEntries >= 1400);
  assert.ok(T.Lexicon.stats.generatedEntries >= 15000);
  assert.ok(T.Lexicon.stats.zhAliases >= 30000);
  assert.ok(T.Lexicon.stats.enAliases >= 18000);
  assert.ok(T.Lexicon.stats.categories >= 22);
});

test('中文短语按语境翻译', function () {
  assert.strictEqual(TR.translateZh('米色风衣').en, 'beige trench coat');
  assert.strictEqual(TR.translateZh('柔和自然光').en, 'soft natural light');
  assert.strictEqual(TR.translateZh('傍晚街边').en, 'street at dusk');
  assert.strictEqual(TR.translateZh('回头微笑').en, 'looking back with a smile');
});

test('英文反向翻译自然且可对照', function () {
  assert.strictEqual(TR.translateEn('beige trench coat').zh, '米色风衣');
  assert.strictEqual(TR.translateEn('soft natural light').zh, '柔和自然光');
  assert.strictEqual(TR.translateEn('woman with long hair and blue eyes').zh, '长发、蓝色眼睛的女人');
  assert.strictEqual(TR.translateEn('street at dusk').zh, '黄昏的街边');
});

test('示例想法拆进六个框', function () {
  const text = '傍晚街边，短发女人穿米色风衣站着，侧脸看向远处，柔和自然光，电影感';
  const parsed = Parser.parse(text);
  const bySlot = {};
  parsed.segments.forEach(function (s) { bySlot[s.slot] = (bySlot[s.slot] || []).concat(s.en); });
  assert.ok(bySlot.person.join(' ').includes('woman with short hair'));
  assert.ok(bySlot.outfit.join(' ').includes('beige trench coat'));
  assert.ok(bySlot.pose.join(' ').includes('standing'));
  assert.ok(bySlot.pose.join(' ').includes('looking into the distance'));
  assert.ok(bySlot.scene.join(' ').includes('street at dusk'));
  assert.ok(bySlot.light.join(' ').includes('soft natural light'));
  assert.ok(bySlot.style.join(' ').includes('cinematic'));
});

test('补全只在缺失维度发生并留下记录', function () {
  const result = pipeline('短发女人站在街边');
  assert.ok(result.added.some(function (x) { return x.en === 'soft natural light'; }));
  assert.ok(result.added.some(function (x) { return x.en === '50mm lens'; }));
  assert.ok(result.added.some(function (x) { return x.en === 'realistic photography'; }));
  assert.ok(result.added.some(function (x) { return x.en === 'natural skin texture'; }));
  assert.strictEqual(result.slots.light.completionItems.length, 2);
  assert.strictEqual(result.slots.style.completionItems.length, 2);
});

test('已有光线镜头时不重复补全', function () {
  const result = pipeline('女人站在街边，柔和自然光，35mm镜头，电影感');
  assert.strictEqual(result.slots.light.en, 'soft natural light, 35mm');
  assert.strictEqual(result.slots.style.en, 'cinematic');
  assert.ok(!result.added.some(function (x) { return x.en === '50mm lens'; }));
  assert.ok(!result.added.some(function (x) { return x.en === 'realistic photography'; }));
});

test('未收录内容保留原文并提示', function () {
  const text = '一个女孩站在街边，背后有闪烁的量子蝴蝶';
  const parsed = Parser.parse(text);
  assert.ok(parsed.unknown.length > 0);
  const filled = SF.fill(parsed);
  const joined = SF.slots.map(function (k) { return filled.slots[k].en; }).join(' ');
  assert.ok(joined.includes('量子'));
});

test('纯英文提示词也能分框', function () {
  const parsed = Parser.parse(
    'a young woman with short hair, wearing a beige trench coat, standing on a rainy street at dusk, cinematic'
  );
  const slots = {};
  parsed.segments.forEach(function (s) { slots[s.slot] = true; });
  assert.ok(slots.person);
  assert.ok(slots.outfit);
  assert.ok(slots.pose);
  assert.ok(slots.style);
});

test('组装顺序和用户修改生效', function () {
  const result = pipeline('傍晚街边，短发女人穿米色风衣站着，柔和自然光，电影感');
  result.slots.person.en = 'woman with long red hair';
  result.slots.outfit.en = 'wearing a black leather jacket';
  const assembled = Assemble.assemble(result.slots);
  assert.ok(assembled.positiveEn.includes('woman with long red hair'));
  assert.ok(assembled.positiveEn.includes('wearing a black leather jacket'));
  assert.ok(assembled.positiveEn.indexOf('black leather jacket') < assembled.positiveEn.indexOf('standing'));
  assert.ok(assembled.positiveEn.indexOf('standing') < assembled.positiveEn.indexOf('street at dusk'));
  assert.ok(assembled.positiveEn.indexOf('street at dusk') < assembled.positiveEn.indexOf('soft natural light'));
  assert.ok(assembled.positiveEn.indexOf('cinematic') < assembled.positiveEn.indexOf('highly detailed'));
});

test('负面提示词覆盖常见问题并能避让冲突', function () {
  const normal = Negative.build('woman, cinematic lighting');
  assert.ok(normal.items.length >= 55);
  assert.ok(normal.negativeEn.includes('watermark'));
  assert.ok(normal.negativeEn.includes('extra fingers'));
  assert.ok(normal.negativeZh.includes('水印'));

  const deliberate = Negative.build('shallow depth of field, film grain, full body shot, high saturation');
  const skipped = deliberate.skipped.map(function (x) { return x.zh; });
  assert.ok(skipped.includes('模糊'));
  assert.ok(skipped.includes('噪点'));
  assert.ok(skipped.includes('裁切不当'));
  assert.ok(skipped.includes('过饱和'));
});

test('复杂服装、材质、发型、光效、镜头和场景都能命中', function () {
  const text = '清晨的咖啡馆，穿黑色丝绸衬衫的银发女人坐在窗边，手里拿着一杯拿铁，柔和逆光，35mm特写，电影感';
  const result = pipeline(text);
  assert.deepStrictEqual(result.parsed.unknown, []);
  assert.ok(result.slots.person.en.includes('silver hair'));
  assert.ok(result.slots.person.en.includes('black silk shirt'));
  assert.ok(result.slots.scene.en.includes('cafe in the early morning'));
  assert.ok(result.slots.light.en.includes('soft backlight'));
  assert.ok(result.slots.light.en.includes('35mm close-up'));
  assert.ok(result.slots.style.en.includes('cinematic'));
});

test('重复片段不会重复组装', function () {
  const result = pipeline('电影感，电影感，短发女人');
  const assembled = Assemble.assemble(result.slots);
  const matches = assembled.positiveEn.match(/cinematic/g) || [];
  assert.strictEqual(matches.length, 1);
});

console.log('\n' + passed + ' tests passed.');
