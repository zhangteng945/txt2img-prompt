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
      /\b(on|at|in|toward|towards|after|by|against|into|over|under|next to|from|onto|along|through|between|near|behind|in front of|across from)\b/i.test(phrase);
  }

  // 简单动作（walking / sitting / standing）紧跟在人物后面时不加逗号：
  // a girl walking on the beach 比 a girl, walking, on the beach 自然。
  function looksLikeBarePose(phrase) {
    return /^[a-z]+ing\b/i.test(phrase);
  }

  // 关系句拆框后，场景框里是方位短语（on the beach / in front of the window）。
  // 它应紧贴前面的动作，拼回 walking on the beach。
  function looksLikeLocativeScene(phrase) {
    return /^(on|onto|in|into|at|by|near|under|behind|next to|between|in front of|across from|across|along|through|from|toward|towards|against|inside|outside|over)\b/i.test(phrase);
  }

  // 日常动物主体：只补真实摄影质感，不补人像皮肤纹理。
  const ANIMAL_SUBJECT_RE = /\b(?:cat|dog|puppy|kitten|rabbit|bunny|fox|deer|horse|bird|butterfly|dragon|wolf|shiba|retriever|golden retriever|corgi|poodle|husky|samoyed|collie|labrador|shepherd|bichon|pomeranian|ragdoll|shorthair|siamese|persian|maine coon|tabby|tuxedo|hamster|guinea pig|squirrel|hedgehog|parrot|pigeon|duck|chicken|goose|pig|cow|sheep|goat|donkey|camel|panda|monkey|elephant|lion|tiger|bear|penguin|dolphin|whale|shark|sea turtle|octopus|crab|frog|snake|lizard|spider|ant|bee|dragonfly|goldfish|koi)\b/i;

  function selectQuality(styleText, allText, hasPerson) {
    const nonPhoto = NON_PHOTO_RE.test(styleText);
    const candidates = nonPhoto
      ? ['highly detailed', 'sharp focus', 'intricate details']
      : ['highly detailed', 'sharp focus', hasPerson ? 'natural skin texture' : 'professional photography'];

    return candidates.filter(function (term) {
      return !hasTerm(allText, term);
    });
  }

  function assemble(slots, options) {
    const noLexicon = !!(options && (options.noLexicon || options.source === 'local-llm')) ||
      !!(slots && slots.__scene && slots.__scene.englishFrom === 'model');
    const addQuality = !!(options && options.quality === true) && !noLexicon;
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

        // 服装框里的 wearing / in / dressed in 是关系短语，紧贴人物更自然：
        // a girl wearing a white dress。
        if (def.key === 'outfit' && lastPhraseSlot === 'person' &&
            /^(wearing|in |dressed in|with )/i.test(phrase)) {
          phrases[phrases.length - 1] += ' ' + phrase;
          allText = phrases.join(', ');
          lastPhraseSlot = 'outfit';
          changed = true;
          return;
        }

        if (def.key === 'pose' && (lastPhraseSlot === 'person' || lastPhraseSlot === 'outfit') &&
            (looksLikeRelationAction(phrase) || looksLikeBarePose(phrase))) {
          // 人物 + 动作直接相连；人物 + 服装后再接动作时用逗号，
          // 更接近 a girl wearing a white dress, standing under a tree。
          phrases[phrases.length - 1] += (lastPhraseSlot === 'outfit' ? ', ' : ' ') + phrase;
          allText = phrases.join(', ');
          lastPhraseSlot = 'pose';
          changed = true;
          return;
        }

        // 姿态框是动作、场景框是方位短语时，合成 walking on the beach。
        if (def.key === 'scene' && lastPhraseSlot === 'pose' && looksLikeLocativeScene(phrase)) {
          phrases[phrases.length - 1] += ' ' + phrase;
          allText = phrases.join(', ');
          lastPhraseSlot = 'scene';
          changed = true;
          return;
        }

        phrases.push(phrase);
        allText += (allText ? ', ' : '') + phrase;
        lastPhraseSlot = def.key;
        changed = true;
      });

      let zh = U.cleanChinese(slot.zh || '');
      if (!zh && !noLexicon) {
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
    const animalOnly = ANIMAL_SUBJECT_RE.test(personText) &&
      !/(woman|man|girl|boy|person|child|model|knight|elf|princess|prince|witch|mage|warrior|dancer|student|detective|cowboy|pirate|ninja|nun|maid|butler)/i.test(personText);
    const quality = selectQuality(styleSlot.en || '', allText, !!personText.trim() && !animalOnly);

    if (addQuality && quality.length) {
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
