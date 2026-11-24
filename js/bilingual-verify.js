/*
 * bilingual-verify.js — 双向语义校对的纯逻辑
 *
 * 职责边界：
 *   - 只比较「用户当前中文（权威）」与「实际英文的独立回译」；
 *   - 回译永远不写中文，中文只读；
 *   - 把发现的结构化差异交给页面展示，由用户确认或修改；
 *   - 状态：unverified 未核对 / checking 核对中 / clean 待确认 /
 *           mismatch 需确认 / verified 已校对 / error 核对失败。
 *
 * 这里的中文锚点只用于「发现差异」，不参与生成或改写英文；
 * 成功路径的英文仍然只来自本机模型或用户。
 */
(function () {
  'use strict';

  const T2I = (window.T2I = window.T2I || {});
  const U = T2I.Utils;

  const SLOTS = ['person', 'outfit', 'pose', 'scene', 'light', 'style'];
  const SLOT_LABELS = {
    person: '人物与外貌',
    outfit: '服装与造型',
    pose: '姿态与动作',
    scene: '场景与背景',
    light: '光线与镜头',
    style: '画风与质感'
  };

  const STATUS = {
    unverified: 'unverified',
    checking: 'checking',
    clean: 'clean',
    mismatch: 'mismatch',
    verified: 'verified',
    error: 'error'
  };

  const STATUS_LABELS = {
    unverified: '未核对',
    checking: '核对中',
    clean: '待确认',
    mismatch: '需确认',
    verified: '已校对',
    error: '核对失败'
  };

  const STATUS_NOTES = {
    unverified: '还没有对当前英文做独立回译核对；修改中文或英文后，原有校对也会失效。',
    checking: '正在把实际英文独立回译成中文，再与你的当前中文比对。',
    clean: '独立回译与你的当前中文未见明显差异，但仍需你确认后才算已校对。',
    mismatch: '独立回译与当前中文存在差异，没有自动标成已校对；请修改或确认。',
    verified: '你已确认当前中文与英文对照。再改任一中文或英文，状态会立即失效。',
    error: '本次回译或修正失败；已有中文、英文和编辑都保留，没有改用词库。'
  };

  const IDENTITY_GROUPS = [
    { id: 'woman', kind: 'female', age: 'adult', label: '女人', zh: /女人|女性|女子|女士|妇人|成年女性/, en: /(?:\bwoman\b|\bwomen\b|\blady\b|\bladies\b)/i },
    { id: 'girl', kind: 'female', age: 'young', label: '女孩', zh: /女孩|少女|小姑娘|小女生|女生/, en: /(?:\bgirl\b|\bgirls\b)/i },
    { id: 'man', kind: 'male', age: 'adult', label: '男人', zh: /男人|男性|男子|男士|成年男性/, en: /(?:\bman\b|\bmen\b|\bgentleman\b)/i },
    { id: 'boy', kind: 'male', age: 'young', label: '男孩', zh: /男孩|少年|小男孩|小男生|男生/, en: /(?:\bboy\b|\bboys\b)/i },
    { id: 'child', kind: 'child', age: 'any', label: '孩子', zh: /孩子|小孩|儿童|孩童/, en: /(?:\bchild\b|\bchildren\b|\bkid\b|\bkids\b)/i },
    { id: 'father', kind: 'role', age: 'adult', label: '父亲', zh: /父亲|爸爸/, en: /(?:\bfather\b|\bdad\b)/i },
    { id: 'mother', kind: 'role', age: 'adult', label: '母亲', zh: /母亲|妈妈/, en: /(?:\bmother\b|\bmom\b)/i },
    { id: 'family', kind: 'group', age: 'any', label: '一家人', zh: /一家[三四五六七八九十0-9]*口|一家人|全家|家庭/, en: /(?:\bfamily\b|\bfamily of\b)/i }
  ];

  const BODY_GROUPS = [
    { id: 'eyes', label: '眼睛', zh: /眼睛|双眼|眼眸|眼神|眼角|眼眶|睫毛|眉毛/, back: /眼睛|双眼|眼眸|眼神|眼角|眼眶|睫毛|眉毛|眼/ },
    { id: 'hair', label: '头发', zh: /头发|长发|短发|金发|银发|黑发|发色|刘海|马尾|辫子/, back: /头发|长发|短发|金发|银发|黑发|发色|刘海|马尾|辫子|发/ },
    { id: 'face', label: '脸/侧脸', zh: /侧脸|脸颊|面容|面庞|五官|脸/, back: /侧脸|脸颊|面容|面庞|五官|脸/ },
    { id: 'mouth', label: '嘴/唇', zh: /嘴唇|嘴角|唇|嘴/, back: /嘴唇|嘴角|唇|嘴/ },
    { id: 'nose', label: '鼻子', zh: /鼻子|鼻梁|鼻/, back: /鼻子|鼻梁|鼻/ },
    { id: 'ears', label: '耳朵', zh: /耳朵|耳垂|耳/, back: /耳朵|耳垂|耳/ },
    { id: 'hands', label: '手/手指', zh: /手指|手臂|胳膊|手掌|手腕|(?:左|右|双|一只|两只)手|双手/, back: /手指|手臂|胳膊|手掌|手腕|手/ },
    { id: 'legs', label: '腿/膝盖', zh: /大腿|小腿|双腿|膝盖|腿/, back: /大腿|小腿|双腿|膝盖|腿/ },
    { id: 'feet', label: '脚/脚趾', zh: /脚趾|脚踝|双脚|脚/, back: /脚趾|脚踝|双脚|脚/ },
    { id: 'shoulder', label: '肩膀', zh: /肩膀|肩/, back: /肩膀|肩/ },
    { id: 'back', label: '背', zh: /后背|背部|背影|背/, back: /后背|背部|背影|背/ },
    { id: 'waist', label: '腰', zh: /腰|腰部/, back: /腰|腰部/ },
    { id: 'chest', label: '胸', zh: /胸口|胸部|胸膛|胸/, back: /胸口|胸部|胸膛|胸/ },
    { id: 'skin', label: '皮肤', zh: /皮肤|肤质|肌肤/, back: /皮肤|肤质|肌肤/ },
    { id: 'teeth', label: '牙齿', zh: /牙齿|牙/, back: /牙齿|牙/ },
    { id: 'tongue', label: '舌头', zh: /舌头|舌/, back: /舌头|舌/ }
  ];

  const ACTION_GROUPS = [
    { id: 'sunbathe', label: '晒太阳', zh: /晒太阳|晒着太阳|沐浴阳光|日光浴|晒日光/, back: /晒|太阳|阳光|日光|日晒/ },
    { id: 'rain', label: '下雨', zh: /下着雨|下起雨|下雨|雨天|雨中|雨夜|细雨|大雨|飘雨|落雨|雨/, back: /雨/ },
    { id: 'sit', label: '坐', zh: /坐|坐着|坐在/, back: /坐/ },
    { id: 'stand', label: '站', zh: /站|站着|站在|站立/, back: /站/ },
    { id: 'lie', label: '趴/躺', zh: /趴|躺|卧/, back: /趴|躺|卧/ },
    { id: 'walk', label: '走', zh: /走在|走向|行走|散步|走/, back: /走|步行|散步/ },
    { id: 'run', label: '跑', zh: /奔跑|跑步|跑/, back: /跑|奔跑/ },
    { id: 'read', label: '阅读', zh: /看书|读书|阅读|翻阅/, back: /看|读|阅读|翻阅/ },
    { id: 'look', label: '看/望', zh: /看向|望向|看着|注视|凝视|远眺|看/, back: /看|望|注视|凝视|远眺/ },
    { id: 'hold', label: '拿/抱/举', zh: /拿着|抱着|举着|提着|端着|握着|拿|抱|举|提|端|握/, back: /拿|抱|举|提|端|握/ },
    { id: 'wear', label: '穿/戴', zh: /穿着|戴着|身穿|头戴|穿|戴/, back: /穿|戴/ },
    { id: 'wait', label: '等待', zh: /等待|等着|等/, back: /等|等待/ },
    { id: 'smile', label: '笑', zh: /微笑|笑着|笑容|笑/, back: /笑/ },
    { id: 'smoke', label: '吸烟', zh: /吸烟|抽烟|香烟/, back: /吸烟|抽烟|烟/ },
    { id: 'turn', label: '转身', zh: /转身|回头|扭过头/, back: /转身|回头|扭过/ },
    { id: 'raise', label: '举起', zh: /举起|抬起|抬手|伸出/, back: /举|抬|伸/ },
    { id: 'open', label: '张开/打开', zh: /张开|打开|推开|拉开/, back: /张|打开|推开|拉开/ }
  ];

  const OBJECT_GROUPS = [
    { id: 'cat', cat: 'animal', label: '猫', zh: /猫/, back: /猫/ },
    { id: 'dog', cat: 'animal', label: '狗', zh: /狗|犬/, back: /狗|犬/ },
    { id: 'book', cat: 'prop', label: '书', zh: /书|书本|书本|书页/, back: /书/ },
    { id: 'flower', cat: 'prop', label: '花', zh: /花束|鲜花|一束花|花/, back: /花/ },
    { id: 'umbrella', cat: 'prop', label: '雨伞', zh: /雨伞|伞/, back: /伞/ },
    { id: 'phone', cat: 'prop', label: '手机', zh: /手机|电话/, back: /手机|电话/ },
    { id: 'cup', cat: 'prop', label: '杯子', zh: /杯子|咖啡杯|茶杯|杯/, back: /杯子|咖啡杯|茶杯|杯/ },
    { id: 'sword', cat: 'prop', label: '剑', zh: /长剑|宝剑|剑/, back: /剑/ },
    { id: 'hat', cat: 'prop', label: '帽子', zh: /帽子|帽/, back: /帽子|帽/ },
    { id: 'glasses', cat: 'prop', label: '眼镜', zh: /眼镜|墨镜/, back: /眼镜|墨镜/ },
    { id: 'car', cat: 'vehicle', label: '汽车', zh: /汽车|轿车|车/, back: /汽车|轿车|车/ },
    { id: 'bike', cat: 'vehicle', label: '自行车', zh: /自行车|单车|脚踏车/, back: /自行车|单车|脚踏车/ },
    { id: 'bench', cat: 'furniture', label: '长椅', zh: /长椅|长凳/, back: /长椅|长凳|椅/ },
    { id: 'chair', cat: 'furniture', label: '椅子', zh: /椅子|座椅/, back: /椅子|座椅|椅/ },
    { id: 'table', cat: 'furniture', label: '桌子', zh: /桌子|餐桌|书桌|桌/, back: /桌子|餐桌|书桌|桌/ },
    { id: 'windowsill', cat: 'place', label: '窗台', zh: /窗台|窗沿|窗边|窗前|窗户/, back: /窗台|窗沿|窗边|窗前|窗户|窗/ },
    { id: 'door', cat: 'place', label: '门', zh: /门口|门前|大门|门/, back: /门口|门前|大门|门|入口|前面|店前/ },
    { id: 'sign', cat: 'prop', label: '告示牌', zh: /告示牌|告示|标牌|标识牌|标志牌|指示牌|招牌|signboard/, back: /告示|标牌|标识|标志|指示牌|招牌|牌子/ },
    { id: 'text', cat: 'exclude', label: '文字', zh: /文字|文本|字/, back: /文字|文本|字/ },
    { id: 'watermark', cat: 'exclude', label: '水印', zh: /水印/, back: /水印/ },
    { id: 'basket', cat: 'prop', label: '篮子', zh: /野餐篮|篮子|竹篮|篮/, back: /野餐篮|篮子|竹篮|篮/ },
    { id: 'camera', cat: 'prop', label: '相机', zh: /相机|照相机/, back: /相机|照相机/ },
    { id: 'tree', cat: 'nature', label: '树', zh: /樱花树|大树|树下|树/, back: /树/ }
  ];

  const COLOR_GROUPS = [
    { id: 'red', label: '红色', zh: /红(?:色)?/, back: /红/, en: /\bred\b/i },
    { id: 'orange', label: '橙色', zh: /橙(?:色)?|橘(?:色)?/, back: /橙|橘/, en: /\borange\b/i },
    { id: 'yellow', label: '黄色', zh: /黄(?:色)?/, back: /黄/, en: /\byellow\b/i },
    { id: 'green', label: '绿色', zh: /绿(?:色)?/, back: /绿/, en: /\bgreen\b/i },
    { id: 'cyan', label: '青色', zh: /青(?:色)?/, back: /青/, en: /\bcyan\b|\bteal\b/i },
    { id: 'blue', label: '蓝色', zh: /蓝(?:色)?/, back: /蓝/, en: /\bblue\b/i },
    { id: 'purple', label: '紫色', zh: /紫(?:色)?/, back: /紫/, en: /\bpurple\b|\bviolet\b/i },
    { id: 'black', label: '黑色', zh: /黑(?:色)?/, back: /黑/, en: /\bblack\b/i },
    { id: 'white', label: '白色', zh: /白(?:色)?/, back: /白/, en: /\bwhite\b/i },
    { id: 'gray', label: '灰色', zh: /灰(?:色)?/, back: /灰/, en: /\bgray\b|\bgrey\b/i },
    { id: 'gold', label: '金色', zh: /金(?:色)?|金色/, back: /金/, en: /\bgold(?:en)?\b/i },
    { id: 'silver', label: '银色', zh: /银(?:色)?|银色/, back: /银/, en: /\bsilver\b/i },
    { id: 'pink', label: '粉色', zh: /粉(?:色)?/, back: /粉/, en: /\bpink\b/i }
  ];

  const NEG_RE = /不要|别|禁止|不能|不得|勿|不许|避免|没有|无|去除|排除|不要有|不能有|禁止出现/;
  const SIGN_RE = /告示牌|告示|标牌|标识牌|标志牌|指示牌|招牌|标语牌|牌子|signboard|\bsign\b/i;
  const SIGN_NEG_RE = /(?:禁止|请勿|不许|no|don't|do not)\s*(?:吸烟|抽烟|smoking)/i;
  const NEG_OBJECTS = [
    { id: 'text', label: '文字', zh: /文字|文本|字/, en: /(?:^|[^a-z])text(?:$|[^a-z])|lettering|writing/i, word: /text|lettering|writing/i },
    { id: 'watermark', label: '水印', zh: /水印/, en: /watermark/i, word: /watermark/i },
    { id: 'smoking', label: '吸烟', zh: /吸烟|抽烟|香烟/, en: /smok|cigarette/i, word: /smok|cigarette/i },
    { id: 'logo', label: 'logo', zh: /logo|商标|标志(?!牌)/i, en: /logo/i, word: /logo/i },
    { id: 'people', label: '人物', zh: /人物|行人|人(?!们)/, en: /people|person|human/i, word: /people|person|human/i },
    { id: 'hat', label: '帽子', zh: /帽子/, en: /hat/i, word: /hat/i },
    { id: 'fingers', label: '手指', zh: /手指/, en: /finger/i, word: /finger/i },
    { id: 'deformed', label: '畸形', zh: /畸形|变形/, en: /deform/i, word: /deform/i }
  ];

  const STOP_CHARS = new Set(('的了着过在是有和与及或而也都就还又很非常一个只条件位名把被将从对为这那哪什么画面里中上下来去地得把让给把着').split(''));
  const NUMBER_VALUES = {
    '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6,
    '七': 7, '八': 8, '九': 9, '十': 10, '百': 100, '千': 1000, '万': 10000
  };

  function text(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function asSlot(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      zh: text(source.zh),
      en: text(source.en),
      stale: source.stale === true
    };
  }

  function backText(back, key) {
    const source = back || {};
    const entry = source[key];
    if (typeof entry === 'string') return text(entry);
    if (!entry || typeof entry !== 'object') return '';
    return text(entry.back_zh || entry.backtranslation || entry.backZh || entry.zh || '');
  }

  function negativeBackText(back) {
    if (!back) return '';
    if (typeof back === 'string') return text(back);
    return text(back.back_zh || back.backtranslation || back.backZh || back.negative_zh || '');
  }

  function slotFields(fields) {
    const out = Object.create(null);
    SLOTS.forEach(function (key) {
      out[key] = asSlot(fields && fields[key]);
    });
    return out;
  }

  function snapshotOf(slots) {
    const out = {};
    SLOTS.forEach(function (key) {
      const slot = slots && slots[key] || {};
      out[key] = {
        zh: text(slot.zh),
        en: text(slot.en)
      };
    });
    return out;
  }

  function sameSnapshot(a, b) {
    if (!a || !b) return false;
    return SLOTS.every(function (key) {
      const left = a[key] || {};
      const right = b[key] || {};
      return text(left.zh) === text(right.zh) && text(left.en) === text(right.en);
    });
  }

  function emptyReview() {
    return {
      status: STATUS.unverified,
      round: 0,
      corrected: false,
      correctedKeys: [],
      issues: [],
      slots: {},
      negative: { zh: '', en: '', backZh: '', issues: [] },
      snapshot: null,
      checkedAt: 0,
      confirmedAt: 0,
      confirmedWithIssues: false,
      model: '',
      auto: false,
      error: '',
      staleReason: '',
      calls: []
    };
  }

  function normalizeReview(raw) {
    const base = emptyReview();
    if (!raw || typeof raw !== 'object') return base;
    const out = Object.assign(base, raw);
    if (!STATUS_LABELS[out.status]) out.status = STATUS.unverified;
    out.issues = Array.isArray(raw.issues) ? raw.issues.filter(Boolean).map(normalizeIssue) : [];
    out.slots = raw.slots && typeof raw.slots === 'object' ? raw.slots : {};
    out.negative = raw.negative && typeof raw.negative === 'object'
      ? {
        zh: text(raw.negative.zh),
        en: text(raw.negative.en),
        backZh: text(raw.negative.backZh),
        issues: Array.isArray(raw.negative.issues) ? raw.negative.issues.filter(Boolean).map(normalizeIssue) : []
      }
      : base.negative;
    out.snapshot = raw.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : null;
    out.correctedKeys = Array.isArray(raw.correctedKeys) ? raw.correctedKeys.filter(function (key) {
      return SLOTS.indexOf(key) !== -1;
    }) : [];
    out.calls = Array.isArray(raw.calls) ? raw.calls : [];
    out.round = Math.max(0, Number(out.round) || 0);
    out.corrected = raw.corrected === true;
    out.confirmedWithIssues = raw.confirmedWithIssues === true;
    out.auto = raw.auto === true;
    return out;
  }

  function normalizeIssue(raw) {
    return {
      id: text(raw.id),
      type: text(raw.type) || 'difference',
      slot: SLOTS.indexOf(raw.slot) !== -1 ? raw.slot : (raw.slot === 'negative' ? 'negative' : ''),
      severity: raw.severity === 'error' ? 'error' : (raw.severity === 'info' ? 'info' : 'warn'),
      fixable: raw.fixable !== false,
      title: text(raw.title) || '发现差异',
      detail: text(raw.detail),
      target: text(raw.target),
      back: text(raw.back)
    };
  }

  function restore(raw, slots) {
    const review = normalizeReview(raw);
    if (!review.snapshot) return emptyReview();
    if (!sameSnapshot(review.snapshot, snapshotOf(slots))) {
      const invalid = emptyReview();
      invalid.staleReason = '这份记录保存后中文或英文又改过，原校对已失效。';
      invalid.invalidatedFrom = review.status;
      return invalid;
    }
    if (review.status === STATUS.checking) {
      review.status = STATUS.unverified;
      review.staleReason = '上次回译核对没有完成。';
    }
    return review;
  }

  function invalidate(review) {
    const out = emptyReview();
    if (review && review.status) out.invalidatedFrom = review.status;
    out.staleReason = '编辑后已失效；请重新做独立回译核对。';
    return out;
  }

  function confirm(review, slots) {
    const current = normalizeReview(review);
    if ([STATUS.clean, STATUS.mismatch, STATUS.verified].indexOf(current.status) === -1) {
      return current;
    }
    current.status = STATUS.verified;
    current.snapshot = snapshotOf(slots);
    current.confirmedAt = Date.now();
    current.confirmedWithIssues = current.issues.length > 0;
    current.staleReason = '';
    return current;
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || STATUS_LABELS.unverified;
  }

  function statusNote(status) {
    return STATUS_NOTES[status] || STATUS_NOTES.unverified;
  }

  function issuesOf(review) {
    const current = normalizeReview(review);
    return current.issues.slice();
  }

  function issueCount(review) {
    return normalizeReview(review).issues.length;
  }

  function fixableIssues(review) {
    return normalizeReview(review).issues.filter(function (issue) { return issue.fixable; });
  }

  function slotIssues(issues, key) {
    return (issues || []).filter(function (issue) { return issue.slot === key; });
  }

  function hasCjk(value) {
    return /[\u3400-\u9fff]/.test(text(value));
  }

  function clauses(value) {
    return text(value).split(/[，,。；;！!？?、\n]/).map(function (part) { return part.trim(); }).filter(Boolean);
  }

  function contentChars(value) {
    const set = new Set();
    text(value).split('').forEach(function (ch) {
      if (/[\u3400-\u9fff]/.test(ch) && !STOP_CHARS.has(ch)) set.add(ch);
    });
    return set;
  }

  function matchedLabel(regex, value, fallback) {
    const match = text(value).match(regex);
    return match && match[0] ? match[0] : fallback;
  }

  function groupMatches(textValue, groups, mode) {
    const field = mode === 'back' ? 'back' : mode === 'en' ? 'en' : 'zh';
    return groups.filter(function (group) {
      return group[field] && group[field].test(textValue);
    });
  }

  function addIssue(issues, data) {
    const issue = normalizeIssue(data);
    const key = [issue.type, issue.slot, issue.title, issue.detail, issue.target, issue.back].join('|');
    if (issues.some(function (item) {
      return [item.type, item.slot, item.title, item.detail, item.target, item.back].join('|') === key;
    })) return;
    issues.push(issue);
  }

  function checkClauseCoverage(zh, backZh, slot, issues) {
    const backChars = contentChars(backZh);
    clauses(zh).forEach(function (clause) {
      if (clause.length < 6) return;
      const targetChars = contentChars(clause);
      if (targetChars.size < 4) return;
      let hit = 0;
      targetChars.forEach(function (ch) { if (backChars.has(ch)) hit += 1; });
      const ratio = hit / targetChars.size;
      if (ratio < 0.2) {
        addIssue(issues, {
          type: 'missing-content',
          slot: slot,
          severity: 'warn',
          title: '整段可能漏译',
          detail: '当前中文这一句「' + clause + '」在独立回译里几乎没有对应内容。',
          target: clause,
          back: backZh
        });
      }
    });
  }

  function checkActions(zh, backZh, slot, issues) {
    const targetActions = groupMatches(zh, ACTION_GROUPS, 'zh');
    const backActions = groupMatches(backZh, ACTION_GROUPS, 'back');
    const backIds = backActions.map(function (group) { return group.id; });
    targetActions.forEach(function (group) {
      if (backIds.indexOf(group.id) === -1) {
        addIssue(issues, {
          type: 'missing-content',
          slot: slot,
          severity: 'warn',
          title: '可能漏译：' + group.label,
          detail: '中文提到「' + matchedLabel(group.zh, zh, group.label) + '」，独立回译没有出现这一动作或语义。',
          target: matchedLabel(group.zh, zh, group.label),
          back: backZh
        });
      }
    });
    const conflicts = [
      ['sit', 'stand'], ['sit', 'lie'], ['stand', 'lie'],
      ['read', 'look'], ['hold', 'wear'], ['smile', 'wait']
    ];
    conflicts.forEach(function (pair) {
      const left = targetActions.some(function (group) { return group.id === pair[0]; });
      const right = targetActions.some(function (group) { return group.id === pair[1]; });
      if (!left || !right) return;
      if (!backIds.includes(pair[0]) && backIds.includes(pair[1])) {
        addIssue(issues, {
          type: 'action-object',
          slot: slot,
          severity: 'warn',
          title: '动作可能被替换',
          detail: '中文同时有「' + ACTION_GROUPS.filter(function (g) { return g.id === pair[0]; })[0].label +
            '」和「' + ACTION_GROUPS.filter(function (g) { return g.id === pair[1]; })[0].label +
            '」，但回译只保留了后者；请核对动作-对象关系。',
          target: matchedLabel(ACTION_GROUPS.filter(function (g) { return g.id === pair[0]; })[0].zh, zh, pair[0]),
          back: backZh
        });
      }
    });
  }

  function checkObjects(zh, backZh, allZh, allBack, slot, issues) {
    const targetObjects = groupMatches(zh, OBJECT_GROUPS, 'zh');
    const backObjects = groupMatches(backZh, OBJECT_GROUPS, 'back');
    const backIds = backObjects.map(function (group) { return group.id; });
    targetObjects.forEach(function (group) {
      if (group.cat === 'exclude') return;
      if (backIds.indexOf(group.id) === -1) {
        addIssue(issues, {
          type: 'action-object',
          slot: slot,
          severity: 'warn',
          title: '可能漏译：' + group.label,
          detail: '中文这一框提到「' + group.label + '」，独立回译没有出现对应物体/对象。',
          target: group.label,
          back: backZh
        });
      }
    });

    // 同一类物体被换成另一个：猫 -> 狗、汽车 -> 自行车 等。
    targetObjects.forEach(function (target) {
      if (backIds.indexOf(target.id) !== -1) return;
      const sameCat = backObjects.filter(function (group) { return group.cat === target.cat; });
      if (sameCat.length) {
        addIssue(issues, {
          type: 'attribute-mismatch',
          slot: slot,
          severity: 'warn',
          title: '物体可能被换掉',
          detail: '中文是「' + target.label + '」，回译成了「' + sameCat[0].label + '」。',
          target: target.label,
          back: sameCat[0].label
        });
      }
    });

    // 回译多出原文没有的显著物体/人物/动物，单独提示，不自动删除。
    const allTargetIds = Object.create(null);
    (groupMatches(allZh, OBJECT_GROUPS, 'zh')).forEach(function (group) { allTargetIds[group.id] = true; });
    const allTargetText = allZh;
    backObjects.forEach(function (group) {
      if (allTargetIds[group.id]) return;
      if (group.cat === 'exclude') return;
      if (group.id === 'sign' && SIGN_RE.test(allTargetText)) return;
      addIssue(issues, {
        type: 'extra-content',
        slot: slot,
        severity: 'warn',
        title: '回译多出原文没有的物体',
        detail: '当前六框中文没有提到「' + group.label + '」，但这一框英文回译里出现了；可能是模型凭空添加。',
        target: '',
        back: group.label
      });
    });
  }

  function checkBodyParts(zh, backZh, slot, issues) {
    groupMatches(zh, BODY_GROUPS, 'zh').forEach(function (group) {
      if (!group.back.test(backZh)) {
        addIssue(issues, {
          type: 'body-part',
          slot: slot,
          severity: 'warn',
          title: '可能漏掉身体部位：' + group.label,
          detail: '中文提到「' + group.label + '」，独立回译没有出现对应部位。',
          target: group.label,
          back: backZh
        });
      }
    });
  }

  function checkColors(zh, backZh, allZh, allBack, slot, issues) {
    const targetColors = groupMatches(zh, COLOR_GROUPS, 'zh');
    const backColors = groupMatches(backZh, COLOR_GROUPS, 'back');
    targetColors.forEach(function (target) {
      if (backColors.some(function (group) { return group.id === target.id; })) return;
      if (backColors.length) {
        addIssue(issues, {
          type: 'attribute-mismatch',
          slot: slot,
          severity: 'warn',
          title: '颜色可能错绑或改变',
          detail: '中文是「' + target.label + '」，回译里却是「' + backColors[0].label + '」；请核对颜色对应的是哪个人物/物体。',
          target: target.label,
          back: backColors[0].label
        });
      } else {
        addIssue(issues, {
          type: 'attribute-mismatch',
          slot: slot,
          severity: 'warn',
          title: '颜色可能丢失',
          detail: '中文有「' + target.label + '」，独立回译没有保留颜色。',
          target: target.label,
          back: backZh
        });
      }
    });

    const targetIds = groupMatches(allZh, COLOR_GROUPS, 'zh').map(function (group) { return group.id; });
    groupMatches(allBack, COLOR_GROUPS, 'back').forEach(function (group) {
      if (targetIds.indexOf(group.id) !== -1) return;
      addIssue(issues, {
        type: 'extra-content',
        slot: slot,
        severity: 'warn',
        title: '回译多出原文没有的颜色',
        detail: '六框中文没有「' + group.label + '」，回译里却出现了；请核对是否模型凭空补色。',
        target: '',
        back: group.label
      });
    });
  }

  const BIND_NOUNS = ['连衣裙', '汽车', '轿车', '风衣', '衬衫', '外套', '裙子', '帽子', '雨伞', '房子', '长椅', '沙发', '床', '背包', '鞋子', '头发', '眼睛', '杯子', '门', '墙', '花'];
  const COLOR_CHARS = '红橙黄绿青蓝紫黑白灰金银粉';

  function colorBindings(value) {
    const input = text(value);
    const out = [];
    const re = new RegExp('(' + COLOR_CHARS + ')色?(' + BIND_NOUNS.join('|') + ')', 'g');
    let match;
    while ((match = re.exec(input)) !== null) {
      out.push({ color: match[1], noun: match[2], text: match[0] });
    }
    return out;
  }

  function checkColorBindings(zh, backZh, slot, issues) {
    const target = colorBindings(zh);
    if (!target.length) return;
    const back = colorBindings(backZh);
    target.forEach(function (binding) {
      const sameNoun = back.filter(function (item) { return item.noun === binding.noun; });
      if (!sameNoun.length) return;
      const conflict = sameNoun.filter(function (item) { return item.color !== binding.color; });
      if (!conflict.length) return;
      addIssue(issues, {
        type: 'attribute-mismatch',
        slot: slot,
        severity: 'warn',
        title: '属性可能错绑',
        detail: '中文是「' + binding.text + '」，回译成了「' + conflict[0].text + '」；颜色和物体的绑定可能错了。',
        target: binding.text,
        back: conflict[0].text
      });
    });
  }

  function numberValue(token) {
    if (/^[0-9]+$/.test(token)) return Number(token);
    let total = 0;
    let current = 0;
    for (let i = 0; i < token.length; i += 1) {
      const value = NUMBER_VALUES[token[i]];
      if (value == null) continue;
      if (value >= 10) {
        if (current === 0) current = 1;
        total += current * value;
        current = 0;
      } else {
        current = value;
      }
    }
    return total + current;
  }

  function significantNumbers(value) {
    const input = text(value);
    const out = [];
    const re = /[0-9]+|[一二两三四五六七八九十百千万]+/g;
    let match;
    while ((match = re.exec(input)) !== null) {
      const after = input.slice(re.lastIndex, re.lastIndex + 4);
      if (/^(?:mm|cm|kg|g|度|%|px|k)\b/i.test(after)) continue;
      const parsed = numberValue(match[0]);
      if (parsed > 1 && out.indexOf(parsed) === -1) out.push(parsed);
    }
    return out;
  }

  function checkNumbers(zh, backZh, slot, issues) {
    const target = significantNumbers(zh);
    if (!target.length) {
      const extra = significantNumbers(backZh);
      if (extra.length) {
        addIssue(issues, {
          type: 'quantity-mismatch',
          slot: slot,
          severity: 'warn',
          title: '回译多出数量',
          detail: '中文没有明显数量，回译里却出现 ' + extra.join('、') + '；请核对人数/物体数量。',
          target: '',
          back: extra.join('、')
        });
      }
      return;
    }
    const back = significantNumbers(backZh);
    const missing = target.filter(function (value) { return back.indexOf(value) === -1; });
    if (missing.length) {
      addIssue(issues, {
        type: 'quantity-mismatch',
        slot: slot,
        severity: 'warn',
        title: '数量可能不一致',
        detail: '中文数量是 ' + target.join('、') + '，回译里没有 ' + missing.join('、') + '。',
        target: target.join('、'),
        back: back.join('、')
      });
    }
  }

  function negatedObjects(value) {
    const out = [];
    clauses(value).forEach(function (clause) {
      if (!NEG_RE.test(clause)) return;
      // 「禁止吸烟的告示牌」描述的是画面里的标牌本身，不是全局排除吸烟。
      if (SIGN_RE.test(clause) && SIGN_NEG_RE.test(clause)) return;
      NEG_OBJECTS.forEach(function (item) {
        if (item.zh.test(clause) && !out.some(function (existing) { return existing.id === item.id; })) {
          out.push(item);
        }
      });
    });
    return out;
  }

  function hasGlobalNegation(value, regex) {
    return clauses(value).some(function (clause) {
      return NEG_RE.test(clause) && regex.test(clause) && !SIGN_RE.test(clause);
    });
  }

  function checkGlobalNegationPlacement(allZh, allEn, issues) {
    const targets = negatedObjects(allZh);
    targets.forEach(function (target) {
      if (target.id === 'smoking' && SIGN_RE.test(allZh)) return;
      SLOTS.forEach(function (key) {
        const value = text(allEn[key]);
        if (!value) return;
        const wordPattern = (target.word || target.en).source;
        const hit = new RegExp('(?:^|[,]|\\s)(?:no|without|free of|no more)\\s+(?:[a-z]+\\s+){0,2}(?:' + wordPattern + ')', 'i').test(value);
        if (!hit) return;
        addIssue(issues, {
          type: 'negation-placement',
          slot: key,
          severity: 'error',
          title: '否定可能落在正面：' + target.label,
          detail: '中文要求排除「' + target.label + '」，但这一框的正面英文仍出现 no/without 这类否定短语；负面提示词同时也在排除它。',
          target: target.label,
          back: value
        });
      });
    });
  }

  function checkNegativeCoverage(zh, negative, issues) {
    const negativeEn = text(negative && negative.en);
    if (!negativeEn) return;
    negatedObjects(zh).forEach(function (target) {
      if (target.en.test(negativeEn)) return;
      addIssue(issues, {
        type: 'negation-missing',
        slot: 'negative',
        severity: 'error',
        title: '负面提示词漏了排除项：' + target.label,
        detail: '中文要求排除「' + target.label + '」，但当前负面英文没有覆盖它。',
        target: target.label,
        back: negativeEn
      });
    });
  }

  function detectSign(value) {
    const input = text(value);
    if (!SIGN_RE.test(input)) return { hasSign: false, prohibited: [], globalSmoking: false };
    const prohibited = [];
    if (SIGN_NEG_RE.test(input)) prohibited.push('smoking');
    return {
      hasSign: true,
      prohibited: prohibited,
      globalSmoking: hasGlobalNegation(input, /吸烟|抽烟|香烟/)
    };
  }

  function checkSign(zh, allEn, backAll, negative, issues) {
    const sign = detectSign(zh);
    if (!sign.hasSign) return;
    if (!/(?:\bsign\b|signboard|notice board)/i.test(allEn) || !/告示|标牌|标识|标志|指示牌|招牌|牌子/.test(backAll)) {
      addIssue(issues, {
        type: 'sign-meaning',
        slot: 'scene',
        severity: 'error',
        title: '告示牌语义可能丢失',
        detail: '中文写的是画面里的告示牌「禁止吸烟」，它应该是正面物体；当前英文或回译里没有保留「告示牌/sign」。',
        target: '禁止吸烟的告示牌',
        back: backAll
      });
    }
    if (sign.prohibited.indexOf('smoking') !== -1 && !sign.globalSmoking && /smok|cigarette/i.test(text(negative && negative.en))) {
      addIssue(issues, {
        type: 'sign-negation',
        slot: 'negative',
        severity: 'error',
        title: '告示牌语义被当成负面排除',
        detail: '中文要画的是「禁止吸烟的告示牌/no smoking sign」，不是要求画面不要出现吸烟；它被误放进了负面提示词。',
        target: 'no smoking sign（正面）',
        back: text(negative && negative.en)
      });
    }
    if (sign.prohibited.indexOf('smoking') !== -1 && /smoking sign/i.test(allEn.replace(/no[\s-]+smoking[\s-]+sign/gi, ''))) {
      addIssue(issues, {
        type: 'sign-meaning',
        slot: 'scene',
        severity: 'error',
        title: '告示牌否定方向可能反了',
        detail: '画面里的标牌应是 no smoking sign；当前英文出现 smoking sign，可能把「禁止」丢了。',
        target: 'no smoking sign',
        back: allEn
      });
    }
  }

  function checkIdentity(zh, backZh, en, allZh, allBack, allEn, slot, issues) {
    const target = groupMatches(zh, IDENTITY_GROUPS, 'zh');
    const back = groupMatches(backZh, IDENTITY_GROUPS, 'zh');
    const targetIds = target.map(function (group) { return group.id; });
    const backIds = back.map(function (group) { return group.id; });

    const targetFemale = target.filter(function (group) { return group.kind === 'female'; });
    const backFemale = back.filter(function (group) { return group.kind === 'female'; });
    if (targetFemale.length && backFemale.length) {
      const mismatch = targetFemale.some(function (targetGroup) {
        if (backIds.indexOf(targetGroup.id) !== -1) return false;
        return backFemale.some(function (backGroup) { return backGroup.id !== targetGroup.id; });
      });
      if (mismatch) {
        addIssue(issues, {
          type: 'identity-conflict',
          slot: slot,
          severity: 'warn',
          title: '人物用词可能冲突',
          detail: '中文这一框是「' + targetFemale[0].label + '」，独立回译成了「' + backFemale[0].label + '」；不能当作一致。',
          target: targetFemale[0].label,
          back: backFemale[0].label
        });
      }
    }
    const targetMale = target.filter(function (group) { return group.kind === 'male'; });
    const backMale = back.filter(function (group) { return group.kind === 'male'; });
    if (targetMale.length && backMale.length) {
      const mismatch = targetMale.some(function (targetGroup) {
        if (backIds.indexOf(targetGroup.id) !== -1) return false;
        return backMale.some(function (backGroup) { return backGroup.id !== targetGroup.id; });
      });
      if (mismatch) {
        addIssue(issues, {
          type: 'identity-conflict',
          slot: slot,
          severity: 'warn',
          title: '人物用词可能冲突',
          detail: '中文这一框是「' + targetMale[0].label + '」，独立回译成了「' + backMale[0].label + '」；不能当作一致。',
          target: targetMale[0].label,
          back: backMale[0].label
        });
      }
    }

    // 英文本身与当前中文的用词冲突（不用等回译）。
    const enIds = groupMatches(en, IDENTITY_GROUPS, 'en').map(function (group) { return group.id; });
    if (targetIds.some(function (id) { return id === 'woman'; }) && enIds.includes('girl') && !enIds.includes('woman')) {
      addIssue(issues, {
        type: 'identity-conflict',
        slot: slot,
        severity: 'warn',
        title: '英文人物与中文不一致',
        detail: '中文是「女人」，英文框里却是 girl；请核对是否指同一个人。',
        target: '女人',
        back: text(en)
      });
    } else if (targetIds.includes('girl') && enIds.includes('woman') && !enIds.includes('girl')) {
      addIssue(issues, {
        type: 'identity-conflict',
        slot: slot,
        severity: 'warn',
        title: '英文人物与中文不一致',
        detail: '中文是「女孩」，英文框里却是 woman；请核对是否指同一个人。',
        target: '女孩',
        back: text(en)
      });
    }

    // 跨框中文自身的人物用词：如果同一套字段里既写女孩又写女人，
    // 不替用户拍板“其实是一个人”，只提示确认。
    const allTargetIds = groupMatches(allZh, IDENTITY_GROUPS, 'zh').map(function (group) { return group.id; });
    const allBackIds = groupMatches(allBack, IDENTITY_GROUPS, 'zh').map(function (group) { return group.id; });
    const allEnIds = ['person', 'outfit', 'pose', 'scene', 'light', 'style'].reduce(function (list, key) {
      groupMatches(allEn && allEn[key], IDENTITY_GROUPS, 'en').forEach(function (group) {
        if (list.indexOf(group.id) === -1) list.push(group.id);
      });
      return list;
    }, []);
    if (allTargetIds.includes('girl') && allTargetIds.includes('woman') && slot === 'person') {
      addIssue(issues, {
        type: 'identity-conflict',
        slot: '',
        severity: 'warn',
        fixable: false,
        title: '各框中文对女性人物用词不一致',
        detail: '六框中文里同时出现「女孩」和「女人」。如果指同一个人，请先统一中文；如果确实是两个人，请保留并在确认时说明。',
        target: '女孩 / 女人',
        back: ''
      });
    }
    if (allTargetIds.includes('woman') && !allEnIds.includes('woman') && slot === 'person') {
      addIssue(issues, {
        type: 'identity-conflict',
        slot: '',
        severity: 'warn',
        fixable: false,
        title: '中文女人没有落到英文 woman',
        detail: '当前中文里出现了「女人」，但六框英文没有任何 woman；人物英文可能仍是 girl。',
        target: '女人',
        back: allEnIds.join('、')
      });
    }
  }

  function countIdentity(textValue, group, mode) {
    const input = text(textValue);
    const field = mode === 'en' ? 'en' : 'zh';
    if (!group[field]) return 0;
    const flags = field === 'en' ? 'gi' : 'g';
    const re = new RegExp(group[field].source, flags);
    const matches = input.match(re);
    return matches ? matches.length : 0;
  }

  function checkDuplicates(zh, backZh, en, allEn, allZh, slot, issues) {
    const roles = IDENTITY_GROUPS.filter(function (group) {
      return ['father', 'mother', 'child', 'woman', 'girl', 'man', 'boy'].indexOf(group.id) !== -1;
    });
    roles.forEach(function (role) {
      const targetCount = countIdentity(zh, role, 'zh');
      const backCount = countIdentity(backZh, role, 'zh');
      if (backCount >= 2 && backCount > targetCount) {
        addIssue(issues, {
          type: 'duplicate-subjects',
          slot: slot,
          severity: 'warn',
          title: '可能重复罗列人物：' + role.label,
          detail: '中文这一框提到「' + role.label + '」' + targetCount + ' 次，回译里出现 ' + backCount + ' 次，可能把同一人物重复列了一遍。',
          target: role.label,
          back: backZh
        });
      }
    });

    if (slot === 'person') {
      const familyOf = /\bfamily of (?:three|four|five|six|\d+)\b/i.test(en);
      const enRoles = roles.filter(function (role) { return countIdentity(en, role, 'en') >= 1; });
      if (familyOf && enRoles.length >= 2) {
        addIssue(issues, {
          type: 'duplicate-subjects',
          slot: slot,
          severity: 'warn',
          title: '可能重复罗列一家人',
          detail: '人物英文既写了 family of…，又逐一列出 ' + enRoles.map(function (role) { return role.label; }).join('、') +
            '；如果后面还有同样的成员列表，容易重复。',
          target: '一家三口',
          back: text(en)
        });
      }
      const poseEn = text(allEn && allEn.pose);
      const poseRoles = roles.filter(function (role) { return countIdentity(poseEn, role, 'en') >= 1; });
      const overlap = enRoles.filter(function (role) { return poseRoles.indexOf(role) !== -1; });
      if (enRoles.length >= 2 && poseRoles.length >= 2 && overlap.length >= 2) {
        addIssue(issues, {
          type: 'duplicate-subjects',
          slot: slot,
          severity: 'warn',
          title: '人物框与动作框重复罗列同一组人',
          detail: '人物框列出 ' + enRoles.map(function (role) { return role.label; }).join('、') +
            '，动作框又列出 ' + poseRoles.map(function (role) { return role.label; }).join('、') +
            '；最终提示词可能重复。',
          target: text(allZh),
          back: text(en) + ' / ' + poseEn
        });
      }
    }
  }

  function checkInputConflicts(zh, issues) {
    const rain = /下着雨|下起雨|下雨|雨天|雨中|雨夜|细雨|大雨|飘雨|落雨/.test(zh);
    const sun = /晒太阳|晒着太阳|沐浴阳光|日光浴|晴天|阳光明媚|烈日/.test(zh);
    if (rain && sun) {
      addIssue(issues, {
        type: 'input-conflict',
        slot: '',
        severity: 'warn',
        fixable: false,
        title: '原文可能自相矛盾：下雨 + 晒太阳',
        detail: '当前中文同时出现下雨和晒太阳/阳光。两侧都保留，没有替你删掉任何一边；如果这是“窗外下雨、窗内猫晒太阳”等合理场景，请确认，否则请先改中文。',
        target: '下雨 / 晒太阳',
        back: ''
      });
    }
    if (/白天|清晨|早晨|正午|中午/.test(zh) && /夜晚|深夜|午夜|晚上|夜里/.test(zh)) {
      addIssue(issues, {
        type: 'input-conflict',
        slot: '',
        severity: 'warn',
        fixable: false,
        title: '原文可能自相矛盾：白天 + 夜晚',
        detail: '当前中文同时出现白天和夜晚；没有自动删改，请确认时间设定。',
        target: '白天 / 夜晚',
        back: ''
      });
    }
  }

  function checkIdeaCoverage(idea, allZh, allBack, issues) {
    const source = text(idea);
    if (!source) return;
    const zhAndBack = allZh + '，' + allBack;
    function omitted(group, kind) {
      if (!group.zh.test(source)) return false;
      const backRegex = group.back || group.zh;
      if (group.zh.test(allZh) || backRegex.test(allBack)) return false;
      addIssue(issues, {
        type: 'input-omitted',
        slot: '',
        severity: 'error',
        fixable: false,
        title: '整体描述有内容没进入六框：' + group.label,
        detail: '原描述里的「' + matchedLabel(group.zh, source, group.label) + '」在六个中文字段和独立回译里都没有保留。' +
          '没有自动补写中文，也没有悄悄删掉；请把它补回对应中文框，再用当前中文重译。',
        target: matchedLabel(group.zh, source, group.label),
        back: zhAndBack
      });
      return true;
    }
    ACTION_GROUPS.forEach(function (group) { omitted(group, 'action'); });
    BODY_GROUPS.forEach(function (group) { omitted(group, 'body'); });
    IDENTITY_GROUPS.forEach(function (group) {
      if (group.id === 'family') return;
      omitted(group, 'identity');
    });
    OBJECT_GROUPS.forEach(function (group) {
      if (group.cat === 'exclude' || group.id === 'sign') return;
      omitted(group, 'object');
    });
    COLOR_GROUPS.forEach(function (group) {
      if (group.zh.test(source) && !group.zh.test(allZh) && !group.back.test(allBack)) {
        addIssue(issues, {
          type: 'input-omitted',
          slot: '',
          severity: 'warn',
          fixable: false,
          title: '整体描述的颜色没进入六框：' + group.label,
          detail: '原描述有「' + group.label + '」，但六个中文字段和回译都没有保留；没有自动补色。',
          target: group.label,
          back: zhAndBack
        });
      }
    });
    const ideaNumbers = significantNumbers(source);
    const keptNumbers = significantNumbers(allZh + '，' + allBack);
    ideaNumbers.forEach(function (value) {
      if (keptNumbers.indexOf(value) !== -1) return;
      addIssue(issues, {
        type: 'input-omitted',
        slot: '',
        severity: 'warn',
        fixable: false,
        title: '整体描述的数量没进入六框',
        detail: '原描述有数量 ' + value + '，但六个中文字段和回译都没有保留；没有自动补数。',
        target: String(value),
        back: zhAndBack
      });
    });
  }

  function compare(input) {
    const data = input || {};
    const fields = slotFields(data.fields);
    const back = data.back || {};
    const negative = {
      zh: text(data.negative && data.negative.zh),
      en: text(data.negative && data.negative.en)
    };
    const backNegative = negativeBackText(data.backNegative || (back && back.negative));
    const issues = [];
    const slotResults = {};
    const allZh = SLOTS.map(function (key) { return fields[key].zh; }).filter(Boolean).join('，');
    const allEn = {};
    const allBack = [];
    SLOTS.forEach(function (key) { allEn[key] = fields[key].en; });

    SLOTS.forEach(function (key) {
      const field = fields[key];
      const backZh = backText(back, key);
      const before = issues.length;
      if ((field.zh || field.en) && field.en && !backZh) {
        addIssue(issues, {
          type: 'backtranslation-missing',
          slot: key,
          severity: 'error',
          title: '这一框没有独立回译',
          detail: '英文存在，但回译结果为空，无法核对。',
          target: field.zh,
          back: ''
        });
      }
      if (field.zh) {
        checkClauseCoverage(field.zh, backZh, key, issues);
        checkActions(field.zh, backZh, key, issues);
        checkObjects(field.zh, backZh, allZh, allBack.join(''), key, issues);
        checkBodyParts(field.zh, backZh, key, issues);
        checkColors(field.zh, backZh, allZh, allBack.join(''), key, issues);
        checkColorBindings(field.zh, backZh, key, issues);
        checkNumbers(field.zh, backZh, key, issues);
        checkIdentity(field.zh, backZh, field.en, allZh, allBack.join(''), allEn, key, issues);
        checkDuplicates(field.zh, backZh, field.en, allEn, allZh, key, issues);
      }
      allBack.push(backZh);
      slotResults[key] = {
        zh: field.zh,
        en: field.en,
        backZh: backZh,
        issues: issues.slice(before)
      };
    });

    const allBackText = allBack.filter(Boolean).join('，');
    checkInputConflicts(allZh, issues);
    if (data.compareIdea && data.idea) {
      checkIdeaCoverage(data.idea, allZh, allBackText, issues);
      checkInputConflicts(String(data.idea) + '，' + allZh, issues);
      checkNegativeCoverage(String(data.idea) + '，' + allZh, negative, issues);
      checkGlobalNegationPlacement(String(data.idea) + '，' + allZh, allEn, issues);
      checkSign(String(data.idea) + '，' + allZh, SLOTS.map(function (key) { return allEn[key]; }).join(', '), allBackText, negative, issues);
    }
    checkSign(allZh, SLOTS.map(function (key) { return allEn[key]; }).join(', '), allBackText, negative, issues);
    checkGlobalNegationPlacement(allZh, allEn, issues);
    checkNegativeCoverage(allZh, negative, issues);

    if (negative.en && !backNegative) {
      addIssue(issues, {
        type: 'backtranslation-missing',
        slot: 'negative',
        severity: 'error',
        title: '负面提示词没有独立回译',
        detail: '负面英文存在，但回译结果为空，无法核对否定是否落位。',
        target: negative.zh,
        back: ''
      });
    }

    const negativeIssues = issues.filter(function (issue) { return issue.slot === 'negative'; });
    return {
      status: issues.length ? STATUS.mismatch : STATUS.clean,
      issues: issues,
      slots: slotResults,
      negative: {
        zh: negative.zh,
        en: negative.en,
        backZh: backNegative,
        issues: negativeIssues
      },
      allZh: allZh,
      allBack: allBackText,
      summary: {
        issueCount: issues.length,
        fixableCount: issues.filter(function (issue) { return issue.fixable; }).length,
        slotCount: SLOTS.filter(function (key) { return fields[key].zh || fields[key].en; }).length
      }
    };
  }

  function serialize(review) {
    const current = normalizeReview(review);
    return {
      version: 1,
      status: current.status,
      round: current.round,
      corrected: current.corrected,
      correctedKeys: current.correctedKeys.slice(),
      issues: current.issues.map(normalizeIssue),
      slots: current.slots,
      negative: current.negative,
      snapshot: current.snapshot,
      checkedAt: current.checkedAt,
      confirmedAt: current.confirmedAt,
      confirmedWithIssues: current.confirmedWithIssues,
      model: current.model,
      auto: current.auto,
      error: current.error,
      staleReason: current.staleReason,
      calls: current.calls
    };
  }

  T2I.BilingualVerify = {
    SLOTS: SLOTS,
    SLOT_LABELS: SLOT_LABELS,
    STATUS: STATUS,
    STATUS_LABELS: STATUS_LABELS,
    STATUS_NOTES: STATUS_NOTES,
    IDENTITY_GROUPS: IDENTITY_GROUPS,
    emptyReview: emptyReview,
    normalizeReview: normalizeReview,
    snapshotOf: snapshotOf,
    sameSnapshot: sameSnapshot,
    restore: restore,
    invalidate: invalidate,
    confirm: confirm,
    statusLabel: statusLabel,
    statusNote: statusNote,
    issuesOf: issuesOf,
    issueCount: issueCount,
    fixableIssues: fixableIssues,
    slotIssues: slotIssues,
    compare: compare,
    serialize: serialize
  };
})();
