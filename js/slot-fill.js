/*
 * slot-fill.js — 把解析出的片段放进六个框
 *
 * 每个片段只会进入一个框；同一段信息不会复制到多个无关框。
 * 无法识别的片段由 parser 按就近规则放入场景/人物等框，不会被丢弃。
 */
(function () {
  'use strict';

  const T2I = (window.T2I = window.T2I || {});
  const U = T2I.Utils;
  const TR = T2I.Translator;

  const SLOT_DEFS = [
    {
      key: 'person',
      label: '人物与外貌',
      enLabel: 'Subject & appearance',
      hint: '身份、年龄、脸型、发型发色、眼睛、表情、妆容'
    },
    {
      key: 'outfit',
      label: '服装与造型',
      enLabel: 'Outfit & styling',
      hint: '服装、颜色、材质、鞋包、首饰、妆造细节'
    },
    {
      key: 'pose',
      label: '姿态与动作',
      enLabel: 'Pose & action',
      hint: '站坐行走、手势、视线、情绪动作、镜头前后关系'
    },
    {
      key: 'scene',
      label: '场景与背景',
      enLabel: 'Scene & background',
      hint: '地点、时间、天气、室内外、背景元素'
    },
    {
      key: 'light',
      label: '光线与镜头',
      enLabel: 'Lighting & camera',
      hint: '光源、光质、色温、焦段、景深、构图、机位'
    },
    {
      key: 'style',
      label: '画风与质感',
      enLabel: 'Style & texture',
      hint: '摄影风格、电影感、胶片、调色、画风、质感'
    }
  ];

  const SLOT_KEYS = SLOT_DEFS.map(function (s) { return s.key; });

  function emptySlots() {
    const slots = Object.create(null);
    SLOT_DEFS.forEach(function (def) {
      slots[def.key] = {
        key: def.key,
        label: def.label,
        items: [],
        completionItems: [],
        zh: '',
        en: '',
        unknown: []
      };
    });
    return slots;
  }

  function fill(parsed, options) {
    const slots = emptySlots();
    const noLexicon = !!(options && options.noLexicon) ||
      !!(parsed && parsed.scene && parsed.scene.englishFrom === 'model');
    const unknown = [];

    // 内部以结构化场景为准：六个框只是 scene.units 的投影。Scene 不存在或
    // 仍是旧调用时，才退回 segments。
    const units = parsed.scene && (parsed.scene.structured || (parsed.scene.units && parsed.scene.units.length))
      ? (parsed.scene.units || [])
      : (parsed.segments || []);

    if (parsed.scene) {
      Object.defineProperty(slots, '__scene', {
        value: parsed.scene,
        enumerable: false,
        configurable: true,
        writable: true
      });
    }

    units.forEach(function (segment) {
      const key = SLOT_KEYS.indexOf(segment.slot) !== -1 ? segment.slot : 'scene';
      const slot = slots[key];
      const en = U.cleanEnglish(segment.en || '');
      let zh = U.cleanChinese(segment.zh || segment.text || '');

      // 纯英文输入时，把英文框内容回译成中文，保证六框仍有中英对照。
      // 本地模型成功路径不再查词库：模型给什么英文就用什么，缺中文就留空。
      if (zh && !U.hasCjk(zh) && !noLexicon) {
        const back = TR.translateEn(en || zh);
        if (back.zh) zh = back.zh;
      }

      // 同一句话被重复写两遍时只保留一次。
      const duplicate = slot.items.some(function (item) {
        return en && item.en && item.en.toLowerCase() === en.toLowerCase();
      });
      if (duplicate) return;

      slot.items.push({
        zh: zh,
        en: en,
        added: false,
        source: segment.source || 'scene',
        category: segment.category || (segment.matches && segment.matches[0] ? segment.matches[0].entry.category : ''),
        entityId: segment.entityId || '',
        relation: segment.relation || '',
        unknown: segment.unknown || []
      });

      (segment.unknown || []).forEach(function (u) {
        if (!unknown.includes(u)) unknown.push(u);
      });
    });

    if (parsed.scene && parsed.scene.unknown) {
      parsed.scene.unknown.forEach(function (item) {
        if (item && !unknown.includes(item)) unknown.push(item);
      });
    }

    refreshText(slots);
    return { slots: slots, unknown: unknown };
  }

  // 用 items 重建每个框的中英文文本。用户编辑后 items 会失效，由 app.js 管理。
  function refreshText(slots) {
    SLOT_KEYS.forEach(function (key) {
      const slot = slots[key];
      slot.zh = U.joinPhrasesZh(slot.items.map(function (i) { return i.zh; }));
      slot.en = U.joinPhrasesEn(slot.items.map(function (i) { return i.en; }));
    });
    return slots;
  }

  function addCompletion(slot, item) {
    slot.items.push({
      zh: item.zh,
      en: item.en,
      added: true,
      source: 'completion',
      reason: item.reason || ''
    });
    slot.completionItems.push({
      zh: item.zh,
      en: item.en,
      reason: item.reason || ''
    });
  }

  function getDefinitions() {
    return SLOT_DEFS;
  }

  T2I.SlotFill = {
    slots: SLOT_KEYS,
    definitions: SLOT_DEFS,
    emptySlots: emptySlots,
    fill: fill,
    refreshText: refreshText,
    addCompletion: addCompletion,
    getDefinitions: getDefinitions
  };
})();
