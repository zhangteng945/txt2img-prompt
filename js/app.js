/*
 * app.js — 界面状态、中英同步、补全标记、生成与复制
 *
 * 不使用框架、不联网。六个框的当前内容始终以用户编辑后的为准；
 * 点击「生成提示词」时只做缺英文的兜底翻译，不会偷偷重新补全被删掉的项。
 */
(function () {
  'use strict';

  const T2I = window.T2I;
  const U = T2I.Utils;
  const TR = T2I.Translator;
  const Parser = T2I.Parser;
  const SF = T2I.SlotFill;
  const Complete = T2I.Complete;
  const Assemble = T2I.Assemble;
  const Negative = T2I.Negative;
  const Feedback = T2I.Feedback;

  const STORAGE_KEYS = {
    favorites: 't2i.favorites.v1',
    history: 't2i.history.v1'
  };

  const EXAMPLES = [
    '傍晚街边，短发女人穿米色风衣站着，侧脸看向远处，柔和自然光，电影感',
    '雨夜街道，霓虹灯，穿黑色皮夹克的年轻女人站在路边，撑着透明雨伞，回过头，35mm 镜头，电影感，青橙色调',
    '清晨的咖啡馆，短发女孩坐在窗边看书，白衬衫和牛仔裤，柔和窗光，浅景深，日系胶片感',
    '一位银发精灵骑士站在雪山之巅，银色盔甲和深蓝披风，手握长剑，逆光，广角镜头，奇幻概念艺术'
  ];

  const PLACEHOLDERS = {
    person: '例如：短发女人，侧脸，蓝眼睛',
    outfit: '例如：米色风衣，黑色皮靴',
    pose: '例如：站在街边，双手插兜',
    scene: '例如：傍晚街边，雨后',
    light: '例如：柔和自然光，50mm 镜头',
    style: '例如：电影感，胶片颗粒'
  };

  const state = {
    slots: SF.emptySlots(),
    parsed: null,
    generated: null,
    timers: Object.create(null),
    unknownBySlot: Object.create(null),
    composing: Object.create(null),
    favorites: [],
    history: [],
    feedback: [],
    libraryTab: 'favorites',
    storageOK: true,
    toastTimer: null,
    searchTimer: null,
    lastFocused: null
  };

  const el = {
    idea: document.getElementById('idea'),
    ideaCount: document.getElementById('ideaCount'),
    fillBtn: document.getElementById('fillBtn'),
    resetBtn: document.getElementById('resetBtn'),
    parseStatus: document.getElementById('parseStatus'),
    slotGrid: document.getElementById('slotGrid'),
    warningBanner: document.getElementById('warningBanner'),
    warningText: document.getElementById('warningText'),
    generateBtn: document.getElementById('generateBtn'),
    outputSection: document.getElementById('outputSection'),
    outputMeta: document.getElementById('outputMeta'),
    positiveEn: document.getElementById('positiveEn'),
    positiveZh: document.getElementById('positiveZh'),
    negativeEn: document.getElementById('negativeEn'),
    negativeZh: document.getElementById('negativeZh'),
    outputFootnote: document.getElementById('outputFootnote'),
    searchInput: document.getElementById('searchInput'),
    searchClear: document.getElementById('searchClear'),
    searchResults: document.getElementById('searchResults'),
    saveFavoriteBtn: document.getElementById('saveFavoriteBtn'),
    saveFavoriteBtnOutput: document.getElementById('saveFavoriteBtnOutput'),
    favoritesBtn: document.getElementById('favoritesBtn'),
    historyBtn: document.getElementById('historyBtn'),
    favoriteCount: document.getElementById('favoriteCount'),
    historyCount: document.getElementById('historyCount'),
    feedbackBtn: document.getElementById('feedbackBtn'),
    feedbackCount: document.getElementById('feedbackCount'),
    warningFeedbackBtn: document.getElementById('warningFeedbackBtn'),
    feedbackModal: document.getElementById('feedbackModal'),
    feedbackList: document.getElementById('feedbackList'),
    feedbackSummary: document.getElementById('feedbackSummary'),
    feedbackStorageNote: document.getElementById('feedbackStorageNote'),
    copyFeedbackBtn: document.getElementById('copyFeedbackBtn'),
    downloadFeedbackBtn: document.getElementById('downloadFeedbackBtn'),
    issueFeedbackBtn: document.getElementById('issueFeedbackBtn'),
    clearFeedbackBtn: document.getElementById('clearFeedbackBtn'),
    previewBtn: document.getElementById('previewBtn'),
    previewModal: document.getElementById('previewModal'),
    previewPositiveEn: document.getElementById('previewPositiveEn'),
    previewPositiveZh: document.getElementById('previewPositiveZh'),
    previewNegativeEn: document.getElementById('previewNegativeEn'),
    previewNegativeZh: document.getElementById('previewNegativeZh'),
    libraryModal: document.getElementById('libraryModal'),
    libraryBody: document.getElementById('libraryBody'),
    favoritesTab: document.getElementById('favoritesTab'),
    historyTab: document.getElementById('historyTab'),
    storageNote: document.getElementById('storageNote'),
    toast: document.getElementById('toast')
  };

  function escapeHtml(text) {
    return U.escapeHtml(String(text == null ? '' : text));
  }

  function renderSlots() {
    el.slotGrid.innerHTML = SF.definitions.map(function (def, index) {
      const key = def.key;
      return (
        '<article class="slot-card slot-' + key + '" data-slot-card="' + key + '">' +
          '<header class="slot-head">' +
            '<span class="slot-index" aria-hidden="true">' + String(index + 1).padStart(2, '0') + '</span>' +
            '<div class="slot-title">' +
              '<h3>' + escapeHtml(def.label) + '</h3>' +
              '<p>' + escapeHtml(def.enLabel) + ' · ' + escapeHtml(def.hint) + '</p>' +
            '</div>' +
            '<span class="completion-badge" data-completion-badge="' + key + '" hidden></span>' +
          '</header>' +
          '<div class="slot-fields">' +
            '<div class="field">' +
              '<label class="field-label" for="slot-' + key + '-zh">' +
                '<span>中文</span><span class="lang-en">ZH</span>' +
              '</label>' +
              '<textarea class="slot-textarea zh" id="slot-' + key + '-zh" data-slot="' + key + '" data-lang="zh" rows="3" maxlength="1400" spellcheck="false" placeholder="' + escapeHtml(PLACEHOLDERS[key]) + '"></textarea>' +
            '</div>' +
            '<div class="field">' +
              '<label class="field-label" for="slot-' + key + '-en">' +
                '<span>English prompt</span><span class="lang-en">EN · SDXL</span>' +
              '</label>' +
              '<textarea class="slot-textarea en" id="slot-' + key + '-en" data-slot="' + key + '" data-lang="en" rows="3" maxlength="1800" spellcheck="false" placeholder="English prompt fragments"></textarea>' +
            '</div>' +
          '</div>' +
          '<div class="slot-foot">' +
            '<p class="sync-hint" data-sync-hint="' + key + '"></p>' +
            '<button type="button" class="mini-button" data-clear-slot="' + key + '">清空本框</button>' +
          '</div>' +
          '<div class="completion-panel" data-completion-panel="' + key + '" hidden>' +
            '<div class="completion-panel-title"><span class="completion-badge">补全</span><span>以下内容未在整体想法里出现，由规则补上</span></div>' +
            '<ul class="completion-list" data-completion-list="' + key + '"></ul>' +
          '</div>' +
        '</article>'
      );
    }).join('');

    SF.definitions.forEach(function (def) {
      const key = def.key;
      const zh = document.getElementById('slot-' + key + '-zh');
      const en = document.getElementById('slot-' + key + '-en');
      zh.addEventListener('input', function () { onFieldInput(key, 'zh', zh.value); });
      en.addEventListener('input', function () { onFieldInput(key, 'en', en.value); });
      [zh, en].forEach(function (area) {
        const lang = area.getAttribute('data-lang');
        const token = key + '-' + lang;
        area.addEventListener('compositionstart', function () {
          state.composing[token] = true;
        });
        area.addEventListener('compositionend', function () {
          state.composing[token] = false;
          onFieldInput(key, lang, area.value);
        });
      });
    });

    el.slotGrid.querySelectorAll('[data-clear-slot]').forEach(function (button) {
      button.addEventListener('click', function () {
        clearSlot(button.getAttribute('data-clear-slot'));
      });
    });
  }

  function setStatus(message, isError) {
    el.parseStatus.textContent = message || '';
    el.parseStatus.classList.toggle('is-error', !!isError);
  }

  function updateIdeaCount() {
    const len = el.idea.value.length;
    el.ideaCount.textContent = len + ' / 1600';
  }

  function slotTextareas(key) {
    return {
      zh: document.getElementById('slot-' + key + '-zh'),
      en: document.getElementById('slot-' + key + '-en')
    };
  }

  function writeField(key, lang, value, syncState) {
    const fields = slotTextareas(key);
    if (fields[lang] && fields[lang].value !== value) fields[lang].value = value;
    if (syncState !== false) state.slots[key][lang] = value;
  }

  function writeSlotToDom(key) {
    const slot = state.slots[key];
    writeField(key, 'zh', slot.zh || '');
    writeField(key, 'en', slot.en || '');
  }

  function writeAllSlotsToDom() {
    SF.slots.forEach(writeSlotToDom);
  }

  function setHint(key, message, isWarning) {
    const hint = el.slotGrid.querySelector('[data-sync-hint="' + key + '"]');
    if (!hint) return;
    hint.textContent = message || '';
    hint.classList.toggle('is-warning', !!isWarning);
  }

  function onFieldInput(key, lang, value) {
    state.slots[key][lang] = value;
    if (state.composing[key + '-' + lang]) return;
    if (lang === 'zh') state.slots[key].zh = value;
    else state.slots[key].en = value;

    refreshCompletionUI(key);
    setHint(key, lang === 'zh' ? '正在按词典同步英文…' : '正在按词典同步中文…', false);

    clearTimeout(state.timers[key]);
    state.timers[key] = setTimeout(function () {
      syncField(key, lang, value);
    }, 330);
  }

  function syncField(key, lang, value) {
    if (!value.trim()) {
      setHint(key, lang === 'zh' ? '中文为空，英文保留未动' : '英文为空，中文保留未动', false);
      return;
    }

    if (lang === 'zh') {
      const result = TR.translateZh(value);
      if (result.en) {
        const current = state.slots[key].en;
        if (current !== result.en) {
          state.slots[key].en = result.en;
          writeField(key, 'en', result.en);
        }
        state.unknownBySlot[key] = result.unknown.slice();
        updateWarningFromState();
        if (result.unknown.length) {
          setHint(
            key,
            '未收录：' + result.unknown.join('、') + '。已保留原文，可直接改英文。',
            true
          );
        } else {
          setHint(key, '已按词典同步英文', false);
        }
      } else {
        setHint(key, '没有找到可对应的词典词，英文保留未动。可直接改英文。', true);
      }
    } else {
      if (U.hasCjk(value)) {
        setHint(key, '英文框里还有中文，中文未自动覆盖；可直接修改中文或英文。', true);
        refreshCompletionUI(key);
        return;
      }
      const result = TR.translateEn(value);
      state.unknownBySlot[key] = result.unknown.slice();
      updateWarningFromState();
      if (result.zh && result.unknown.length === 0) {
        if (state.slots[key].zh !== result.zh) {
          state.slots[key].zh = result.zh;
          writeField(key, 'zh', result.zh);
        }
        setHint(key, '已按词典同步中文', false);
      } else if (result.unknown.length) {
        setHint(
          key,
          '未收录：' + result.unknown.join('、') + '。中文保留当前内容，未擅自清空。',
          true
        );
      } else {
        setHint(key, '没有匹配到完整词典短语，中文保留当前内容。', true);
      }
    }

    refreshCompletionUI(key);
  }

  function activeCompletions(key) {
    const slot = state.slots[key];
    return (slot.completionItems || []).filter(function (item) {
      const zhHit = item.zh && slot.zh && slot.zh.indexOf(item.zh) !== -1;
      const enHit = item.en && slot.en && slot.en.toLowerCase().indexOf(item.en.toLowerCase()) !== -1;
      return !!(zhHit || enHit);
    });
  }

  function refreshCompletionUI(key) {
    const slot = state.slots[key];
    const badge = el.slotGrid.querySelector('[data-completion-badge="' + key + '"]');
    const panel = el.slotGrid.querySelector('[data-completion-panel="' + key + '"]');
    const list = el.slotGrid.querySelector('[data-completion-list="' + key + '"]');
    if (!badge || !panel || !list) return;

    const items = activeCompletions(key);
    if (!items.length) {
      badge.hidden = true;
      panel.hidden = true;
      list.innerHTML = '';
      return;
    }

    badge.hidden = false;
    badge.textContent = '补全 ' + items.length;
    panel.hidden = false;
    list.innerHTML = items.map(function (item) {
      return (
        '<li>' +
          '<span>' + escapeHtml(item.zh) + '</span>' +
          '<code>' + escapeHtml(item.en) + '</code>' +
          (item.reason ? '<span class="completion-reason">' + escapeHtml(item.reason) + '</span>' : '') +
        '</li>'
      );
    }).join('');
    if (!slot.zh && !slot.en) {
      badge.hidden = true;
      panel.hidden = true;
    }
  }

  function refreshAllCompletionUI() {
    SF.slots.forEach(refreshCompletionUI);
  }

  function showWarning(unknown) {
    if (!unknown || !unknown.length) {
      el.warningBanner.hidden = true;
      el.warningText.textContent = '';
      return;
    }
    el.warningBanner.hidden = false;
    el.warningText.textContent =
      '未收录：' + unknown.join('、') + '。这些原文已保留在英文框里，没有被清空，也已自动记入本机「待补录」，不用再手抄。' +
      '你可以直接改英文，或点「查看待补录」写备注并导出给大肥鱼补词。';
  }

  function updateWarningFromState() {
    const all = [];
    SF.slots.forEach(function (key) {
      (state.unknownBySlot[key] || []).forEach(function (u) {
        if (!all.includes(u)) all.push(u);
      });
    });
    showWarning(all);
  }

  function hideOutput() {
    el.outputSection.hidden = true;
    state.generated = null;
  }

  // ─────────────────────────────────────────────────────────────
  // 本地收藏 / 历史 / 搜索 / 预览
  // ─────────────────────────────────────────────────────────────

  function loadStore(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      state.storageOK = false;
      return [];
    }
  }

  function saveStore(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      state.storageOK = false;
      return false;
    }
  }

  function updateLibraryCounts() {
    el.favoriteCount.textContent = String(state.favorites.length);
    el.historyCount.textContent = String(state.history.length);
  }

  function formatSavedAt(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return '';
    const pad = function (n) { return String(n).padStart(2, '0'); };
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    return (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function makeRecordTitle(idea, positiveEn) {
    const source = String(idea || positiveEn || '').replace(/\s+/g, ' ').trim();
    if (!source) return '未命名提示词';
    return source.length > 38 ? source.slice(0, 38) + '…' : source;
  }

  function readSlotsFromDom() {
    SF.slots.forEach(function (key) {
      const fields = slotTextareas(key);
      state.slots[key].zh = fields.zh.value;
      state.slots[key].en = fields.en.value;
    });
  }

  function serializeSlots() {
    const out = {};
    SF.slots.forEach(function (key) {
      const slot = state.slots[key];
      out[key] = {
        zh: slot.zh || '',
        en: slot.en || '',
        completionItems: (slot.completionItems || []).map(function (item) {
          return { zh: item.zh, en: item.en, reason: item.reason || '' };
        })
      };
    });
    return out;
  }

  function snapshotCurrent() {
    readSlotsFromDom();
    const hasContent = el.idea.value.trim() || SF.slots.some(function (key) {
      return state.slots[key].zh.trim() || state.slots[key].en.trim();
    });
    if (!hasContent) return null;

    ensureEnglishForAllSlots();
    const assembled = Assemble.assemble(state.slots);
    const negative = Negative.build(assembled.positiveEn);
    return {
      version: 1,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: makeRecordTitle(el.idea.value, assembled.positiveEn),
      idea: el.idea.value,
      slots: serializeSlots(),
      positiveEn: assembled.positiveEn,
      positiveZh: assembled.positiveZh,
      negativeEn: negative.negativeEn,
      negativeZh: negative.negativeZh,
      phraseCount: assembled.phraseCount,
      savedAt: Date.now()
    };
  }

  function persistLibrary() {
    const okFavorites = saveStore(STORAGE_KEYS.favorites, state.favorites);
    const okHistory = saveStore(STORAGE_KEYS.history, state.history);
    if (!okFavorites || !okHistory) state.storageOK = false;
    updateLibraryCounts();
  }

  function updateFeedbackCount() {
    if (el.feedbackCount) el.feedbackCount.textContent = String(state.feedback.length);
  }

  function persistFeedback() {
    let ok = false;
    try {
      ok = Feedback.saveTo(window.localStorage, state.feedback);
    } catch (err) {
      ok = false;
    }
    if (!ok) state.storageOK = false;
    updateFeedbackCount();
    return ok;
  }

  // 打开弹层前按当前词库重新判断：新冻结版发布后，已经能命中的词会被标出来。
  function feedbackCovered(term) {
    return Feedback.isCovered(term, TR);
  }

  function collectFeedback(ideaText) {
    const map = state.unknownBySlot;
    if (!Feedback.occurrencesFromUnknownMap(map).length) return;
    const fallbackIdea = SF.slots.map(function (key) {
      return state.slots[key].zh || state.slots[key].en || '';
    }).filter(Boolean).join('，');
    const contextIdea = String(ideaText || '').trim() || fallbackIdea;
    if (!contextIdea) return;
    state.feedback = Feedback.recordUnknownTerms(state.feedback, map, {
      idea: contextIdea,
      source: Feedback.sourceLabel(),
      at: new Date().toISOString()
    });
    persistFeedback();
  }

  function recomputeUnknownBySlot() {
    const map = Object.create(null);
    SF.slots.forEach(function (key) {
      const slot = state.slots[key];
      const unknown = [];
      if (slot.zh && slot.zh.trim()) {
        const result = U.hasCjk(slot.zh)
          ? TR.translateZh(slot.zh)
          : (slot.en.trim() ? TR.translateEn(slot.en) : TR.translateZh(slot.zh));
        (result.unknown || []).forEach(function (item) {
          if (Feedback.isMeaningfulTerm(item) && !unknown.includes(item)) unknown.push(item);
        });
      } else if (slot.en && slot.en.trim()) {
        const result = TR.translateEn(slot.en);
        (result.unknown || []).forEach(function (item) {
          if (Feedback.isMeaningfulTerm(item) && !unknown.includes(item)) unknown.push(item);
        });
      }
      map[key] = unknown;
    });
    state.unknownBySlot = map;
    return map;
  }

  function formatFeedbackTime(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function feedbackSlotText(entry) {
    return (entry.slotHints || []).map(function (slot) {
      return Feedback.slotLabels[slot] || slot;
    }).join('、') || '未标注';
  }

  function renderFeedback() {
    if (!el.feedbackList) return;
    const rows = state.feedback.map(function (entry) {
      return { entry: entry, covered: feedbackCovered(entry.term) };
    });
    const coveredCount = rows.filter(function (row) { return row.covered; }).length;
    const totalCount = rows.reduce(function (sum, row) { return sum + row.entry.count; }, 0);

    if (!rows.length) {
      el.feedbackSummary.textContent = '还没有待补录词。遇到未收录内容时，页面会自动记在这里。';
    } else {
      el.feedbackSummary.textContent =
        '共 ' + rows.length + ' 个待补录词，累计出现 ' + totalCount + ' 次' +
        (coveredCount ? '；其中 ' + coveredCount + ' 个当前词库已可命中，可移除。' : '。');
    }

    const empty = rows.length === 0;
    [el.copyFeedbackBtn, el.downloadFeedbackBtn, el.issueFeedbackBtn, el.clearFeedbackBtn].forEach(function (button) {
      if (button) button.disabled = empty;
    });

    if (empty) {
      el.feedbackList.innerHTML =
        '<div class="feedback-empty"><strong>暂无待补录</strong>' +
        '下次拆解想法或生成提示词时，未收录片段会自动记录，同一词只留一条并累计次数。</div>';
    } else {
      el.feedbackList.innerHTML = rows.map(function (row) {
        const entry = row.entry;
        const contexts = (entry.contexts || []).map(function (context) {
          const where = context.slotLabel || Feedback.slotLabels[context.slot] || '未标注框';
          return (
            '<li>' +
              '<span class="feedback-context-time">' + escapeHtml(formatFeedbackTime(context.at)) + ' · ' + escapeHtml(where) + '</span>' +
              '<p class="feedback-context-text">' + escapeHtml(context.idea) + '</p>' +
            '</li>'
          );
        }).join('');
        return (
          '<article class="feedback-card">' +
            '<div class="feedback-card-head">' +
              '<div class="feedback-card-main">' +
                '<h3 class="feedback-term">' + escapeHtml(entry.term) + '</h3>' +
                '<p class="feedback-meta">出现 ' + entry.count + ' 次 · 最近更新 ' + escapeHtml(formatFeedbackTime(entry.updatedAt)) + '</p>' +
                (row.covered ? '<p class="feedback-covered">词库已可命中，可移除</p>' : '') +
                '<p class="feedback-slots">可能所在框：' + escapeHtml(feedbackSlotText(entry)) + '</p>' +
              '</div>' +
              '<button type="button" class="record-action danger" data-remove-feedback="' + escapeHtml(entry.term) + '">删除</button>' +
            '</div>' +
            (contexts
              ? '<div class="feedback-contexts"><h4>最近上下文（完整想法原文）</h4><ol>' + contexts + '</ol></div>'
              : '<p class="feedback-slots">还没有保存到想法原文。</p>') +
            '<label class="feedback-note-label">备注（大概是什么意思 / 想译成什么英文 / 属于哪一类）' +
              '<textarea class="feedback-note" data-feedback-note="' + escapeHtml(entry.term) + '" rows="2" maxlength="' + Feedback.NOTE_MAX + '" placeholder="例如：大概是一种发光的蝴蝶 / 想译成 glowing butterfly / 属于场景元素">' +
                escapeHtml(entry.note || '') +
              '</textarea>' +
            '</label>' +
          '</article>'
        );
      }).join('');
    }

    el.feedbackStorageNote.textContent = state.storageOK
      ? '待补录保存在本浏览器 localStorage（' + Feedback.STORAGE_KEY + '）；清理浏览器数据会丢失。导出 JSON 后即可交给大肥鱼。'
      : '当前浏览器不允许本地存储或空间已满，待补录只在本次页面中有效；请尽快复制或下载清单。';
  }

  function openFeedback() {
    el.searchResults.hidden = true;
    renderFeedback();
    openModal(el.feedbackModal);
  }

  function feedbackExportData() {
    return Feedback.exportFeedback(state.feedback, {
      now: new Date(),
      source: Feedback.sourceLabel()
    });
  }

  function copyFeedback() {
    if (!state.feedback.length) {
      showToast('还没有待补录词');
      return;
    }
    const text = Feedback.markdownFor(feedbackExportData(), {
      isCovered: feedbackCovered
    });
    copyText(text).then(function (ok) {
      showToast(ok ? '已复制补录清单（Markdown + JSON）' : '复制失败，请用「下载 JSON」');
    });
  }

  function downloadFeedback() {
    if (!state.feedback.length) {
      showToast('还没有待补录词');
      return;
    }
    const data = feedbackExportData();
    const blob = new Blob([Feedback.toJson(data)], { type: 'application/json;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = Feedback.filenameFor(new Date());
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(href); }, 1200);
    showToast('已下载 ' + link.download);
  }

  function openGithubFeedback() {
    if (!state.feedback.length) {
      showToast('还没有待补录词');
      return;
    }
    const url = Feedback.issueUrlFor(feedbackExportData(), {
      isCovered: feedbackCovered
    });
    const opened = window.open(url, '_blank');
    if (opened) {
      try { opened.opener = null; } catch (err) { /* 忽略跨域限制 */ }
    } else {
      showToast('浏览器拦截了新标签页，请允许弹窗后再试');
    }
  }

  function removeFeedbackTerm(term) {
    state.feedback = Feedback.removeTerm(state.feedback, term);
    persistFeedback();
    renderFeedback();
    showToast('已移除「' + term + '」');
  }

  function clearFeedback() {
    if (!state.feedback.length) return;
    if (window.confirm && !window.confirm('确定清空全部待补录词？清空后无法恢复。')) return;
    state.feedback = [];
    persistFeedback();
    renderFeedback();
    showToast('已清空待补录');
  }

  function saveFavorite() {
    const snapshot = snapshotCurrent();
    if (!snapshot) {
      showToast('先写点想法或填写任一框，再收藏');
      return;
    }
    const existing = state.favorites.findIndex(function (item) {
      return item.idea === snapshot.idea && item.positiveEn === snapshot.positiveEn;
    });
    if (existing >= 0) {
      snapshot.id = state.favorites[existing].id;
      state.favorites.splice(existing, 1);
    }
    state.favorites.unshift(snapshot);
    state.favorites = state.favorites.slice(0, 40);
    persistLibrary();
    if (state.storageOK) {
      showToast('已收藏，可在收藏夹再次打开');
    } else {
      showToast('已收藏（本地存储不可用，仅在本次页面有效）');
    }
  }

  function recordHistory() {
    if (!state.generated) return;
    const snapshot = snapshotCurrent();
    if (!snapshot) return;
    const existing = state.history.findIndex(function (item) {
      return item.idea === snapshot.idea && item.positiveEn === snapshot.positiveEn;
    });
    if (existing >= 0) {
      snapshot.id = state.history[existing].id;
      state.history.splice(existing, 1);
    }
    state.history.unshift(snapshot);
    state.history = state.history.slice(0, 30);
    persistLibrary();
  }

  function loadRecord(record) {
    if (!record || !record.slots) return;
    const fresh = SF.emptySlots();
    SF.slots.forEach(function (key) {
      const saved = record.slots[key] || {};
      fresh[key].zh = typeof saved.zh === 'string' ? saved.zh : '';
      fresh[key].en = typeof saved.en === 'string' ? saved.en : '';
      fresh[key].completionItems = Array.isArray(saved.completionItems)
        ? saved.completionItems.map(function (item) {
          return { zh: item.zh || '', en: item.en || '', reason: item.reason || '' };
        })
        : [];
      fresh[key].items = [];
    });

    state.slots = fresh;
    state.unknownBySlot = Object.create(null);
    el.idea.value = record.idea || '';
    updateIdeaCount();
    writeAllSlotsToDom();
    SF.slots.forEach(function (key) {
      setHint(key, '已从' + (state.libraryTab === 'favorites' ? '收藏夹' : '历史') + '打开，可继续修改。', false);
    });
    refreshAllCompletionUI();
    showWarning([]);
    hideOutput();
    el.searchResults.hidden = true;
    closeAllModals();
    setStatus('已打开「' + (record.title || '未命名') + '」，正在按当前内容重新生成…', false);
    generate();
  }

  function deleteRecord(collection, id) {
    const list = collection === 'favorites' ? state.favorites : state.history;
    const next = list.filter(function (item) { return item.id !== id; });
    if (collection === 'favorites') state.favorites = next;
    else state.history = next;
    persistLibrary();
    renderLibrary();
    showToast(collection === 'favorites' ? '已取消收藏' : '已删除这条历史');
  }

  function renderLibrary() {
    const isFavorites = state.libraryTab === 'favorites';
    el.favoritesTab.classList.toggle('is-active', isFavorites);
    el.historyTab.classList.toggle('is-active', !isFavorites);
    el.favoritesTab.setAttribute('aria-selected', String(isFavorites));
    el.historyTab.setAttribute('aria-selected', String(!isFavorites));

    const list = isFavorites ? state.favorites : state.history;
    if (!list.length) {
      el.libraryBody.innerHTML =
        '<div class="empty-state"><strong>' +
        (isFavorites ? '还没有收藏' : '还没有历史记录') +
        '</strong>' +
        (isFavorites
          ? '点「收藏当前」把想法、六个框和最终提示词一起保存在本机。'
          : '生成一次提示词后，想法和结果会自动保存在这里。') +
        '</div>';
    } else {
      el.libraryBody.innerHTML = '<div class="record-list">' + list.map(function (record) {
        const preview = String(record.idea || record.positiveEn || '').replace(/\s+/g, ' ').trim();
        return (
          '<article class="record-card">' +
            '<div class="record-main">' +
              '<p class="record-title">' + escapeHtml(record.title || '未命名提示词') + '</p>' +
              '<p class="record-meta">' + escapeHtml(formatSavedAt(record.savedAt)) +
                (record.phraseCount ? ' · ' + record.phraseCount + ' 个短语' : '') + '</p>' +
              '<p class="record-preview">' + escapeHtml(preview || '（没有想法文本）') + '</p>' +
            '</div>' +
            '<div class="record-actions">' +
              '<button type="button" class="record-action" data-load-record="' + escapeHtml(record.id) + '" data-record-collection="' + (isFavorites ? 'favorites' : 'history') + '">打开</button>' +
              '<button type="button" class="record-action danger" data-delete-record="' + escapeHtml(record.id) + '" data-record-collection="' + (isFavorites ? 'favorites' : 'history') + '">删除</button>' +
            '</div>' +
          '</article>'
        );
      }).join('') + '</div>';
    }

    el.storageNote.textContent = state.storageOK
      ? '收藏与历史保存在本浏览器 localStorage；清理浏览器数据后会丢失。'
      : '当前浏览器不允许本地存储或空间已满，收藏与历史只在本次页面中有效。';
  }

  function openLibrary(tab) {
    state.libraryTab = tab;
    el.searchResults.hidden = true;
    renderLibrary();
    openModal(el.libraryModal);
  }

  function openModal(modal) {
    if (!modal) return;
    const anyOpen = Array.prototype.some.call(document.querySelectorAll('.modal'), function (item) {
      return !item.hidden;
    });
    if (!anyOpen) state.lastFocused = document.activeElement;
    Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (item) {
      if (item !== modal) item.hidden = true;
    });
    modal.hidden = false;
    document.body.classList.add('modal-open');
    const close = modal.querySelector('.modal-close');
    if (close) setTimeout(function () { close.focus(); }, 30);
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    const anyOpen = Array.prototype.some.call(document.querySelectorAll('.modal'), function (item) {
      return !item.hidden;
    });
    if (!anyOpen) {
      document.body.classList.remove('modal-open');
      if (state.lastFocused && typeof state.lastFocused.focus === 'function') {
        try { state.lastFocused.focus(); } catch (err) { /* ignore */ }
      }
    }
  }

  function closeAllModals() {
    Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (modal) {
      modal.hidden = true;
    });
    document.body.classList.remove('modal-open');
  }

  function renderPreview() {
    if (!state.generated) return false;
    const positive = state.generated.positive;
    const negative = state.generated.negative;
    el.previewPositiveEn.textContent = positive.positiveEn;
    el.previewPositiveZh.textContent = positive.positiveZh || '（无中文对照）';
    el.previewNegativeEn.textContent = negative.negativeEn;
    el.previewNegativeZh.textContent = negative.negativeZh || '（无中文对照）';
    return true;
  }

  function openPreview() {
    el.searchResults.hidden = true;
    if (!state.generated || !renderPreview()) {
      showToast('先生成一次提示词，再预览完整对照');
      return;
    }
    openModal(el.previewModal);
  }

  function slotLabelOf(key) {
    const found = SF.definitions.find(function (def) { return def.key === key; });
    return found ? found.label : key;
  }

  function addEntryToSlot(entry) {
    const key = T2I.Lexicon.slotOfCategory[entry.category];
    if (!key || SF.slots.indexOf(key) === -1) {
      showToast('这个词条没有对应的六个框，可直接在搜索里查看');
      return;
    }
    const slot = state.slots[key];
    const zh = String(entry.zh || '');
    const en = String(entry.en || '');
    if (zh && slot.zh.indexOf(zh) === -1) slot.zh = U.joinPhrasesZh([slot.zh, zh]);
    if (en && slot.en.toLowerCase().indexOf(en.toLowerCase()) === -1) slot.en = U.joinPhrasesEn([slot.en, en]);
    writeSlotToDom(key);
    refreshCompletionUI(key);
    setHint(key, '已从词库加入「' + zh + '」。', false);
    el.searchResults.hidden = true;
    const card = el.slotGrid.querySelector('[data-slot-card="' + key + '"]');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('已加入「' + slotLabelOf(key) + '」');
  }

  function searchRecords(list, q) {
    const needle = q.toLowerCase();
    return list.filter(function (record) {
      const haystack = [
        record.title || '',
        record.idea || '',
        record.positiveEn || '',
        record.positiveZh || '',
        record.negativeEn || '',
        record.negativeZh || ''
      ].join(' ').toLowerCase();
      if (haystack.indexOf(needle) !== -1) return true;
      if (!record.slots) return false;
      return Object.keys(record.slots).some(function (key) {
        const slot = record.slots[key] || {};
        return String(slot.zh || '').toLowerCase().indexOf(needle) !== -1 ||
          String(slot.en || '').toLowerCase().indexOf(needle) !== -1;
      });
    });
  }

  function renderSearchResults(query) {
    const q = String(query || '').trim();
    if (!q) {
      el.searchResults.hidden = true;
      el.searchResults.innerHTML = '';
      el.searchClear.hidden = true;
      return;
    }
    el.searchClear.hidden = false;
    const needle = q.toLowerCase();
    const L = T2I.Lexicon;

    const lexHits = [];
    for (let i = 0; i < L.entries.length; i += 1) {
      const entry = L.entries[i];
      let hit = entry.zh.indexOf(q) !== -1 || entry.en.toLowerCase().indexOf(needle) !== -1;
      if (!hit) hit = entry.zhAliases.some(function (a) { return a.toLowerCase().indexOf(needle) !== -1; });
      if (!hit) hit = entry.enAliases.some(function (a) { return a.toLowerCase().indexOf(needle) !== -1; });
      if (!hit) continue;
      let score = entry.generated ? 0 : 5;
      if (entry.zh === q || entry.en.toLowerCase() === needle) score += 100;
      else if (entry.zh.indexOf(q) === 0 || entry.en.toLowerCase().indexOf(needle) === 0) score += 20;
      score += Math.min(5, entry.zh.length / 4);
      lexHits.push({ entry: entry, score: score });
    }
    lexHits.sort(function (a, b) { return b.score - a.score; });
    const lexTop = lexHits.slice(0, 12);

    const slotHits = [];
    SF.slots.forEach(function (key) {
      const slot = state.slots[key];
      const zh = slot.zh || '';
      const en = slot.en || '';
      if (zh.toLowerCase().indexOf(needle) !== -1 || en.toLowerCase().indexOf(needle) !== -1) {
        slotHits.push({ key: key, zh: zh, en: en });
      }
    });

    const favoriteHits = searchRecords(state.favorites, q).slice(0, 4);
    const historyHits = searchRecords(state.history, q).slice(0, 4);

    function group(title, count, inner) {
      return '<div class="search-group"><h4><span>' + title + '</span><span>' + count + '</span></h4>' + inner + '</div>';
    }

    const groups = [];
    if (lexTop.length) {
      groups.push(group('词库', lexHits.length + ' 个命中，显示前 ' + lexTop.length + ' 个', lexTop.map(function (hit) {
        const entry = hit.entry;
        const slot = T2I.Lexicon.slotOfCategory[entry.category];
        return (
          '<div class="search-item">' +
            '<div class="search-item-main">' +
              '<div class="search-item-title"><span>' + escapeHtml(entry.zh) + '</span>' +
                '<span class="search-item-cat">' + escapeHtml(T2I.Lexicon.categoryLabel[entry.category] || entry.category) + '</span></div>' +
              '<span class="search-item-en">' + escapeHtml(entry.en) + '</span>' +
            '</div>' +
            (slot
              ? '<button type="button" class="search-item-action" data-search-action="fill-entry" data-entry-id="' + escapeHtml(entry.id) + '">填入' + escapeHtml(slotLabelOf(slot)) + '</button>'
              : '') +
          '</div>'
        );
      }).join('')));
    }
    if (slotHits.length) {
      groups.push(group('已填框内容', slotHits.length + ' 个框', slotHits.map(function (hit) {
        return (
          '<div class="search-item">' +
            '<div class="search-item-main">' +
              '<div class="search-item-title"><span>' + escapeHtml(slotLabelOf(hit.key)) + '</span></div>' +
              '<p class="search-item-snippet">' + escapeHtml((hit.zh || hit.en).slice(0, 120)) + '</p>' +
            '</div>' +
            '<button type="button" class="search-item-action" data-search-action="locate-slot" data-slot="' + escapeHtml(hit.key) + '">定位</button>' +
          '</div>'
        );
      }).join('')));
    }
    if (favoriteHits.length) {
      groups.push(group('收藏', favoriteHits.length + ' 条', favoriteHits.map(function (record) {
        return (
          '<div class="search-item">' +
            '<div class="search-item-main">' +
              '<div class="search-item-title"><span>' + escapeHtml(record.title || '未命名') + '</span></div>' +
              '<p class="search-item-snippet">' + escapeHtml(String(record.idea || record.positiveEn || '').slice(0, 110)) + '</p>' +
            '</div>' +
            '<button type="button" class="search-item-action" data-search-action="load-record" data-record-collection="favorites" data-record-id="' + escapeHtml(record.id) + '">打开</button>' +
          '</div>'
        );
      }).join('')));
    }
    if (historyHits.length) {
      groups.push(group('历史', historyHits.length + ' 条', historyHits.map(function (record) {
        return (
          '<div class="search-item">' +
            '<div class="search-item-main">' +
              '<div class="search-item-title"><span>' + escapeHtml(record.title || '未命名') + '</span></div>' +
              '<p class="search-item-snippet">' + escapeHtml(String(record.idea || record.positiveEn || '').slice(0, 110)) + '</p>' +
            '</div>' +
            '<button type="button" class="search-item-action" data-search-action="load-record" data-record-collection="history" data-record-id="' + escapeHtml(record.id) + '">打开</button>' +
          '</div>'
        );
      }).join('')));
    }

    if (!groups.length) {
      el.searchResults.innerHTML = '<p class="search-empty">没有找到。可以试试更短的中文词或英文提示词。</p>';
    } else {
      el.searchResults.innerHTML = groups.join('');
    }
    el.searchResults.hidden = false;
  }

  function handleSearchAction(button) {
    const action = button.getAttribute('data-search-action');
    if (action === 'fill-entry') {
      const id = button.getAttribute('data-entry-id');
      const entry = T2I.Lexicon.entries.find(function (item) { return item.id === id; });
      if (entry) addEntryToSlot(entry);
      return;
    }
    if (action === 'locate-slot') {
      const key = button.getAttribute('data-slot');
      el.searchResults.hidden = true;
      const card = el.slotGrid.querySelector('[data-slot-card="' + key + '"]');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(function () {
          const fields = slotTextareas(key);
          if (fields.zh) fields.zh.focus({ preventScroll: true });
        }, 350);
      }
      return;
    }
    if (action === 'load-record') {
      const collection = button.getAttribute('data-record-collection');
      const id = button.getAttribute('data-record-id');
      const list = collection === 'favorites' ? state.favorites : state.history;
      const record = list.find(function (item) { return item.id === id; });
      if (record) {
        state.libraryTab = collection === 'favorites' ? 'favorites' : 'history';
        loadRecord(record);
      }
    }
  }

  function runFill() {
    const idea = el.idea.value.trim();
    if (!idea) {
      setStatus('先写一句整体想法，再点「补全并填入各框」。', true);
      el.idea.focus();
      return;
    }

    const parsed = Parser.parse(idea);

    if (!parsed.segments.length) {
      state.slots = SF.emptySlots();
      state.unknownBySlot = Object.create(null);
      writeAllSlotsToDom();
      updateWarningFromState();
      hideOutput();
      setStatus('这段想法暂时没能拆出可用的提示词片段，试试用「人物、穿着、站在、光线、风格」这类词分隔。', true);
      return;
    }

    const filled = SF.fill(parsed);
    const completed = Complete.complete(filled.slots);
    state.slots = completed.slots;
    state.parsed = parsed;
    state.unknownBySlot = Object.create(null);
    SF.slots.forEach(function (key) {
      state.unknownBySlot[key] = [];
      state.slots[key].items.forEach(function (item) {
        (item.unknown || []).forEach(function (u) {
          if (!state.unknownBySlot[key].includes(u)) state.unknownBySlot[key].push(u);
        });
      });
    });

    writeAllSlotsToDom();
    updateWarningFromState();
    collectFeedback(idea);
    hideOutput();

    const counts = {};
    SF.slots.forEach(function (key) { counts[key] = state.slots[key].items.length; });
    const segmentCount = parsed.segments.length;
    const completionCount = completed.added.length;
    const summary = SF.definitions
      .map(function (def) { return def.label.replace(/与.*/, '') + ' ' + counts[def.key]; })
      .join(' · ');

    if (!segmentCount) {
      setStatus('这段想法暂时没能拆出可用的提示词片段，试试用「人物、穿着、站在、光线、风格」这类词分隔。', true);
    } else {
      setStatus(
        '已拆成 ' + segmentCount + ' 个片段（' + summary + '），规则补全 ' +
        completionCount + ' 项。补全内容在框下方标出，可直接改或删。',
        false
      );
    }

    SF.slots.forEach(function (key) {
      const count = counts[key];
      const added = state.slots[key].completionItems.length;
      if (count) {
        setHint(
          key,
          '由想法拆出 ' + count + ' 条' + (added ? '，其中 ' + added + ' 条为补全' : '') +
          '。修改中文或英文会自动尝试对齐。',
          false
        );
      } else {
        setHint(key, '这个框没有从想法里拆到内容。', false);
      }
    });

    refreshAllCompletionUI();

    setTimeout(function () {
      const target = document.getElementById('workflow-title');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 90);
  }

  function clearAll() {
    state.slots = SF.emptySlots();
    state.parsed = null;
    state.generated = null;
    state.unknownBySlot = Object.create(null);
    el.idea.value = '';
    updateIdeaCount();
    writeAllSlotsToDom();
    SF.slots.forEach(function (key) {
      const fields = slotTextareas(key);
      fields.zh.value = '';
      fields.en.value = '';
      setHint(key, '', false);
    });
    updateWarningFromState();
    hideOutput();
    setStatus('已清空。', false);
    el.idea.focus();
    refreshAllCompletionUI();
  }

  function clearSlot(key) {
    state.slots[key] = {
      key: key,
      label: state.slots[key].label,
      items: [],
      completionItems: [],
      zh: '',
      en: '',
      unknown: []
    };
    const fields = slotTextareas(key);
    fields.zh.value = '';
    fields.en.value = '';
    state.unknownBySlot[key] = [];
    updateWarningFromState();
    setHint(key, '本框已清空。', false);
    refreshCompletionUI(key);
  }

  function ensureEnglishForAllSlots() {
    const unknownAll = [];
    SF.slots.forEach(function (key) {
      const slot = state.slots[key];
      if (!slot.en.trim() && slot.zh.trim()) {
        const result = TR.translateZh(slot.zh);
        slot.en = result.en || '';
        writeField(key, 'en', slot.en);
        state.unknownBySlot[key] = result.unknown.slice();
        result.unknown.forEach(function (u) {
          if (!unknownAll.includes(u)) unknownAll.push(u);
        });
      }
      if (!slot.en.trim() && !slot.zh.trim()) {
        const fields = slotTextareas(key);
        slot.en = fields.en.value.trim();
        slot.zh = fields.zh.value.trim();
      }
    });
    return unknownAll;
  }

  function generate() {
    SF.slots.forEach(function (key) {
      const fields = slotTextareas(key);
      state.slots[key].zh = fields.zh.value;
      state.slots[key].en = fields.en.value;
    });

    recomputeUnknownBySlot();
    ensureEnglishForAllSlots();
    const assembled = Assemble.assemble(state.slots);
    if (!assembled.positiveEn.trim()) {
      setStatus('六个框还是空的。先在上方写整体想法并「补全并填入各框」，或直接填写任一框。', true);
      el.idea.focus();
      return;
    }

    const negative = Negative.build(assembled.positiveEn);
    state.generated = { positive: assembled, negative: negative };

    el.positiveEn.value = assembled.positiveEn;
    el.positiveZh.textContent = assembled.positiveZh || '（中文框为空，暂无可对照内容）';
    el.negativeEn.value = negative.negativeEn;
    el.negativeZh.textContent = negative.negativeZh;
    el.outputMeta.textContent =
      assembled.phraseCount + ' 个正面短语 · ' + negative.items.length + ' 个负面词' +
      (assembled.quality.length ? ' · 补全质量词 ' + assembled.quality.length + ' 个' : '');
    el.outputFootnote.textContent = assembled.quality.length
      ? '末尾质量词为算法补全：' + assembled.quality.join(', ') + '（中文：' + assembled.qualityZh.join('，') + '）。'
      : '正面已包含常用质量词，未重复添加。';

    el.outputSection.hidden = false;
    autoSizePrompt(el.positiveEn);
    autoSizePrompt(el.negativeEn);
    setTimeout(function () {
      autoSizePrompt(el.positiveEn);
      autoSizePrompt(el.negativeEn);
    }, 60);
    updateWarningFromState();
    collectFeedback(el.idea.value);
    if (assembled.hasUntranslated) {
      showToast('提示词里仍保留未收录中文，建议在英文框里改写');
    } else {
      setStatus('已生成正面与负面提示词。复制英文即可粘贴到 SDXL / ComfyUI。', false);
    }

    recordHistory();

    setTimeout(function () {
      el.outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  function autoSizePrompt(area) {
    if (!area) return;
    const rows = area.rows;
    area.rows = 1;
    area.style.height = '0px';
    const contentHeight = area.scrollHeight + 4;
    area.style.height = Math.min(Math.max(contentHeight, 108), 460) + 'px';
    area.rows = rows;
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('is-visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      el.toast.classList.remove('is-visible');
    }, 1800);
  }

  function fallbackCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, area.value.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }).catch(function () {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function handleCopy(button) {
    const type = button.getAttribute('data-copy');
    if (!state.generated) return;
    const text = type === 'negative'
      ? state.generated.negative.negativeEn
      : state.generated.positive.positiveEn;
    const label = button.querySelector('.copy-label');
    const original = label ? label.textContent : '复制英文';

    copyText(text).then(function (ok) {
      if (ok) {
        showToast(type === 'negative' ? '已复制负面提示词' : '已复制正面提示词');
        if (label) {
          label.textContent = '已复制';
          button.classList.add('is-copied');
          setTimeout(function () {
            label.textContent = original;
            button.classList.remove('is-copied');
          }, 1600);
        }
      } else {
        showToast('复制失败，请长按文本框全选复制');
        const area = type === 'negative' ? el.negativeEn : el.positiveEn;
        area.focus();
        area.select();
      }
    });
  }

  function applyExample(index) {
    const text = EXAMPLES[index];
    if (!text) return;
    el.idea.value = text;
    updateIdeaCount();
    runFill();
  }

  function bindStaticEvents() {
    el.fillBtn.addEventListener('click', runFill);
    el.resetBtn.addEventListener('click', clearAll);
    el.generateBtn.addEventListener('click', generate);
    el.idea.addEventListener('input', updateIdeaCount);
    el.saveFavoriteBtn.addEventListener('click', saveFavorite);
    el.saveFavoriteBtnOutput.addEventListener('click', saveFavorite);
    el.favoritesBtn.addEventListener('click', function () { openLibrary('favorites'); });
    el.historyBtn.addEventListener('click', function () { openLibrary('history'); });
    el.feedbackBtn.addEventListener('click', openFeedback);
    el.warningFeedbackBtn.addEventListener('click', openFeedback);
    el.previewBtn.addEventListener('click', openPreview);
    el.copyFeedbackBtn.addEventListener('click', copyFeedback);
    el.downloadFeedbackBtn.addEventListener('click', downloadFeedback);
    el.issueFeedbackBtn.addEventListener('click', openGithubFeedback);
    el.clearFeedbackBtn.addEventListener('click', clearFeedback);

    document.querySelectorAll('[data-example]').forEach(function (button) {
      button.addEventListener('click', function () {
        applyExample(Number(button.getAttribute('data-example')));
      });
    });

    el.favoritesTab.addEventListener('click', function () {
      state.libraryTab = 'favorites';
      renderLibrary();
    });
    el.historyTab.addEventListener('click', function () {
      state.libraryTab = 'history';
      renderLibrary();
    });

    el.libraryBody.addEventListener('click', function (event) {
      const load = event.target.closest('[data-load-record]');
      if (load) {
        const collection = load.getAttribute('data-record-collection');
        const id = load.getAttribute('data-load-record');
        const list = collection === 'favorites' ? state.favorites : state.history;
        const record = list.find(function (item) { return item.id === id; });
        if (record) {
          state.libraryTab = collection === 'favorites' ? 'favorites' : 'history';
          loadRecord(record);
        }
        return;
      }
      const remove = event.target.closest('[data-delete-record]');
      if (remove) {
        deleteRecord(remove.getAttribute('data-record-collection'), remove.getAttribute('data-delete-record'));
      }
    });

    el.searchResults.addEventListener('click', function (event) {
      const action = event.target.closest('[data-search-action]');
      if (action) handleSearchAction(action);
    });

    el.feedbackList.addEventListener('click', function (event) {
      const remove = event.target.closest('[data-remove-feedback]');
      if (remove) removeFeedbackTerm(remove.getAttribute('data-remove-feedback'));
    });

    el.feedbackList.addEventListener('input', function (event) {
      const area = event.target.closest('[data-feedback-note]');
      if (!area) return;
      state.feedback = Feedback.setNote(state.feedback, area.getAttribute('data-feedback-note'), area.value);
      persistFeedback();
    });

    el.searchInput.addEventListener('input', function () {
      const value = el.searchInput.value;
      el.searchClear.hidden = !value;
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(function () { renderSearchResults(value); }, 160);
    });

    el.searchClear.addEventListener('click', function () {
      el.searchInput.value = '';
      el.searchClear.hidden = true;
      el.searchResults.hidden = true;
      el.searchResults.innerHTML = '';
      el.searchInput.focus();
    });

    document.addEventListener('click', function (event) {
      const copyButton = event.target.closest('[data-copy]');
      if (copyButton) {
        handleCopy(copyButton);
        return;
      }
      const closer = event.target.closest('[data-close-modal]');
      if (closer) {
        const modal = closer.closest('.modal');
        closeModal(modal);
        return;
      }
      if (!event.target.closest('.library-bar')) {
        el.searchResults.hidden = true;
      }
    });

    document.addEventListener('keydown', function (event) {
      const openModalEl = document.querySelector('.modal:not([hidden])');
      if (openModalEl && event.key === 'Tab') {
        const focusables = Array.prototype.slice.call(
          openModalEl.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])')
        ).filter(function (node) { return node.offsetParent !== null || node === document.activeElement; });
        if (focusables.length) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
      if (event.key === 'Escape') {
        const open = document.querySelector('.modal:not([hidden])');
        if (open) {
          closeModal(open);
          return;
        }
        if (!el.searchResults.hidden) {
          el.searchResults.hidden = true;
          el.searchInput.focus();
          return;
        }
      }
      // 键盘快捷键：Ctrl/Cmd + Enter 生成（弹层打开时不触发）。
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !document.querySelector('.modal:not([hidden])')) {
        event.preventDefault();
        generate();
      }
    });
  }

  function init() {
    renderSlots();
    bindStaticEvents();
    updateIdeaCount();
    writeAllSlotsToDom();
    state.favorites = loadStore(STORAGE_KEYS.favorites).filter(function (item) {
      return item && item.id && item.slots;
    });
    state.history = loadStore(STORAGE_KEYS.history).filter(function (item) {
      return item && item.id && item.slots;
    });
    state.feedback = Feedback.normalizeList(loadStore(Feedback.STORAGE_KEY));
    updateLibraryCounts();
    updateFeedbackCount();
    if (window.T2I.Lexicon && window.T2I.Lexicon.stats) {
      const stats = window.T2I.Lexicon.stats;
      const count = stats.canonicalEntries.toLocaleString('zh-CN');
      el.searchInput.placeholder = '搜索 ' + count + ' 条词库、已填框、收藏和历史…';
      el.outputFootnote.textContent = '词典已载入：' + count + ' 条规范词条、' + stats.zhAliases.toLocaleString('zh-CN') + ' 个中文说法。';
    }
  }

  init();
})();
