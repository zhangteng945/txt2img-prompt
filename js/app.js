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
  const Scene = T2I.Scene;
  const LocalLLM = T2I.LocalLLM;
  const PromptFlow = T2I.PromptFlow;

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
    lastFocused: null,
    allowCompletion: false,
    verify: null,
    // 当前六框的来源：empty / local-model / rules。
    // localSlots 为 true 时，中英同步、组装和缺英文兜底都不查词库。
    source: 'empty',
    localSlots: false,
    modelNegative: null,
    model: '',
    editRevision: 0,
    localLLM: {
      settings: LocalLLM.loadSettings(window.localStorage),
      running: false,
      op: '',
      controller: null,
      runId: 0,
      abortRequested: false
    }
  };

  const el = {
    idea: document.getElementById('idea'),
    ideaCount: document.getElementById('ideaCount'),
    fillBtn: document.getElementById('fillBtn'),
    ruleFillBtn: document.getElementById('ruleFillBtn'),
    resetBtn: document.getElementById('resetBtn'),
    parseStatus: document.getElementById('parseStatus'),
    slotGrid: document.getElementById('slotGrid'),
    warningBanner: document.getElementById('warningBanner'),
    warningTitle: document.getElementById('warningTitle'),
    warningText: document.getElementById('warningText'),
    scenePanel: document.getElementById('scenePanel'),
    allowCompletion: document.getElementById('allowCompletion'),
    localLLMApiRoot: document.getElementById('localLLMApiRoot'),
    localLLMModel: document.getElementById('localLLMModel'),
    localLLMHint: document.getElementById('localLLMHint'),
    localLLMStatus: document.getElementById('localLLMStatus'),
    localLLMStatusTitle: document.getElementById('localLLMStatusTitle'),
    localLLMStatusDetail: document.getElementById('localLLMStatusDetail'),
    localLLMAbort: document.getElementById('localLLMAbort'),
    generateBtn: document.getElementById('generateBtn'),
    retranslateBtn: document.getElementById('retranslateBtn'),
    englishSyncNote: document.getElementById('englishSyncNote'),
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
            '<span class="slot-badges">' +
              '<span class="completion-badge" data-completion-badge="' + key + '" hidden></span>' +
              '<span class="sync-badge" data-stale-badge="' + key + '" hidden>英文待更新</span>' +
              '<span class="sync-badge is-inferred" data-inferred-badge="' + key + '" hidden>补全</span>' +
            '</span>' +
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
    state.editRevision += 1;
    hideOutput();
    refreshCompletionUI(key);

    if (state.localSlots) {
      // 本地模型主流程：中文是权威，英文只由用户或「重新生成英文」更新；
      // 任何词库同步都不会发生。
      if (lang === 'zh') {
        PromptFlow.markChineseEdited(state.slots, key);
        setHint(
          key,
          state.slots[key].zh.trim()
            ? '中文已修改，对应英文已标为待更新。点上方「重新生成英文」，会以当前中文为准重译。'
            : '中文已清空；英文保留当前内容，需要时可直接修改英文。',
          !!state.slots[key].zh.trim()
        );
      } else {
        PromptFlow.markEnglishEdited(state.slots, key);
        setHint(key, '英文以你的编辑为准；不会被词库回写或覆盖。', false);
      }
      updateStaleUI();
      updateWarningFromState();
      return;
    }

    state.slots[key].stale = false;
    updateStaleUI();
    setHint(key, lang === 'zh' ? '规则路径：正在按词典同步英文…' : '规则路径：正在按词典同步中文…', false);

    clearTimeout(state.timers[key]);
    state.timers[key] = setTimeout(function () {
      syncField(key, lang, value);
    }, 330);
  }

  function syncField(key, lang, value) {
    if (state.localSlots) return;
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

  function sceneChip(label, value, className) {
    return '<span class="scene-chip' + (className ? ' ' + className : '') + '">' +
      '<span>' + escapeHtml(label) + '</span>' +
      (value ? '<code>' + escapeHtml(value) + '</code>' : '') +
      '</span>';
  }

  function relationLabel(type) {
    const map = {
      wearing: '穿着', next_to: '在…旁边', located: '位于', pose: '动作',
      distance: '距离', holding: '拿着'
    };
    return map[type] || type;
  }

  function renderScene(scene) {
    if (!el.scenePanel) return;
    if (!scene || (!scene.structured && !(scene.negations && scene.negations.length))) {
      el.scenePanel.hidden = true;
      el.scenePanel.innerHTML = '';
      return;
    }
    const groups = [];
    if (scene.subjects && scene.subjects.length) {
      groups.push('<div class="scene-group"><h4>主体</h4><div class="scene-chip-row">' +
        scene.subjects.map(function (subject) {
          const attrs = (subject.attributes || []).map(function (a) { return a.zh + ' → ' + a.en; }).join('；');
          return sceneChip(subject.zh, subject.en + (attrs ? '；' + attrs : ''));
        }).join('') + '</div></div>');
    }
    if (scene.outfits && scene.outfits.length) {
      groups.push('<div class="scene-group"><h4>服饰与颜色</h4><div class="scene-chip-row">' +
        scene.outfits.map(function (outfit) {
          return sceneChip(outfit.zh, outfit.en + (outfit.color ? '（' + outfit.color.zh + ' → ' + outfit.color.en + '）' : ''));
        }).join('') + '</div></div>');
    }
    if (scene.objects && scene.objects.length) {
      groups.push('<div class="scene-group"><h4>物体与属性</h4><div class="scene-chip-row">' +
        scene.objects.map(function (object) {
          const extras = [];
          if (object.color) extras.push(object.color.zh + ' → ' + object.color.en);
          if (object.distance) extras.push(object.distance + ' → 只作用于该物体');
          return sceneChip(object.zh, object.en + (extras.length ? '（' + extras.join('；') + '）' : ''));
        }).join('') + '</div></div>');
    }
    if (scene.actions && scene.actions.length) {
      groups.push('<div class="scene-group"><h4>动作</h4><div class="scene-chip-row">' +
        scene.actions.map(function (action) { return sceneChip(action.zh, action.en); }).join('') +
        '</div></div>');
    }
    if (scene.relations && scene.relations.length) {
      groups.push('<div class="scene-group"><h4>关系</h4><div class="scene-chip-row">' +
        scene.relations.map(function (relation) {
          return sceneChip(relationLabel(relation.type), relation.en || relation.verify || relation.zh);
        }).join('') + '</div></div>');
    }
    if (scene.negations && scene.negations.length) {
      groups.push('<div class="scene-group"><h4>排除 / 否定</h4><div class="scene-chip-row">' +
        scene.negations.map(function (negation) {
          const targets = (negation.targets || []).map(function (t) { return t.zh + ' → ' + t.en; }).join('；');
          return sceneChip((negation.scope === 'global' ? '整体排除' : negation.scope + ' 局部排除'), targets, 'is-negation');
        }).join('') + '</div></div>');
    }
    if (scene.scopes && scene.scopes.length) {
      groups.push('<div class="scene-group"><h4>作用范围</h4><div class="scene-chip-row">' +
        scene.scopes.map(function (scope) {
          const label = (scope.polarity === 'allow' ? '允许' : scope.polarity === 'apply' ? '应用' : '排除') +
            ' · ' + (scope.scope === 'subject' ? '人物' : scope.scope === 'background' ? '背景' : scope.scope === 'all' ? '整体' : '整体');
          let value = scope.target || '';
          if (scope.exception) value += '；例外：' + scope.exception + ' → 不在作用范围内';
          return sceneChip(label, value);
        }).join('') + '</div></div>');
    }
    if (scene.ambiguities && scene.ambiguities.length) {
      groups.push('<div class="scene-group"><h4>保留的歧义（未替你拍板）</h4><div class="scene-chip-row">' +
        scene.ambiguities.map(function (item) {
          return sceneChip('可能切法', item.alternatives.join(' / '), 'is-ambiguous');
        }).join('') + '</div><p class="scene-note">当前按上下文选择了：' +
        escapeHtml(scene.ambiguities[0].chosen || '') + '。如果不符合你的原意，可直接改六个框。</p></div>');
    }
    if (scene.unknown && scene.unknown.length) {
      groups.push('<div class="scene-group"><h4>未处理部分（保留原文，不假装完整）</h4><div class="scene-chip-row">' +
        scene.unknown.map(function (item) { return sceneChip(item, '未收录，已保留原文', 'is-negative'); }).join('') +
        '</div></div>');
    }
    const summary = scene.summary || {};
    const localScene = scene.origin === 'local-llm' && scene.englishFrom === 'model';
    el.scenePanel.innerHTML =
      '<div class="scene-panel-head"><strong>结构化场景</strong>' +
      '<span>' + (localScene ? '本地模型自己分解并翻译（未参照词库）' : (scene.origin === 'local-llm' ? '本地模型编译' : '规则编译器')) + ' · ' +
      (scene.structured ? (localScene ? '英文直接来自模型输出' : '六个框由这棵树投影') : '部分内容退回原有片段解析') +
      ' · 主体 ' + (summary.subjectCount || 0) +
      ' · 物体 ' + (summary.objectCount || 0) +
      ' · 关系 ' + (summary.relationCount || 0) +
      ' · 否定 ' + (summary.negationCount || 0) +
      ' · 未识别 ' + (scene.unknown ? scene.unknown.length : 0) + '</span></div>' +
      groups.join('');
    el.scenePanel.hidden = false;
  }

  function showWarning(unknown, issues) {
    const list = unknown || [];
    const issueList = (issues || []).filter(function (issue) {
      return issue && issue.message;
    });
    if (!list.length && !issueList.length) {
      el.warningBanner.hidden = true;
      el.warningText.textContent = '';
      return;
    }
    const errors = issueList.filter(function (issue) { return issue.severity === 'error'; });
    el.warningBanner.hidden = false;
    if (el.warningTitle) {
      el.warningTitle.textContent = errors.length
        ? '语义守恒检查未通过'
        : (state.localSlots ? '本地模型校验提示' : '有未收录内容');
    }
    const parts = [];
    if (list.length) {
      parts.push(state.localSlots
        ? '本地模型没有给出这些片段的英文：' + list.join('、') + '。这些条目留空，没有用词库补译；请直接改英文框。'
        : '未收录：' + list.join('、') + '。这些原文已保留在英文框里，没有被清空，也已自动记入本机「待补录」，不用再手抄。' +
          '你可以直接改英文，或点「查看待补录」写备注并导出给大肥鱼补词。');
    }
    issueList.forEach(function (issue) {
      parts.push((issue.severity === 'error' ? '必须处理：' : '提示：') + issue.message);
    });
    el.warningText.textContent = parts.join(' ');
  }

  function updateWarningFromState() {
    const all = [];
    SF.slots.forEach(function (key) {
      (state.unknownBySlot[key] || []).forEach(function (u) {
        if (!all.includes(u)) all.push(u);
      });
    });
    showWarning(all, state.verify ? state.verify.issues : []);
  }

  function updateStaleUI() {
    const pending = state.localSlots ? PromptFlow.pendingKeys(state.slots) : [];
    const inferred = state.localSlots ? PromptFlow.inferredKeys(state.slots) : [];
    SF.slots.forEach(function (key) {
      const slot = state.slots[key] || {};
      const staleBadge = el.slotGrid.querySelector('[data-stale-badge="' + key + '"]');
      const inferredBadge = el.slotGrid.querySelector('[data-inferred-badge="' + key + '"]');
      if (staleBadge) staleBadge.hidden = !(state.localSlots && slot.stale === true);
      if (inferredBadge) inferredBadge.hidden = !(state.localSlots && slot.inferred === true);
      const fields = slotTextareas(key);
      if (fields.en) fields.en.classList.toggle('is-stale', !!(state.localSlots && slot.stale === true));
    });

    if (el.retranslateBtn) {
      el.retranslateBtn.disabled = !state.localSlots || !pending.length || state.localLLM.running;
      el.retranslateBtn.textContent = pending.length
        ? '重新生成英文（' + pending.length + '）'
        : '重新生成英文';
    }
    if (!el.englishSyncNote) return;
    el.englishSyncNote.classList.toggle('is-pending', state.localSlots && pending.length > 0);
    el.englishSyncNote.classList.toggle('is-error', false);
    if (!state.localSlots) {
      el.englishSyncNote.textContent = state.source === 'rules'
        ? '当前是规则生成（次要路径）：中文改动会按词库同步；模型主流程不会这样做。'
        : '模型拆解后，这里会显示英文同步状态。';
      return;
    }
    if (pending.length) {
      el.englishSyncNote.textContent =
        '有 ' + pending.length + ' 个字段的中文已改，英文待更新：' +
        pending.map(slotLabelOf).join('、') + '。重译成功前不会放行生成。';
    } else if (inferred.length) {
      el.englishSyncNote.textContent =
        '英文已与当前中文同步；其中 ' + inferred.map(slotLabelOf).join('、') + ' 为模型补全。';
    } else {
      el.englishSyncNote.textContent = '英文已与当前中文同步；可点「生成正/负提示词」预览或复制。';
    }
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
        stale: slot.stale === true,
        inferred: slot.inferred === true,
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
    const scene = !state.localSlots && state.parsed && state.parsed.scene &&
      state.parsed.raw === el.idea.value.trim() ? state.parsed.scene : null;
    const assembled = Assemble.assemble(state.slots, {
      quality: state.allowCompletion && !state.localSlots,
      noLexicon: state.localSlots
    });
    const negative = state.localSlots
      ? {
        negativeEn: (state.modelNegative && state.modelNegative.en) || '',
        negativeZh: (state.modelNegative && state.modelNegative.zh) || '',
        items: [],
        extraItems: [],
        skipped: [],
        suppressed: []
      }
      : Negative.build(assembled.positiveEn, scene ? Scene.negativePlan(scene) : null);
    const pending = PromptFlow.pendingKeys(state.slots);
    return {
      version: 2,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: makeRecordTitle(el.idea.value, assembled.positiveEn),
      idea: el.idea.value,
      source: state.localSlots ? 'local-model' : 'rules',
      model: state.localSlots ? state.model : '',
      infer: state.allowCompletion,
      slots: serializeSlots(),
      positiveEn: assembled.positiveEn,
      positiveZh: assembled.positiveZh,
      negativeEn: negative.negativeEn,
      negativeZh: negative.negativeZh,
      phraseCount: assembled.phraseCount,
      pendingEnglish: pending,
      staleEnglish: pending.length > 0,
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
    // 本地成功路径不查词库，也就没有「词库未收录」可记。
    if (state.localSlots) return;
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
    if (state.localSlots) {
      SF.slots.forEach(function (key) { map[key] = []; });
      state.unknownBySlot = map;
      return map;
    }
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
    cancelLocalFill('');
    const legacyPending = Array.isArray(record.pendingEnglish) ? record.pendingEnglish : [];
    const fresh = SF.emptySlots();
    SF.slots.forEach(function (key) {
      const saved = record.slots[key] || {};
      fresh[key].zh = typeof saved.zh === 'string' ? saved.zh : '';
      fresh[key].en = typeof saved.en === 'string' ? saved.en : '';
      fresh[key].stale = saved.stale === true || legacyPending.indexOf(key) !== -1;
      fresh[key].inferred = saved.inferred === true;
      fresh[key].completionItems = Array.isArray(saved.completionItems)
        ? saved.completionItems.map(function (item) {
          return { zh: item.zh || '', en: item.en || '', reason: item.reason || '' };
        })
        : [];
      fresh[key].items = [];
    });

    state.slots = fresh;
    state.parsed = null;
    state.verify = null;
    state.source = record.source === 'local-model' ? 'local-model' : 'rules';
    state.localSlots = state.source === 'local-model';
    state.model = record.model || '';
    state.modelNegative = state.localSlots && (record.negativeEn || record.negativeZh)
      ? { en: record.negativeEn || '', zh: record.negativeZh || '' }
      : null;
    state.allowCompletion = record.infer === true;
    if (el.allowCompletion) el.allowCompletion.checked = state.allowCompletion;
    state.unknownBySlot = Object.create(null);
    state.editRevision = 0;
    renderScene(null);
    el.idea.value = record.idea || '';
    updateIdeaCount();
    writeAllSlotsToDom();
    const label = state.libraryTab === 'favorites' ? '收藏夹' : '历史';
    SF.slots.forEach(function (key) {
      setHint(key, '已从' + label + '打开，可继续修改。', false);
    });
    refreshAllCompletionUI();
    showWarning([]);
    hideOutput();
    updateStaleUI();
    el.searchResults.hidden = true;
    closeAllModals();

    if (state.localSlots) {
      const pending = PromptFlow.pendingKeys(state.slots);
      if (pending.length) {
        setStatus(
          '已打开「' + (record.title || '未命名') + '」：其中 ' + pending.map(slotLabelOf).join('、') +
          ' 的英文在保存时就待更新。中文和旧英文已原样恢复；请先点「重新生成英文」再生成提示词。',
          true
        );
        setLocalStatus(
          'secondary',
          '历史记录已打开，英文待更新',
          '没有自动用词库重译，也没有自动生成最终提示词；保留保存时的编辑与待更新状态。'
        );
        return;
      }
    }
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
        const recordSlots = PromptFlow.normalizeSlots(record.slots, record.pendingEnglish);
        const pendingCount = PromptFlow.pendingKeys(recordSlots).length;
        const sourceLabel = record.source === 'local-model' ? '本地模型' : '规则次要路径';
        return (
          '<article class="record-card">' +
            '<div class="record-main">' +
              '<p class="record-title">' + escapeHtml(record.title || '未命名提示词') + '</p>' +
              '<p class="record-meta">' + escapeHtml(formatSavedAt(record.savedAt)) +
                (record.phraseCount ? ' · ' + record.phraseCount + ' 个短语' : '') +
                ' · ' + escapeHtml(sourceLabel) +
                (pendingCount ? ' · <strong class="record-stale">英文待更新 ' + pendingCount + ' 项</strong>' : '') + '</p>' +
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
      groups.push(group('词库（规则次要路径）', lexHits.length + ' 个命中，显示前 ' + lexTop.length + ' 个', lexTop.map(function (hit) {
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

  function localSecondsText(ms) {
    const seconds = Number(ms) / 1000;
    if (!isFinite(seconds) || seconds <= 0) return '不到 1 秒';
    return (seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds))) + ' 秒';
  }

  function setLocalStatus(kind, title, detail) {
    if (!el.localLLMStatus) return;
    if (!kind) {
      el.localLLMStatus.hidden = true;
      el.localLLMStatus.className = 'local-llm-status';
      if (el.localLLMStatusTitle) el.localLLMStatusTitle.textContent = '';
      if (el.localLLMStatusDetail) el.localLLMStatusDetail.textContent = '';
      if (el.localLLMAbort) el.localLLMAbort.hidden = true;
      return;
    }
    el.localLLMStatus.hidden = false;
    el.localLLMStatus.className = 'local-llm-status is-' + kind;
    if (el.localLLMStatusTitle) el.localLLMStatusTitle.textContent = title || '';
    if (el.localLLMStatusDetail) el.localLLMStatusDetail.textContent = detail || '';
    if (el.localLLMAbort) el.localLLMAbort.hidden = kind !== 'running';
  }

  function updateLocalHint() {
    if (!el.localLLMHint) return;
    const root = LocalLLM.normalizeApiRoot(state.localLLM.settings.apiRoot);
    const parts = [
      '默认地址走 Tailscale Serve 的 HTTPS（仅尾网可达），不要占用 443 / 8080 / 8443。',
      '当前 Ollama 没有鉴权，页面不需要也不会保存密钥。'
    ];
    let warning = false;
    if (window.location && window.location.protocol === 'https:' && /^http:\/\//i.test(root)) {
      parts.push('当前页面是 HTTPS，浏览器会以混合内容为由拦截 http:// 地址；本机调试请用 http://localhost 打开页面。');
      warning = true;
    }
    if (/127\.0\.0\.1|localhost/i.test(root)) {
      parts.push('手机上 127.0.0.1 不是这台 Mac；GitHub Pages 页面也不能直接请求本机回环地址。');
      warning = true;
    }
    if (window.location && window.location.protocol === 'file:') {
      parts.push('file:// 页面请求 Ollama 时 Origin 是 null，可能被 CORS 拒绝；建议用本地静态服务器或 GitHub Pages 打开。');
      warning = true;
    }
    el.localLLMHint.textContent = parts.join(' ');
    el.localLLMHint.classList.toggle('is-warning', warning);
  }

  function syncLocalSettingsUI() {
    const settings = state.localLLM.settings;
    if (el.localLLMApiRoot) el.localLLMApiRoot.value = LocalLLM.normalizeApiRoot(settings.apiRoot);
    if (el.localLLMModel) el.localLLMModel.value = LocalLLM.normalizeModel(settings.model);
    state.allowCompletion = settings.infer === true;
    if (el.allowCompletion) el.allowCompletion.checked = state.allowCompletion;
    updateLocalHint();
  }

  function persistLocalSettings() {
    LocalLLM.saveSettings(window.localStorage, state.localLLM.settings);
  }

  function onLocalSettingsChange() {
    const settings = state.localLLM.settings;
    settings.apiRoot = LocalLLM.normalizeApiRoot(el.localLLMApiRoot ? el.localLLMApiRoot.value : '');
    settings.model = LocalLLM.normalizeModel(el.localLLMModel ? el.localLLMModel.value : '');
    settings.infer = !!(el.allowCompletion && el.allowCompletion.checked);
    state.allowCompletion = settings.infer;
    if (el.localLLMApiRoot) el.localLLMApiRoot.value = settings.apiRoot;
    if (el.localLLMModel) el.localLLMModel.value = settings.model;
    persistLocalSettings();
    updateLocalHint();
  }

  function setRequestButtonsDisabled(disabled) {
    if (el.fillBtn) el.fillBtn.disabled = disabled;
    if (el.ruleFillBtn) el.ruleFillBtn.disabled = disabled;
    if (el.retranslateBtn) el.retranslateBtn.disabled = disabled ||
      !state.localSlots || !PromptFlow.pendingKeys(state.slots).length;
  }

  function cancelLocalFill(message) {
    state.localLLM.runId += 1;
    const controller = state.localLLM.controller;
    state.localLLM.controller = null;
    state.localLLM.running = false;
    state.localLLM.op = '';
    state.localLLM.abortRequested = false;
    setRequestButtonsDisabled(false);
    updateStaleUI();
    if (controller) {
      try { controller.abort(); } catch (err) { /* 忽略 */ }
    }
    if (message) setLocalStatus('error', '已中止本地模型请求', message + ' 已有编辑与英文都保留，没有改用规则或词库。');
    else setLocalStatus(null);
  }

  function abortLocalFill() {
    if (!state.localLLM.running) return;
    state.localLLM.abortRequested = true;
    const controller = state.localLLM.controller;
    if (controller) {
      try { controller.abort(); } catch (err) { /* 忽略 */ }
    }
    setLocalStatus(
      'running',
      '正在中止…',
      '这次请求会停止；已有中文、英文和待更新标记都会保留，不会自动改用规则。'
    );
  }

  function localErrorDetail(result) {
    const code = (result && result.code) || 'unexpected';
    let reason = LocalLLM.reasonText(code);
    if (code === 'aborted' && !state.localLLM.abortRequested) reason = '本地模型请求已中止';
    let detail = '原因：' + reason + '。';
    if (code === 'network') {
      detail += '请确认：Ollama 已打开且 11434 在监听、电脑没有休眠、Tailscale 已连上、Tailscale Serve 和 CORS 已放行。';
    } else if (code === 'cors') {
      detail += '当前 Origin 是 ' + (window.location && window.location.origin ? window.location.origin : '本页') +
        '，需要在 Ollama 侧放行；手机访问时也要确认该地址在尾网内可达。';
    } else if (code === 'timeout') {
      detail += '首次加载模型可能较慢，可以重试；也可以先在本机跑一次让模型常驻。';
    } else if (code === 'config') {
      detail += '请在「连接设置」里填写完整的 http(s):// 地址。';
    }
    if (result && result.detail &&
        ['invalid-json', 'invalid-spec', 'missing-english', 'inferred', 'empty-negative', 'server', 'empty-fields', 'missing-english'].indexOf(code) !== -1) {
      detail += ' 细节：' + result.detail + '。';
    }
    return detail;
  }

  function finishLocalFill(runId, result) {
    if (runId !== state.localLLM.runId || !state.localLLM.running) return;
    state.localLLM.running = false;
    state.localLLM.op = '';
    state.localLLM.controller = null;
    state.localLLM.abortRequested = false;
    setRequestButtonsDisabled(false);
    updateStaleUI();

    if (result && result.status === 'ok') {
      fillFromModel(result);
      return;
    }

    const code = (result && result.code) || 'unexpected';
    const detail = localErrorDetail(result);
    setLocalStatus(
      'error',
      '本地模型失败，已有内容未改动',
      detail + ' 本次没有生成新结果，也没有自动改用规则或词库。需要规则结果时，请自己点「改用规则生成（次要）」。'
    );
    setStatus('本地模型失败：' + LocalLLM.reasonText(code) + '。已有编辑/上一轮结果已保留；没有静默回退词库。', true);
  }

  function currentFieldPayload() {
    readSlotsFromDom();
    const out = Object.create(null);
    SF.slots.forEach(function (key) {
      out[key] = {
        zh: state.slots[key].zh || '',
        en: state.slots[key].en || ''
      };
    });
    return out;
  }

  function startLocalFill(idea) {
    if (state.localLLM.running) return;
    const runId = state.localLLM.runId + 1;
    state.localLLM.runId = runId;
    let controller = null;
    try {
      controller = new AbortController();
    } catch (err) {
      controller = null;
    }
    state.localLLM.running = true;
    state.localLLM.op = 'fill';
    state.localLLM.abortRequested = false;
    state.localLLM.controller = controller;
    setRequestButtonsDisabled(true);
    updateStaleUI();
    const model = LocalLLM.normalizeModel(state.localLLM.settings.model);
    setLocalStatus(
      'running',
      '本地模型拆解中',
      '正在请求本机 ' + model + '；首次加载可能要十几秒，最长等 ' +
      Math.round(LocalLLM.TIMEOUT_MS / 1000) + ' 秒，可以点「中止」。'
    );

    LocalLLM.generate(state.localLLM.settings, idea, {
      signal: controller ? controller.signal : undefined,
      infer: state.allowCompletion,
      timeoutMs: LocalLLM.TIMEOUT_MS
    }).then(function (result) {
      finishLocalFill(runId, result);
    }).catch(function (err) {
      finishLocalFill(runId, {
        status: 'error',
        code: 'unexpected',
        reason: String(err && err.message ? err.message : err),
        detail: String(err && err.message ? err.message : err)
      });
    });
  }

  function finishRetranslate(runId, revision, pending, result) {
    if (runId !== state.localLLM.runId || !state.localLLM.running) return;
    state.localLLM.running = false;
    state.localLLM.op = '';
    state.localLLM.controller = null;
    state.localLLM.abortRequested = false;
    setRequestButtonsDisabled(false);
    updateStaleUI();

    if (revision !== state.editRevision) {
      setLocalStatus(
        'error',
        '重译期间中文又被修改，结果未采用',
        '你的最新中文和旧英文都保留着；待更新标记还在。请重新点「重新生成英文」。'
      );
      setStatus('重译结果已丢弃：请求期间中文又改了。最新编辑已保留，请重新点「重新生成英文」。', true);
      updateStaleUI();
      return;
    }

    if (!result || result.status !== 'ok') {
      const detail = localErrorDetail(result || { code: 'unexpected' });
      setLocalStatus(
        'error',
        '英文重译失败，已有编辑已保留',
        detail + ' 中文没有改动，旧英文也还在；' + pending.map(slotLabelOf).join('、') +
        ' 仍标记为待更新。没有改用规则或词库。'
      );
      setStatus('英文重译失败：' + LocalLLM.reasonText((result && result.code) || 'unexpected') +
        '。中文和旧英文已保留，可重试。', true);
      updateStaleUI();
      return;
    }

    const applied = PromptFlow.applyEnglish(state.slots, result.fields, pending);
    if (!applied.ok) {
      setLocalStatus(
        'error',
        '重译结果不完整，已有编辑已保留',
        '模型没有给出这些字段的可用英文：' + applied.missing.map(slotLabelOf).join('、') +
        '。中文与旧英文都没有改动，没有用词库补译。'
      );
      setStatus('重译结果不完整，未写入任何英文；请重试。', true);
      updateStaleUI();
      return;
    }

    if (result.negative && result.negative.en) state.modelNegative = result.negative;
    state.localSlots = true;
    state.source = 'local-model';
    state.model = result.model || state.model;
    state.verify = null;
    writeAllSlotsToDom();
    updateStaleUI();
    hideOutput();
    setLocalStatus(
      'ok',
      '英文重译完成',
      '用时 ' + localSecondsText(result.elapsedMs) + '，模型 ' + (result.model || state.model) + '。只更新了 ' +
      applied.updated.map(slotLabelOf).join('、') + ' 的英文；中文保持你改过的版本，没有回写。'
    );
    setStatus('英文已按当前中文重译；中文未被改回。已刷新正/负提示词。', false);
    generate();
  }

  function startRetranslate() {
    if (state.localLLM.running || !state.localSlots) return;
    const fields = currentFieldPayload();
    const pending = PromptFlow.pendingKeys(state.slots);
    if (!pending.length) {
      setStatus('当前没有需要重译的字段：英文已经和中文同步。', false);
      return;
    }
    const runId = state.localLLM.runId + 1;
    state.localLLM.runId = runId;
    const revision = state.editRevision;
    let controller = null;
    try {
      controller = new AbortController();
    } catch (err) {
      controller = null;
    }
    state.localLLM.running = true;
    state.localLLM.op = 'retranslate';
    state.localLLM.abortRequested = false;
    state.localLLM.controller = controller;
    setRequestButtonsDisabled(true);
    updateStaleUI();
    const model = LocalLLM.normalizeModel(state.localLLM.settings.model);
    setLocalStatus(
      'running',
      '正在重新生成英文',
      '以当前六个中文框为准，只重译待更新字段：' + pending.map(slotLabelOf).join('、') +
      '。会带上原始描述和其余字段作上下文，模型 ' + model + '，可点「中止」。'
    );

    LocalLLM.retranslate(state.localLLM.settings, {
      idea: el.idea.value,
      fields: fields,
      pending: pending,
      negative: state.modelNegative
    }, {
      signal: controller ? controller.signal : undefined,
      timeoutMs: LocalLLM.TIMEOUT_MS
    }).then(function (result) {
      finishRetranslate(runId, revision, pending, result);
    }).catch(function (err) {
      finishRetranslate(runId, revision, pending, {
        status: 'error',
        code: 'unexpected',
        reason: String(err && err.message ? err.message : err),
        detail: String(err && err.message ? err.message : err)
      });
    });
  }

  function fillFromModel(result) {
    const fields = result.fields || {};
    state.slots = SF.emptySlots();
    const counts = {};
    const inferred = [];
    SF.slots.forEach(function (key) {
      const field = fields[key] || {};
      state.slots[key].zh = typeof field.zh === 'string' ? field.zh : '';
      state.slots[key].en = typeof field.en === 'string' ? field.en : '';
      state.slots[key].stale = false;
      state.slots[key].inferred = field.inferred === true;
      state.slots[key].items = [];
      counts[key] = (state.slots[key].zh || state.slots[key].en) ? 1 : 0;
      if (state.slots[key].inferred) inferred.push(key);
    });
    state.localSlots = true;
    state.source = 'local-model';
    state.parsed = null;
    state.verify = null;
    state.modelNegative = result.negative || null;
    state.model = result.model || LocalLLM.normalizeModel(state.localLLM.settings.model);
    state.unknownBySlot = Object.create(null);
    SF.slots.forEach(function (key) { state.unknownBySlot[key] = []; });

    writeAllSlotsToDom();
    renderScene(null);
    updateWarningFromState();
    hideOutput();
    refreshAllCompletionUI();
    updateStaleUI();

    const filled = SF.slots.filter(function (key) { return counts[key]; }).length;
    const inferredText = inferred.length
      ? ' 其中 ' + inferred.map(slotLabelOf).join('、') + ' 是模型按开关补全，已在框上标「补全」。'
      : '';
    setLocalStatus(
      'ok',
      '本地模型拆解完成',
      '用时 ' + localSecondsText(result.elapsedMs) + '，模型 ' + state.model +
      '。由模型自己理解、分解并翻译，请求没有携带词库，也没有用词库改写模型英文。' + inferredText
    );
    setStatus(
      '本地模型已把整体描述拆成六个中英对照框，直接给出了英文。' +
      '填了 ' + filled + ' 个字段；中文可逐项修改，改后对应英文会标「待更新」。' +
      '确认中文后点「重新生成英文」，会以当前中文为准重译。' + inferredText,
      false
    );

    SF.slots.forEach(function (key) {
      const slot = state.slots[key];
      if (!counts[key]) {
        setHint(key, '模型没有从描述里拆出这一项；需要时可以直接填写中文或英文。', false);
        return;
      }
      if (slot.inferred) {
        setHint(key, '这一项是模型在你开启「允许推测」后补全的；不需要可清空或改写。', false);
      } else if (slot.stale) {
        setHint(key, '中文已改，英文待更新。点「重新生成英文」以当前中文为准重译。', true);
      } else {
        setHint(key, '由本地模型拆出并翻译；改中文会标记英文待更新，改英文不会被词库覆盖。', false);
      }
    });

    setTimeout(function () {
      const target = document.getElementById('workflow-title');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 90);
  }

  function fillFromParsed(parsed, meta) {
    // 只服务用户明确点击「改用规则生成（次要）」的路径。
    const scene = parsed.scene;
    state.localSlots = false;
    state.source = 'rules';
    state.modelNegative = null;
    state.model = '';
    const hasUnits = scene ? (scene.units || []).length > 0 : (parsed.segments || []).length > 0;
    const hasConstraints = !!(scene && ((scene.negations || []).length || (scene.scopes || []).length));
    state.verify = null;

    if (!hasUnits && !hasConstraints) {
      state.slots = SF.emptySlots();
      state.unknownBySlot = Object.create(null);
      writeAllSlotsToDom();
      renderScene(scene);
      updateWarningFromState();
      hideOutput();
      updateStaleUI();
      setStatus('规则生成（次要路径）：这段描述暂时没能拆出可用的提示词片段。', true);
      return;
    }

    const filled = SF.fill(parsed, { noLexicon: false });
    const completed = Complete.complete(filled.slots, { enabled: state.allowCompletion });
    state.slots = completed.slots;
    SF.slots.forEach(function (key) {
      state.slots[key].stale = false;
      state.slots[key].inferred = false;
    });
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
    // 场景级未识别内容可能没有落在任何框里，也要给待补录一个明确位置。
    if (scene && scene.unknown && scene.unknown.length) {
      const known = [];
      SF.slots.forEach(function (key) {
        (state.unknownBySlot[key] || []).forEach(function (u) { known.push(u); });
      });
      scene.unknown.forEach(function (item) {
        if (known.includes(item)) return;
        if (!state.unknownBySlot.scene.includes(item)) state.unknownBySlot.scene.push(item);
      });
    }

    writeAllSlotsToDom();
    renderScene(scene);
    updateWarningFromState();
    collectFeedback(parsed.raw || el.idea.value);
    hideOutput();
    refreshAllCompletionUI();
    updateStaleUI();

    const counts = {};
    SF.slots.forEach(function (key) { counts[key] = state.slots[key].items.length; });
    const summary = SF.definitions
      .map(function (def) { return def.label.replace(/与.*/, '') + ' ' + counts[def.key]; })
      .join(' · ');
    const completionCount = completed.added.length;
    const structure = scene && scene.structured
      ? '结构化场景：主体 ' + (scene.summary.subjectCount || 0) +
        ' · 物体 ' + (scene.summary.objectCount || 0) +
        ' · 关系 ' + (scene.summary.relationCount || 0) +
        ' · 否定 ' + (scene.summary.negationCount || 0) + '。'
      : '部分内容沿用了片段解析。';

    setLocalStatus(
      'secondary',
      '规则生成完成（次要路径）',
      '你明确选择了规则 + 词库；这不是本地模型结果。需要模型理解与翻译时，请点「用本地模型拆解并翻译」。'
    );
    if (!hasUnits && hasConstraints) {
      setStatus('规则生成（次要路径）：只解析出否定 / 作用范围约束；正面框为空，负面提示词会按约束生成。', false);
    } else if (!hasUnits) {
      setStatus('规则生成（次要路径）：暂时没能拆出可用的提示词片段。', true);
    } else {
      setStatus(
        '规则生成（次要路径）：' + structure + '已投影到六框（' + summary + '）。' +
        (state.allowCompletion ? '规则补全 ' + completionCount + ' 项，已在框下标出。' : '规则补全关闭。') +
        (scene && scene.ambiguities && scene.ambiguities.length ? ' 分词仍有备选解释，已保留在结构化场景里。' : ''),
        false
      );
    }

    SF.slots.forEach(function (key) {
      const count = counts[key];
      const added = state.slots[key].completionItems.length;
      if (count) {
        setHint(
          key,
          '规则路径拆出 ' + count + ' 条' + (added ? '，其中 ' + added + ' 条为补全' : '') +
          '。修改中文或英文会按词库尝试对齐；这是次要路径。',
          false
        );
      } else {
        setHint(key, '规则路径没有从这个框拆到内容。', false);
      }
    });

    setTimeout(function () {
      const target = document.getElementById('workflow-title');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 90);
  }

  function runFill() {
    const idea = el.idea.value.trim();
    if (!idea) {
      setStatus('先写一段整体描述，再点「用本地模型拆解并翻译」。', true);
      el.idea.focus();
      return;
    }
    startLocalFill(idea);
  }

  function runRuleFill() {
    const idea = el.idea.value.trim();
    if (!idea) {
      setStatus('先写一段整体描述，再选择规则生成。', true);
      el.idea.focus();
      return;
    }
    cancelLocalFill('');
    fillFromParsed(Parser.parse(idea), { mode: 'rule' });
  }

  function clearAll() {
    cancelLocalFill('');
    state.localSlots = false;
    state.source = 'empty';
    state.modelNegative = null;
    state.model = '';
    state.editRevision = 0;
    state.slots = SF.emptySlots();
    state.parsed = null;
    state.generated = null;
    state.verify = null;
    state.unknownBySlot = Object.create(null);
    renderScene(null);
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
    updateStaleUI();
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
      stale: false,
      inferred: false,
      unknown: []
    };
    const fields = slotTextareas(key);
    fields.zh.value = '';
    fields.en.value = '';
    state.unknownBySlot[key] = [];
    state.editRevision += 1;
    hideOutput();
    updateWarningFromState();
    setHint(key, '本框已清空。', false);
    refreshCompletionUI(key);
    updateStaleUI();
  }

  function ensureEnglishForAllSlots() {
    const unknownAll = [];
    // 本地模型成功路径：英文只来自模型/用户，不再按词库补齐缺英文。
    if (state.localSlots) return unknownAll;
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

    if (state.localSlots) {
      const pending = PromptFlow.pendingKeys(state.slots);
      if (pending.length) {
        hideOutput();
        updateStaleUI();
        setStatus(
          '先重译英文：' + pending.map(slotLabelOf).join('、') +
          ' 的中文已改，英文仍标记待更新。点上方「重新生成英文」成功后才能生成，避免复制过期英文。',
          true
        );
        if (el.retranslateBtn) el.retranslateBtn.focus({ preventScroll: false });
        return;
      }
    }

    recomputeUnknownBySlot();
    ensureEnglishForAllSlots();
    const assembled = Assemble.assemble(state.slots, {
      quality: state.allowCompletion && !state.localSlots,
      noLexicon: state.localSlots
    });
    let scene = null;
    let verify = null;
    let negative;
    if (state.localSlots) {
      const modelNegative = state.modelNegative || { zh: '', en: '' };
      negative = {
        negativeEn: modelNegative.en || '',
        negativeZh: modelNegative.zh || '',
        items: [],
        extraItems: [],
        skipped: [],
        suppressed: []
      };
    } else {
      scene = state.parsed && state.parsed.scene && state.parsed.raw === el.idea.value.trim()
        ? state.parsed.scene
        : null;
      const negativePlan = scene ? Scene.negativePlan(scene) : { extra: [], suppress: [], notes: [] };
      negative = Negative.build(assembled.positiveEn, negativePlan);
      verify = scene ? Scene.verify(scene, state.slots, assembled, negative) : null;
    }
    state.verify = verify;

    const onlyNegative = state.localSlots
      ? !!negative.negativeEn.trim()
      : !!(scene && !assembled.positiveEn.trim() &&
        ((scene.negations || []).length || (scene.scopes || []).some(function (scope) { return scope.polarity === 'exclude'; })));
    if (!assembled.positiveEn.trim() && !onlyNegative) {
      setStatus('六个框还是空的。先在上方写整体描述并用本地模型拆解，或直接填写任一框。', true);
      el.idea.focus();
      return;
    }

    state.generated = { positive: assembled, negative: negative, verify: verify };

    el.positiveEn.value = assembled.positiveEn;
    el.positiveZh.textContent = assembled.positiveZh || (onlyNegative ? '（只有负面约束，没有正面内容）' : '（中文框为空，暂无可对照内容）');
    el.negativeEn.value = negative.negativeEn;
    el.negativeZh.textContent = negative.negativeZh;
    const negCount = state.localSlots
      ? (negative.negativeEn ? negative.negativeEn.split(',').filter(function (item) { return item.trim(); }).length : 0)
      : negative.items.length;
    const extraCount = state.localSlots ? 0 : negative.extraItems.length;
    if (state.localSlots) {
      const inferred = PromptFlow.inferredKeys(state.slots);
      el.outputMeta.textContent =
        assembled.phraseCount + ' 个正面短语 · ' + negCount + ' 个负面词 · 英文来自本地模型 · 未使用词库' +
        (inferred.length ? ' · 补全 ' + inferred.length + ' 个' : '');
    } else {
      el.outputMeta.textContent =
        assembled.phraseCount + ' 个正面短语 · ' + negCount + ' 个负面词' +
        (extraCount ? ' · 其中 ' + extraCount + ' 个来自本轮否定/范围约束' : '') +
        (assembled.quality.length ? ' · 补全质量词 ' + assembled.quality.length + ' 个' : '') +
        ' · 规则次要路径';
    }

    if (state.localSlots) {
      const inferred = PromptFlow.inferredKeys(state.slots);
      el.outputFootnote.textContent = inferred.length
        ? '英文由本地模型按描述直接给出，未使用词库；其中 ' + inferred.map(slotLabelOf).join('、') +
          ' 是开启「允许推测」后的补全。再次修改中文会隐藏本结果并标记英文待更新。'
        : '英文由本地模型按描述直接给出，未使用词库或规则补全。再次修改中文会隐藏本结果并标记英文待更新。';
    } else if (assembled.quality.length) {
      el.outputFootnote.textContent = '末尾质量词为勾选规则补全后加入：' +
        assembled.quality.join(', ') + '（中文：' + assembled.qualityZh.join('，') + '）。';
    } else if (onlyNegative) {
      el.outputFootnote.textContent = '本轮只有否定 / 作用范围约束，正面提示词为空；负面提示词已按局部约束生成，没有升级成全局否定。';
    } else {
      el.outputFootnote.textContent = '规则次要路径：英文由词典 / 规则生成；主流程应使用本地模型。';
    }

    el.outputSection.hidden = false;
    autoSizePrompt(el.positiveEn);
    autoSizePrompt(el.negativeEn);
    setTimeout(function () {
      autoSizePrompt(el.positiveEn);
      autoSizePrompt(el.negativeEn);
    }, 60);
    updateWarningFromState();
    collectFeedback(el.idea.value);

    if (verify && verify.incomplete) {
      const message = verify.issues.length ? verify.issues[0].message : '仍有未处理部分';
      showToast('语义守恒检查未通过：结果已标为不完整');
      setStatus('已生成，但语义守恒检查未通过：' + message + '。请按上方警告修正后再复制。', true);
    } else if (assembled.hasUntranslated) {
      showToast('提示词里仍保留未收录中文，建议在英文框里改写');
      setStatus('已生成，但正面提示词仍保留未收录中文，结果不完整，请先修正。', true);
    } else if (onlyNegative && !assembled.positiveEn.trim()) {
      setStatus('已生成负面约束；正面为空，可继续补充想画的主体与场景。', false);
    } else if (state.localSlots) {
      setStatus('已生成正/负提示词，英文来自本地模型与你的编辑，未使用词库。复制英文即可粘贴到 SDXL / ComfyUI。', false);
    } else {
      setStatus('已生成正/负提示词（规则次要路径）。复制英文即可粘贴到 SDXL / ComfyUI。', false);
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
    cancelLocalFill('');
    el.idea.value = text;
    updateIdeaCount();
    runFill();
  }

  function bindStaticEvents() {
    if (el.allowCompletion) {
      el.allowCompletion.checked = state.allowCompletion;
      el.allowCompletion.addEventListener('change', function () {
        onLocalSettingsChange();
        state.verify = null;
        setStatus(
          state.allowCompletion
            ? '已开启模型推测补全：仅下次模型拆解时可补光线/镜头/画风，并在框上标记「补全」；不会补人物、剧情、服装。'
            : '已关闭模型推测补全：模型不会补用户没提到的光线、镜头或画风。',
          false
        );
      });
    }
    el.fillBtn.addEventListener('click', runFill);
    if (el.ruleFillBtn) el.ruleFillBtn.addEventListener('click', runRuleFill);
    if (el.retranslateBtn) el.retranslateBtn.addEventListener('click', startRetranslate);
    el.resetBtn.addEventListener('click', clearAll);
    el.generateBtn.addEventListener('click', generate);
    el.idea.addEventListener('input', function () {
      updateIdeaCount();
      if (state.localLLM.running) {
        cancelLocalFill('整体描述已修改，已中止上一次本地模型请求；已有框内容保留，请重新提交。');
      }
    });
    if (el.localLLMApiRoot) {
      el.localLLMApiRoot.addEventListener('change', onLocalSettingsChange);
      el.localLLMApiRoot.addEventListener('blur', onLocalSettingsChange);
    }
    if (el.localLLMModel) {
      el.localLLMModel.addEventListener('change', onLocalSettingsChange);
      el.localLLMModel.addEventListener('blur', onLocalSettingsChange);
    }
    if (el.localLLMAbort) el.localLLMAbort.addEventListener('click', abortLocalFill);
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
    syncLocalSettingsUI();
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
      el.searchInput.placeholder = '搜索 ' + count + ' 条词库（规则次要路径）、已填框、收藏和历史…';
    }
    updateStaleUI();
  }

  init();
})();
