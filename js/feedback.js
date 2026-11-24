/*
 * feedback.js — 未收录片段的本机待补录队列与导出格式
 *
 * 这个模块不碰 DOM、不联网，浏览器和 Node 测试共用。界面只负责：
 *   1. 把解析/生成时的 unknown 片段交给 recordUnknownTerms；
 *   2. 把返回的列表写回 localStorage；
 *   3. 用 exportFeedback / markdownFor / issueUrlFor 导出给大肥鱼。
 *
 * 数据格式固定为 t2i.lexicon-feedback/v1，字段说明见 feedback/schema.json。
 */
(function () {
  'use strict';

  const T2I = (window.T2I = window.T2I || {});

  const STORAGE_KEY = 't2i.lexiconFeedback.v1';
  const SCHEMA_ID = 't2i.lexicon-feedback/v1';
  const SCHEMA_URL = 'feedback/schema.json';
  const PAGE_VERSION = '2026.11.24-feedback.1';
  const MAX_CONTEXTS = 5;
  const MAX_TERMS = 300;
  const NOTE_MAX = 600;
  const IDEA_MAX = 4000;
  const ISSUE_REPO = 'zhangteng945/txt2img-prompt';

  const SLOT_LABELS = {
    person: '人物与外貌',
    outfit: '服装与造型',
    pose: '姿态与动作',
    scene: '场景与背景',
    light: '光线与镜头',
    style: '画风与质感'
  };

  const LEADING_PUNCT = /^[\s，,。.、；;：:！!？?（）()【】\[\]{}<>《》"'“”‘’`~@#$%^&*_+=|\\/·…—–-]+/;
  const TRAILING_PUNCT = /[\s，,。.、；;：:！!？?（）()【】\[\]{}<>《》"'“”‘’`~@#$%^&*_+=|\\/·…—–-]+$/;

  function normalizeTerm(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .replace(LEADING_PUNCT, '')
      .replace(TRAILING_PUNCT, '')
      .trim();
  }

  function isMeaningfulTerm(value) {
    const term = normalizeTerm(value);
    if (!term) return false;
    // 纯标点、纯空白、纯 emoji 都不算；至少要有汉字、字母或数字。
    return /[A-Za-z0-9\u3400-\u9fff]/.test(term);
  }

  function termKey(term) {
    return normalizeTerm(term).toLowerCase();
  }

  function toIso(value, fallback) {
    const d = value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) return fallback;
    return d.toISOString();
  }

  function nowIso(value) {
    return toIso(value, new Date().toISOString());
  }

  function positiveInt(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(1000000, Math.floor(n));
  }

  function uniqueSlots(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach(function (slot) {
      if (typeof slot !== 'string' || !slot) return;
      if (!Object.prototype.hasOwnProperty.call(SLOT_LABELS, slot)) return;
      if (!out.includes(slot)) out.push(slot);
    });
    return out;
  }

  function normalizeContext(raw, fallbackAt) {
    if (!raw || typeof raw !== 'object') return null;
    const idea = String(raw.idea == null ? '' : raw.idea).replace(/\u0000/g, '').slice(0, IDEA_MAX).trim();
    if (!idea) return null;
    const slot = typeof raw.slot === 'string' && SLOT_LABELS[raw.slot] ? raw.slot : '';
    return {
      idea: idea,
      slot: slot,
      slotLabel: slot ? SLOT_LABELS[slot] : '',
      at: toIso(raw.at, fallbackAt)
    };
  }

  function pushContext(contexts, context) {
    const list = Array.isArray(contexts) ? contexts.slice() : [];
    const index = list.findIndex(function (item) {
      return item.idea === context.idea && item.slot === context.slot;
    });
    if (index !== -1) list.splice(index, 1);
    list.push(context);
    return list.slice(-MAX_CONTEXTS);
  }

  function normalizeEntry(raw, fallbackAt) {
    if (!raw || typeof raw !== 'object') return null;
    const term = normalizeTerm(raw.term);
    if (!isMeaningfulTerm(term)) return null;

    const createdAt = toIso(raw.createdAt, fallbackAt);
    const updatedAt = toIso(raw.updatedAt, createdAt);
    let contexts = [];
    (Array.isArray(raw.contexts) ? raw.contexts : []).forEach(function (context) {
      const normalized = normalizeContext(context, updatedAt);
      if (normalized) contexts = pushContext(contexts, normalized);
    });

    const slotHints = uniqueSlots(raw.slotHints);
    contexts.forEach(function (context) {
      if (context.slot && !slotHints.includes(context.slot)) slotHints.push(context.slot);
    });

    return {
      term: term,
      count: positiveInt(raw.count, 1),
      contexts: contexts.slice(-MAX_CONTEXTS),
      slotHints: slotHints,
      note: String(raw.note == null ? '' : raw.note).replace(/\u0000/g, '').slice(0, NOTE_MAX),
      createdAt: createdAt,
      updatedAt: updatedAt,
      source: String(raw.source == null ? '' : raw.source).slice(0, 300)
    };
  }

  function mergeEntry(target, incoming) {
    if (!target) return incoming;
    target.count = positiveInt(incoming.count, 1) + target.count;
    target.slotHints = uniqueSlots(target.slotHints.concat(incoming.slotHints));
    (incoming.contexts || []).forEach(function (context) {
      target.contexts = pushContext(target.contexts, context);
    });
    if (!target.note && incoming.note) target.note = incoming.note;
    if (incoming.createdAt < target.createdAt) target.createdAt = incoming.createdAt;
    if (incoming.updatedAt > target.updatedAt) target.updatedAt = incoming.updatedAt;
    if (!target.source && incoming.source) target.source = incoming.source;
    return target;
  }

  function sortEntries(entries) {
    return entries.slice().sort(function (a, b) {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      return a.term.localeCompare(b.term, 'zh-CN');
    });
  }

  function normalizeList(raw, now) {
    const fallbackAt = nowIso(now);
    const map = new Map();
    (Array.isArray(raw) ? raw : []).forEach(function (item) {
      const entry = normalizeEntry(item, fallbackAt);
      if (!entry) return;
      const key = termKey(entry.term);
      if (map.has(key)) mergeEntry(map.get(key), entry);
      else map.set(key, entry);
    });
    return sortEntries(Array.from(map.values())).slice(0, MAX_TERMS);
  }

  function occurrencesFromUnknownMap(unknownBySlot) {
    const byKey = new Map();
    const out = [];
    Object.keys(unknownBySlot || {}).forEach(function (slot) {
      const list = Array.isArray(unknownBySlot[slot]) ? unknownBySlot[slot] : [];
      list.forEach(function (rawTerm) {
        const term = normalizeTerm(rawTerm);
        if (!isMeaningfulTerm(term)) return;
        const key = termKey(term);
        let occurrence = byKey.get(key);
        if (!occurrence) {
          occurrence = { term: term, count: 1, slots: [] };
          byKey.set(key, occurrence);
          out.push(occurrence);
        }
        if (slot && SLOT_LABELS[slot] && !occurrence.slots.includes(slot)) {
          occurrence.slots.push(slot);
        }
      });
    });
    return out;
  }

  /*
   * 把一次拆解/生成里出现的 unknown 合并进本机列表。
   * 同一词（忽略大小写）只留一条，count 累加，上下文保留最近 5 条。
   */
  function mergeOccurrences(existing, occurrences, context, now) {
    const at = nowIso(now);
    const base = context && typeof context === 'object' ? context : {};
    const idea = String(base.idea == null ? '' : base.idea).replace(/\u0000/g, '').slice(0, IDEA_MAX).trim();
    const source = String(base.source == null ? '' : base.source).slice(0, 300);

    const map = new Map();
    normalizeList(existing, at).forEach(function (entry) {
      map.set(termKey(entry.term), entry);
    });

    (Array.isArray(occurrences) ? occurrences : []).forEach(function (raw) {
      if (!raw || typeof raw !== 'object') return;
      const term = normalizeTerm(raw.term);
      if (!isMeaningfulTerm(term)) return;
      const key = termKey(term);
      let entry = map.get(key);
      if (!entry) {
        entry = {
          term: term,
          count: 0,
          contexts: [],
          slotHints: [],
          note: '',
          createdAt: at,
          updatedAt: at,
          source: source
        };
        map.set(key, entry);
      }
      entry.count += positiveInt(raw.count, 1);
      entry.slotHints = uniqueSlots(entry.slotHints.concat(uniqueSlots(raw.slots)));
      if (!entry.source && source) entry.source = source;
      entry.updatedAt = at;

      if (idea) {
        const contextSlot = uniqueSlots(raw.slots)[0] || '';
        entry.contexts = pushContext(entry.contexts, {
          idea: idea,
          slot: contextSlot,
          slotLabel: contextSlot ? SLOT_LABELS[contextSlot] : '',
          at: at
        });
      }
    });

    return sortEntries(Array.from(map.values())).slice(0, MAX_TERMS);
  }

  function recordUnknownTerms(existing, unknownBySlot, context, now) {
    return mergeOccurrences(existing, occurrencesFromUnknownMap(unknownBySlot), context, now);
  }

  function setNote(existing, term, note, now) {
    const key = termKey(term);
    const at = nowIso(now);
    const list = normalizeList(existing, at).map(function (entry) {
      if (termKey(entry.term) !== key) return entry;
      entry.note = String(note == null ? '' : note).replace(/\u0000/g, '').slice(0, NOTE_MAX);
      entry.updatedAt = at;
      return entry;
    });
    return sortEntries(list);
  }

  function removeTerm(existing, term) {
    const key = termKey(term);
    return normalizeList(existing).filter(function (entry) {
      return termKey(entry.term) !== key;
    });
  }

  function isCovered(term, translator) {
    const text = normalizeTerm(term);
    if (!isMeaningfulTerm(text)) return false;
    const TR = translator || T2I.Translator;
    if (!TR) return false;

    if (typeof TR.translateZh === 'function') {
      const zh = TR.translateZh(text);
      if (zh && zh.matches && zh.matches.length && (!zh.unknown || zh.unknown.length === 0)) return true;
    }
    if (typeof TR.translateEn === 'function' && /[A-Za-z]/.test(text)) {
      const en = TR.translateEn(text);
      if (en && en.matches && en.matches.length && (!en.unknown || en.unknown.length === 0)) return true;
    }
    return false;
  }

  function sourceLabel() {
    const stats = T2I.Lexicon && T2I.Lexicon.stats;
    return 'txt2img-prompt@' + PAGE_VERSION +
      (stats
        ? ' / lexicon ' + stats.canonicalEntries + ' entries (' +
          stats.zhAliases + ' zh aliases, ' + stats.enAliases + ' en aliases)'
        : '');
  }

  function exportFeedback(list, options) {
    const opts = options || {};
    const at = toIso(opts.now, new Date().toISOString());
    const source = String(opts.source || sourceLabel()).slice(0, 300);
    const terms = normalizeList(list, at).map(function (entry) {
      return {
        term: entry.term,
        count: entry.count,
        contexts: entry.contexts.map(function (context) {
          return {
            idea: context.idea,
            slot: context.slot,
            slotLabel: context.slotLabel,
            at: context.at
          };
        }),
        slotHints: entry.slotHints.slice(),
        note: entry.note,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        source: entry.source || source
      };
    });

    return {
      schema: SCHEMA_ID,
      schemaUrl: SCHEMA_URL,
      generator: 'txt2img-prompt',
      pageVersion: PAGE_VERSION,
      exportedAt: at,
      source: source,
      terms: terms
    };
  }

  function slotText(slotHints) {
    return uniqueSlots(slotHints).map(function (slot) {
      return SLOT_LABELS[slot] + '（' + slot + '）';
    }).join('、') || '未标注';
  }

  function quoteLines(text) {
    return String(text || '').split('\n').map(function (line) {
      return '> ' + line;
    }).join('\n');
  }

  function markdownFor(data, options) {
    const opts = options || {};
    const covered = typeof opts.isCovered === 'function' ? opts.isCovered : function () { return false; };
    const terms = data && Array.isArray(data.terms) ? data.terms : [];
    const totalCount = terms.reduce(function (sum, entry) {
      return sum + positiveInt(entry.count, 1);
    }, 0);
    const lines = [];

    lines.push('# 词库待补录清单');
    lines.push('');
    lines.push('- 导出时间：' + (data.exportedAt || ''));
    lines.push('- 页面 / 词库：' + (data.source || ''));
    lines.push('- 格式：' + (data.schema || SCHEMA_ID) + '（schema: ' + (data.schemaUrl || SCHEMA_URL) + '）');
    lines.push('- 待补录词：' + terms.length + ' 个，累计出现 ' + totalCount + ' 次');
    lines.push('');
    lines.push('> 给大肥鱼：按正确类别补规范词和常用 alias；先去重，不做颜色 × 物体笛卡尔积；补回归测试；不要自行 push 或发布 GitHub Pages。');
    lines.push('');

    if (!terms.length) {
      lines.push('（当前没有待补录词。）');
      lines.push('');
    }

    terms.forEach(function (entry, index) {
      lines.push('## ' + (index + 1) + '. ' + entry.term + ' × ' + entry.count);
      lines.push('');
      lines.push('- 可能所在框：' + slotText(entry.slotHints));
      lines.push('- 词库状态：' + (covered(entry.term) ? '词库已可命中，可移除' : '当前词库仍不能完整命中'));
      if (entry.note) {
        lines.push('- 用户备注：' + String(entry.note).replace(/\n/g, ' / '));
      } else {
        lines.push('- 用户备注：（无）');
      }
      lines.push('- 时间：创建 ' + entry.createdAt + '，最近更新 ' + entry.updatedAt);
      lines.push('');
      if (entry.contexts && entry.contexts.length) {
        lines.push('最近上下文：');
        lines.push('');
        entry.contexts.forEach(function (context) {
          const where = context.slotLabel ? context.slotLabel : '未标注框';
          lines.push('**' + context.at + ' · ' + where + '**');
          lines.push('');
          lines.push(quoteLines(context.idea));
          lines.push('');
        });
      } else {
        lines.push('最近上下文：（没有保存到想法原文）');
        lines.push('');
      }
    });

    if (opts.includeJson !== false) {
      lines.push('## JSON');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(data, null, 2));
      lines.push('```');
      lines.push('');
    }

    lines.push('---');
    lines.push('由 txt2img-prompt 页面在本机生成；没有上传数据。');
    return lines.join('\n');
  }

  function issueBodyFor(data, options) {
    const opts = options || {};
    const body = markdownFor(data, {
      isCovered: opts.isCovered,
      includeJson: false
    });
    const maxLength = positiveInt(opts.maxLength, 6500);
    const footer = '\n\n---\n完整 JSON 请回到页面点「复制补录清单」后粘贴；页面不会自动创建 issue，也不包含任何 token。';
    if (body.length + footer.length <= maxLength) return body + footer;
    return body.slice(0, Math.max(0, maxLength - footer.length - 40)) +
      '\n\n…（内容过长已截断，完整清单请用页面「复制补录清单」粘贴。）' + footer;
  }

  function issueUrlFor(data, options) {
    const opts = options || {};
    const repo = opts.repo || ISSUE_REPO;
    const date = String(data.exportedAt || '').slice(0, 10) || filenameDate(new Date());
    const title = '[词库补录] ' + (data.terms ? data.terms.length : 0) + ' 个未收录词 · ' + date;
    const base = 'https://github.com/' + repo + '/issues/new?title=' + encodeURIComponent(title) + '&body=';
    // GitHub 的 issues/new 预填 URL 不能无限长。这里按编码后的 URL 长度收紧，
    // 保证「可以打开」优先；完整清单仍可用页面里的「复制补录清单」。
    let maxLength = positiveInt(opts.maxLength, 3000);
    let body = issueBodyFor(data, {
      isCovered: opts.isCovered,
      maxLength: maxLength
    });
    let url = base + encodeURIComponent(body);
    while (url.length > 7800 && maxLength > 500) {
      maxLength -= 300;
      body = issueBodyFor(data, {
        isCovered: opts.isCovered,
        maxLength: maxLength
      });
      url = base + encodeURIComponent(body);
    }
    return url;
  }

  function filenameDate(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    if (Number.isNaN(d.getTime())) {
      const fallback = new Date();
      return String(fallback.getFullYear()) + String(fallback.getMonth() + 1).padStart(2, '0') + String(fallback.getDate()).padStart(2, '0');
    }
    return String(d.getFullYear()) +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
  }

  function filenameFor(date) {
    return 'lexicon-feedback-' + filenameDate(date) + '.json';
  }

  function toJson(data) {
    return JSON.stringify(data, null, 2) + '\n';
  }

  function loadFrom(storage) {
    try {
      const raw = storage && storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return normalizeList(JSON.parse(raw));
    } catch (err) {
      return [];
    }
  }

  function saveTo(storage, list) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(normalizeList(list)));
      return true;
    } catch (err) {
      return false;
    }
  }

  T2I.Feedback = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_ID: SCHEMA_ID,
    SCHEMA_URL: SCHEMA_URL,
    PAGE_VERSION: PAGE_VERSION,
    MAX_CONTEXTS: MAX_CONTEXTS,
    MAX_TERMS: MAX_TERMS,
    NOTE_MAX: NOTE_MAX,
    slotLabels: SLOT_LABELS,
    normalizeTerm: normalizeTerm,
    isMeaningfulTerm: isMeaningfulTerm,
    normalizeList: normalizeList,
    occurrencesFromUnknownMap: occurrencesFromUnknownMap,
    mergeOccurrences: mergeOccurrences,
    recordUnknownTerms: recordUnknownTerms,
    setNote: setNote,
    removeTerm: removeTerm,
    isCovered: isCovered,
    sourceLabel: sourceLabel,
    exportFeedback: exportFeedback,
    markdownFor: markdownFor,
    issueBodyFor: issueBodyFor,
    issueUrlFor: issueUrlFor,
    filenameFor: filenameFor,
    toJson: toJson,
    loadFrom: loadFrom,
    saveTo: saveTo
  };
})();
