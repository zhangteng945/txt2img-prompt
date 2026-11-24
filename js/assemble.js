/*
 * assemble.js — 按 SDXL 常用顺序组装最终提示词
 *
 * 顺序：人物外貌 → 服装造型 → 姿态动作 → 场景背景 → 光线镜头 → 画风质感
 *      → 少量、克制的质量词。
 * 使用英文框当前内容（用户改过的英文优先）；中文对照同样使用中文框当前内容。
 */
(function () {
  'use strict';

  const T2I = (window.T2I = window.T2I || {});
  const U = T2I.Utils;
  const TR = T2I.Translator;
  const SF = T2I.SlotFill;

  const QUALITY_ZH = {
    'highly detailed': '细节丰富',
    'sharp focus': '清晰对焦',
    'natural skin texture': '自然肤质',
    'professional photography': '专业摄影',
    'intricate details': '精致细节'
  };

  const NON_PHOTO_RE = /(anime|manga|illustration|watercolor|oil painting|3d render|cgi|concept art|digital painting|low poly|pixel art|claymation|ink painting|ukiyo-e|comic|cartoon|clay|surrealism)/i;

  function phrasesOf(text) {
    return U.splitPhrases(text)
      .map(function (p) { return U.cleanEnglish(p); })
      .filter(function (p) { return p && p.replace(/[,\s]/g, ''); });
  }

  function hasTerm(text, term) {
    return text.toLowerCase().indexOf(term.toLowerCase()) !== -1;
  }

  // 关系句会把同一物体放进姿态（peeing on a car wheel）和场景（car wheel）。
  // 已被前面的完整短语覆盖时不再重复输出；按单词边界判断，避免把 man
  // 误判成 woman 的一部分。
  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function alreadyCovered(phrase, allText) {
    if (!allText) return false;
    const re = new RegExp('(^|[^a-z0-9])' + escapeRegExp(phrase.toLowerCase()) + '([^a-z0-9]|$)', 'i');
    return re.test(allText.toLowerCase());
  }

  // 关系句的姿态短语自带目标（peeing on a car wheel）。它紧跟在人物后面时，
  // 合成 a dog peeing on a car wheel，比 a dog, peeing on... 更自然。
  function looksLikeRelationAction(phrase) {
    return /^[a-z]+ing\b/i.test(phrase) &&
      /\b(on|at|in|toward|towards|after|by|against|into|over|under|next to)\b/i.test(phrase);
  }

  function selectQuality(styleText, allText, hasPerson) {
    const nonPhoto = NON_PHOTO_RE.test(styleText);
    const candidates = nonPhoto
      ? ['highly detailed', 'sharp focus', 'intricate details']
      : ['highly detailed', 'sharp focus', hasPerson ? 'natural skin texture' : 'professional photography'];

    return candidates.filter(function (term) {
      return !hasTerm(allText, term);
    });
  }

  function assemble(slots) {
    const phrases = [];
    const zhSections = [];
    const seen = Object.create(null);
    let allText = '';
    let lastPhraseSlot = '';

    SF.definitions.forEach(function (def) {
      const slot = slots[def.key] || { en: '', zh: '' };
      const enList = phrasesOf(slot.en);
      let changed = false;
      enList.forEach(function (phrase) {
        const k = phrase.toLowerCase();
        if (seen[k] || alreadyCovered(phrase, allText)) return;
        seen[k] = true;

        if (def.key === 'pose' && lastPhraseSlot === 'person' && looksLikeRelationAction(phrase)) {
          phrases[phrases.length - 1] += ' ' + phrase;
          allText = phrases.join(', ');
          lastPhraseSlot = 'pose';
          changed = true;
          return;
        }

        phrases.push(phrase);
        allText += (allText ? ', ' : '') + phrase;
        lastPhraseSlot = def.key;
        changed = true;
      });

      let zh = U.cleanChinese(slot.zh || '');
      if (!zh) {
        const fallback = TR.translateEn(slot.en || '');
        zh = fallback.zh || '';
      }
      if (zh) {
        zhSections.push({ label: def.label, zh: zh });
      }
      // 如果英文全部被去重，中文仍保留，保证对照不丢信息。
      if (!changed && zh && zhSections.length) {
        const last = zhSections[zhSections.length - 1];
        if (last.label === def.label) last.zh = zh;
      }
    });

    const styleSlot = slots.style || { en: '' };
    const personSlot = slots.person || { en: '' };
    const personText = personSlot.en || '';
    const animalOnly = /(cat|dog|rabbit|fox|deer|horse|bird|butterfly|dragon|wolf|kitten|puppy|shiba|retriever)/i.test(personText) &&
      !/(woman|man|girl|boy|person|child|model|knight|elf|princess|prince|witch|mage|warrior|dancer|student|detective|cowboy|pirate|ninja|nun|maid|butler)/i.test(personText);
    const quality = selectQuality(styleSlot.en || '', allText, !!personText.trim() && !animalOnly);

    if (quality.length) {
      quality.forEach(function (term) {
        phrases.push(term);
        allText += (allText ? ', ' : '') + term;
      });
      zhSections.push({
        label: '质量词',
        zh: quality.map(function (term) { return QUALITY_ZH[term] || term; }).join('，')
      });
    }

    const positiveEn = U.joinPhrasesEn(phrases);
    const positiveZh = zhSections
      .filter(function (section) { return section.zh; })
      .map(function (section) { return section.label + '：' + section.zh; })
      .join('；');
    const positiveZhPlain = zhSections.map(function (section) { return section.zh; }).join('，');

    return {
      positiveEn: positiveEn,
      positiveZh: positiveZh,
      positiveZhPlain: positiveZhPlain,
      sections: zhSections,
      quality: quality,
      qualityZh: quality.map(function (term) { return QUALITY_ZH[term] || term; }),
      hasUntranslated: U.hasCjk(positiveEn),
      phraseCount: phrases.length
    };
  }

  T2I.Assemble = { assemble: assemble, selectQuality: selectQuality };
})();
