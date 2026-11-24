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
  assert.ok(byCategory.pose.length >= 400);
  assert.ok(byCategory.subject.length >= 500);
  assert.ok(byCategory.object.length >= 2500, 'object 要系统覆盖家具/厨房/食物/家电/文具/交通/建筑/自然/动物用品');
  assert.ok(byCategory.object.length <= 4000, 'object 不应靠颜色笛卡尔积膨胀');

  // 物体概念必须中英独立、不重复；同一个概念只留一条规范词。
  const objectZh = Object.create(null);
  const objectEn = Object.create(null);
  byCategory.object.forEach(function (entry) {
    assert.ok(!objectZh[entry.zh], 'object 规范中文重复：' + entry.zh);
    objectZh[entry.zh] = true;
    const enKey = entry.en.toLowerCase();
    assert.ok(!objectEn[enKey], 'object 规范英文重复：' + entry.en);
    objectEn[enKey] = true;
  });

  // 规范词必须优先于别名：object 的每条规范中文都应译回自己，
  // 不能因为更早条目占了同名别名而译成别的物体。
  byCategory.object.forEach(function (entry) {
    const result = TR.translateZh(entry.zh);
    assert.ok(result.matches.length, 'object 规范词应能命中：' + entry.zh);
    assert.strictEqual(result.matches[0].entry.zh, entry.zh, 'object 规范词被别名抢占：' + entry.zh);
    assert.strictEqual(result.en, entry.en, 'object 规范词英文不稳定：' + entry.zh);
  });

  [
    ['双人床', 'double bed'],
    ['空气炸锅', 'air fryer'],
    ['无人机', 'drone'],
    ['消防栓', 'fire hydrant'],
    ['轮毂', 'wheel hub'],
    ['天花板', 'ceiling'],
    ['蘑菇', 'mushroom'],
    ['狗项圈', 'dog collar']
  ].forEach(function (item) {
    const result = TR.translateZh(item[0]);
    assert.deepStrictEqual(result.unknown, [], item[0] + ' 不应落空');
    assert.strictEqual(result.matches[0].entry.category, 'object', item[0] + ' 应归入 object');
    assert.strictEqual(result.matches[0].entry.en, item[1], item[0] + ' 英文译法不稳定');
  });
  assert.ok(byCategory.mood.length >= 20, 'mood 要覆盖日常/纪实/夸张/治愈等氛围');
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

test('关系句按角色分框：动作留姿态，地点进场景，最终英文仍自然', function () {
  const cases = [
    ['走在沙滩上', 'walking on the beach', /^walking$/, /beach/, /walking on the beach/],
    ['坐在椅子上', 'sitting on a chair', /^sitting$/, /chair/, /sitting on a chair/],
    ['跑过街道', 'running across the street', /^running$/, /street/, /running across the street/],
    ['站在窗前', 'standing in front of the window', /^standing$/, /window/, /standing in front of the window/],
    ['走在街上', 'walking on the street', /^walking$/, /street/, /walking on the street/],
    ['坐在地上', 'sitting on the ground', /^sitting$/, /ground/, /sitting on the ground/],
    ['靠在墙上', 'leaning against the wall', /^leaning$/, /wall/, /leaning against the wall/],
    ['沿着河边散步', 'walking along a riverside', /^walking$/, /riverside/, /walking along a riverside/],
    ['她走在沙滩上', 'a woman walking on the beach', /^walking$/, /beach/, /a woman walking on the beach/],
    ['狗跑过街道', 'a dog running across the street', /^running$/, /street/, /a dog running across the street/],
    ['猫坐在椅子上', 'a cat sitting on a chair', /^sitting$/, /chair/, /a cat sitting on a chair/]
  ];

  cases.forEach(function (item) {
    const text = item[0];
    const result = pipeline(text);
    assert.deepStrictEqual(result.parsed.unknown, [], text + ' 不应有未命中词');
    assert.ok(result.slots.pose.en.trim(), text + ' 姿态框不能为空');
    assert.ok(result.slots.scene.en.trim(), text + ' 场景框不能为空');
    assert.ok(item[2].test(result.slots.pose.en), text + ' 姿态框只放动作，实际：' + result.slots.pose.en);
    assert.ok(item[3].test(result.slots.scene.en), text + ' 场景框应放地点，实际：' + result.slots.scene.en);
    assert.ok(!item[3].test(result.slots.pose.en), text + ' 地点不能留在姿态框');

    const assembled = Assemble.assemble(result.slots);
    assert.ok(item[4].test(assembled.positiveEn), text + ' 最终英文关系不自然：' + assembled.positiveEn);
    assert.ok(!/[\u3400-\u9fff]/.test(assembled.positiveEn), text + ' 最终英文不应残留中文');
  });

  // 有显式人物时同样拆框：人物 → 姿态 → 场景，且英文拼回自然关系。
  const girl = pipeline('女孩走在沙滩上');
  assert.deepStrictEqual(girl.parsed.unknown, []);
  assert.ok(/girl/i.test(girl.slots.person.en));
  assert.ok(/^walking$/.test(girl.slots.pose.en));
  assert.ok(/beach/i.test(girl.slots.scene.en));
  const girlEn = Assemble.assemble(girl.slots).positiveEn;
  assert.ok(/a girl walking on the beach/i.test(girlEn), '人物 + 关系句应组装自然：' + girlEn);

  const riverside = pipeline('女孩沿着河边散步');
  assert.deepStrictEqual(riverside.parsed.unknown, []);
  assert.ok(/^walking$/.test(riverside.slots.pose.en), '沿着的动作应只留在姿态框');
  assert.ok(/along a riverside/i.test(riverside.slots.scene.en), '沿着的地点应进入场景框');
  assert.ok(/a girl walking along a riverside/i.test(Assemble.assemble(riverside.slots).positiveEn));
});

test('日常高频动作、物体、动物和氛围都能独立命中', function () {
  const cases = [
    ['吃', 'eating', 'pose'],
    ['喝', 'drinking water', 'pose'],
    ['拿', 'holding something', 'pose'],
    ['扔', 'throwing', 'pose'],
    ['坐', 'sitting', 'pose'],
    ['躺', 'lying down', 'pose'],
    ['蹲', 'crouching', 'pose'],
    ['跪', 'kneeling', 'pose'],
    ['走', 'walking', 'pose'],
    ['爬', 'crawling', 'pose'],
    ['躲', 'hiding', 'pose'],
    ['打', 'hitting', 'pose'],
    ['踢', 'kicking in martial arts', 'pose'],
    ['拍', 'patting', 'pose'],
    ['摸', 'stroking', 'pose'],
    ['看', 'looking', 'pose'],
    ['听', 'listening', 'pose'],
    ['说', 'talking', 'pose'],
    ['睡', 'sleeping', 'pose'],
    ['醒', 'waking up', 'expression'],
    ['等', 'waiting', 'pose'],
    ['排队', 'queuing', 'pose'],
    ['开门', 'opening a door', 'pose'],
    ['关门', 'closing a door', 'pose'],
    ['洗手', 'washing hands', 'pose'],
    ['下车', 'getting out of a car', 'pose'],
    ['上车', 'getting into a car', 'pose'],
    ['跌倒', 'falling down', 'pose'],
    ['亲吻', 'kissing', 'pose'],
    ['吵架', 'arguing', 'pose'],
    ['打架', 'fighting', 'pose'],
    ['咬', 'biting something', 'pose'],
    ['抓', 'scratching', 'pose'],
    ['卧', 'lying down', 'pose'],
    ['飞', 'flying', 'pose'],
    ['游', 'swimming', 'pose'],
    ['冰箱', 'refrigerator', 'object'],
    ['碗', 'bowl', 'object'],
    ['铅笔', 'pencil', 'object'],
    ['玩具', 'toy', 'object'],
    ['篮球', 'basketball', 'object'],
    ['玫瑰', 'rose', 'object'],
    ['井盖', 'manhole cover', 'object'],
    ['邮箱', 'mailbox', 'object'],
    ['出租车', 'taxi', 'object'],
    ['挡风玻璃', 'windshield', 'object'],
    ['台阶', 'steps', 'object'],
    ['门', 'door', 'object'],
    ['柯基', 'corgi', 'subject'],
    ['布偶猫', 'ragdoll cat', 'subject'],
    ['仓鼠', 'hamster', 'subject'],
    ['鹦鹉', 'parrot', 'subject'],
    ['熊猫', 'giant panda', 'subject'],
    ['鸽子', 'pigeon', 'subject'],
    ['阿姨', 'auntie', 'subject'],
    ['奶奶', 'grandmother', 'subject'],
    ['日常', 'slice-of-life mood', 'mood'],
    ['纪实', 'documentary mood', 'mood'],
    ['夸张', 'exaggerated mood', 'mood'],
    ['轻松', 'relaxed atmosphere', 'mood'],
    ['治愈', 'warm atmosphere', 'mood'],
    ['电影感', 'cinematic', 'style']
  ];

  cases.forEach(function (item) {
    const term = item[0];
    const result = TR.translateZh(term);
    assert.deepStrictEqual(result.unknown, [], term + ' 不应落空');
    assert.strictEqual(result.en, item[1], term + ' 英文译法不稳定');
    assert.ok(result.matches.length, term + ' 应命中词库');
    assert.strictEqual(result.matches[0].entry.category, item[2], term + ' 类别不对');
  });
});

test('换词回归：换物体、动物、动作、氛围后关键零件仍然命中', function () {
  const cases = [
    ['小狗在电线杆上撒尿的搞笑画面', [/dog|puppy/i, /peeing on a utility pole/i, /funny|comedic/i]],
    ['小狗在树上撒尿的搞笑画面', [/dog|puppy/i, /peeing on a tree/i, /funny|comedic/i]],
    ['小狗在消防栓上撒尿的搞笑画面', [/dog|puppy/i, /peeing on a fire hydrant/i, /funny|comedic/i]],
    ['小猫在消防栓旁嗅来嗅去的温馨画面', [/cat|kitten/i, /sniffing next to a fire hydrant/i, /warm atmosphere|cozy/i]],
    ['小猫在树下咬东西的荒诞画面', [/cat|kitten/i, /biting something under a tree/i, /absurd/i]],
    ['女孩在路灯下看书的治愈画面', [/girl/i, /reading under a streetlight/i, /warm atmosphere|healing/i]],
    ['小猫从椅子跳到桌子上的搞笑画面', [/cat|kitten/i, /jumping from a chair onto a table/i, /funny|comedic/i]],
    ['女人把书放在桌子上的日常画面', [/woman/i, /placing a book on a table/i, /slice-of-life|everyday/i]],
    ['女孩沿着河边散步的浪漫画面', [/girl/i, /walking along a riverside/i, /romantic atmosphere/i]],
    ['男孩穿过森林的紧张画面', [/boy/i, /walking through a forest/i, /tense atmosphere|suspenseful/i]],
    ['小狗在桌子之间嗅来嗅去的搞笑画面', [/dog|puppy/i, /sniffing between tables/i, /funny|comedic/i]],
    ['小猫在沙发后面躲藏的紧张画面', [/cat|kitten/i, /hiding behind a sofa/i, /tense atmosphere/i]],
    ['小猫在纸箱里睡觉的温馨画面', [/cat|kitten/i, /sleeping in a cardboard box/i, /warm atmosphere/i]],
    ['女孩在镜子前化妆的日常画面', [/girl/i, /putting on makeup in front of a mirror/i, /slice-of-life|everyday/i]],
    ['老人坐在长椅上喂鸽子的温馨画面', [/elderly/i, /feeding pigeons on a park bench/i, /warm atmosphere/i]],
    ['妈妈在厨房做饭的温馨画面', [/mother/i, /cooking in a kitchen/i, /warm atmosphere/i]],
    ['朋友在咖啡馆聊天的欢乐画面', [/friends/i, /chatting in a cafe/i, /joyful atmosphere/i]],
    ['老人坐在公园长椅上看报纸的温馨画面', [/elderly/i, /reading a newspaper on a park bench/i, /warm atmosphere/i]]
  ];

  cases.forEach(function (item) {
    const text = item[0];
    const result = pipeline(text);
    assert.deepStrictEqual(result.parsed.unknown, [], text + ' 不应有未命中词');

    ['person', 'pose', 'scene', 'light', 'style'].forEach(function (slot) {
      assert.ok(result.slots[slot].en.trim(), text + ' 的 ' + slot + ' 框不能整段空白');
    });

    const assembled = Assemble.assemble(result.slots);
    assert.ok(assembled.positiveEn.trim().length > 0, text + ' 最终提示词不能为空');
    item[1].forEach(function (re) {
      assert.ok(re.test(assembled.positiveEn), text + ' 缺少关键零件 ' + re);
    });
    assert.ok(!/[\u3400-\u9fff]/.test(assembled.positiveEn), text + ' 已命中词不应残留中文');
  });
});

test('短别名不切开长词：拒绝抽烟的广告拆成主题动作 + 媒介', function () {
  const text = '拒绝抽烟的广告';
  const parsed = Parser.parse(text);
  const result = pipeline(text);

  assert.deepStrictEqual(parsed.unknown, [], text + ' 不应出现未命中的残片');
  assert.ok(parsed.unknown.indexOf('拒绝抽') === -1, '不能把「拒绝抽」当成未收录残片');
  assert.ok(parsed.unknown.indexOf('的广告') === -1, '不能把「的广告」当成未收录残片');

  const aliases = [];
  parsed.segments.forEach(function (segment) {
    (segment.matches || []).forEach(function (match) { aliases.push(match.alias); });
  });
  assert.ok(aliases.indexOf('拒绝') !== -1, '应命中「拒绝」');
  assert.ok(aliases.indexOf('抽烟') !== -1, '应命中「抽烟」');
  assert.ok(aliases.indexOf('广告') !== -1, '应命中「广告」');
  assert.ok(aliases.indexOf('烟') === -1, '「烟」不能从「抽烟」中间单独命中');

  const texts = parsed.segments.map(function (segment) { return segment.text; });
  assert.ok(texts.indexOf('拒绝抽烟') !== -1, '主题动作应单独成段');
  assert.ok(texts.indexOf('广告') !== -1, '媒介应单独成段');
  assert.ok(!parsed.segments.some(function (segment) {
    return segment.slot === 'outfit' && /cigarette/i.test(segment.en);
  }), '「烟」不能被塞进服装框译成 cigarette');

  const assembled = Assemble.assemble(result.slots);
  assert.ok(/smoking/i.test(assembled.positiveEn), '最终英文应体现抽烟/禁烟语义');
  assert.ok(/advertisement|poster|\bad\b/i.test(assembled.positiveEn), '最终英文应体现广告/海报媒介');
  assert.ok(!/cigarette/i.test(assembled.positiveEn), '最终英文不应把抽烟译成香烟实物');

  // 独立概念也应有稳定译法，供「禁烟广告 / 公益广告」等常见说法复用。
  assert.ok(/anti-smoking|no smoking/i.test(TR.translateZh('禁烟广告').en));
  assert.ok(/public service/i.test(TR.translateZh('公益广告').en));
});

test('短别名边界：搞笑画面不拆出 smiling，香烟/小猫在边界仍命中', function () {
  const funny = TR.scanZh('搞笑画面');
  assert.ok(funny.length, '「搞笑画面」应有命中');
  assert.ok(!funny.some(function (match) { return match.alias === '笑'; }), '「笑」不能从「搞笑」中间命中');
  assert.ok(funny.some(function (match) { return match.entry.zh === '搞笑画面'; }), '应整词命中「搞笑画面」');
  assert.ok(!/smil/i.test(TR.translateZh('搞笑画面').en), '搞笑画面不应译成 smiling');

  const funnyImage = TR.scanZh('搞笑图片');
  assert.ok(!funnyImage.some(function (match) { return match.alias === '笑'; }), '「笑」不能从「搞笑图片」中间命中');

  const cigarette = TR.translateZh('手上夹着香烟');
  assert.ok(cigarette.matches.some(function (match) { return match.entry.zh === '香烟'; }), '边界处的「香烟」仍应命中');
  assert.ok(/cigarette/i.test(cigarette.en), '「香烟」仍应译成 cigarette');

  const cat = pipeline('小猫在树下睡觉');
  assert.deepStrictEqual(cat.parsed.unknown, [], '「小猫在树下睡觉」不应有未命中词');
  const catEn = Assemble.assemble(cat.slots).positiveEn;
  assert.ok(/cat|kitten/i.test(catEn), '应命中猫');
  assert.ok(/sleeping/i.test(catEn), '应命中睡觉');
  assert.ok(/tree/i.test(catEn), '应命中树');
});

test('通用短别名边界规则：所有单字别名都不能从复合词中间命中', function () {
  const singleChars = Object.create(null);
  T.Lexicon.entries.forEach(function (entry) {
    entry.zhAliases.forEach(function (alias) {
      if (alias.length === 1) singleChars[alias] = true;
    });
  });
  const singles = Object.keys(singleChars);
  assert.ok(singles.length >= 100, '单字别名样本应足够多');

  // 任意汉字夹住单字别名：不是边界，不能命中。
  singles.forEach(function (ch) {
    const wrapped = '鑫' + ch + '焱';
    const inside = TR.scanZh(wrapped);
    assert.ok(!inside.some(function (match) { return match.alias === ch && match.start === 1; }),
      '「鑫' + ch + '焱」里的「' + ch + '」不应从词中间命中');

    const bounded = '，' + ch + '，';
    const atBoundary = TR.scanZh(bounded);
    assert.ok(atBoundary.some(function (match) { return match.alias === ch && match.start === 1; }),
      '「，' + ch + '，」里的「' + ch + '」应能在标点边界命中');
  });

  // 已知更长的中文词包含单字别名时，必须整词优先命中，不能退成单字。
  const longAliases = Object.create(null);
  T.Lexicon.entries.forEach(function (entry) {
    entry.zhAliases.forEach(function (alias) {
      if (alias.length > 1 && /^[\u3400-\u9fff]+$/.test(alias)) longAliases[alias] = true;
    });
  });
  let checked = 0;
  Object.keys(longAliases).forEach(function (word) {
    let containsSingle = false;
    for (let i = 0; i < word.length; i += 1) {
      if (singleChars[word.charAt(i)]) { containsSingle = true; break; }
    }
    if (!containsSingle) return;
    const matches = TR.scanZh(word);
    assert.ok(matches.length, word + ' 应命中');
    assert.strictEqual(matches[0].alias, word, word + ' 应整词命中');
    assert.ok(!matches.some(function (match) { return match.alias.length === 1; }),
      word + ' 不能被拆出单字别名');
    checked += 1;
  });
  assert.ok(checked >= 1000, '应自动覆盖至少上千个包含单字别名的已知长词，实际 ' + checked);
});

test('英文短词不能切开带连字符的长词', function () {
  const scanned = TR.scanEn('anti-smoking advertisement');
  assert.ok(scanned.some(function (match) { return match.alias === 'anti-smoking advertisement'; }),
    'anti-smoking advertisement 应整词命中');
  assert.ok(!scanned.some(function (match) { return match.alias.toLowerCase() === 'smoking'; }),
    'smoking 不能从 anti-smoking 中间命中');

  const noSmokingPoster = TR.translateEn('no smoking poster');
  assert.deepStrictEqual(noSmokingPoster.unknown, []);
  assert.ok(/禁烟/.test(noSmokingPoster.zh), 'no smoking poster 应反译成禁烟广告/海报');

  const antiSmokingAd = TR.translateEn('anti-smoking ad');
  assert.deepStrictEqual(antiSmokingAd.unknown, []);
  assert.ok(/禁烟/.test(antiSmokingAd.zh), 'anti-smoking ad 应反译成禁烟广告');
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
