/*
 * prompt-flow.js — 六框编辑 / 英文待更新状态的纯逻辑
 *
 * 与 DOM 解耦，方便测试：
 *   - 用户改中文：对应英文标记 stale（待更新），中文永远是本地权威；
 *   - 用户改英文：清掉该字段 stale；
 *   - 重译只更新传入的字段英文，绝不写中文；
 *   - 旧收藏 / 历史没有 stale 字段时，按「中文有内容但英文为空」兼容判断。
 */
(function () {
  'use strict';

  const T2I = (window.T2I = window.T2I || {});
  const U = T2I.Utils;
  const SLOTS = ['person', 'outfit', 'pose', 'scene', 'light', 'style'];

  function normalizeSlot(source) {
    const item = source && typeof source === 'object' ? source : {};
    return {
      zh: typeof item.zh === 'string' ? item.zh : '',
      en: typeof item.en === 'string' ? item.en : '',
      stale: item.stale === true,
      inferred: item.inferred === true,
      completionItems: Array.isArray(item.completionItems) ? item.completionItems : []
    };
  }

  function normalizeSlots(source, legacyPending) {
    const pending = Array.isArray(legacyPending) ? legacyPending : [];
    const out = Object.create(null);
    SLOTS.forEach(function (key) {
      const slot = normalizeSlot(source && source[key]);
      if (pending.indexOf(key) !== -1) slot.stale = true;
      out[key] = slot;
    });
    return out;
  }

  function markChineseEdited(slots, key) {
    if (!slots || !slots[key]) return false;
    slots[key].stale = !!String(slots[key].zh || '').trim() || !!String(slots[key].en || '').trim();
    return slots[key].stale;
  }

  function markEnglishEdited(slots, key) {
    if (!slots || !slots[key]) return false;
    slots[key].stale = false;
    return true;
  }

  function pendingKeys(slots) {
    if (!slots) return [];
    return SLOTS.filter(function (key) {
      const slot = slots[key] || {};
      if (slot.stale === true) return true;
      return !!String(slot.zh || '').trim() && !String(slot.en || '').trim();
    });
  }

  function inferredKeys(slots) {
    if (!slots) return [];
    return SLOTS.filter(function (key) { return !!(slots[key] && slots[key].inferred); });
  }

  function validEn(value) {
    const text = U.cleanEnglish(String(value == null ? '' : value));
    return !!text && U.hasLatin(text) && !U.hasCjk(text);
  }

  // 只更新 keys 指定的英文；任一字段不合格就整体不落盘，避免半套新英文。
  function applyEnglish(slots, englishFields, keys) {
    const list = (Array.isArray(keys) ? keys : pendingKeys(slots)).filter(function (key) {
      return SLOTS.indexOf(key) !== -1;
    });
    const missing = [];
    const updates = Object.create(null);
    list.forEach(function (key) {
      const entry = englishFields && englishFields[key];
      const rawEn = entry && typeof entry === 'object' ? entry.en : entry;
      const en = String(rawEn == null ? '' : rawEn).trim();
      // 中文被清空时，允许模型/流程返回空英文，表示这一项确实不再需要英文。
      if (!en && !String(slots[key].zh || '').trim()) {
        updates[key] = '';
        return;
      }
      if (!validEn(en)) {
        missing.push(key);
        return;
      }
      updates[key] = U.cleanEnglish(en);
    });
    if (missing.length) {
      return { ok: false, missing: missing, updated: [] };
    }
    list.forEach(function (key) {
      slots[key].en = updates[key];
      slots[key].stale = false;
      slots[key].inferred = false;
    });
    return { ok: true, missing: [], updated: list.slice() };
  }

  function serialize(slots) {
    const out = {};
    SLOTS.forEach(function (key) {
      const slot = slots[key] || {};
      out[key] = {
        zh: String(slot.zh || ''),
        en: String(slot.en || ''),
        stale: slot.stale === true,
        inferred: slot.inferred === true
      };
    });
    return out;
  }

  function summary(slots) {
    const pending = pendingKeys(slots);
    return {
      pending: pending,
      pendingCount: pending.length,
      inferred: inferredKeys(slots)
    };
  }

  T2I.PromptFlow = {
    SLOTS: SLOTS,
    normalizeSlot: normalizeSlot,
    normalizeSlots: normalizeSlots,
    markChineseEdited: markChineseEdited,
    markEnglishEdited: markEnglishEdited,
    pendingKeys: pendingKeys,
    inferredKeys: inferredKeys,
    validEn: validEn,
    applyEnglish: applyEnglish,
    serialize: serialize,
    summary: summary
  };
})();
