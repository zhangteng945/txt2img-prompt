/*
 * parser.js — 把整段中文 / 中英混写想法拆成可归类的短句
 *
 * 处理步骤：
 * 1. 中文标点、英文逗号、换行都作为句子边界；
 * 2. 在「穿着 / 戴着 / 站在 / 坐在 / 背景是 / 光线是 / 镜头是 / 风格是」
 *    等提示词前切开，保留提示词本身；
 * 3. 用最长词匹配计算每个片段的类别分数，归入六个框之一；
 * 4. 「穿…的… / 戴…的…」定语结构不硬切，避免把人物和服装拆散。
 */
(function () {
  'use strict';

  const T2I = (window.T2I = window.T2I || {});
  const U = T2I.Utils;
  const L = T2I.Lexicon;
  const TR = T2I.Translator;

  const SLOTS = ['person', 'outfit', 'pose', 'scene', 'light', 'style'];
  const SLOT_LABEL = {
    person: '人物与外貌',
    outfit: '服装与造型',
    pose: '姿态与动作',
    scene: '场景与背景',
    light: '光线与镜头',
    style: '画风与质感'
  };

  const CUES = [
    { text: '背景是', slot: 'scene' },
    { text: '背景为', slot: 'scene' },
    { text: '身后是', slot: 'scene' },
    { text: '周围是', slot: 'scene' },
    { text: '地点是', slot: 'scene' },
    { text: '光线是', slot: 'light' },
    { text: '光线为', slot: 'light' },
    { text: '光照是', slot: 'light' },
    { text: '镜头是', slot: 'light' },
    { text: '镜头为', slot: 'light' },
    { text: '视角是', slot: 'light' },
    { text: '构图是', slot: 'light' },
    { text: '风格是', slot: 'style' },
    { text: '风格为', slot: 'style' },
    { text: '画风是', slot: 'style' },
    { text: '质感是', slot: 'style' },
    { text: '身穿', slot: 'outfit' },
    { text: '穿着', slot: 'outfit' },
    { text: '穿了', slot: 'outfit' },
    { text: '身着', slot: 'outfit' },
    { text: '套着', slot: 'outfit' },
    { text: '披着', slot: 'outfit' },
    { text: '戴着', slot: 'outfit' },
    { text: '佩戴', slot: 'outfit' },
    { text: '佩带', slot: 'outfit' },
    { text: '系着', slot: 'outfit' },
    { text: '围着', slot: 'outfit' },
    { text: '背着', slot: 'outfit' },
    { text: '挎着', slot: 'outfit' },
    { text: '双手插兜', slot: 'pose' },
    { text: '双手抱胸', slot: 'pose' },
    { text: '整理衣领', slot: 'pose' },
    { text: '扶帽檐', slot: 'pose' },
    { text: '站在', slot: 'pose' },
    { text: '坐在', slot: 'pose' },
    { text: '躺在', slot: 'pose' },
    { text: '靠在', slot: 'pose' },
    { text: '走在', slot: 'pose' },
    { text: '蹲在', slot: 'pose' },
    { text: '跪在', slot: 'pose' },
    { text: '站着', slot: 'pose' },
    { text: '坐着', slot: 'pose' },
    { text: '躺着', slot: 'pose' },
    { text: '靠着', slot: 'pose' },
    { text: '走着', slot: 'pose' },
    { text: '蹲着', slot: 'pose' },
    { text: '跪着', slot: 'pose' },
    { text: '侧身', slot: 'pose' },
    { text: '侧脸', slot: 'pose' },
    { text: '回头', slot: 'pose' },
    { text: '看向', slot: 'pose' },
    { text: '望向', slot: 'pose' },
    { text: '凝视', slot: 'pose' },
    { text: '看着', slot: 'pose' },
    { text: '低头', slot: 'pose' },
    { text: '抬头', slot: 'pose' },
    { text: '微笑', slot: 'pose' },
    { text: '笑着', slot: 'pose' },
    { text: '大笑', slot: 'pose' },
    { text: '闭眼', slot: 'pose' },
    { text: '叉腰', slot: 'pose' },
    { text: '拿着', slot: 'pose' },
    { text: '端着', slot: 'pose' },
    { text: '撑着', slot: 'pose' },
    { text: '抱着', slot: 'pose' },
    { text: '晒太阳', slot: 'pose' },
    { text: '举着', slot: 'pose' },
    { text: '托腮', slot: 'pose' },
    { text: '扶着', slot: 'pose' },
    { text: '跳舞', slot: 'pose' },
    { text: '奔跑', slot: 'pose' },
    { text: '行走', slot: 'pose' },
    { text: '伸手', slot: 'pose' },
    { text: '挥手', slot: 'pose' },
    { text: '看书', slot: 'pose' },
    { text: '喝咖啡', slot: 'pose' },
    { text: '弹吉他', slot: 'pose' },
    { text: '拍照', slot: 'pose' },
    { text: '穿', slot: 'outfit' },
    { text: '戴', slot: 'outfit' }
  ].sort(function (a, b) { return b.text.length - a.text.length; });

  const CUE_BY_TEXT = Object.create(null);
  CUES.forEach(function (cue) { CUE_BY_TEXT[cue.text] = cue; });

  const SUBJECT_WORDS = /(女人|男人|女孩|男孩|女子|男子|女生|男生|少女|少年|人物|老人|儿童|模特|女孩儿|女的|男的|她|他)/;

  // 判断某个提示词是否处在「穿米色风衣的女人」这种定语结构中。
  function insideAttributive(text, cueEnd) {
    const right = text.slice(cueEnd);
    if (right.indexOf('的') === -1) return false;
    return /^[^，。；;、]{0,32}的[^，。；;、]{0,18}(女人|男人|女孩|男孩|女子|男子|女生|男生|少女|少年|人物|老人|儿童|模特|孩子|她|他)/.test(right);
  }

  function findCueAt(text, index) {
    for (let i = 0; i < CUES.length; i += 1) {
      const cue = CUES[i];
      if (text.startsWith(cue.text, index)) {
        if ((cue.text === '穿' || cue.text === '戴') && /[越梭透过上]/.test(text.charAt(index + 1))) {
          continue;
        }
        return cue;
      }
    }
    return null;
  }

  function splitByCues(phrase) {
    const text = U.normalizeSpace(phrase);
    if (!text) return [];
    const cuts = [0];
    let i = 0;
    while (i < text.length) {
      const cue = findCueAt(text, i);
      if (cue) {
        // 即使提示词在句首也要跳过整个提示词，避免「微笑着」被拆成「微」+「笑着」。
        if (i > 0 && !insideAttributive(text, i + cue.text.length)) cuts.push(i);
        i += cue.text.length;
        continue;
      }
      i += 1;
    }
    cuts.push(text.length);
    const out = [];
    for (let c = 0; c < cuts.length - 1; c += 1) {
      const chunk = text.slice(cuts[c], cuts[c + 1]).trim();
      if (chunk) out.push(chunk);
    }
    return out;
  }

  function cueSlotOf(text) {
    const textClean = U.normalizeSpace(text);
    for (let i = 0; i < CUES.length; i += 1) {
      if (textClean.startsWith(CUES[i].text)) {
        if ((CUES[i].text === '穿' || CUES[i].text === '戴') && /[越梭透过上]/.test(textClean.charAt(1))) {
          continue;
        }
        return CUES[i].slot;
      }
    }
    return null;
  }

  const FALLBACK_RULES = [
    { slot: 'light', re: /(光线|光照|打光|镜头|视角|构图|焦段|景深|曝光|逆光|侧光|顶光|轮廓光|lighting|lens|camera|depth of field|angle|shot)/i },
    { slot: 'style', re: /(风格|画风|质感|摄影|电影|颗粒|调色|插画|油画|水彩|渲染|像素|极简|复古|cinematic|photography|film|style|anime|illustration|render)/i },
    { slot: 'outfit', re: /(穿|戴|衣|裙|裤|鞋|靴|帽|围巾|手套|包|项链|耳环|眼镜|墨镜|面料|材质|色|wearing|dress|coat|jacket|shirt|pants|skirt|hat|glasses|boots)/i },
    { slot: 'pose', re: /(站|坐|躺|靠|走|跑|跳|蹲|跪|看|望|拿|抱|举|扶|手|姿|动作|表情|微笑|回头|standing|sitting|lying|looking|holding|walking|running|pose)/i },
    { slot: 'person', re: /(她|他|人|女|男|眼|发|脸|肤|身材|年龄|岁|气质|woman|man|girl|boy|person|face|hair|eyes|skin)/i },
    { slot: 'scene', re: /(街|路|店|房|室|馆|场|山|海|林|园|湖|河|桥|城|村|镇|背景|天气|雨|雪|雾|风|时间|傍晚|夜|晨|午|street|cafe|forest|park|room|background|night|rain|snow)/i }
  ];

  function fallbackSlot(text) {
    for (let i = 0; i < FALLBACK_RULES.length; i += 1) {
      if (FALLBACK_RULES[i].re.test(text)) return FALLBACK_RULES[i].slot;
    }
    return 'scene';
  }

  // 类别 → 框的计分。长词权重更高；主体词额外加权，避免「拿着书的女孩」被切成动作。
  function englishCueSlot(text) {
    const t = String(text || '').trim();
    if (/^(wearing|dressed in)\b/i.test(t)) return 'outfit';
    if (/^(standing|sitting|seated|lying|walking|running|looking|holding|leaning|kneeling|crouching|dancing|jumping|posing)\b/i.test(t)) return 'pose';
    if (/^(in the|at the|on the|background|scene|location)\b/i.test(t)) return 'scene';
    if (/^(soft |natural |warm |cool |dramatic |cinematic )?lighting\b/i.test(t)) return 'light';
    if (/^(cinematic|film|photorealistic|photographic|anime|illustration|watercolor|oil painting|3d render)\b/i.test(t)) return 'style';
    return null;
  }

  function classify(text, matches) {
    const cueSlot = cueSlotOf(text) || englishCueSlot(text);
    const scores = { person: 0, outfit: 0, pose: 0, scene: 0, light: 0, style: 0 };
    let hasSubject = false;

    matches.forEach(function (m) {
      const entry = m.entry;
      let slot = entry.slot;
      if (!slot) return;

      if (entry.category === 'color') {
        const hasScene = matches.some(function (x) { return x.entry.category === 'scene' || x.entry.category === 'time'; });
        const hasPerson = matches.some(function (x) {
          return ['subject', 'hair', 'eyes'].indexOf(x.entry.category) !== -1;
        });
        const hasLight = matches.some(function (x) { return x.entry.category === 'light'; });
        slot = hasPerson ? 'person' : hasLight ? 'light' : hasScene ? 'scene' : 'outfit';
      }

      const weight = 1 + Math.min(4, m.alias.length / 2);
      scores[slot] += weight;
      if (entry.category === 'subject') {
        hasSubject = true;
        scores.person += 3;
      }
    });

    if (cueSlot) scores[cueSlot] += 8;
    if (hasSubject) scores.person += 2;

    // 「穿黑色夹克的年轻女人」整体是人物描写，开头的「穿」不应把整句拉到服装框。
    if (hasSubject && text.indexOf('的') !== -1 && (cueSlot === 'outfit' || cueSlot === 'pose')) {
      scores.person += 7;
    }

    let best = null;
    let bestScore = -1;
    SLOTS.forEach(function (slot) {
      if (scores[slot] > bestScore) {
        bestScore = scores[slot];
        best = slot;
      }
    });

    if (bestScore <= 0) return fallbackSlot(text);
    return best;
  }

  function parse(text) {
    const raw = U.normalizeSpace(text);
    if (!raw) {
      return { raw: '', chunks: [], segments: [], unknown: [] };
    }

    const phrases = U.splitPhrases(raw);
    const chunks = [];
    phrases.forEach(function (phrase) {
      splitByCues(phrase).forEach(function (chunk) {
        if (chunk.trim()) chunks.push(chunk.trim());
      });
    });

    const unknown = [];
    const segments = [];

    chunks.forEach(function (chunk) {
      // 中文优先用中文字典；纯英文 / 英文为主的短语退回英文索引，
      // 这样中英混写时不会把整段英文都塞进「场景」。
      let matches = TR.scanZh(chunk);
      if (!matches.length) matches = TR.scanEn(chunk);
      const slot = classify(chunk, matches);
      const translated = TR.translateZh(chunk, { slot: slot });
      const cleanZh = U.cleanChinese(chunk);
      const en = U.cleanEnglish(translated.en);

      (translated.unknown || []).forEach(function (item) {
        if (!unknown.includes(item)) unknown.push(item);
      });

      // 只是「她 / 的 / 一个」这类虚词时不必占一个框。
      if (!en && !(translated.unknown || []).length) return;

      segments.push({
        text: chunk,
        zh: cleanZh,
        en: en,
        slot: slot,
        cue: (function () {
          const cue = cueSlotOf(chunk);
          return cue || null;
        })(),
        matches: matches,
        unknown: translated.unknown || [],
        source: 'idea'
      });
    });

    return {
      raw: raw,
      chunks: chunks,
      segments: segments,
      unknown: unknown
    };
  }

  T2I.Parser = {
    parse: parse,
    splitByCues: splitByCues,
    classify: classify,
    slots: SLOTS,
    slotLabel: SLOT_LABEL,
    cues: CUES
  };
})();
