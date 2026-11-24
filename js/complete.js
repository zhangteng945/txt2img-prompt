/*
 * complete.js — 克制地补全空白维度
 *
 * 只补光线、镜头和基础真实摄影质感；不编造人物身份、服装、场景或剧情。
 * 每一条补全都会记录在 slot.completionItems 中，界面据此显示「补全」标记。
 */
(function () {
  'use strict';

  const T2I = (window.T2I = window.T2I || {});
  const TR = T2I.Translator;
  const SF = T2I.SlotFill;

  // 日常动物主体：只补真实摄影质感，不补人像皮肤纹理。
  const ANIMAL_SUBJECT_RE = /\b(?:cat|dog|puppy|kitten|rabbit|bunny|fox|deer|horse|bird|butterfly|dragon|wolf|shiba|retriever|golden retriever|corgi|poodle|husky|samoyed|collie|labrador|shepherd|bichon|pomeranian|ragdoll|shorthair|siamese|persian|maine coon|tabby|tuxedo|hamster|guinea pig|squirrel|hedgehog|parrot|pigeon|duck|chicken|goose|pig|cow|sheep|goat|donkey|camel|panda|monkey|elephant|lion|tiger|bear|penguin|dolphin|whale|shark|sea turtle|octopus|crab|frog|snake|lizard|spider|ant|bee|dragonfly|goldfish|koi)\b/i;

  function categoriesIn(text) {
    return TR.scanEn(text || '').map(function (m) { return m.entry.category; });
  }

  function complete(slots, options) {
    const added = [];
    // 默认关闭：用户没提光线 / 镜头 / 画风时不再自动补。只有界面显式勾选
    // 「允许规则补全」并传入 { enabled: true } 才运行。
    if (!options || options.enabled !== true) {
      SF.refreshText(slots);
      return { slots: slots, added: added };
    }

    const lightSlot = slots.light;
    const lightCats = categoriesIn(lightSlot.en);
    const hasLight = lightCats.indexOf('light') !== -1;
    const hasCamera = lightCats.indexOf('camera') !== -1;

    if (!hasLight) {
      const item = {
        zh: '柔和自然光',
        en: 'soft natural light',
        reason: '未提及光线，按真实摄影默认补全'
      };
      SF.addCompletion(lightSlot, item);
      added.push({ slot: 'light', zh: item.zh, en: item.en, reason: item.reason });
    }

    if (!hasCamera) {
      const item = {
        zh: '50mm 镜头',
        en: '50mm lens',
        reason: '未提及镜头，按自然的人像视角补全'
      };
      SF.addCompletion(lightSlot, item);
      added.push({ slot: 'light', zh: item.zh, en: item.en, reason: item.reason });
    }

    const styleSlot = slots.style;
    if (!styleSlot.en.trim()) {
      const base = {
        zh: '真实摄影',
        en: 'realistic photography',
        reason: '未提及画风，按真实摄影默认补全'
      };
      SF.addCompletion(styleSlot, base);
      added.push({ slot: 'style', zh: base.zh, en: base.en, reason: base.reason });

      const personText = slots.person.en.trim();
      const animalOnly = ANIMAL_SUBJECT_RE.test(personText) &&
        !/(woman|man|girl|boy|person|child|model|knight|elf|princess|prince|witch|mage|warrior|dancer|student|detective|cowboy|pirate|ninja|nun|maid|butler)/i.test(personText);
      if (personText && !animalOnly) {
        const texture = {
          zh: '自然肤质',
          en: 'natural skin texture',
          reason: '已有主体，补全自然的皮肤质感'
        };
        SF.addCompletion(styleSlot, texture);
        added.push({ slot: 'style', zh: texture.zh, en: texture.en, reason: texture.reason });
      }
    }

    SF.refreshText(slots);
    return { slots: slots, added: added };
  }

  T2I.Complete = { complete: complete };
})();
