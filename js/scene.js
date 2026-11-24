/*
 * scene.js — 面向绘画描述的结构化场景编译
 *
 * 这一层不再把中文当成「一串要填进六个框的标签」，而是先编出一棵
 * 对象-属性-关系树：
 *
 *   subject(女孩) --wearing--> outfit(连衣裙) --color--> 白色
 *   subject(女孩) --next_to--> object(汽车) --color--> 蓝色
 *   object(房子) --distance--> 远处 --color--> 白色
 *
 * 中文和英文都从这棵树投影出来；六个框只是树的一个视图。
 * 词典负责零件译名，模板负责关系表达，不要求整句预先存在。
 * 规则覆盖不到的地方保留原文并标记 unknown / ambiguity，不假装理解。
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

  const NOUN_CATEGORIES = ['subject', 'outfit', 'accessory', 'object', 'scene', 'body', 'eyes', 'hair'];
  const PERSON_CATEGORIES = ['subject', 'appearance', 'hair', 'eyes', 'expression', 'makeup'];
  const OUTFIT_CATEGORIES = ['outfit', 'accessory', 'shoe'];
  const PLACE_CATEGORIES = ['scene', 'object', 'time', 'weather'];

  const WEARING_MARKERS = ['穿着', '身穿', '穿了', '身着', '套着', '披着', '戴着', '围系'];
  const ACTION_LOCATIVE_MARKERS = ['走在', '坐在', '躺在', '靠在', '蹲在', '跪在', '站在', '跑在', '爬到', '走到'];
  const CONTRAST_PREFIX = /^(但是|不过|然而|但|而|可是)\s*/;
  const NEGATION_MARKERS = ['不要', '不想', '别', '避免', '不能', '不可', '请勿', '切勿', '勿', '没有', '不含', '去除', '去掉', '排除'];
  const ALLOW_MARKERS = ['可以', '允许', '能够', '可'];

  const SUFFIX_RE = /(后面|前面|下面|里面|上面|旁边|之间|中间|附近|对面|之下|之中|旁|边|上|里|中|前|后|下|外)$/;

  const STRUCTURAL_MARKERS = [
    '其他部分', '其他', '其余', '其它', '剩下', '画面深处', '画面远处', '背景里',
    '不远处', '远处', '近处', '旁边', '对面', '附近', '前面', '后面', '上面',
    '沿着', '沿',
    '下面', '里面', '中间', '之间', '除了', '部分', '使用', '采用', '但是',
    '不过', '然而', '并且', '以及', '还有', '不要', '不想', '避免', '去除',
    '去掉', '排除', '禁止', '严禁', '切勿', '可以', '允许', '能够', '出现',
    '一座', '一辆', '一栋', '一间', '一个', '一位', '一名', '一只', '一条',
    '一片', '一排', '两座', '两辆', '几个', '的', '地', '得', '了', '着',
    '和', '与', '及', '或', '但', '而', '都', '也', '全部', '均', '有',
    '在', '上', '下', '里', '中', '旁', '前', '后', '边', '内', '外'
  ].sort(function (a, b) { return b.length - a.length; });

  const STOP_CHARS = (function () {
    const set = Object.create(null);
    TR.stopZh.forEach(function (word) {
      if (word.length === 1) set[word] = true;
    });
    '的了着过和与及或但而都也还又很太更最带有个位件条双只张座片群套头身款种些上下里中旁前后边内外处间'.split('').forEach(function (ch) {
      set[ch] = true;
    });
    return set;
  })();

  // 颜色别名：按长度从长到短，保证「深蓝色」不会被「深蓝」或「蓝」抢先。
  const COLOR_ALIASES = [];
  (L.byCategory.color || []).forEach(function (entry) {
    entry.zhAliases.forEach(function (alias) {
      COLOR_ALIASES.push({ alias: alias, entry: entry });
    });
  });
  COLOR_ALIASES.sort(function (a, b) { return b.alias.length - a.alias.length; });

  // 发色 / 发型、外貌、材质都从词库动态取，不维护整句模板。
  function aliasesOf(categories) {
    const out = [];
    categories.forEach(function (category) {
      (L.byCategory[category] || []).forEach(function (entry) {
        entry.zhAliases.forEach(function (alias) {
          out.push({ alias: alias, entry: entry });
        });
      });
    });
    return out.sort(function (a, b) { return b.alias.length - a.alias.length; });
  }

  const HAIR_ALIASES = aliasesOf(['hair']);
  const APPEARANCE_ALIASES = aliasesOf(['appearance']);
  const EYES_ALIASES = aliasesOf(['eyes']);
  const MATERIAL_ALIASES = aliasesOf(['material']);
  const ACTION_EN_ALIASES = (function () {
    const map = Object.create(null);
    (L.byCategory.pose || []).concat(L.byCategory.action || [], L.byCategory.expression || []).forEach(function (entry) {
      entry.enAliases.forEach(function (en) {
        if (/^[A-Za-z][A-Za-z -]*$/.test(en)) map[en.toLowerCase()] = true;
      });
    });
    return Object.keys(map).sort(function (a, b) { return b.length - a.length; });
  })();

  const PRE_PERSON_EN = Object.create(null);
  [
    'young', 'middle-aged', 'elderly', 'cute', 'mature', 'elegant', 'poised',
    'slim', 'tall', 'petite', 'well-proportioned', 'athletic', 'muscular',
    'curvy', 'fair-skinned', 'tan-skinned', 'dark-skinned',
    'pretty', 'beautiful', 'good-looking', 'handsome', 'attractive',
    'stunning', 'gorgeous', 'lovely', 'charming'
  ].forEach(function (w) { PRE_PERSON_EN[w] = true; });

  const QUANTIFIER_RE = /^(?:一|两|几|这|那)?(?:个|位|名|件|条|双|只|把|张|座|片|群|套|头|身|款|种|辆|栋|间|棵|朵|排|块|根)?/;

  function cleanText(text) {
    return String(text == null ? '' : text).replace(/^[，,、；;。.!！?？\s]+|[，,、；;。.!！?？\s]+$/g, '').trim();
  }

  function stripQuantifier(text) {
    return cleanText(text).replace(QUANTIFIER_RE, '').trim();
  }

  function stripLeadingContrast(text) {
    return cleanText(text).replace(CONTRAST_PREFIX, '').trim();
  }

  // 除了标点，转折词本身也常常是子句边界：「人物不要模糊但背景可以虚化」。
  function splitClauses(text) {
    const normalized = String(text || '').replace(/(^|[^不])但(?:是)?/g, function (m, prefix) {
      return prefix + '，但';
    }).replace(/(^|[^不])不过/g, function (m, prefix) {
      return prefix + '，不过';
    }).replace(/(^|[^然])然而/g, function (m, prefix) {
      return prefix + '，然而';
    });
    return U.splitPhrases(normalized);
  }

  function stripParticle(text) {
    return String(text || '').replace(/^[的地得]+|[的地得]+$/g, '').trim();
  }

  function hasCjk(text) {
    return U.hasCjk(text);
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function hasWord(text, term) {
    const t = String(text || '');
    const w = String(term || '').trim();
    if (!w) return false;
    if (!/^[A-Za-z]/.test(w)) return t.toLowerCase().indexOf(w.toLowerCase()) !== -1;
    return new RegExp('(^|[^a-z0-9])' + escapeRegExp(w.toLowerCase()) + '([^a-z0-9]|$)', 'i').test(t.toLowerCase());
  }

  function uniqueByEn(list) {
    const seen = Object.create(null);
    const out = [];
    (list || []).forEach(function (item) {
      if (!item || !item.en) return;
      const key = String(item.en).toLowerCase().trim();
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(item);
    });
    return out;
  }

  function addArticle(en) {
    const text = String(en || '').trim();
    if (!text || hasCjk(text)) return text;
    return TR.withIndefiniteArticle(text);
  }

  // ── 多候选切分图 ────────────────────────────────────────────
  // 每个位置保留若干条候选边（词典长词、结构标记、未知字），用动态规划
  // 取前三条路径。前两条分数接近且切法不同 → 保留歧义，不假装唯一。

  function candidatesAt(text, index) {
    const source = String(text || '');
    const ch = source.charAt(index);
    const out = [];
    const bucket = L.zhIndex[String(ch).toLowerCase()] || [];
    for (let i = 0; i < bucket.length && out.length < 120; i += 1) {
      const cand = bucket[i];
      if (!source.startsWith(cand.alias, index)) continue;
      if (!TR.isAliasAllowed(cand, source, index)) continue;
      out.push({
        kind: 'lexicon',
        alias: cand.alias,
        entry: cand.entry,
        start: index,
        end: index + cand.alias.length
      });
    }
    for (let i = 0; i < STRUCTURAL_MARKERS.length; i += 1) {
      const marker = STRUCTURAL_MARKERS[i];
      if (!source.startsWith(marker, index)) continue;
      out.push({
        kind: 'marker',
        alias: marker,
        entry: null,
        start: index,
        end: index + marker.length
      });
      break;
    }
    if (/^[\s，,。.、；;：:！!？?（）()【】\[\]{}<>《》〈〉「」『』“”‘’"'…—\-·/\\|+*=&%#@~`^]$/.test(ch)) {
      out.push({ kind: 'punct', alias: ch, entry: null, start: index, end: index + 1 });
    }
    // 没有任何命中时允许一个未知字边，保证路径能走完整句。
    if (!out.length) {
      out.push({ kind: 'unknown', alias: ch, entry: null, start: index, end: index + 1 });
    }
    return out;
  }

  function hasCategoryAt(text, index, categories) {
    const bucket = L.zhIndex[String(String(text).charAt(index)).toLowerCase()] || [];
    for (let i = 0; i < bucket.length; i += 1) {
      if (text.startsWith(bucket[i].alias, index) && categories.indexOf(bucket[i].entry.category) !== -1) return true;
    }
    return false;
  }

  function previousLex(tokens) {
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      if (tokens[i].kind === 'lexicon') return tokens[i];
    }
    return null;
  }

  function edgeScore(text, edge, tokens) {
    const prev = previousLex(tokens);
    if (edge.kind === 'unknown') return -24;
    if (edge.kind === 'punct') return -4;
    if (edge.kind === 'marker') return 1 + edge.alias.length * 0.2;
    const len = edge.alias.length;
    let score = 12 + len * len * 1.4 - 4;
    const category = edge.entry.category;
    if (category === 'subject') score += edge.start === 0 ? 20 : 8;
    if (category === 'sign') score += 40;
    if (['hair', 'eyes', 'appearance'].indexOf(category) !== -1 && hasCategoryAt(text, edge.end, ['subject'])) score += 12;
    if (category === 'color') {
      if (hasCategoryAt(text, edge.end, NOUN_CATEGORIES)) score += 9;
      else score -= 3;
    }
    if (OUTFIT_CATEGORIES.indexOf(category) !== -1 && prev && WEARING_MARKERS.indexOf(prev.alias) !== -1) score += 18;
    if (['pose', 'action', 'expression'].indexOf(category) !== -1 && prev && prev.entry && prev.entry.category === 'subject') score += 14;
    if (['object', 'scene'].indexOf(category) !== -1 && prev && prev.entry && prev.entry.category === 'color') score += 10;
    if (prev && prev.entry && prev.entry.category === 'color' && category === 'subject') score -= 12;
    return score;
  }

  function pathKey(tokens) {
    return tokens.map(function (t) { return t.kind + ':' + t.alias; }).join('|');
  }

  function pushState(states, state) {
    const key = pathKey(state.tokens);
    for (let i = 0; i < states.length; i += 1) {
      if (pathKey(states[i].tokens) === key) {
        if (state.score > states[i].score) states[i] = state;
        states.sort(function (a, b) { return b.score - a.score; });
        return;
      }
    }
    states.push(state);
    states.sort(function (a, b) { return b.score - a.score; });
    if (states.length > 3) states.length = 3;
  }

  function contentCategorySignature(tokens) {
    const set = [];
    (tokens || []).forEach(function (token) {
      const cat = tokenCategory(token);
      if (!cat || ['connector', 'negative'].indexOf(cat) !== -1) return;
      if (set.indexOf(cat) === -1) set.push(cat);
    });
    return set.sort().join('+');
  }

  function segmentLattice(text) {
    const source = String(text || '');
    const n = source.length;
    const states = new Array(n + 1);
    const candidateEdges = [];
    const candidateSeen = Object.create(null);
    for (let i = 0; i <= n; i += 1) states[i] = [];
    states[0].push({ score: 0, tokens: [] });
    for (let i = 0; i < n; i += 1) {
      if (!states[i].length) continue;
      const edges = candidatesAt(source, i);
      edges.forEach(function (edge) {
        if (edge.end <= i) return;
        const key = edge.start + ':' + edge.end + ':' + edge.alias;
        if (!candidateSeen[key]) {
          candidateSeen[key] = true;
          candidateEdges.push({
            start: edge.start,
            end: edge.end,
            alias: edge.alias,
            kind: edge.kind,
            category: edge.entry ? edge.entry.category : ''
          });
        }
        states[i].forEach(function (state) {
          const score = state.score + edgeScore(source, edge, state.tokens);
          pushState(states[edge.end], {
            score: score,
            tokens: state.tokens.concat([edge])
          });
        });
      });
    }
    const finals = states[n] || [];
    const best = finals[0] || { score: 0, tokens: [] };
    const alternatives = finals.slice(1).filter(function (alt) {
      return pathKey(alt.tokens) !== pathKey(best.tokens);
    });
    const bestSig = contentCategorySignature(best.tokens);
    const ambiguous = alternatives.length > 0 && (best.score - alternatives[0].score) < 9 &&
      alternatives.some(function (alt) { return contentCategorySignature(alt.tokens) !== bestSig; });
    return {
      tokens: mergeUnknown(best.tokens),
      score: best.score,
      alternatives: alternatives.map(function (alt) { return mergeUnknown(alt.tokens); }),
      ambiguous: ambiguous,
      alternativesText: alternatives.map(function (alt) {
        return mergeUnknown(alt.tokens).map(function (t) { return t.alias; }).join(' / ');
      }),
      candidates: candidateEdges,
      candidateCount: candidateEdges.length
    };
  }

  function mergeUnknown(tokens) {
    const out = [];
    (tokens || []).forEach(function (token) {
      if (token.kind === 'unknown' && out.length && out[out.length - 1].kind === 'unknown') {
        const last = out[out.length - 1];
        last.alias += token.alias;
        last.end = token.end;
      } else {
        out.push(Object.assign({}, token));
      }
    });
    return out;
  }

  function tokenCategory(token) {
    return token && token.entry ? token.entry.category : '';
  }

  // ── 词典零件解析 ────────────────────────────────────────────

  function parseColorPrefix(text) {
    const source = cleanText(text);
    for (let i = 0; i < COLOR_ALIASES.length; i += 1) {
      const item = COLOR_ALIASES[i];
      if (!source.startsWith(item.alias)) continue;
      let rest = source.slice(item.alias.length);
      if (rest.charAt(0) === '色' && item.alias.charAt(item.alias.length - 1) !== '色') {
        rest = rest.slice(1);
      }
      rest = rest.replace(/^[的地得]+/, '');
      return {
        color: { zh: item.entry.zh, en: item.entry.en, alias: item.alias, category: 'color' },
        rest: rest
      };
    }
    // 词库没有整条「浅紫」时，用「程度词 + 基础色」组合，不新增整句词条。
    const modifier = source.match(/^(浅|深|淡|亮|暗)(.+)$/);
    if (modifier) {
      const base = parseColorPrefix(modifier[2]);
      if (base && base.rest) {
        const prefixMap = { '浅': 'light', '深': 'dark', '淡': 'pale', '亮': 'bright', '暗': 'dim' };
        return {
          color: {
            zh: modifier[1] + base.color.zh,
            en: prefixMap[modifier[1]] + ' ' + base.color.en,
            alias: modifier[1] + base.color.alias,
            category: 'color'
          },
          rest: base.rest
        };
      }
    }
    return null;
  }

  function parseHairPrefix(text) {
    const source = cleanText(text);
    for (let i = 0; i < HAIR_ALIASES.length; i += 1) {
      const item = HAIR_ALIASES[i];
      if (!source.startsWith(item.alias)) continue;
      const rest = source.slice(item.alias.length).replace(/^[的地得]+/, '');
      if (!rest) continue;
      return {
        attr: { kind: 'hair', zh: item.entry.zh, en: item.entry.en, category: 'hair' },
        rest: rest
      };
    }
    return null;
  }

  function parseAppearancePrefix(text) {
    const source = cleanText(text);
    for (let i = 0; i < APPEARANCE_ALIASES.length; i += 1) {
      const item = APPEARANCE_ALIASES[i];
      if (!source.startsWith(item.alias)) continue;
      const rest = source.slice(item.alias.length).replace(/^[的地得]+/, '');
      if (!rest) continue;
      // 只有后面确实还是人物时才当作外貌前缀，避免把「优雅的咖啡馆」拆错。
      return {
        attr: { kind: 'appearance', zh: item.entry.zh, en: item.entry.en, category: 'appearance' },
        rest: rest
      };
    }
    return null;
  }

  function parseEyesPrefix(text) {
    const source = cleanText(text);
    for (let i = 0; i < EYES_ALIASES.length; i += 1) {
      const item = EYES_ALIASES[i];
      if (!source.startsWith(item.alias)) continue;
      const rest = source.slice(item.alias.length).replace(/^[的地得]+/, '');
      if (!rest) continue;
      return {
        attr: { kind: 'eyes', zh: item.entry.zh, en: item.entry.en, category: 'eyes' },
        rest: rest
      };
    }
    return null;
  }

  function parseMaterialPrefix(text) {
    const source = cleanText(text);
    for (let i = 0; i < MATERIAL_ALIASES.length; i += 1) {
      const item = MATERIAL_ALIASES[i];
      if (!source.startsWith(item.alias)) continue;
      const rest = source.slice(item.alias.length).replace(/^[的地得]+/, '');
      if (!rest) continue;
      return {
        attr: { kind: 'material', zh: item.entry.zh, en: item.entry.en, category: 'material' },
        rest: rest
      };
    }
    return null;
  }

  function impliedClothing(text, color, attrs) {
    const source = cleanText(text);
    const m = source.match(/^(衣服|服装|衣物|衣裳|上衣|衣)(.*)$/);
    if (!m) return null;
    return {
      zh: color ? color.zh + '衣' : m[1],
      en: color ? color.en + ' clothes' : 'clothes',
      color: color || null,
      implied: true,
      attributes: attrs || []
    };
  }

  function translateNoun(text, slot) {
    const source = cleanText(text);
    if (!source) return null;
    const result = TR.translateZhPhrase(source, { slot: slot, allowRelation: false });
    const unknown = (result.unknown || []).filter(function (item) {
      return hasCjk(item) && String(item).replace(/[的了着过和与及或在地得]/g, '').trim();
    });
    if (!result.en || unknown.length || hasCjk(result.en)) return null;
    return {
      en: U.cleanEnglish(result.en),
      zh: result.zh || source,
      matches: result.matches || [],
      unknown: result.unknown || []
    };
  }

  function parseSubjectPhrase(text) {
    let rest = stripQuantifier(text);
    const attrs = [];
    let outfit = null;
    let guard = 0;
    while (rest && guard < 6) {
      guard += 1;
      const hair = parseHairPrefix(rest);
      if (hair) { attrs.push(hair.attr); rest = hair.rest; continue; }
      const eyes = parseEyesPrefix(rest);
      if (eyes) { attrs.push(eyes.attr); rest = eyes.rest; continue; }
      const appearance = parseAppearancePrefix(rest);
      if (appearance) { attrs.push(appearance.attr); rest = appearance.rest; continue; }
      const color = parseColorPrefix(rest);
      if (color) {
        const cloth = impliedClothing(color.rest, color.color, []);
        if (cloth) { outfit = cloth; rest = color.rest.replace(/^(衣服|服装|衣物|衣裳|上衣|衣)/, ''); continue; }
      }
      break;
    }
    rest = stripParticle(rest);
    if (!rest) return null;
    const pronounMap = {
      '她': 'a woman', '他': 'a man', '她们': 'people', '他们': 'people',
      '我': 'a person', '你': 'a person', '它': 'an animal'
    };
    let baseEn = pronounMap[rest] || '';
    let baseZh = rest;
    if (!baseEn) {
      const noun = translateNoun(rest, 'person');
      if (!noun) return null;
      const cats = (noun.matches || []).map(function (m) { return m.entry.category; });
      if (cats.some(function (category) {
        return ['subject', 'appearance', 'hair', 'eyes', 'expression', 'makeup'].indexOf(category) === -1;
      })) return null;
      baseEn = noun.en;
      baseZh = noun.zh;
    }
    let en = addArticle(baseEn);
    const pre = [];
    attrs.forEach(function (attr) {
      if (attr.kind === 'appearance' && PRE_PERSON_EN[attr.en]) pre.push(attr.en);
      else en += ' with ' + attr.en;
    });
    if (pre.length) {
      const article = en.match(/^(a|an|the)\s+(.*)$/i);
      en = article
        ? article[1] + ' ' + pre.join(' ') + ' ' + article[2]
        : pre.join(' ') + ' ' + en;
    }
    return {
      zh: baseZh,
      en: en,
      text: cleanText(text),
      attributes: attrs,
      outfit: outfit,
      matches: []
    };
  }

  function parseOutfitPhrase(text) {
    let rest = stripQuantifier(text);
    const attrs = [];
    let color = null;
    let guard = 0;
    while (rest && guard < 5) {
      guard += 1;
      const c = parseColorPrefix(rest);
      if (c) { color = c.color; rest = c.rest; continue; }
      const m = parseMaterialPrefix(rest);
      if (m) { attrs.push(m.attr); rest = m.rest; continue; }
      break;
    }
    rest = stripParticle(rest);
    if (!rest) {
      if (color) {
        return { zh: color.zh, en: color.en, color: color, attributes: attrs, implied: true };
      }
      return null;
    }
    const clothing = impliedClothing(rest, color, attrs);
    if (clothing && clothing.implied) return clothing;
    const noun = translateNoun(rest, 'outfit');
    if (!noun) return null;
    const nounCats = (noun.matches || []).map(function (m) { return m.entry.category; });
    if (!nounCats.length || nounCats.some(function (category) {
      return ['outfit', 'accessory', 'shoe', 'material', 'color', 'pattern'].indexOf(category) === -1;
    })) return null;
    let en = noun.en;
    const prefix = [];
    if (color && !new RegExp('^' + escapeRegExp(color.en), 'i').test(en)) prefix.push(color.en);
    attrs.forEach(function (attr) { prefix.push(attr.en); });
    if (prefix.length) {
      const prefixText = prefix.join(' ');
      if (en.indexOf(prefixText) === -1) en = prefixText + ' ' + en;
    }
    return {
      zh: (color ? color.zh : '') + noun.zh,
      en: en,
      color: color,
      attributes: attrs,
      matches: noun.matches
    };
  }

  function parseObjectPhrase(text) {
    let rest = stripQuantifier(text);
    let distance = '';
    const distanceMatch = rest.match(/^(远处|近处|不远处|背景里|画面远处|画面深处)(?:的)?/);
    if (distanceMatch) {
      distance = distanceMatch[1];
      rest = rest.slice(distanceMatch[0].length);
      rest = rest.replace(/^[的地得]+/, '');
    }
    let color = null;
    const c = parseColorPrefix(rest);
    if (c) { color = c.color; rest = c.rest; }
    rest = stripParticle(rest);
    if (!rest) return null;
    const noun = translateNoun(rest, 'scene');
    if (!noun) return null;
    const cats = (noun.matches || []).map(function (m) { return m.entry.category; });
    // 目标必须是物体 / 场景 / 时间 / 天气这类名词性概念；如果里面还夹着
    // 喂鸽子、看报纸之类的动作，说明这不是单纯的地点，交回完整关系解析。
    if (!cats.length || cats.some(function (category) {
      return ['object', 'scene', 'time', 'weather', 'color', 'material'].indexOf(category) === -1;
    })) return null;
    let en = noun.en;
    if (color && !new RegExp('^' + escapeRegExp(color.en), 'i').test(en)) en = color.en + ' ' + en;
    const category = noun.matches[0] ? noun.matches[0].entry.category : 'scene';
    return {
      zh: (color ? color.zh : '') + noun.zh,
      en: en,
      color: color,
      distance: distance,
      category: category,
      matches: noun.matches
    };
  }

  function splitSuffix(text) {
    const source = cleanText(text);
    const m = source.match(SUFFIX_RE);
    if (!m) return { text: source, suffix: '' };
    return { text: source.slice(0, source.length - m[1].length).trim(), suffix: m[1] };
  }

  function exactPlacePhrase(text) {
    const source = cleanText(text);
    if (!source) return null;
    const result = TR.translateZhPhrase(source, { slot: 'scene', allowRelation: false });
    if (!result.matches || result.matches.length !== 1) return null;
    const match = result.matches[0];
    if (match.start !== 0 || match.end !== source.length) return null;
    if (['scene', 'object', 'time', 'weather'].indexOf(match.entry.category) === -1) return null;
    if (!result.en || hasCjk(result.en)) return null;
    return {
      zh: result.zh || source,
      en: result.en,
      category: match.entry.category,
      color: null,
      distance: '',
      matches: result.matches
    };
  }

  function parseLocativeTarget(text) {
    const source = cleanText(text);
    const exact = exactPlacePhrase(source);
    if (exact) {
      return { target: exact, text: source, suffix: '' };
    }
    const parts = splitSuffix(source);
    const target = parseObjectPhrase(parts.text);
    return { target: target, text: parts.text, suffix: parts.suffix };
  }

  function suffixPrep(suffix, actionEn, targetEn, targetCategory) {
    if (/^lean/i.test(actionEn) && (suffix === '上' || suffix === '上面')) return 'against';
    if (suffix === '之间' || suffix === '中间') return 'between';
    if (suffix === '附近') return 'near';
    if (suffix === '对面') return 'across from';
    if (suffix === '里' || suffix === '里面' || suffix === '中' || suffix === '之中') return 'in';
    if (suffix === '旁边' || suffix === '旁' || suffix === '边') return 'next to';
    if (suffix === '前面' || suffix === '前') return 'in front of';
    if (suffix === '后面' || suffix === '后') return 'behind';
    if (suffix === '下面' || suffix === '下' || suffix === '之下') return 'under';
    if (suffix === '上面' || suffix === '上') return 'on';
    if (suffix === '外') return 'outside';
    return '';
  }

  function placementPrep(marker, actionEn, targetEn, targetCategory) {
    if (/walk/i.test(actionEn) || marker === '走在' || marker === '走到') {
      return targetCategory === 'object' ? 'on' : TR.placePrep(targetEn);
    }
    if (/sit|lying|lie|kneel|crouch/i.test(actionEn)) return 'on';
    if (/lean/i.test(actionEn)) {
      if (/window|wall/i.test(targetEn)) return 'against';
      if (/railing/i.test(targetEn)) return 'by';
      return 'on';
    }
    if (/stand/i.test(actionEn)) {
      if (targetCategory === 'object') {
        if (/window|wall/i.test(targetEn)) return 'by';
        return 'on';
      }
      return TR.placePrep(targetEn);
    }
    return targetCategory === 'object' ? 'on' : TR.placePrep(targetEn);
  }

  function actionInfo(actionZh) {
    const clean = cleanText(actionZh);
    if (!clean) return null;
    const map = {
      '站在': 'standing', '站着': 'standing',
      '坐在': 'sitting', '坐着': 'sitting',
      '躺在': 'lying down', '躺着': 'lying down',
      '靠在': 'leaning', '靠着': 'leaning',
      '走在': 'walking', '走着': 'walking',
      '蹲在': 'crouching', '蹲着': 'crouching',
      '跪在': 'kneeling', '跪着': 'kneeling',
      '跑在': 'running', '跑到': 'running',
      '爬到': 'climbing', '走到': 'walking'
    };
    if (map[clean]) {
      return { en: map[clean], zh: clean, matches: [], unknown: [] };
    }
    const body = translateBodyAction(clean);
    if (body) return body;
    const noun = translateNoun(clean, 'pose');
    if (noun) return { en: noun.en, zh: noun.zh, matches: noun.matches, unknown: noun.unknown };
    return null;
  }

  const BODY_VERBS = [
    { re: /^(举起|抬起|高举)/, en: 'raising' },
    { re: /^(伸出|探出)/, en: 'reaching out with' },
    { re: /^(握住|握紧|攥紧)/, en: 'gripping' },
    { re: /^(捂住|掩住)/, en: 'covering' },
    { re: /^(抚摸|摸着|摸摸|摸)/, en: 'touching' },
    { re: /^(弯曲|弯起)/, en: 'bending' },
    { re: /^(交叉)/, en: 'crossing' },
    { re: /^(张开|伸开|摊开)/, en: 'spreading' },
    { re: /^(放下|垂下)/, en: 'lowering' },
    { re: /^(摆动|摇晃)/, en: 'swinging' },
    { re: /^(拍打|轻拍)/, en: 'patting' }
  ];

  const BODY_PARTS = [
    ['五指', 'five fingers'], ['五根手指', 'five fingers'],
    ['右手', 'right hand'], ['左手', 'left hand'], ['双手', 'both hands'],
    ['手指', 'fingers'], ['手掌', 'palm'], ['拳头', 'fist'],
    ['右臂', 'right arm'], ['左臂', 'left arm'], ['手臂', 'arm'], ['双臂', 'both arms'], ['胳膊', 'arm'],
    ['右腿', 'right leg'], ['左腿', 'left leg'], ['双腿', 'both legs'], ['腿', 'leg'],
    ['右膝', 'right knee'], ['左膝', 'left knee'], ['双膝', 'both knees'], ['膝盖', 'knees'],
    ['右脚', 'right foot'], ['左脚', 'left foot'], ['双脚', 'both feet'],
    ['脚尖', 'toes'], ['脚', 'feet'], ['右肩', 'right shoulder'], ['左肩', 'left shoulder'], ['肩膀', 'shoulders'],
    ['右眼', 'right eye'], ['左眼', 'left eye'],
    ['背', 'back'], ['腰', 'waist'], ['头', 'head'], ['嘴', 'mouth'],
    ['眼睛', 'eyes'], ['头发', 'hair']
  ].sort(function (a, b) { return b[0].length - a[0].length; });

  function translateBodyAction(text) {
    const source = cleanText(text);
    for (let i = 0; i < BODY_VERBS.length; i += 1) {
      const verb = BODY_VERBS[i];
      const m = source.match(verb.re);
      if (!m) continue;
      let rest = source.slice(m[0].length).replace(/^[的地得]+/, '');
      if (!rest) continue;
      const part = BODY_PARTS.find(function (p) { return rest === p[0] || rest.startsWith(p[0]); });
      if (!part) continue;
      return {
        en: verb.en + ' ' + part[1],
        zh: source,
        matches: [],
        unknown: []
      };
    }
    return null;
  }

  // ── 子句编译 ────────────────────────────────────────────────

  function trySign(clause) {
    const text = cleanText(clause);
    const matches = TR.scanZh(text);
    if (matches.length === 1 && matches[0].start === 0 && matches[0].end === text.length &&
        matches[0].entry.category === 'sign') {
      return {
        handled: true,
        kind: 'sign',
        units: [makeUnit('scene', text, matches[0].entry.en, text, 'sign', { matches: matches })]
      };
    }
    return null;
  }

  function conceptTranslation(text) {
    let source = cleanText(text).replace(/^(任何|所有|出现|带有|的)+/g, '').trim();
    if (!source) return null;
    // 「不要戴帽子」里的「戴」是关系动词，排除对象是帽子，不是戴这个动作。
    const wearMatch = source.match(/^(戴着?|穿着?|系着?|围着?|披着?)(.+)$/);
    if (wearMatch) source = wearMatch[2].trim();
    if (!source) return null;
    const special = {
      '低饱和色彩': { zh: '低饱和', en: 'muted colors', category: 'style' },
      '低饱和度': { zh: '低饱和', en: 'muted colors', category: 'style' },
      '低饱和色调': { zh: '低饱和', en: 'muted colors', category: 'style' },
      '标识': { zh: '标志', en: 'logo', category: 'negative' },
      '文字': { zh: '文字', en: 'text', category: 'negative' },
      '水印': { zh: '水印', en: 'watermark', category: 'negative' },
      '帽子': { zh: '帽子', en: 'hat', category: 'accessory' },
      '模糊': { zh: '模糊', en: 'blurry', category: 'negative' },
      '虚化': { zh: '虚化', en: 'blurred', category: 'style' },
      '眼睛': { zh: '眼睛', en: 'eyes', category: 'eyes' }
    };
    if (special[source]) return special[source];
    const result = TR.translateZhPhrase(source, { allowRelation: false });
    const unknown = (result.unknown || []).filter(function (item) {
      return hasCjk(item) && String(item).replace(/[的了着过和与及或在地得]/g, '').trim();
    });
    if (!result.en || unknown.length || hasCjk(result.en)) return null;
    return {
      zh: result.zh || source,
      en: U.cleanEnglish(result.en),
      category: result.matches[0] ? result.matches[0].entry.category : ''
    };
  }

  function expandNegationTarget(text) {
    const source = cleanText(text);
    const parts = source.split(/和|与|及|以及|、|,|\//).map(cleanText).filter(Boolean);
    const out = [];
    parts.forEach(function (part) {
      const normalized = part.replace(/^(任何|所有|出现|带有|的)+/g, '').trim();
      if (!normalized) return;
      if (normalized.indexOf('文字') !== -1) {
        out.push({ zh: '文字', en: 'text', category: 'negative', expandedFrom: normalized });
        out.push({ zh: '标志', en: 'logo', category: 'negative', expandedFrom: normalized });
        return;
      }
      const concept = conceptTranslation(normalized);
      if (concept) out.push(concept);
      else out.push({ zh: normalized, en: normalized, category: '', unresolved: true });
    });
    return out;
  }

  function topicScope(topic) {
    if (!topic) return 'global';
    if (/画面|整张图|图片|镜头外|构图/.test(topic)) return 'global';
    if (/背景|环境|后景|远景/.test(topic)) return 'background';
    if (/人物|主体|人脸|面部|身体|衣服|服装|手部|头发|眼睛|角色|她|他|女人|男人|女孩|男孩|女子|男子|女生|男生|老人|儿童|婴儿|模特|孩子/.test(topic)) return 'subject';
    return 'global';
  }

  function topicZhEn(topic) {
    if (!topic) return { zh: '', en: '' };
    if (/背景|后景/.test(topic)) return { zh: '背景', en: 'background' };
    if (/环境/.test(topic)) return { zh: '环境', en: 'environment' };
    if (/面部|脸/.test(topic)) return { zh: '面部', en: 'face' };
    if (/身体/.test(topic)) return { zh: '身体', en: 'body' };
    if (/手/.test(topic)) return { zh: '手部', en: 'hands' };
    if (/头发/.test(topic)) return { zh: '头发', en: 'hair' };
    if (/眼睛/.test(topic)) return { zh: '眼睛', en: 'eyes' };
    if (/画面|整张图|图片/.test(topic)) return { zh: '', en: '' };
    return { zh: '人物', en: 'person' };
  }

  function parseNegation(clause, context) {
    const text = stripLeadingContrast(clause);
    let topic = '';
    let m = text.match(/^(人物|主体|人脸|面部|背景|环境|衣服|服装|身体|手部|头发|眼睛|画面里|画面|整张图)?(?:都|也|全部)?(不要|不想|别|避免|不能|不可|请勿|切勿|勿|没有|不含|去除|去掉|排除)(.+)$/);
    if (!m) {
      // 允许「女人不要戴帽子 / 背景里不要有水印」这种自然主语/范围前缀。
      m = text.match(/^(.{0,14}?)(不要|不想|别|避免|不能|不可|请勿|切勿|勿|没有|不含|去除|去掉|排除)(.+)$/);
    }
    if (!m) return null;
    topic = cleanText(m[1] || '');
    const targetText = cleanText(m[3]).replace(/^(出现|任何|所有|带有|有|的)+/g, '').trim();
    if (!targetText) return null;
    const targets = expandNegationTarget(targetText);
    if (!targets.length) return null;
    const scope = topicScope(topic || context.topic || '');
    const topicInfo = topicZhEn(topic);
    const record = {
      text: cleanText(clause),
      topic: topic || (scope === 'subject' ? '人物' : ''),
      scope: scope,
      targets: targets,
      rawTarget: targetText,
      negated: true
    };
    context.topic = scope === 'subject' ? 'subject' : (scope === 'background' ? 'background' : context.topic);
    const units = [];
    const subjects = [];
    if (scope === 'subject') {
      const subject = parseSubjectPhrase(topic && !/人脸|面部|身体|衣服|服装|手部|头发|眼睛/.test(topic) ? topic : '人物');
      if (subject) {
        const sid = nextId('s');
        units.push(makeUnit('person', subject.zh, subject.en, topic || '人物', 'subject', { entityId: sid }));
        subjects.push({
          id: sid, zh: subject.zh, en: subject.en, category: 'subject',
          attributes: subject.attributes || [], outfitColor: subject.outfit ? subject.outfit.color : null
        });
      }
    }
    return {
      handled: true,
      kind: 'negation',
      negations: [record],
      units: units,
      subjects: subjects,
      scopes: [{
        scope: scope,
        topic: topicInfo.zh,
        topicEn: topicInfo.en,
        target: targetText,
        targets: targets,
        polarity: 'exclude',
        exception: ''
      }]
    };
  }

  function parseAllow(clause, context) {
    const text = stripLeadingContrast(clause);
    const m = text.match(/^(人物|主体|人脸|面部|背景|环境|衣服|服装|身体|手部|头发|眼睛|画面|整张图)?(?:可以|允许|能够|可)(.+)$/);
    if (!m) return null;
    const topic = m[1] || '';
    const targetText = cleanText(m[2]).replace(/^(被|进行|做|使用|用|的)+/g, '').trim();
    if (!targetText) return null;
    if (/背景|后景|环境/.test(topic) && /虚化|模糊|散景|景深/.test(targetText)) {
      context.topic = 'background';
      return {
        handled: true,
        kind: 'allow',
        units: [makeUnit('scene', '背景虚化', 'blurred background', '背景虚化', 'scene')],
        scopes: [{
          scope: 'background', topic: '背景', topicEn: 'background',
          target: targetText, targets: [{ zh: '背景虚化', en: 'blurred background' }],
          polarity: 'allow', exception: ''
        }]
      };
    }
    if (/虚化|模糊/.test(targetText) && !topic) {
      return {
        handled: true,
        kind: 'allow',
        units: [makeUnit('style', targetText, 'blurred', targetText, 'style')],
        scopes: [{ scope: 'global', topic: '', topicEn: '', target: targetText, targets: [{ zh: targetText, en: 'blurred' }], polarity: 'allow', exception: '' }]
      };
    }
    const concept = conceptTranslation(targetText);
    if (!concept) return null;
    const scope = topicScope(topic);
    context.topic = scope === 'subject' ? 'subject' : context.topic;
    return {
      handled: true,
      kind: 'allow',
      units: [makeUnit(scope === 'background' ? 'scene' : 'style', concept.zh, concept.en, targetText, concept.category)],
      scopes: [{
        scope: scope, topic: topicZhEn(topic).zh, topicEn: topicZhEn(topic).en,
        target: targetText, targets: [concept], polarity: 'allow', exception: ''
      }]
    };
  }

  function parseScopeException(raw) {
    const text = cleanText(raw);
    const m = text.match(/^除(?:了)?\s*(.+?)\s*(?:之外|以外|外)?\s*(?:[，,]\s*)?(?:其他|其余|其它|剩下)(?:的)?(?:部分|地方|部位)?\s*(?:都|均|全部)?\s*(?:使用|用|采用|是|为)?\s*(.+?)\s*[。.!！]?$/);
    if (!m) return null;
    const exception = conceptTranslation(m[1]);
    const concept = conceptTranslation(m[2]);
    if (!exception || !concept) return null;
    const en = concept.en + ' except the ' + exception.en.replace(/^the\s+/i, '');
    const zh = concept.zh + '，' + exception.zh + '除外';
    return {
      handled: true,
      full: true,
      kind: 'scope-exception',
      units: [makeUnit('style', zh, en, text, 'style', { scope: 'all-except' })],
      scopes: [{
        scope: 'all', topic: '整体', topicEn: 'everything',
        target: m[2], targets: [concept], polarity: 'apply',
        exception: exception.zh, exceptionEn: exception.en
      }],
      exceptions: [{ zh: exception.zh, en: exception.en }]
    };
  }

  function parseExistence(clause) {
    const text = cleanText(clause);
    const m = text.match(/^(远处|近处|不远处|背景里|画面远处|画面深处)?\s*(?:有|是|出现)\s*(?:一|两|几)?(?:座|栋|间|个|辆|只|条|片|排|棵|朵)?\s*(.+)$/);
    if (!m) return null;
    const distanceWord = m[1] || '';
    let objectText = m[2];
    if (distanceWord) objectText = distanceWord + objectText;
    const object = parseObjectPhrase(objectText);
    if (!object) return null;
    let en = object.en;
    if (/远处|画面远处|画面深处/.test(object.distance)) en = addArticle(en) + ' in the distance';
    else if (/近处|不远处/.test(object.distance)) en = addArticle(en) + ' in the foreground';
    else en = addArticle(en);
    const objectId = nextId('o');
    return {
      handled: true,
      kind: 'existence',
      units: [makeUnit('scene', object.zh, en, text, object.category || 'object')],
      objects: [{
        id: objectId,
        zh: object.zh,
        en: object.en,
        category: object.category || 'object',
        color: object.color || null,
        distance: object.distance || '',
        attributes: []
      }],
      relations: object.distance ? [{
        type: 'distance', objectId: objectId, value: object.distance,
        zh: object.distance, en: 'in the distance', verify: 'in the distance'
      }] : []
    };
  }

  function parsePositionExistence(clause, context) {
    const text = cleanText(clause);
    const m = text.match(/^(背后|身后|前面|身前|旁边|身旁|周围|四周|远处|近处|背景里)(?:有|是|出现)(.+)$/);
    if (!m) return null;
    const positionZh = m[1];
    const rest = cleanText(m[2]);
    if (!rest) return null;
    const positionEnMap = {
      '背后': 'behind', '身后': 'behind', '前面': 'in front of', '身前': 'in front of',
      '旁边': 'next to', '身旁': 'next to', '周围': 'around', '四周': 'around',
      '远处': 'in the distance', '近处': 'in the foreground', '背景里': 'in the background'
    };
    const result = TR.translateZhPhrase(rest, { slot: 'scene', allowRelation: false });
    let en = U.cleanEnglish(result.en || rest);
    const unknown = (result.unknown || []).slice();
    if (!en) en = rest;
    // 未收录部分必须留在英文里，不能只留一个已知名词（量子蝴蝶 → butterfly）。
    const unknownEn = unknown.filter(function (item) {
      return item && en.indexOf(item) === -1;
    });
    const fullEn = (positionEnMap[positionZh] || '') + ' ' + addArticle(en) +
      (unknownEn.length ? ', ' + unknownEn.join(', ') : '');
    const objectId = nextId('o');
    const subjectId = context && context.subjectId ? context.subjectId : '';
    return {
      handled: true,
      kind: 'position-existence',
      units: [makeUnit('scene', positionZh + rest, fullEn, text, 'scene', {
        entityId: objectId, relation: 'locative', unknown: unknown
      })],
      objects: [{
        id: objectId, zh: rest, en: en, category: 'scene',
        color: null, distance: positionZh, attributes: [], unknown: unknown
      }],
      relations: [{
        type: 'located', subjectId: subjectId, objectId: objectId,
        zh: text, en: (positionEnMap[positionZh] || '') + ' ' + en,
        verify: positionEnMap[positionZh] || en
      }]
    };
  }

  function parseAttributiveOutfit(clause) {
    const text = cleanText(clause);
    const m = text.match(/^(.*?)(穿着|身穿|穿了|身着|套着|披着|戴着|穿(?!过|越|梭|透))(.+?)的(.+)$/);
    if (!m) return null;
    const left = cleanText(m[1]).replace(/^(一个|一位|一名|那个|这个)/, '').trim();
    const outfitText = cleanText(m[3]);
    const subjectText = (left ? left : '') + cleanText(m[4]);
    const subject = parseSubjectPhrase(subjectText);
    const outfit = parseOutfitPhrase(outfitText);
    if (!subject || !outfit) return null;
    const subjectId = nextId('s');
    const outfitId = nextId('c');
    const outfitUnitEn = 'wearing ' + addArticle(outfit.en);
    return {
      handled: true,
      kind: 'wearing',
      units: [
        makeUnit('person', subject.zh, subject.en, subject.text, 'subject', { entityId: subjectId }),
        makeUnit('outfit', outfit.zh, outfitUnitEn, outfitText, outfit.color ? 'outfit' : 'outfit', { entityId: outfitId })
      ],
      subjects: [{
        id: subjectId, zh: subject.zh, en: subject.en, category: 'subject',
        attributes: subject.attributes || [], outfitColor: subject.outfit ? subject.outfit.color : null
      }],
      outfits: [{
        id: outfitId, ownerId: subjectId, zh: outfit.zh, en: outfit.en,
        color: outfit.color || null, attributes: outfit.attributes || []
      }],
      relations: [{
        type: 'wearing', subjectId: subjectId, outfitId: outfitId,
        zh: subject.zh + '穿着' + outfit.zh, en: 'wearing', verify: outfit.en
      }]
    };
  }

  function parseOutfitAttributive(clause) {
    const text = cleanText(clause);
    const m = text.match(/^(.+?)的(.+)$/);
    if (!m) return null;
    const outfitText = cleanText(m[1]);
    const subjectText = cleanText(m[2]);
    if (!outfitText || !subjectText) return null;
    const outfit = parseOutfitPhrase(outfitText);
    if (!outfit) return null;
    const subject = parseSubjectPhrase(subjectText);
    if (!subject) return null;
    const subjectId = nextId('s');
    const outfitId = nextId('c');
    return {
      handled: true,
      kind: 'wearing',
      units: [
        makeUnit('person', subject.zh, subject.en, subjectText, 'subject', { entityId: subjectId }),
        makeUnit('outfit', outfit.zh, 'wearing ' + addArticle(outfit.en), outfitText, 'outfit', { entityId: outfitId })
      ],
      subjects: [{
        id: subjectId, zh: subject.zh, en: subject.en, category: 'subject',
        attributes: subject.attributes || [], outfitColor: subject.outfit ? subject.outfit.color : null
      }],
      outfits: [{
        id: outfitId, ownerId: subjectId, zh: outfit.zh, en: outfit.en,
        color: outfit.color || null, attributes: outfit.attributes || []
      }],
      relations: [{
        type: 'wearing', subjectId: subjectId, outfitId: outfitId,
        zh: subject.zh + '穿着' + outfit.zh, en: 'wearing', verify: outfit.en
      }]
    };
  }

  function parseSubjectWearing(clause, context) {
    const text = cleanText(clause);
    const m = text.match(/^(.*?)(穿着|身穿|穿了|身着|套着|披着|戴着|穿(?!过|越|梭|透)|戴(?!着))(.+)$/);
    if (!m) return null;
    const left = cleanText(m[1]);
    const outfitText = cleanText(m[3]);
    const outfit = parseOutfitPhrase(outfitText);
    if (!outfit) return null;
    let subject = left ? parseSubjectPhrase(left) : null;
    if (left && !subject) return null;
    const inherited = !left && context && context.subjectId;
    const subjectId = subject ? nextId('s') : (inherited ? context.subjectId : '');
    const outfitId = nextId('c');
    const units = [];
    if (subject) {
      units.push(makeUnit('person', subject.zh, subject.en, left, 'subject', { entityId: subjectId }));
    }
    units.push(makeUnit('outfit', outfit.zh, 'wearing ' + addArticle(outfit.en), outfitText, 'outfit', { entityId: outfitId }));
    return {
      handled: true,
      kind: 'wearing',
      units: units,
      subjects: subject ? [{
        id: subjectId, zh: subject.zh, en: subject.en, category: 'subject',
        attributes: subject.attributes || [], outfitColor: subject.outfit ? subject.outfit.color : null
      }] : [],
      outfits: [{
        id: outfitId, ownerId: subjectId, zh: outfit.zh, en: outfit.en,
        color: outfit.color || null, attributes: outfit.attributes || []
      }],
      relations: (subject || inherited) ? [{
        type: 'wearing', subjectId: subjectId, outfitId: outfitId,
        zh: (subject ? subject.zh : (context.subjectZh || '主体')) + '穿着' + outfit.zh,
        en: 'wearing', verify: outfit.en
      }] : []
    };
  }

  function parseSubjectWearingLocative(clause) {
    const text = cleanText(clause);
    let marker = '';
    let markerIndex = -1;
    for (let i = 0; i < ACTION_LOCATIVE_MARKERS.length; i += 1) {
      const m = ACTION_LOCATIVE_MARKERS[i];
      const idx = text.indexOf(m);
      if (idx > 0 && (markerIndex === -1 || idx < markerIndex)) {
        marker = m;
        markerIndex = idx;
      }
    }
    if (!marker) return null;
    const left = cleanText(text.slice(0, markerIndex));
    const right = cleanText(text.slice(markerIndex + marker.length));
    if (!left || !right) return null;

    let personUnit = null;
    let outfitUnit = null;
    let subject = null;
    let outfit = null;
    let subjects = [];
    let outfits = [];
    let relations = [];

    const wearing = left.match(/^(.*?)(穿着|身穿|穿了|身着|套着|披着|戴着|穿(?!过|越|梭|透)|戴(?!着))(.+)$/);
    if (wearing && cleanText(wearing[1])) {
      subject = parseSubjectPhrase(wearing[1]);
      outfit = parseOutfitPhrase(wearing[3]);
      if (subject && outfit) {
        const sid = nextId('s');
        const oid = nextId('c');
        personUnit = makeUnit('person', subject.zh, subject.en, cleanText(wearing[1]), 'subject', { entityId: sid });
        outfitUnit = makeUnit('outfit', outfit.zh, 'wearing ' + addArticle(outfit.en), cleanText(wearing[3]), 'outfit', { entityId: oid });
        subjects = [{
          id: sid, zh: subject.zh, en: subject.en, category: 'subject',
          attributes: subject.attributes || [], outfitColor: subject.outfit ? subject.outfit.color : null
        }];
        outfits = [{
          id: oid, ownerId: sid, zh: outfit.zh, en: outfit.en,
          color: outfit.color || null, attributes: outfit.attributes || []
        }];
        relations = [{
          type: 'wearing', subjectId: sid, outfitId: oid,
          zh: subject.zh + '穿着' + outfit.zh, en: 'wearing', verify: outfit.en
        }];
      }
    }

    if (!personUnit) {
      const attributive = parseAttributiveOutfit(left);
      if (!attributive) return null;
      personUnit = (attributive.units || []).find(function (u) { return u.slot === 'person'; }) || null;
      outfitUnit = (attributive.units || []).find(function (u) { return u.slot === 'outfit'; }) || null;
      subjects = attributive.subjects || [];
      outfits = attributive.outfits || [];
      relations = (attributive.relations || []).slice();
      if (!personUnit) return null;
    }

    const parsedTarget = parseLocativeTarget(right);
    const parts = { text: parsedTarget.text, suffix: parsedTarget.suffix };
    const target = parsedTarget.target;
    if (!target) return null;
    const afterSuffix = cleanText(right.slice(parts.text.length + parts.suffix.length));
    if (afterSuffix && hasCjk(afterSuffix)) return null;
    const action = actionInfo(marker);
    if (!action) return null;
    const category = target.category || 'scene';
    let prep = suffixPrep(parts.suffix, action.en, target.en, category);
    if (!prep) prep = placementPrep(marker, action.en, target.en, category);
    const locEn = TR.locativePhrase(prep, target.en, category);
    const objectId = nextId('o');
    const poseId = nextId('a');
    const units = [personUnit];
    if (outfitUnit) units.push(outfitUnit);
    units.push(makeUnit('pose', action.zh || marker, action.en, marker, 'pose', { entityId: poseId, relation: 'pose' }));
    units.push(makeUnit('scene', target.zh + parts.suffix, locEn, parts.text + parts.suffix, category, { entityId: objectId, relation: 'locative' }));
    const relationType = parts.suffix === '旁' || parts.suffix === '旁边' || parts.suffix === '边' ? 'next_to' : 'located';
    const subjectId = subjects[0] ? subjects[0].id : '';
    relations.push({
      type: relationType, subjectId: subjectId, objectId: objectId,
      zh: (subjects[0] ? subjects[0].zh : '') + marker + target.zh + parts.suffix,
      en: action.en + ' ' + locEn, verify: locEn
    });
    return {
      handled: true,
      kind: 'wearing-locative',
      units: units,
      subjects: subjects,
      objects: [{
        id: objectId, zh: target.zh, en: target.en, category: category,
        color: target.color || null, distance: target.distance || '', attributes: []
      }],
      outfits: outfits,
      actions: [{ id: poseId, subjectId: subjectId, zh: marker, en: action.en, type: 'pose', targetId: objectId }],
      relations: relations
    };
  }

  function parseSubjectActionLocative(clause) {
    const text = cleanText(clause);
    let marker = '';
    let markerIndex = -1;
    for (let i = 0; i < ACTION_LOCATIVE_MARKERS.length; i += 1) {
      const m = ACTION_LOCATIVE_MARKERS[i];
      const idx = text.indexOf(m);
      if (idx > 0 && (markerIndex === -1 || idx < markerIndex)) {
        marker = m;
        markerIndex = idx;
      }
    }
    if (!marker) return null;
    const subjectText = cleanText(text.slice(0, markerIndex));
    const right = cleanText(text.slice(markerIndex + marker.length));
    if (!subjectText || !right) return null;
    const subject = parseSubjectPhrase(subjectText);
    if (!subject) return null;
    const parsedTarget = parseLocativeTarget(right);
    const parts = { text: parsedTarget.text, suffix: parsedTarget.suffix };
    const target = parsedTarget.target;
    if (!target) return null;
    // 「老人坐在长椅上看报纸」这种目标后还有第二个动作的，交回既有关系解析。
    const afterSuffix = cleanText(right.slice(parts.text.length + parts.suffix.length));
    if (afterSuffix && hasCjk(afterSuffix)) return null;
    const action = actionInfo(marker);
    if (!action) return null;
    const category = target.category || 'scene';
    let prep = suffixPrep(parts.suffix, action.en, target.en, category);
    if (!prep) prep = placementPrep(marker, action.en, target.en, category);
    const locEn = TR.locativePhrase(prep, target.en, category);
    const subjectId = nextId('s');
    const objectId = nextId('o');
    const poseId = nextId('a');
    const units = [
      makeUnit('person', subject.zh, subject.en, subjectText, 'subject', { entityId: subjectId }),
      makeUnit('pose', action.zh || marker, action.en, marker, 'pose', { entityId: poseId, relation: 'pose' }),
      makeUnit('scene', target.zh + parts.suffix, locEn, parts.text + parts.suffix, category, { entityId: objectId, relation: 'locative' })
    ];
    if (subject.outfit) {
      units.splice(1, 0, makeUnit('outfit', subject.outfit.zh, 'wearing ' + subject.outfit.en, subject.outfit.zh, 'outfit', { entityId: nextId('c'), relation: 'wearing' }));
    }
    const relationType = parts.suffix === '旁' || parts.suffix === '旁边' || parts.suffix === '边' ? 'next_to' : 'located';
    return {
      handled: true,
      kind: 'subject-locative',
      units: units,
      subjects: [{
        id: subjectId, zh: subject.zh, en: subject.en, category: 'subject',
        attributes: subject.attributes || [], outfitColor: subject.outfit ? subject.outfit.color : null
      }],
      objects: [{
        id: objectId, zh: target.zh, en: target.en, category: category,
        color: target.color || null, distance: target.distance || '', attributes: []
      }],
      actions: [{
        id: poseId, subjectId: subjectId, zh: marker, en: action.en,
        type: 'pose', targetId: relationType === 'next_to' ? objectId : objectId
      }],
      relations: [{
        type: relationType, subjectId: subjectId, objectId: objectId,
        zh: subject.zh + marker + target.zh + parts.suffix,
        en: action.en + ' ' + locEn,
        verify: locEn
      }]
    };
  }

  function parseActionLocative(clause, context) {
    const text = cleanText(clause);
    let marker = '';
    for (let i = 0; i < ACTION_LOCATIVE_MARKERS.length; i += 1) {
      if (text.startsWith(ACTION_LOCATIVE_MARKERS[i])) { marker = ACTION_LOCATIVE_MARKERS[i]; break; }
    }
    if (!marker) return null;
    const right = cleanText(text.slice(marker.length));
    if (!right) return null;
    const parsedTarget = parseLocativeTarget(right);
    const parts = { text: parsedTarget.text, suffix: parsedTarget.suffix };
    const target = parsedTarget.target;
    if (!target) return null;
    const afterSuffix = cleanText(right.slice(parts.text.length + parts.suffix.length));
    if (afterSuffix && hasCjk(afterSuffix)) return null;
    const action = actionInfo(marker);
    if (!action) return null;
    const category = target.category || 'scene';
    let prep = suffixPrep(parts.suffix, action.en, target.en, category);
    if (!prep) prep = placementPrep(marker, action.en, target.en, category);
    const locEn = TR.locativePhrase(prep, target.en, category);
    const objectId = nextId('o');
    const poseId = nextId('a');
    return {
      handled: true,
      kind: 'action-locative',
      units: [
        makeUnit('pose', action.zh || marker, action.en, marker, 'pose', { entityId: poseId, relation: 'pose' }),
        makeUnit('scene', target.zh + parts.suffix, locEn, parts.text + parts.suffix, category, { entityId: objectId, relation: 'locative' })
      ],
      objects: [{
        id: objectId, zh: target.zh, en: target.en, category: category,
        color: target.color || null, distance: target.distance || '', attributes: []
      }],
      actions: [{
        id: poseId, subjectId: context && context.subjectId ? context.subjectId : '',
        zh: marker, en: action.en, type: 'pose', targetId: objectId
      }],
      relations: [{
        type: 'located', subjectId: context && context.subjectId ? context.subjectId : '',
        objectId: objectId, zh: marker + target.zh + parts.suffix,
        en: action.en + ' ' + locEn, verify: locEn
      }]
    };
  }

  function strictActionInfo(text) {
    const clean = cleanText(text);
    if (!clean) return null;
    const body = translateBodyAction(clean);
    if (body) return body;
    const matches = TR.scanZh(clean);
    if (matches.length === 1 && matches[0].start === 0 && matches[0].end === clean.length &&
        ['pose', 'action', 'expression'].indexOf(matches[0].entry.category) !== -1) {
      return {
        en: matches[0].entry.en,
        zh: matches[0].entry.zh,
        matches: matches,
        unknown: []
      };
    }
    return null;
  }

  function parseSubjectAction(clause) {
    const text = cleanText(clause);
    const segmentation = segmentLattice(text);
    const tokens = segmentation.tokens;
    const subjectIndex = tokens.findIndex(function (t) { return tokenCategory(t) === 'subject'; });
    if (subjectIndex === -1 || tokens[subjectIndex].start !== 0) return null;
    const subjectToken = tokens[subjectIndex];
    const rest = cleanText(text.slice(subjectToken.end));
    if (!rest) return null;
    const action = strictActionInfo(rest);
    if (!action) return null;
    const subject = parseSubjectPhrase(subjectToken.alias);
    if (!subject) return null;
    const subjectId = nextId('s');
    const poseId = nextId('a');
    return {
      handled: true,
      kind: 'subject-action',
      units: [
        makeUnit('person', subject.zh, subject.en, subjectToken.alias, 'subject', { entityId: subjectId }),
        makeUnit('pose', action.zh || rest, action.en, rest, 'pose', { entityId: poseId, relation: 'pose' })
      ],
      subjects: [{
        id: subjectId, zh: subject.zh, en: subject.en, category: 'subject',
        attributes: subject.attributes || [], outfitColor: subject.outfit ? subject.outfit.color : null
      }],
      actions: [{ id: poseId, subjectId: subjectId, zh: rest, en: action.en, type: 'pose' }],
      relations: [{ type: 'pose', subjectId: subjectId, actionId: poseId, zh: rest, en: action.en, verify: action.en }]
    };
  }

  function parseBareOutfit(clause) {
    const text = cleanText(clause);
    const outfit = parseOutfitPhrase(text);
    if (!outfit) return null;
    if (!outfit.matches || !outfit.matches.length) {
      if (!outfit.implied) return null;
    }
    const outfitId = nextId('c');
    return {
      handled: true,
      kind: 'outfit',
      units: [makeUnit('outfit', outfit.zh, addArticle(outfit.en), text, 'outfit', { entityId: outfitId })],
      outfits: [{
        id: outfitId, ownerId: '', zh: outfit.zh, en: outfit.en,
        color: outfit.color || null, attributes: outfit.attributes || []
      }],
      relations: []
    };
  }

  function parseClause(rawClause, context) {
    const clause = cleanText(rawClause);
    if (!clause) return null;
    return trySign(clause) ||
      parseNegation(clause, context) ||
      parseAllow(clause, context) ||
      parseExistence(clause) ||
      parsePositionExistence(clause, context) ||
      parseSubjectWearingLocative(clause) ||
      parseSubjectActionLocative(clause) ||
      parseActionLocative(clause, context) ||
      parseAttributiveOutfit(clause) ||
      parseOutfitAttributive(clause) ||
      parseSubjectWearing(clause, context) ||
      parseSubjectAction(clause) ||
      parseBareOutfit(clause);
  }

  // ── 场景对象 ────────────────────────────────────────────────

  let idCounter = 0;
  function nextId(prefix) {
    idCounter += 1;
    return prefix + idCounter;
  }

  function makeUnit(slot, zh, en, text, category, extra) {
    return Object.assign({
      slot: slot,
      zh: cleanText(zh),
      en: U.cleanEnglish(en || ''),
      text: cleanText(text || zh),
      category: category || '',
      unknown: []
    }, extra || {});
  }

  function emptyScene(raw) {
    return {
      raw: String(raw || ''),
      structured: false,
      subjects: [],
      objects: [],
      outfits: [],
      actions: [],
      relations: [],
      negations: [],
      scopes: [],
      exceptions: [],
      units: [],
      unknown: [],
      ambiguities: [],
      segmentation: { tokens: [], alternatives: [], ambiguous: false, score: 0 },
      lighting: [],
      camera: [],
      style: [],
      complete: true,
      notes: []
    };
  }

  function mergeUnique(target, items) {
    (items || []).forEach(function (item) {
      if (!item) return;
      if (item.en) {
        const key = String(item.en).toLowerCase();
        const found = target.some(function (x) { return String(x.en || '').toLowerCase() === key; });
        if (found) return;
      }
      target.push(item);
    });
    return target;
  }

  function unknownFromUnits(units) {
    const out = [];
    (units || []).forEach(function (unit) {
      (unit.unknown || []).forEach(function (item) {
        const clean = cleanText(item);
        if (clean && !out.includes(clean)) out.push(clean);
      });
    });
    return out;
  }

  function coveredCategories(units) {
    const categories = Object.create(null);
    units.forEach(function (unit) {
      (unit.matches || []).forEach(function (m) {
        if (m.entry) categories[m.entry.category] = true;
      });
    });
    return categories;
  }

  function fallbackUnitFromClause(clause) {
    const text = cleanText(clause);
    let matches = TR.scanZh(text);
    if (!matches.length) matches = TR.scanEn(text);
    const result = TR.translateZhPhrase(text, { allowRelation: true });
    const en = U.cleanEnglish(result.en || text);
    const zh = U.cleanChinese(result.zh || text);
    const slotScores = { person: 0, outfit: 0, pose: 0, scene: 0, light: 0, style: 0 };
    (result.matches || matches || []).forEach(function (m) {
      const entry = m.entry;
      if (!entry) return;
      let slot = entry.slot;
      if (entry.category === 'color') slot = 'outfit';
      if (slot) slotScores[slot] += 1 + Math.min(4, m.alias.length / 2);
    });
    let best = 'scene';
    let bestScore = 0;
    SLOTS.forEach(function (key) {
      if (slotScores[key] > bestScore) { bestScore = slotScores[key]; best = key; }
    });
    return makeUnit(best, zh, en, text, result.matches && result.matches[0] ? result.matches[0].entry.category : '', {
      matches: result.matches || [],
      unknown: result.unknown || []
    });
  }

  function compile(raw, options) {
    const source = U.normalizeSpace(raw);
    const scene = emptyScene(source);
    if (!source) return scene;
    idCounter = 0;
    const legacySegments = (options && options.segments) || [];
    const context = { topic: '' };
    const consumedSegments = Object.create(null);

    function segmentMatchesClause(segment, clause) {
      const st = cleanText(segment.text);
      const c = cleanText(clause);
      return !!st && (c.indexOf(st) !== -1 || st.indexOf(c) !== -1);
    }

    // 「除了眼睛，其他部分都使用低饱和色彩」跨逗号，先整体识别。
    const scopeException = parseScopeException(source);
    if (scopeException) {
      scene.structured = true;
      scene.units = scopeException.units;
      scene.scopes = scopeException.scopes;
      scene.exceptions = scopeException.exceptions;
      scene.segmentation = segmentLattice(source);
      scene.ambiguities = scene.segmentation.ambiguous ? [{
        text: source,
        chosen: scene.segmentation.tokens.map(function (t) { return t.alias; }).join(' / '),
        alternatives: scene.segmentation.alternativesText,
        reason: '分词存在多种解释，已按当前上下文选择，保留备选供核对'
      }] : [];
      finalizeScene(scene, source);
      return scene;
    }

    const clauses = splitClauses(source);

    clauses.forEach(function (clause, index) {
      // 必须按顺序解析：后一个子句要用到前一个子句的主体和话题上下文。
      const result = parseClause(clause, context);
      if (result) {
        mergeUnique(scene.units, result.units);
        mergeUnique(scene.subjects, result.subjects || []);
        mergeUnique(scene.objects, result.objects || []);
        mergeUnique(scene.outfits, result.outfits || []);
        mergeUnique(scene.actions, result.actions || []);
        mergeUnique(scene.relations, result.relations || []);
        mergeUnique(scene.negations, result.negations || []);
        mergeUnique(scene.scopes, result.scopes || []);
        mergeUnique(scene.exceptions, result.exceptions || []);
        scene.structured = true;
        if (result.subjects && result.subjects.length) {
          const lastSubject = result.subjects[result.subjects.length - 1];
          context.subjectId = lastSubject.id;
          context.subjectZh = lastSubject.zh;
        } else if (result.units && !context.subjectId) {
          const personUnit = result.units.find(function (u) { return u.slot === 'person'; });
          if (personUnit) {
            context.subjectId = personUnit.entityId || '';
            context.subjectZh = personUnit.zh || '';
          }
        }
        legacySegments.forEach(function (segment, segIndex) {
          if (segmentMatchesClause(segment, clause)) consumedSegments[segIndex] = true;
        });
        return;
      }
      // 结构化编译没有把握：该子句退回到既有片段解析，原文与未知内容都不丢。
      let used = 0;
      legacySegments.forEach(function (segment, segIndex) {
        if (consumedSegments[segIndex]) return;
        if (!segmentMatchesClause(segment, clause)) return;
        consumedSegments[segIndex] = true;
        used += 1;
        mergeUnique(scene.units, [makeUnit(
          SLOTS.indexOf(segment.slot) !== -1 ? segment.slot : 'scene',
          segment.zh,
          segment.en,
          segment.text,
          segment.matches && segment.matches[0] ? segment.matches[0].entry.category : '',
          { matches: segment.matches || [], unknown: segment.unknown || [], source: 'fallback' }
        )]);
      });
      if (!used) {
        mergeUnique(scene.units, [fallbackUnitFromClause(clause)]);
      }
    });

    // 没有归属子句的旧片段不能静默丢掉。
    legacySegments.forEach(function (segment, segIndex) {
      if (consumedSegments[segIndex]) return;
      mergeUnique(scene.units, [makeUnit(
        SLOTS.indexOf(segment.slot) !== -1 ? segment.slot : 'scene',
        segment.zh,
        segment.en,
        segment.text,
        segment.matches && segment.matches[0] ? segment.matches[0].entry.category : '',
        { matches: segment.matches || [], unknown: segment.unknown || [], source: 'fallback' }
      )]);
    });

    scene.segmentation = segmentLattice(source);
    if (scene.segmentation.ambiguous) {
      scene.ambiguities.push({
        text: source,
        chosen: scene.segmentation.tokens.map(function (t) { return t.alias; }).join(' / '),
        alternatives: scene.segmentation.alternativesText,
        reason: '分词存在多种解释，已按当前上下文选择，保留备选供核对'
      });
    }

    // 只有局部否定、没有显式主体时，补一个「人物」作为作用对象，
    // 但这是结构里的主体，不是凭空编造外貌或剧情。
    const hasSubject = scene.subjects.length > 0 || scene.units.some(function (u) { return u.slot === 'person'; });
    const subjectScope = scene.scopes.some(function (s) { return s.scope === 'subject'; });
    if (!hasSubject && subjectScope) {
      const unit = makeUnit('person', '人物', 'a person', '人物', 'subject');
      scene.units.unshift(unit);
      scene.subjects.push({ id: nextId('s'), zh: '人物', en: 'a person', category: 'subject', attributes: [], outfitColor: null });
    }

    finalizeScene(scene, source);
    return scene;
  }

  function coveragePool(scene) {
    const pool = [];
    function add(value) {
      if (value && hasCjk(value)) pool.push(String(value));
    }
    (scene.units || []).forEach(function (unit) { add(unit.text); add(unit.zh); });
    (scene.subjects || []).forEach(function (item) { add(item.zh); });
    (scene.objects || []).forEach(function (item) { add(item.zh); });
    (scene.outfits || []).forEach(function (item) { add(item.zh); });
    (scene.actions || []).forEach(function (item) { add(item.zh); });
    (scene.relations || []).forEach(function (item) { add(item.zh); });
    (scene.negations || []).forEach(function (item) { add(item.rawTarget); add(item.text); });
    (scene.scopes || []).forEach(function (item) { add(item.target); add(item.topic); add(item.exception); });
    (scene.exceptions || []).forEach(function (item) { add(item.zh); });
    return pool;
  }

  function coveredByStructure(scene, text, pool) {
    const item = cleanText(text);
    if (!item || !hasCjk(item)) return true;
    for (let i = 0; i < pool.length; i += 1) {
      if (pool[i].indexOf(item) !== -1) return true;
    }
    // 分词图的未知边可能跨过词边界（「穿黑色」被拆成未知边），但每个字
    // 都已经被结构化单元覆盖时，不算真正的未翻译内容。
    if (item.length <= 4) {
      const chars = pool.join('');
      const allCovered = item.split('').every(function (ch) {
        return !hasCjk(ch) || chars.indexOf(ch) !== -1;
      });
      if (allCovered) return true;
    }
    return false;
  }

  function splitPersonActionEn(en) {
    const text = String(en || '');
    let earliest = -1;
    let action = '';
    for (let i = 0; i < ACTION_EN_ALIASES.length; i += 1) {
      const alias = ACTION_EN_ALIASES[i];
      const re = new RegExp('(^|[^a-z0-9])(' + escapeRegExp(alias) + ')([^a-z0-9]|$)', 'i');
      const m = re.exec(text);
      if (!m) continue;
      const index = m.index + (m[1] ? m[1].length : 0);
      if (index <= 0) continue;
      if (earliest === -1 || index < earliest) {
        earliest = index;
        action = text.slice(index).trim();
      }
    }
    if (earliest === -1) return null;
    return { person: text.slice(0, earliest).trim().replace(/[,;\s]+$/, ''), action: action };
  }

  function normalizeFallbackUnits(scene) {
    const units = scene.units || [];
    for (let i = units.length - 1; i >= 0; i -= 1) {
      const unit = units[i];
      if (unit.slot !== 'person' || unit.source !== 'fallback') continue;
      const split = splitPersonActionEn(unit.en);
      if (!split || !split.person || !split.action) continue;
      unit.en = U.cleanEnglish(split.person);
      units.splice(i + 1, 0, makeUnit('pose', split.action, split.action, split.action, 'pose', { source: 'fallback-split' }));
    }
  }

  function finalizeScene(scene, source) {
    normalizeFallbackUnits(scene);
    scene.unknown = unknownFromUnits(scene.units);
    // 明显没有被任何结构覆盖的未知中文也要提示，不能因为分词边被标记就消失。
    scene.segmentation.tokens.forEach(function (token) {
      if (token.kind !== 'unknown') return;
      const text = cleanText(token.alias);
      if (!text || !hasCjk(text)) return;
      if (text.split('').every(function (ch) { return STOP_CHARS[ch] || /[的了着过和与及或在地得]/.test(ch); })) return;
      if (scene.unknown.indexOf(text) === -1) scene.unknown.push(text);
    });
    const pool = coveragePool(scene);
    const declaredUnknown = [];
    scene.units.forEach(function (unit) {
      // 只有英文里确实还保留着中文的未知项才需要强制保留；分词图/翻译器
      // 留下的单字残片（例如「沿着」里的「沿」）会被下面的覆盖检查过滤。
      if (!hasCjk(unit.en)) return;
      (unit.unknown || []).forEach(function (item) {
        if (item && declaredUnknown.indexOf(item) === -1) declaredUnknown.push(item);
      });
    });
    scene.unknown = scene.unknown.filter(function (item) {
      return item &&
        item.replace(/[的了着过和与及或在地得，,。；;：:、\s]/g, '').trim() &&
        (declaredUnknown.indexOf(item) !== -1 || !coveredByStructure(scene, item, pool));
    });
    scene.units.forEach(function (unit) {
      if (!unit.en && unit.zh) unit.en = unit.zh;
      if (!hasCjk(unit.en)) return;
      const already = scene.unknown.some(function (item) { return unit.en.indexOf(item) !== -1; });
      if (!already) scene.unknown.push(unit.en);
    });
    scene.lighting = scene.units.filter(function (u) { return u.slot === 'light'; });
    scene.camera = scene.lighting.filter(function (u) {
      return (u.matches || []).some(function (m) { return m.entry && m.entry.category === 'camera'; });
    });
    scene.style = scene.units.filter(function (u) { return u.slot === 'style'; });
    scene.complete = scene.unknown.length === 0;
    // 统一实体视图：主体 + 物体。服饰作为主体的属性/关系，资料更细，
    // 但「女孩 / 汽车 / 房子」这类画面对象可以直接从 entities 数出来。
    scene.entities = (scene.subjects || []).map(function (subject) {
      return {
        id: subject.id, kind: 'subject', zh: subject.zh, en: subject.en,
        category: subject.category || 'subject', color: subject.outfitColor || null,
        distance: '', attributes: subject.attributes || []
      };
    }).concat((scene.objects || []).map(function (object) {
      return {
        id: object.id, kind: 'object', zh: object.zh, en: object.en,
        category: object.category || 'object', color: object.color || null,
        distance: object.distance || '', attributes: object.attributes || []
      };
    }));
    scene.summary = {
      subjectCount: scene.subjects.length,
      objectCount: scene.objects.length,
      outfitCount: scene.outfits.length,
      actionCount: scene.actions.length,
      relationCount: scene.relations.length,
      negationCount: scene.negations.length,
      scopeCount: scene.scopes.length,
      unitCount: scene.units.length
    };
    // 内部结构里保留这句原始输入，供守恒检查逐项比对。
    scene.source = source;
  }

  // ── 投影到六个框 ────────────────────────────────────────────

  function project(scene) {
    const slots = { person: [], outfit: [], pose: [], scene: [], light: [], style: [] };
    (scene && scene.units ? scene.units : []).forEach(function (unit) {
      const key = SLOTS.indexOf(unit.slot) !== -1 ? unit.slot : 'scene';
      slots[key].push(unit);
    });
    return slots;
  }

  // 从同一棵树生成英文；界面仍可只读六个框，但这里的整句关系是结构生成的。
  function render(scene) {
    if (!scene || !scene.units || !scene.units.length) return '';
    const projected = project(scene);
    const person = projected.person.map(function (u) { return u.en; }).filter(Boolean);
    const outfit = projected.outfit.map(function (u) { return u.en; }).filter(Boolean);
    const pose = projected.pose.map(function (u) { return u.en; }).filter(Boolean);
    const background = projected.scene.map(function (u) { return u.en; }).filter(Boolean);
    const light = projected.light.map(function (u) { return u.en; }).filter(Boolean);
    const style = projected.style.map(function (u) { return u.en; }).filter(Boolean);
    const phrases = [];
    let lastKind = '';
    if (person.length) {
      phrases.push(person.join(', '));
      lastKind = 'person';
    }
    outfit.forEach(function (item) {
      if (/^(wearing|in |dressed in)/i.test(item) && phrases.length) {
        phrases[phrases.length - 1] += ' ' + item;
      } else {
        phrases.push(item);
      }
      lastKind = 'outfit';
    });
    pose.forEach(function (item) {
      if (phrases.length && /^[a-z]+ing\b/i.test(item)) {
        phrases[phrases.length - 1] += (lastKind === 'outfit' ? ', ' : ' ') + item;
      } else {
        phrases.push(item);
      }
      lastKind = 'pose';
    });
    background.forEach(function (item) {
      if (phrases.length && /^(on|at|in|by|near|under|behind|next to|in front of|across from|along|through|from|toward|towards|against|inside|outside|over)\b/i.test(item)) {
        phrases[phrases.length - 1] += ' ' + item;
      } else {
        phrases.push(item);
      }
      lastKind = 'scene';
    });
    light.forEach(function (item) { phrases.push(item); });
    style.forEach(function (item) { phrases.push(item); });
    return U.joinPhrasesEn(phrases);
  }

  function renderZh(scene) {
    if (!scene || !scene.units || !scene.units.length) return '';
    const projected = project(scene);
    const parts = [];
    function push(unit, prefix) {
      const text = cleanText(unit.text || unit.zh || '');
      if (!text) return;
      parts.push((prefix && !/^(穿着|戴着|身穿)/.test(text) ? prefix : '') + text);
    }
    projected.person.forEach(function (u) { push(u); });
    projected.outfit.forEach(function (u) { push(u, '穿着'); });
    projected.pose.forEach(function (u) { push(u); });
    projected.scene.forEach(function (u) { push(u); });
    projected.light.forEach(function (u) { push(u); });
    projected.style.forEach(function (u) { push(u); });
    let out = '';
    parts.forEach(function (part, index) {
      if (!out) { out = part; return; }
      const glue = /[在着沿过往向朝]$/.test(out) ? '' : '，';
      out += glue + part;
    });
    return out;
  }

  // ── 负面提示词计划 ──────────────────────────────────────────

  function negativePlan(scene) {
    const extra = [];
    const suppress = [];
    const notes = [];
    if (!scene) return { extra: extra, suppress: suppress, notes: notes };
    scene.negations.forEach(function (negation) {
      const targets = negation.targets || [];
      targets.forEach(function (target) {
        if (!target.en) return;
        if (negation.scope === 'global') {
          extra.push({ zh: target.zh, en: target.en, reason: '用户明确排除：' + negation.rawTarget });
        } else if (negation.scope === 'subject' && /blur|模糊/i.test(target.zh + ' ' + target.en)) {
          suppress.push('模糊', '失焦');
          extra.push({ zh: '人物模糊', en: 'blurry person', reason: '局部否定：人物不要模糊' });
          extra.push({ zh: '面部模糊', en: 'blurry face', reason: '局部否定：人物不要模糊' });
          notes.push('人物模糊只在人物作用域内排除，不生成全局 blur');
        } else if (negation.scope === 'background' && /blur|模糊|虚化/i.test(target.zh + ' ' + target.en)) {
          suppress.push('模糊', '失焦');
          extra.push({ zh: '背景模糊', en: 'blurry background', reason: '局部否定：背景不要虚化' });
        } else {
          extra.push({
            zh: target.zh, en: target.en + ' on ' + (negation.scope === 'subject' ? 'person' : 'background'),
            reason: '局部否定：' + negation.rawTarget
          });
        }
      });
    });
    scene.scopes.forEach(function (scope) {
      if (scope.exception) {
        extra.push({ zh: scope.exception + '低饱和', en: 'desaturated ' + scope.exceptionEn, reason: '例外：' + scope.exception + '不受低饱和影响' });
        extra.push({ zh: scope.exception + '发灰', en: 'gray ' + scope.exceptionEn, reason: '例外：' + scope.exception + '不被去色' });
      }
    });
    // 用户明确允许背景虚化时，不应让默认的全局「模糊」负面词把它压掉。
    const allowsBackgroundBlur = scene.scopes.some(function (s) {
      return s.scope === 'background' && s.polarity === 'allow' && /虚化|模糊/.test(s.target + ' ' + (s.targets || []).map(function (t) { return t.zh; }).join(' '));
    });
    if (allowsBackgroundBlur) {
      suppress.push('模糊', '失焦');
      notes.push('背景虚化是用户允许的，不再用全局模糊负面词压制');
    }
    return { extra: uniqueByEn(extra), suppress: Array.from(new Set(suppress)), notes: notes };
  }

  // ── 语义守恒检查 ────────────────────────────────────────────

  function verify(scene, slots, assembled, negative) {
    const issues = [];
    let positive = String((assembled && assembled.positiveEn) || '');
    if (!positive && slots) {
      positive = U.joinPhrasesEn(SLOTS.map(function (key) {
        return slots[key] && slots[key].en ? slots[key].en : '';
      }));
    }
    const negativeText = String((negative && negative.negativeEn) || '');
    const projected = scene ? project(scene) : { person: [], outfit: [], pose: [], scene: [], light: [], style: [] };
    const positiveLower = positive.toLowerCase();
    const negativeLower = negativeText.toLowerCase();

    function add(code, severity, message, detail) {
      issues.push({ code: code, severity: severity, message: message, detail: detail || '' });
    }

    if (!scene) {
      return { ok: true, complete: true, incomplete: false, issues: issues, checks: {} };
    }

    // 1. 未识别内容
    if (scene.unknown.length) {
      add('UNTRANSLATED_CONTENT', 'warning', '仍有未识别内容，结果不完整：' + scene.unknown.join('、'), scene.unknown);
    }
    if (hasCjk(positive)) {
      add('CJK_RESIDUE', 'warning', '正面提示词里仍残留中文，说明还有未处理部分', positive);
    }

    // 2. 否定不能变成肯定
    scene.negations.forEach(function (negation) {
      (negation.targets || []).forEach(function (target) {
        if (!target.en) return;
        if (hasWord(positive, target.en)) {
          add('NEGATION_LEAK', 'error',
            '用户否定的「' + target.zh + '」出现在正面提示词里（' + target.en + '）', target.en);
        }
        if (negative && !hasWord(negativeText, target.en) &&
            !(negative.extraItems || []).some(function (x) { return hasWord(x.en, target.en); })) {
          add('NEGATION_MISSING', 'warning', '否定项没有进入负面提示词：' + target.zh, target.en);
        }
      });
    });

    // 3. 主体数量与主体存在性
    const subjectCount = (scene.subjects || []).length;
    const colorPairs = [];
    if (scene.structured) {
    if (subjectCount > 0 && !positive.trim()) {
      add('SUBJECT_MISSING', 'error', '场景里有 ' + subjectCount + ' 个主体，但正面提示词为空', subjectCount);
    }
    (scene.subjects || []).forEach(function (subject) {
      const base = String(subject.en || '').replace(/^(a|an|the)\s+/i, '').replace(/\s+(with|wearing)\b.*$/i, '');
      if (base && !hasWord(positive, base) && !hasWord(projected.person.map(function (u) { return u.en; }).join(' '), base)) {
        add('SUBJECT_MISSING', 'error', '主体没有进入提示词：' + subject.zh, base);
      }
    });
    // 明显多出来的主体（原文只有女人，英文却出现 a girl）也要拦。
    const expectedSubjectWords = [];
    (scene.subjects || []).forEach(function (subject) {
      String(subject.en || '').toLowerCase().replace(/[^a-z\- ]+/g, ' ').split(/\s+/).forEach(function (word) {
        if (word && ['a', 'an', 'the'].indexOf(word) === -1 && expectedSubjectWords.indexOf(word) === -1) {
          expectedSubjectWords.push(word);
        }
      });
    });
    ['woman', 'man', 'girl', 'boy', 'child', 'baby', 'dog', 'cat', 'person'].forEach(function (term) {
      if (expectedSubjectWords.indexOf(term) !== -1) return;
      if (!hasWord(positive, term)) return;
      add('EXTRA_SUBJECT', 'error', '提示词里出现了原文没有的主体：' + term, term);
    });

    // 4. 颜色必须绑在正确对象上
    (scene.subjects || []).forEach(function (subject) {
      if (subject.outfitColor) colorPairs.push({ color: subject.outfitColor, target: 'outfit', owner: subject.zh });
    });
    (scene.outfits || []).forEach(function (outfit) {
      if (outfit.color) colorPairs.push({ color: outfit.color, target: 'outfit', owner: outfit.zh });
    });
    (scene.objects || []).forEach(function (object) {
      if (object.color) colorPairs.push({ color: object.color, target: object.en, owner: object.zh });
    });
    colorPairs.forEach(function (pair) {
      if (!hasWord(positive, pair.color.en)) {
        add('COLOR_MISSING', 'error', '颜色没有进入提示词：' + pair.color.zh, pair.color.en);
      }
    });
    // 颜色必须和正确对象一起出现，不能只检查「颜色出现过」。
    (scene.objects || []).forEach(function (object) {
      if (!object.color || !object.en) return;
      const color = String(object.color.en);
      const base = String(object.en).replace(new RegExp('^' + escapeRegExp(color) + '\\s+', 'i'), '').trim();
      if (!base) return;
      const re = new RegExp('\\b' + escapeRegExp(color) + '\\s+(?:[a-z-]+\\s+){0,2}?' + escapeRegExp(base), 'i');
      if (!re.test(positive)) {
        add('COLOR_BINDING', 'error',
          '颜色与对象没有绑定在一起：' + object.color.zh + ' + ' + object.zh +
          '（期望 ' + color + ' ' + base + '）', color + ' ' + base);
      }
    });
    // 隐含衣服颜色（红衣）要求「red」和穿着关系一起出现。
    (scene.subjects || []).forEach(function (subject) {
      if (!subject.outfitColor) return;
      const color = String(subject.outfitColor.en);
      const re = new RegExp('\\b(?:wearing|in|dressed in)\\s+(?:[a-z-]+\\s+){0,2}?' + escapeRegExp(color) + '\\b', 'i');
      const alt = new RegExp('\\b' + escapeRegExp(color) + '\\s+(?:clothes|clothing|outfit|dress|shirt|coat|jacket)\\b', 'i');
      if (!re.test(positive) && !alt.test(positive)) {
        add('COLOR_BINDING', 'error',
          '衣服颜色没有和穿着关系绑定：' + subject.outfitColor.zh, color);
      }
    });
    // 明显的错绑：颜色 + 人物名词，但场景里该人物没有这个颜色。
    const allColors = [];
    (L.byCategory.color || []).forEach(function (entry) {
      entry.enAliases.forEach(function (en) { if (allColors.indexOf(en) === -1) allColors.push(en); });
    });
    const personNouns = ['woman', 'man', 'girl', 'boy', 'person', 'people', 'child', 'lady', 'gentleman'];
    personNouns.forEach(function (noun) {
      allColors.forEach(function (color) {
        if (color.indexOf(' ') !== -1) return;
        const re = new RegExp('\\b' + escapeRegExp(color) + '\\s+' + escapeRegExp(noun) + '\\b', 'i');
        if (!re.test(positive)) return;
        const valid = colorPairs.some(function (pair) {
          return pair.target === 'outfit' && hasWord(pair.color.en, color) &&
            scene.subjects.some(function (s) { return hasWord(s.en, noun); });
        });
        if (!valid) add('COLOR_MISBIND', 'error', '颜色可能绑错对象：' + color + ' ' + noun, color + ' ' + noun);
      });
    });

    // 5. 关系不能丢
    (scene.relations || []).forEach(function (relation) {
      if (!relation.verify) return;
      const verify = String(relation.verify);
      if (!hasWord(positive, verify) && positiveLower.indexOf(verify.toLowerCase()) === -1) {
        // 介词短语允许被逗号或人物动作合并，按关键词再检查一次。
        const key = verify.split(/\s+/).filter(function (w) {
          return ['a', 'an', 'the', 'on', 'in', 'at', 'by', 'to', 'of', 'with', 'and'].indexOf(w.toLowerCase()) === -1;
        }).join(' ');
        if (key && positiveLower.indexOf(key.toLowerCase()) === -1) {
          add('RELATION_MISSING', 'error', '关系在提示词里丢失：' + relation.zh, verify);
        }
      }
    });

    }

    // 6. 用户允许的背景虚化不能被默认全局负面词压掉
    const allowBackgroundBlur = (scene.scopes || []).some(function (s) {
      return s.scope === 'background' && s.polarity === 'allow';
    });
    if (allowBackgroundBlur && hasWord(negativeText, 'blurry') && !/blurry background|blurred background/i.test(positive)) {
      add('SCOPE_LOST', 'error', '背景虚化是用户允许的，但负面提示词把它压掉了', 'blurry');
    }

    // 7. 不能擅自补光/镜头/画风
    const autoLight = /(soft natural light|50mm lens|natural skin texture)/i;
    if (autoLight.test(positive)) {
      if (!scene.lighting.length) add('EXTRA_LIGHTING', 'error', '用户没提光线/镜头，却出现了自动补全的光线或镜头词', positive);
    }
    if (!scene.style.length && /(realistic photography|cinematic|film grain|35mm film)/i.test(positive) &&
        !/(电影感|摄影|胶片|写实|真实摄影|cinematic|photography|film)/i.test(scene.raw)) {
      add('EXTRA_STYLE', 'error', '用户没提画风，却出现了自动补全的画风词', positive);
    }

    // 8. 输入是否被遗漏：结构单元的中文必须能在原文找到，且英文不能凭空多出主体
    (scene.subjects || []).forEach(function (subject) {
      if (subject.zh && scene.raw.indexOf(subject.zh) === -1 && subject.zh !== '人物') {
        add('INPUT_MISSING', 'warning', '结构里的主体在原文中找不到：' + subject.zh, subject.zh);
      }
    });

    const errors = issues.filter(function (i) { return i.severity === 'error'; });
    const incomplete = errors.length > 0 || scene.unknown.length > 0 || hasCjk(positive);
    return {
      ok: !incomplete,
      complete: !incomplete,
      incomplete: incomplete,
      issues: issues,
      checks: {
        subjectCount: subjectCount,
        colorPairs: colorPairs.length,
        relationCount: (scene.relations || []).length,
        negationCount: (scene.negations || []).length,
        unknownCount: scene.unknown.length,
        cjkResidue: hasCjk(positive)
      }
    };
  }

  // ── 本地模型结果的场景接入 ──────────────────────────────────
  // 本地模型只负责「哪些原文片段 + 什么槽位 / 角色 / 结构关系」；英文仍由
  // 本文件的词典与结构模板生成，不另做一套拼英文逻辑。模型返回的 text
  // 必须是原文子串，local-llm.js 会先逐段校验，这里再做一次防御性解析。

  function specSpan(text, slot) {
    const source = cleanText(text);
    if (!source) return { zh: '', en: '', matches: [], unknown: [] };
    const result = TR.translateZhPhrase(source, { slot: slot, allowRelation: true });
    return {
      zh: U.cleanChinese(result.zh || source),
      en: U.cleanEnglish(result.en || ''),
      matches: result.matches || [],
      unknown: (result.unknown || []).slice(),
      relation: result.relation || null
    };
  }

  function specColor(text) {
    const source = cleanText(text);
    if (!source) return null;
    const span = specSpan(source, 'outfit');
    return {
      zh: span.zh || source,
      en: span.en || source,
      alias: source,
      category: 'color'
    };
  }

  function specCategory(span, parsed) {
    if (span && span.matches && span.matches[0] && span.matches[0].entry) {
      return span.matches[0].entry.category || '';
    }
    if (parsed && parsed.matches && parsed.matches[0] && parsed.matches[0].entry) {
      return parsed.matches[0].entry.category || '';
    }
    return '';
  }

  function specUnitFromText(text, slot, role) {
    const source = cleanText(text);
    if (!source) return null;
    const key = SLOTS.indexOf(slot) !== -1 ? slot : 'scene';
    let parsed = null;
    if (key === 'person') parsed = parseSubjectPhrase(source);
    else if (key === 'outfit') parsed = parseOutfitPhrase(source);
    else if (key === 'scene' && role === 'object') parsed = parseObjectPhrase(source);

    const span = specSpan(source, key);
    let en = parsed && parsed.en ? parsed.en : span.en;
    let zh = hasCjk(source) ? source : (parsed && parsed.zh ? parsed.zh : (span.zh || source));

    if (!en && !hasCjk(source)) en = U.cleanEnglish(source);
    if (en && key === 'person' && !/^(a|an|the)\b/i.test(en)) en = addArticle(en);
    if (en && key === 'outfit' && !/^(wearing|in |dressed in)\b/i.test(en)) {
      en = 'wearing ' + addArticle(en);
    }
    if (en && key === 'scene' && role === 'object' &&
        !hasCjk(en) && !/^(a|an|the)\b/i.test(en) &&
        !/^(in|on|at|under|over|by|near|behind|beside|next to|in front of|inside|outside|along|through|from|toward|towards|against|across)\b/i.test(en)) {
      en = addArticle(en);
    }

    return makeUnit(key, zh, en, source, specCategory(span, parsed), {
      source: 'local-llm',
      role: role || '',
      matches: span.matches || [],
      unknown: span.unknown || []
    });
  }

  function specSubject(item) {
    if (!item || typeof item.text !== 'string') return null;
    const text = cleanText(item.text);
    if (!text) return null;
    const parsed = parseSubjectPhrase(text);
    const span = specSpan(text, 'person');
    let en = parsed && parsed.en ? parsed.en : addArticle(span.en || text);
    const attributes = [];
    const seen = Object.create(null);
    function addAttr(zh, enValue) {
      const zhText = cleanText(zh);
      const enText = U.cleanEnglish(enValue || '');
      if (!zhText && !enText) return;
      const key = (zhText + '|' + enText).toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      attributes.push({ zh: zhText || enText, en: enText || zhText, kind: 'spec' });
    }
    ((parsed && parsed.attributes) || []).forEach(function (attr) { addAttr(attr.zh, attr.en); });
    (Array.isArray(item.attributes) ? item.attributes : []).forEach(function (attrText) {
      const attr = specSpan(attrText, 'person');
      const already = attributes.some(function (a) { return a.zh === cleanText(attrText); });
      addAttr(attr.zh || attrText, attr.en || attrText);
      if (!already && attr.en && en.indexOf(attr.en) === -1) en += ' with ' + attr.en;
    });
    return {
      id: nextId('s'),
      zh: parsed ? parsed.zh : text,
      en: en,
      category: 'subject',
      attributes: attributes,
      outfitColor: null,
      outfitColorText: item.outfit_color ? cleanText(item.outfit_color) : '',
      text: text
    };
  }

  function specOutfit(item) {
    if (!item || typeof item.text !== 'string') return null;
    const text = cleanText(item.text);
    if (!text) return null;
    const parsed = parseOutfitPhrase(text);
    const span = specSpan(text, 'outfit');
    const color = item.color ? specColor(item.color) : (parsed && parsed.color ? parsed.color : null);
    let en = parsed && parsed.en ? parsed.en : span.en;
    if (!en) en = text;
    if (color && color.en && !new RegExp('^' + escapeRegExp(color.en), 'i').test(en)) {
      en = color.en + ' ' + en;
    }
    return {
      id: nextId('c'),
      ownerId: '',
      ownerText: item.owner ? cleanText(item.owner) : '',
      zh: parsed ? parsed.zh : text,
      en: en,
      color: color,
      attributes: (parsed && parsed.attributes) || [],
      text: text
    };
  }

  function specObject(item) {
    if (!item || typeof item.text !== 'string') return null;
    const text = cleanText(item.text);
    if (!text) return null;
    const parsed = parseObjectPhrase(text);
    const span = specSpan(text, 'scene');
    const color = item.color ? specColor(item.color) : (parsed && parsed.color ? parsed.color : null);
    let en = parsed && parsed.en ? parsed.en : span.en;
    if (!en) en = text;
    if (color && color.en && !new RegExp('^' + escapeRegExp(color.en), 'i').test(en)) {
      en = color.en + ' ' + en;
    }
    return {
      id: nextId('o'),
      zh: parsed ? parsed.zh : text,
      en: en,
      category: (parsed && parsed.category) || specCategory(span, parsed) || 'object',
      color: color,
      distance: cleanText(item.distance || (parsed && parsed.distance) || ''),
      attributes: [],
      text: text
    };
  }

  function textOverlaps(a, b) {
    const left = cleanText(a);
    const right = cleanText(b);
    if (!left || !right) return false;
    return left === right || left.indexOf(right) !== -1 || right.indexOf(left) !== -1;
  }

  function normalizeSpecScope(value) {
    const text = cleanText(value);
    if (/^(all|everything|整体|全部|所有)$/i.test(text)) return 'all';
    if (/background|背景|环境|后景|远景/i.test(text)) return 'background';
    if (/subject|人物|主体|人脸|面部|身体|衣服|服装|手部|头发|眼睛|角色|她|他/.test(text)) return 'subject';
    return 'global';
  }

  function normalizeSpecTarget(value) {
    let text = cleanText(value);
    const stripped = text
      .replace(/^(人物|主体|人脸|面部|背景|环境|衣服|服装|身体|手部|头发|眼睛|画面里|画面|整张图)?(?:都|也|全部)?(?:不要|不想|别|避免|不能|不可|请勿|切勿|勿|没有|不含|去除|去掉|排除)/, '')
      .replace(/^(出现|任何|所有|带有|有|的)+/g, '')
      .trim();
    return stripped || text;
  }

  function fromSpec(spec, raw) {
    const source = U.normalizeSpace(raw);
    const scene = emptyScene(source);
    scene.structured = true;
    scene.origin = 'local-llm';
    scene.specNotes = Array.isArray(spec && spec.notes) ? spec.notes.slice(0, 20).map(String) : [];
    const data = spec || {};

    // 关系句先让既有规则编译器拆一次（如「站在蓝色汽车旁」→ standing + next to a blue car），
    // 模型已给出关系和物体时，用它替换整句姿态翻译，避免颜色和介词绑错。
    const relationParses = Object.create(null);
    (Array.isArray(data.relations) ? data.relations : []).forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      const text = cleanText(item.text || '');
      if (!text || relationParses[text]) return;
      try {
        relationParses[text] = compile(text);
      } catch (err) {
        relationParses[text] = null;
      }
    });
    idCounter = 0;

    // 1. 六个框的投影单元：原文片段 + 槽位。
    const unitSeen = Object.create(null);
    function addUnit(unit) {
      if (!unit) return;
      const key = unit.slot + '|' + (unit.en || '').toLowerCase() + '|' + (unit.text || '');
      if (unitSeen[key]) return;
      unitSeen[key] = true;
      scene.units.push(unit);
    }
    function relationParseFor(text) {
      const relations = Array.isArray(data.relations) ? data.relations : [];
      for (let i = 0; i < relations.length; i += 1) {
        const item = relations[i];
        if (!item || typeof item !== 'object') continue;
        const relationText = cleanText(item.text || '');
        if (relationText !== text) continue;
        const parsed = relationParses[relationText];
        if (!parsed || !(parsed.units || []).length) continue;
        const structural = parsed.units.filter(function (unit) {
          return unit.slot === 'pose' || unit.slot === 'scene';
        });
        if (!structural.length) continue;
        // 关系句拆分后不能吞掉主语等前缀：没被动作/方位覆盖的实义字，
        // 必须能对上模型显式给出的主体 / 服装 / 物体，否则不替换。
        const covered = new Array(text.length);
        structural.forEach(function (unit) {
          const part = unit.text || '';
          let index = part ? text.indexOf(part) : -1;
          while (index !== -1) {
            for (let k = index; k < index + part.length; k += 1) covered[k] = true;
            index = text.indexOf(part, index + 1);
          }
        });
        let leftover = '';
        for (let k = 0; k < text.length; k += 1) {
          if (!covered[k]) leftover += text[k];
        }
        leftover = leftover.replace(/[的了着过和与及或而并也都就还很更最把被给让使对为以于地得在是有可所其之此那这我你他她它们个位名件条双只张座片群套头身款种些点分一二两三几每各另穿戴着系围披除部分使用剩余外，,。.、；;：:]/g, '').trim();
        if (leftover) {
          const explicit = (Array.isArray(data.subjects) ? data.subjects : [])
            .concat(Array.isArray(data.outfits) ? data.outfits : [])
            .concat(Array.isArray(data.objects) ? data.objects : []);
          const matched = explicit.some(function (entity) {
            return entity && typeof entity.text === 'string' && textOverlaps(entity.text, leftover);
          });
          if (!matched) continue;
        }
        return { parsed: parsed, item: item, structural: structural };
      }
      return null;
    }

    (Array.isArray(data.units) ? data.units : []).forEach(function (item) {
      if (!item || typeof item.text !== 'string') return;
      const text = cleanText(item.text);
      if (!text) return;
      const slot = SLOTS.indexOf(item.slot) !== -1 ? item.slot : 'scene';
      const role = typeof item.role === 'string' ? item.role : '';

      // 姿态单元如果正好是模型给出的关系句，用规则编译器的拆分结果，
      // 保留「动作 + 方位」两段，颜色绑定和 verify 都更稳。
      if (slot === 'pose') {
        const found = relationParseFor(text);
        if (found) {
          found.structural.forEach(function (parsedUnit) {
            addUnit(makeUnit(
              parsedUnit.slot,
              parsedUnit.zh,
              parsedUnit.en,
              parsedUnit.text,
              parsedUnit.category,
              {
                source: 'local-llm',
                role: parsedUnit.slot === 'pose' ? 'action' : 'place',
                matches: parsedUnit.matches || [],
                unknown: parsedUnit.unknown || []
              }
            ));
          });
          return;
        }
      }

      addUnit(specUnitFromText(text, slot, role));
    });

    // 2. 模型显式给出的主体 / 服装 / 物体。
    (Array.isArray(data.subjects) ? data.subjects : []).forEach(function (item) {
      const subject = specSubject(item);
      if (!subject) return;
      if (scene.subjects.some(function (s) { return textOverlaps(s.text || s.zh, subject.text); })) return;
      scene.subjects.push(subject);
    });
    (Array.isArray(data.outfits) ? data.outfits : []).forEach(function (item) {
      const outfit = specOutfit(item);
      if (!outfit) return;
      if (scene.outfits.some(function (o) { return textOverlaps(o.text || o.zh, outfit.text); })) return;
      scene.outfits.push(outfit);
    });
    (Array.isArray(data.objects) ? data.objects : []).forEach(function (item) {
      const object = specObject(item);
      if (!object) return;
      if (scene.objects.some(function (o) { return textOverlaps(o.text || o.zh, object.text); })) return;
      scene.objects.push(object);
    });

    // 3. 把单元和实体连起来；模型漏写实体数组时从单元推断，保证六框不空。
    scene.subjects.forEach(function (subject) {
      const unit = scene.units.find(function (u) {
        return u.slot === 'person' && textOverlaps(u.text, subject.text || subject.zh);
      });
      if (unit) {
        unit.entityId = subject.id;
        if (!unit.en || hasCjk(unit.en)) unit.en = subject.en;
      } else if (!scene.units.some(function (u) { return textOverlaps(u.text, subject.text || subject.zh); })) {
        scene.units.push(makeUnit('person', subject.zh, subject.en, subject.text || subject.zh, 'subject', {
          source: 'local-llm', role: 'subject', entityId: subject.id
        }));
      }
    });
    scene.outfits.forEach(function (outfit) {
      const unit = scene.units.find(function (u) {
        return u.slot === 'outfit' && textOverlaps(u.text, outfit.text || outfit.zh);
      });
      if (unit) {
        unit.entityId = outfit.id;
        if (!unit.en || hasCjk(unit.en)) {
          unit.en = /^(wearing|in |dressed in)\b/i.test(outfit.en) ? outfit.en : 'wearing ' + addArticle(outfit.en);
        }
      } else if (!scene.units.some(function (u) { return textOverlaps(u.text, outfit.text || outfit.zh); })) {
        scene.units.push(makeUnit('outfit', outfit.zh, 'wearing ' + addArticle(outfit.en), outfit.text || outfit.zh, 'outfit', {
          source: 'local-llm', role: 'outfit', entityId: outfit.id
        }));
      }
    });
    scene.objects.forEach(function (object) {
      const unit = scene.units.find(function (u) {
        return u.slot === 'scene' && u.role === 'object' && textOverlaps(u.text, object.text || object.zh);
      });
      if (unit) {
        unit.entityId = object.id;
        if (!unit.en || hasCjk(unit.en)) unit.en = addArticle(object.en);
      } else if (!scene.units.some(function (u) { return textOverlaps(u.text, object.text || object.zh); })) {
        scene.units.push(makeUnit('scene', object.zh, addArticle(object.en), object.text || object.zh, object.category || 'object', {
          source: 'local-llm', role: 'object', entityId: object.id
        }));
      }
    });

    // 单元没写实体时也补出主体 / 服装 / 物体，结构化面板才有东西可看。
    scene.units.forEach(function (unit) {
      if (unit.slot === 'person' && !scene.subjects.some(function (s) { return textOverlaps(unit.text, s.text || s.zh); })) {
        const subject = specSubject({ text: unit.text });
        if (subject) {
          subject.en = unit.en || subject.en;
          subject.zh = unit.zh || subject.zh;
          scene.subjects.push(subject);
          unit.entityId = subject.id;
        }
      }
      if (unit.slot === 'outfit' && !scene.outfits.some(function (o) { return textOverlaps(unit.text, o.text || o.zh); })) {
        const outfit = specOutfit({ text: unit.text });
        if (outfit) {
          outfit.en = unit.en || outfit.en;
          outfit.zh = unit.zh || outfit.zh;
          scene.outfits.push(outfit);
          unit.entityId = outfit.id;
        }
      }
      if (unit.slot === 'scene' && unit.role === 'object' &&
          !scene.objects.some(function (o) { return textOverlaps(unit.text, o.text || o.zh); })) {
        const object = specObject({ text: unit.text });
        if (object) {
          object.en = unit.en || object.en;
          object.zh = unit.zh || object.zh;
          scene.objects.push(object);
          unit.entityId = object.id;
        }
      }
    });

    // 4. 服装归属与主体衣服颜色。
    scene.outfits.forEach(function (outfit) {
      let owner = null;
      if (outfit.ownerText) {
        owner = scene.subjects.find(function (s) { return textOverlaps(outfit.ownerText, s.text || s.zh); }) || null;
      }
      if (!owner && scene.subjects.length === 1) owner = scene.subjects[0];
      if (owner) outfit.ownerId = owner.id;
    });
    scene.subjects.forEach(function (subject) {
      if (!subject.outfitColorText) return;
      const match = scene.outfits.find(function (outfit) {
        return outfit.color && (outfit.color.zh === subject.outfitColorText ||
          textOverlaps(outfit.text || outfit.zh, subject.outfitColorText));
      });
      if (match && match.color) subject.outfitColor = match.color;
      delete subject.outfitColorText;
    });

    // 5. 动作：以姿态单元为准；模型显式给了 actions 也保留。
    scene.units.forEach(function (unit) {
      if (unit.slot !== 'pose') return;
      const actor = scene.subjects.find(function (s) { return textOverlaps(unit.text, s.text || s.zh); }) ||
        scene.subjects[0] || null;
      scene.actions.push({
        id: nextId('a'),
        subjectId: actor ? actor.id : '',
        zh: unit.zh,
        en: unit.en,
        type: 'pose',
        targetId: ''
      });
    });

    // 6. 关系：wearing / located / next_to / holding / pose / distance。
    const relationSeen = Object.create(null);
    (Array.isArray(data.relations) ? data.relations : []).forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      const type = cleanText(item.type) || 'other';
      const text = cleanText(item.text || '');
      const from = cleanText(item.from || '');
      const to = cleanText(item.to || '');
      if (!text && !to && !from) return;
      const span = specSpan(text || to || from, 'pose');
      const subject = from ? scene.subjects.find(function (s) { return textOverlaps(from, s.text || s.zh); }) : scene.subjects[0];
      const object = to ? scene.objects.find(function (o) { return textOverlaps(to, o.text || o.zh); }) : null;
      const outfit = to ? scene.outfits.find(function (o) { return textOverlaps(to, o.text || o.zh); }) : null;
      let verify = span.en || '';
      if (type === 'wearing' && outfit) verify = outfit.en;
      else if (object) verify = object.en;
      const parsedRelation = text && relationParses[text] && (relationParses[text].relations || []).find(function (r) {
        return r && (r.en || r.verify);
      });
      if (parsedRelation && parsedRelation.verify) verify = parsedRelation.verify;
      if (!verify) return;
      const key = type + '|' + verify.toLowerCase() + '|' + text;
      if (relationSeen[key]) return;
      relationSeen[key] = true;
      scene.relations.push({
        type: type,
        subjectId: subject ? subject.id : '',
        objectId: object ? object.id : '',
        outfitId: outfit ? outfit.id : '',
        zh: text || (from + to),
        en: (parsedRelation && parsedRelation.en) || span.en || verify,
        verify: verify
      });
    });

    // 7. 否定与作用范围：不改写成肯定，也不把局部否定升级成全局。
    function ensurePersonSubject() {
      if (scene.subjects.length) return;
      const subject = {
        id: nextId('s'), zh: '人物', en: 'a person', category: 'subject',
        attributes: [], outfitColor: null, text: '人物'
      };
      scene.subjects.push(subject);
      scene.units.unshift(makeUnit('person', '人物', 'a person', '人物', 'subject', {
        source: 'local-llm', role: 'subject', entityId: subject.id
      }));
    }

    function addNegation(item) {
      if (!item) return;
      const rawTarget = normalizeSpecTarget(item.target || item.text || '');
      if (!rawTarget) return;
      const targets = expandNegationTarget(rawTarget);
      if (!targets.length) return;
      const scope = normalizeSpecScope(item.scope || item.topic || '');
      const topic = cleanText(item.topic || '');
      if (scope === 'subject') ensurePersonSubject();
      scene.negations.push({
        text: cleanText(item.text || rawTarget),
        topic: topic || (scope === 'subject' ? '人物' : ''),
        scope: scope,
        targets: targets,
        rawTarget: rawTarget,
        negated: true
      });
      const topicInfo = topicZhEn(topic);
      scene.scopes.push({
        scope: scope,
        topic: topicInfo.zh,
        topicEn: topicInfo.en,
        target: rawTarget,
        targets: targets,
        polarity: 'exclude',
        exception: ''
      });
    }
    (Array.isArray(data.negations) ? data.negations : []).forEach(function (item) {
      if (typeof item === 'string') addNegation({ text: item, target: item });
      else addNegation(item);
    });

    function addException(text) {
      const span = specSpan(text, 'style');
      if (!span.zh && !span.en) return;
      const zh = span.zh || cleanText(text);
      if (scene.exceptions.some(function (item) { return item.zh === zh; })) return;
      scene.exceptions.push({ zh: zh, en: span.en || zh });
    }

    const scopeSeen = Object.create(null);
    (Array.isArray(data.scopes) ? data.scopes : []).forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      let polarity = cleanText(item.polarity) || 'apply';
      if (['exclude', 'allow', 'apply'].indexOf(polarity) === -1) polarity = 'apply';
      const target = normalizeSpecTarget(item.target || item.text || '');
      if (!target) return;
      const targets = polarity === 'exclude'
        ? expandNegationTarget(target)
        : (function () { const span = specSpan(target, 'style'); return [{ zh: span.zh || target, en: span.en || target }]; })();
      if (!targets.length) return;
      const scope = normalizeSpecScope(item.scope || '');
      const exception = cleanText(item.exception || '');
      const key = scope + '|' + polarity + '|' + target + '|' + exception;
      if (scopeSeen[key]) return;
      scopeSeen[key] = true;
      const topicInfo = topicZhEn(cleanText(item.topic || ''));
      scene.scopes.push({
        scope: scope,
        topic: topicInfo.zh,
        topicEn: topicInfo.en,
        target: target,
        targets: targets,
        polarity: polarity,
        exception: exception,
        exceptionEn: exception ? (specSpan(exception, 'style').en || exception) : ''
      });
      if (polarity === 'exclude') {
        const exists = scene.negations.some(function (negation) {
          return (negation.targets || []).some(function (t) {
            return t.en && targets.some(function (x) { return x.en === t.en; });
          });
        });
        if (!exists) {
          const scopeTopic = cleanText(item.topic || '');
          scene.negations.push({
            text: cleanText(item.text || target),
            topic: scopeTopic || (scope === 'subject' ? '人物' : ''),
            scope: scope,
            targets: targets,
            rawTarget: target,
            negated: true
          });
        }
      }
      if (exception) addException(exception);
      if (scope === 'subject' && polarity === 'exclude') ensurePersonSubject();
    });

    (Array.isArray(data.exceptions) ? data.exceptions : []).forEach(function (item) {
      if (typeof item === 'string') addException(item);
      else if (item && typeof item === 'object') addException(item.text || item.exception || '');
    });

    // 作用范围去重：否定生成的 scope 和模型显式 scope 可能重复。
    const dedupScopes = [];
    scene.scopes.forEach(function (scope) {
      const key = scope.scope + '|' + scope.polarity + '|' + (scope.target || '') + '|' + (scope.exception || '');
      const found = dedupScopes.some(function (item) {
        return item.scope + '|' + item.polarity + '|' + (item.target || '') + '|' + (item.exception || '') === key;
      });
      if (!found) dedupScopes.push(scope);
    });
    scene.scopes = dedupScopes;

    // 单元顺序保持模型给定的顺序；六框投影和组装继续用同一套 rules。
    scene.segmentation = { tokens: [], alternatives: [], ambiguous: false, score: 0 };
    finalizeScene(scene, source);
    return scene;
  }

  T2I.Scene = {
    compile: compile,
    project: project,
    render: render,
    renderZh: renderZh,
    negativePlan: negativePlan,
    verify: verify,
    segmentLattice: segmentLattice,
    fromSpec: fromSpec,
    translateSpan: specSpan,
    show: function (scene) { return JSON.parse(JSON.stringify(scene)); },
    slots: SLOTS,
    slotLabel: SLOT_LABEL
  };
})();
