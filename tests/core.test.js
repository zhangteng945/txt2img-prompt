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

test('词典规模落在覆盖率最佳点', function () {
  const stats = T.Lexicon.stats;
  assert.ok(stats.canonicalEntries >= 10000);
  assert.ok(stats.canonicalEntries <= 15000);
  assert.ok(stats.manualEntries >= 4000);
  assert.ok(stats.generatedEntries >= 5000);
  assert.ok(stats.generatedEntries <= 7000);
  assert.ok(stats.zhAliases >= 19000);
  assert.ok(stats.enAliases >= 14000);
  assert.ok(stats.categories >= 22);

  const byCategory = T.Lexicon.byCategory;
  assert.ok(byCategory.scene.length >= 3000, 'scene 应该是覆盖主战场');
  assert.ok(byCategory.outfit.length <= 2500, 'outfit 不应再靠笛卡尔积膨胀');
  assert.ok(byCategory.outfit.length < byCategory.scene.length);
  assert.ok(byCategory.pose.length >= 300);
  assert.ok(byCategory.subject.length >= 400);
  assert.ok(byCategory.appearance.length >= 200);
  assert.ok(byCategory.expression.length >= 140);
  assert.ok(byCategory.hair.length >= 500);
  assert.ok(byCategory.light.length >= 450);
  assert.ok(byCategory.camera.length >= 200);
  assert.ok(byCategory.style.length >= 300);
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

test('高频中文外貌说法必须命中正确规范词并译出英文', function () {
  const cases = [
    ['美女', 'beautiful woman', 'subject', '美丽的女性'],
    ['漂亮', 'pretty', 'appearance', '漂亮'],
    ['美丽', 'beautiful', 'appearance', '美丽'],
    ['好看', 'good-looking', 'appearance', '好看'],
    ['帅哥', 'handsome man', 'subject', '英俊男性'],
    ['美男', 'handsome man', 'subject', '英俊男性'],
    ['美少女', 'beautiful girl', 'subject', '美少女'],
    ['佳人', 'beautiful woman', 'subject', '美丽的女性'],
    ['女神', 'goddess-like beauty', 'subject', '女神'],
    ['男神', 'handsome man', 'subject', '英俊男性'],
    ['靓女', 'beautiful woman', 'subject', '美丽的女性'],
    ['靓仔', 'handsome man', 'subject', '英俊男性'],
    ['美眉', 'beautiful girl', 'subject', '美少女'],
    ['校花', 'campus beauty', 'subject', '校花'],
    ['校草', 'campus heartthrob', 'subject', '校草'],
    ['漂亮的女人', 'beautiful woman', 'subject', '美丽的女性'],
    ['美丽的女孩', 'beautiful girl', 'subject', '美少女'],
    ['混血美女', 'mixed-race woman', 'subject', '混血女性']
  ];

  cases.forEach(function (item) {
    const term = item[0];
    const result = TR.translateZh(term, { slot: 'person' });
    assert.deepStrictEqual(result.unknown, [], term + ' 不应落空');
    assert.strictEqual(result.en, item[1], term + ' 英文译法不稳定');
    assert.ok(result.matches.length, term + ' 应命中词库');
    assert.strictEqual(result.matches[0].entry.category, item[2], term + ' 类别不对');
    assert.strictEqual(result.matches[0].entry.zh, item[3], term + ' 规范词不对');

    const parsed = Parser.parse(term);
    assert.strictEqual(parsed.segments[0].slot, 'person', term + ' 应归入人物框');
    assert.strictEqual(parsed.segments[0].en, item[1], term + ' 解析结果应稳定');
  });

  // 「美女」必须挂在宽词「美丽的女性」上，而不是窄词「混血女性」。
  assert.notStrictEqual(TR.translateZh('美女').matches[0].entry.zh, '混血女性');
  assert.strictEqual(TR.translateZh('混血美女').matches[0].entry.zh, '混血女性');
});

test('高频英文外貌词及人物组合必须命中正确类别', function () {
  const cases = [
    ['handsome', '英俊', 'appearance'],
    ['pretty', '漂亮', 'appearance'],
    ['beautiful', '美丽', 'appearance'],
    ['gorgeous', '华丽', 'appearance'],
    ['attractive', '迷人', 'appearance'],
    ['stunning', '惊艳', 'appearance'],
    ['handsome man', '英俊男性', 'subject'],
    ['beautiful woman', '美丽的女性', 'subject'],
    ['beautiful girl', '美少女', 'subject'],
    ['handsome boy', '英俊男孩', 'subject']
  ];

  cases.forEach(function (item) {
    const term = item[0];
    const result = TR.translateEn(term);
    assert.strictEqual(result.zh, item[1], term + ' 反向译法不稳定');
    assert.ok(result.matches.length, term + ' 应命中词库');
    assert.strictEqual(result.matches[0].entry.category, item[2], term + ' 类别不对');

    const parsed = Parser.parse(term);
    assert.strictEqual(parsed.segments[0].slot, 'person', term + ' 应归入人物框');
  });
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

test('关系句式先拆角色再组装：给…上 / 对着 / 在…上', function () {
  const cases = [
    '小狗给车轮上撒尿的搞笑画面',
    '小狗对着车轮撒尿的搞笑画面',
    '小狗在车轮上撒尿的搞笑画面'
  ];

  cases.forEach(function (text) {
    const result = pipeline(text);
    const parsed = result.parsed;
    const slots = result.slots;

    assert.deepStrictEqual(parsed.unknown, [], text + ' 不应有未命中词');
    ['狗', '撒尿', '车轮', '搞笑', '画面'].forEach(function (term) {
      assert.ok(!parsed.unknown.includes(term), text + ' 未命中列表不应出现 ' + term);
    });

    assert.strictEqual(SF.slots.length, 6, '六个框必须都存在');
    assert.ok(/dog|puppy/i.test(slots.person.en), text + ' 人物框应体现狗');
    assert.ok(/peeing|urinating/i.test(slots.pose.en), text + ' 姿态框应体现撒尿');
    assert.ok(/wheel|tire/i.test(slots.pose.en + ' ' + slots.scene.en), text + ' 场景应体现车轮');
    assert.ok(/funny|comedic/i.test(slots.style.en), text + ' 画风框应体现搞笑');

    const assembled = Assemble.assemble(slots);
    assert.ok(assembled.positiveEn.trim().length > 0, text + ' 最终提示词不能为空');
    assert.ok(/dog|puppy/i.test(assembled.positiveEn), text + ' 最终提示词缺少狗');
    assert.ok(/peeing|urinating/i.test(assembled.positiveEn), text + ' 最终提示词缺少撒尿');
    assert.ok(/wheel|tire/i.test(assembled.positiveEn), text + ' 最终提示词缺少车轮');
    assert.ok(/funny|comedic/i.test(assembled.positiveEn), text + ' 最终提示词缺少搞笑');
    assert.ok(/peeing on a (car wheel|tire)/i.test(assembled.positiveEn), text + ' 应组装出 on 关系');
    assert.ok(/a (dog|puppy) peeing on a (car wheel|tire)/i.test(assembled.positiveEn), text + ' 主体和关系动作应连成自然英文');
    assert.ok(!/[\u3400-\u9fff]/.test(assembled.positiveEn), text + ' 已命中词不应残留中文');
  });

  // 未收录的目标物保留原文，不能把整段关系丢掉。
  const fallback = pipeline('小狗给飞碟上撒尿的搞笑画面');
  assert.ok(fallback.parsed.unknown.includes('飞碟'));
  assert.ok(fallback.slots.pose.en.includes('飞碟'));
  assert.ok(fallback.parsed.unknown.indexOf('撒尿') === -1);
  assert.ok(fallback.parsed.unknown.indexOf('车轮') === -1);
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
