/*
 * translator.js — 词典驱动的中英互译
 *
 * 策略：先识别「谁 + 对什么 + 做什么 + 什么氛围」的关系句式，再用词典
 * 零件组装 peeing on a car wheel 这类自然英文；然后做整条短语精确匹配、
 * 「穿着 / 站在 / 坐在 / 背景是 / 光线是」等结构，最后做最长词匹配 +
 * 组合翻译。词典没收录的内容原样保留，同时通过 unknown 数组交给界面
 * 提示，绝不静默删除。
 */
(function () {
  'use strict';

  const T2I = (window.T2I = window.T2I || {});
  const U = T2I.Utils;
  const L = T2I.Lexicon;

  // 不参与语义、也不应触发「未收录」提示的虚词 / 量词。
  const STOP_ZH = [
    '看起来', '看上去', '显得', '感觉', '整体', '以及', '还有', '并且', '同时',
    '因为', '所以', '如果', '但是', '不过', '然后', '而且', '其中', '一种',
    '一个', '一位', '一名', '一件', '一条', '一双', '一只', '一把', '一张',
    '一座', '一片', '一群', '一套', '一头', '一身', '一些', '一点', '几分',
    '非常', '十分', '特别', '比较', '稍微', '有些', '略微', '略显', '相当',
    '的是', '的', '地', '得', '了', '着', '过', '是', '在', '里', '中', '上', '撑着',
    '下', '边', '旁', '前', '后', '内', '外', '和', '与', '及', '而', '也',
    '都', '还', '又', '很', '太', '更', '最', '带', '有', '被', '把', '让',
    '给', '对', '向', '朝', '往', '从', '到', '于', '为', '以', '之', '其',
    '此', '那', '这', '我', '你', '他', '她', '它', '他们', '她们', '人们',
    '着', '的', '个', '位', '件', '条', '双', '只', '把', '张', '座', '片',
    '群', '套', '头', '身', '款', '种', '些', '很', '手里', '手中',
    '一杯', '两杯', '三杯', '几杯', '一口', '一杯杯',
    '画面', '场面', '场景中'
  ].sort(function (a, b) { return b.length - a.length; });

  const EN_STOP = [
    'a', 'an', 'the', 'and', 'or', 'with', 'in', 'on', 'at', 'by', 'of',
    'for', 'to', 'from', 'into', 'over', 'under', 'wearing', 'dressed',
    'is', 'are', 'was', 'were', 'be', 'being', 'very', 'slightly', 'highly',
    'down', 'up', 'out', 'through', 'across', 'near', 'around', 'while',
    'his', 'her', 'their', 'its', 'this', 'that', 'these', 'those', 'as',
    'style', 'look', 'feel', 'shot', 'image', 'photo', 'picture', 'scene'
  ];
  const EN_STOP_SET = Object.create(null);
  EN_STOP.forEach(function (w) { EN_STOP_SET[w] = true; });

  // 人物描写里应放在人物名词前的形容词（young woman, slim man）。
  const PRE_PERSON_EN = Object.create(null);
  [
    'young', 'middle-aged', 'elderly', 'cute', 'mature', 'elegant', 'poised',
    'slim', 'tall', 'petite', 'well-proportioned', 'athletic', 'muscular',
    'curvy', 'fair-skinned', 'tan-skinned', 'dark-skinned',
    'pretty', 'beautiful', 'good-looking', 'handsome', 'attractive',
    'stunning', 'gorgeous', 'lovely', 'charming'
  ].forEach(function (w) { PRE_PERSON_EN[w] = true; });

  const PLACE_AT = /(station|airport|doorway|bus stop|platform|entrance|corner)/i;
  const PLACE_ON = /(street|beach|rooftop|bridge|stage|grass|snowfield|boardwalk|field|road|roadside|summit|mountain|floor|bench)/i;
  const PLACE_BY = /(window|wall|seaside|lakeside|riverside|railing|pier|harbor|harbour|lighthouse)/i;
  const PLACE_IN = /(cafe|restaurant|bar|library|bookstore|bedroom|living room|kitchen|bathroom|office|classroom|hotel room|forest|park|garden|village|museum|gallery|studio|car|room)/i;

  const POSE_PLACEMENT = {
    standing: '站在',
    sitting: '坐在',
    seated: '坐在',
    lying: '躺在',
    walking: '走在',
    leaning: '靠在',
    kneeling: '跪在',
    crouching: '蹲在'
  };

  // 关系句式的零件类别。动作不只来自 pose，也包括「对着镜头微笑」这类表情。
  const ACTION_CATEGORIES = ['pose', 'expression', 'action'];
  const TARGET_CATEGORIES = ['object', 'scene', 'camera', 'light', 'outfit', 'accessory', 'subject'];
  const RELATION_MARKERS = ['对着', '朝着', '向着', '冲着', '冲向', '给', '往', '向', '朝', '在', '对'];
  const EXCRETION_RE = /^(peeing|urinating|pooping|defecating|spraying|marking)\b/i;
  const MOVEMENT_RE = /^(running|walking|jumping|charging|flying|swimming|driving|riding|climbing|chasing)\b/i;
  const GAZE_RE = /^(looking|gazing|staring|smiling|grinning|laughing|barking|growling|pointing|waving|glancing)\b/i;

  const exactZh = Object.create(null);
  const exactEn = Object.create(null);

  L.entries.forEach(function (entry) {
    entry.zhAliases.forEach(function (alias) {
      const key = alias.trim().toLowerCase();
      if (!exactZh[key]) exactZh[key] = entry;
    });
    entry.enAliases.forEach(function (alias) {
      const key = alias.trim().toLowerCase();
      if (!exactEn[key]) exactEn[key] = entry;
    });
  });

  function scanZh(text) {
    const source = U.normalizeQuotes(String(text || ''));
    const matches = [];
    let i = 0;
    while (i < source.length) {
      const ch = source.charAt(i);
      const candidates = L.zhIndex[ch.toLowerCase()];
      let found = null;
      if (candidates) {
        for (let c = 0; c < candidates.length; c += 1) {
          const cand = candidates[c];
          const slice = source.slice(i, i + cand.alias.length);
          if (slice.toLowerCase() === cand.alias.toLowerCase()) {
            found = cand;
            break;
          }
        }
      }
      if (found) {
        matches.push({
          entry: found.entry,
          alias: found.alias,
          start: i,
          end: i + found.alias.length
        });
        i += found.alias.length;
      } else {
        i += 1;
      }
    }
    return matches;
  }

  function isWordChar(ch) {
    return /[A-Za-z0-9]/.test(ch || '');
  }

  function scanEn(text) {
    const source = U.normalizeQuotes(String(text || ''));
    const lower = source.toLowerCase();
    const matches = [];
    let i = 0;
    while (i < source.length) {
      const ch = lower.charAt(i);
      const candidates = L.enIndex[ch];
      let found = null;
      if (candidates) {
        for (let c = 0; c < candidates.length; c += 1) {
          const cand = candidates[c];
          const alias = cand.alias.toLowerCase();
          if (!lower.startsWith(alias, i)) continue;
          const before = source.charAt(i - 1);
          const after = source.charAt(i + alias.length);
          if (isWordChar(before) || isWordChar(after)) continue;
          found = cand;
          break;
        }
      }
      if (found) {
        matches.push({
          entry: found.entry,
          alias: found.alias,
          start: i,
          end: i + found.alias.length
        });
        i += found.alias.length;
      } else {
        i += 1;
      }
    }
    return matches;
  }

  function stripStopZh(gap) {
    let rest = String(gap || '').replace(/[\s，,。.、；;：:！!？?（）()【】\[\]"'“”‘’]/g, '');
    STOP_ZH.forEach(function (word) {
      if (rest.indexOf(word) !== -1) rest = rest.split(word).join('');
    });
    return rest.trim();
  }

  function meaningfulGap(gap) {
    return stripStopZh(gap).length > 0;
  }

  function extractUnknownEn(text, matches) {
    const source = String(text || '');
    const re = /[A-Za-z0-9][A-Za-z0-9'’/.-]*/g;
    const unknown = [];
    let m;
    while ((m = re.exec(source)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const covered = matches.some(function (match) {
        return start >= match.start && end <= match.end;
      });
      if (covered) continue;
      const token = m[0].toLowerCase().replace(/^[-.]+|[-.]+$/g, '');
      if (!token || EN_STOP_SET[token]) continue;
      if (!unknown.includes(token)) unknown.push(token);
    }
    return unknown;
  }

  function unknownZhSpans(phrase, matches) {
    const spans = [];
    let cursor = 0;
    matches.forEach(function (match) {
      const gap = phrase.slice(cursor, match.start);
      if (meaningfulGap(gap)) spans.push(gap.trim());
      cursor = match.end;
    });
    const tail = phrase.slice(cursor);
    if (meaningfulGap(tail)) spans.push(tail.trim());
    return spans.filter(function (s) {
      return s && !/^[\s，,。.、；;：:！!？?（）()【】\[\]"'“”‘’]+$/.test(s);
    });
  }

  function placePrep(en) {
    if (/^(by|at|in|on|near|inside|outside|under|behind)\b/i.test(en)) return '';
    if (PLACE_IN.test(en) && PLACE_BY.test(en)) return 'in';
    if (PLACE_BY.test(en)) return 'by';
    if (PLACE_ON.test(en)) return 'on';
    if (PLACE_AT.test(en)) return 'at';
    return 'in';
  }

  // 给地点补一个自然冠词：standing on the street / sitting in the cafe。
  function placePhrase(prep, en) {
    const text = String(en || '').trim();
    if (!prep || !text) return text;
    if (/^(a|an|the|his|her|their|this|that)\b/i.test(text)) return text;
    if (/s$/i.test(text) && !/glass|grass|dress/i.test(text)) return text;
    return prep + ' the ' + text;
  }

  function joinWords(parts) {
    const out = [];
    parts.forEach(function (part) {
      const clean = String(part || '').replace(/\s+/g, ' ').trim();
      if (!clean) return;
      if (out.length && /[,;.!?]$/.test(out[out.length - 1])) {
        out.push(clean);
      } else {
        out.push(clean);
      }
    });
    return out.join(' ').replace(/\s+([,.;])/g, '$1').replace(/,\s*,/g, ',').trim();
  }

  function addPhrase(enParts, text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    enParts.push(clean);
  }

  function personComposition(matches, phrase) {
    const subject = matches.find(function (m) { return m.entry.category === 'subject'; });
    if (!subject) return null;
    const pre = [];
    const withList = [];
    const expr = [];
    const used = [subject];

    matches.forEach(function (m) {
      if (m === subject || m.entry.category === 'connector') return;
      const cat = m.entry.category;
      if (['appearance', 'hair', 'eyes', 'expression', 'makeup'].indexOf(cat) === -1) return;
      used.push(m);
      if (cat === 'expression') {
        expr.push(m.entry.en);
      } else if (cat === 'appearance' && PRE_PERSON_EN[m.entry.en]) {
        pre.push(m.entry.en);
      } else {
        withList.push(m.entry.en);
      }
    });

    let out = pre.concat(subject.entry.en).join(' ');
    if (withList.length) out += ' with ' + withList.join(' and ');
    if (expr.length) out += (withList.length ? ',' : '') + ' ' + expr.join(', ');

    // 同一短语里如果还夹着动作、服装或场景，接在后面，绝不静默丢失。
    const extras = matches.filter(function (m) {
      return ['subject', 'appearance', 'hair', 'eyes', 'expression', 'makeup', 'connector'].indexOf(m.entry.category) === -1;
    });
    if (extras.length) {
      const onlyPose = extras.every(function (m) { return m.entry.category === 'pose'; });
      if (onlyPose && !withList.length && !expr.length && extras.length === 1) {
        out += ' ' + extras[0].entry.en;
      } else {
        out += ', ' + extras.map(function (m) { return m.entry.en; }).join(', ');
      }
    }
    return out;
  }

  function sceneComposition(matches) {
    const sceneMatches = matches.filter(function (m) { return m.entry.category === 'scene'; });
    const timeMatches = matches.filter(function (m) { return m.entry.category === 'time'; });
    const weatherMatches = matches.filter(function (m) { return m.entry.category === 'weather'; });
    if (!sceneMatches.length && !timeMatches.length && !weatherMatches.length) return null;

    let out = sceneMatches.map(function (m) { return m.entry.en; }).join(' ');
    const weather = weatherMatches.map(function (m) { return m.entry.en; }).join(' ');
    if (weather) {
      if (/^(sunny|rainy|cloudy|overcast|foggy|snowy|windy|stormy)$/.test(weather)) {
        out = (weather + ' ' + out).trim();
      } else {
        out = joinWords([out, weather]);
      }
    }
    if (timeMatches.length) {
      const time = timeMatches.map(function (m) { return m.entry.en; }).join(' ');
      let prep = 'at';
      if (/golden hour|blue hour|sunrise|sunset/i.test(time)) prep = 'during';
      else if (/morning|afternoon|spring|summer|autumn|winter/i.test(time)) prep = 'in the';
      else if (/night|noon|dusk|dawn|midnight/i.test(time)) prep = 'at';
      out = out ? out + ' ' + prep + ' ' + time : time;
    }

    // 场景短语里经常还夹着动作或质感词（窗边看书 / 模糊的城市灯光）。
    // 形容词放场景前，动作放场景后，避免出现 city lights blurred。
    const extras = matches.filter(function (m) {
      return ['scene', 'time', 'weather', 'connector'].indexOf(m.entry.category) === -1;
    });
    const preExtras = extras
      .filter(function (m) { return ['style', 'quality', 'light'].indexOf(m.entry.category) !== -1; })
      .map(function (m) { return m.entry.en; });
    const postExtras = extras
      .filter(function (m) { return ['style', 'quality', 'light'].indexOf(m.entry.category) === -1; })
      .map(function (m) { return m.entry.en; });
    if (preExtras.length) out = joinWords(preExtras.concat([out]));
    if (postExtras.length) out = joinWords([out].concat(postExtras));
    return out || null;
  }

  function outfitComposition(matches) {
    const wanted = ['outfit', 'accessory', 'material', 'color'];
    const relevant = matches.filter(function (m) { return wanted.indexOf(m.entry.category) !== -1; });
    if (!relevant.length) return null;
    const items = [];
    let pending = [];
    relevant.forEach(function (m) {
      const isNoun = m.entry.category === 'outfit' || m.entry.category === 'accessory';
      if (isNoun) {
        items.push(pending.concat([m.entry.en]).join(' '));
        pending = [];
      } else {
        pending.push(m.entry.en);
      }
    });
    if (pending.length) items.push(pending.join(' '));

    let out = items.join(' and ');
    const extras = matches.filter(function (m) {
      return wanted.indexOf(m.entry.category) === -1 && m.entry.category !== 'connector';
    });
    if (extras.length) {
      out += ', ' + extras.map(function (m) { return m.entry.en; }).join(', ');
    }
    return out;
  }

  function lightComposition(matches) {
    const lights = matches.filter(function (m) {
      return m.entry.category === 'light' || m.entry.category === 'camera';
    });
    if (!lights.length) return null;
    const modifiers = matches.filter(function (m) {
      return m.entry.category === 'color' || m.entry.category === 'quality' || m.entry.category === 'style';
    });
    const lightText = U.uniqueBy(
      lights.map(function (m) { return m.entry.en; }),
      function (x) { return x.toLowerCase(); }
    ).join(', ');
    const prefix = U.uniqueBy(
      modifiers.map(function (m) { return m.entry.en; }),
      function (x) { return x.toLowerCase(); }
    ).join(' ');
    return prefix ? prefix + ' ' + lightText : lightText;
  }

  function styleComposition(matches) {
    const relevant = matches.filter(function (m) {
      return m.entry.category === 'style' || m.entry.category === 'quality' || m.entry.category === 'mood';
    });
    if (!relevant.length) return null;
    return relevant.map(function (m) { return m.entry.en; }).join(', ');
  }

  function genericComposition(phrase, matches) {
    if (!matches.length) return null;
    const parts = [];
    let cursor = 0;
    matches.forEach(function (match) {
      const gap = phrase.slice(cursor, match.start);
      if (meaningfulGap(gap)) parts.push(gap.trim());
      if (match.entry.category !== 'connector') parts.push(match.entry.en);
      cursor = match.end;
    });
    const tail = phrase.slice(cursor);
    if (meaningfulGap(tail)) parts.push(tail.trim());
    return joinWords(parts);
  }

  // ── 关系句式：谁 + 对什么 + 做什么 + 什么氛围 ──────────────────
  // 先定位主体、关系词、目标物体、动作和尾部的氛围，再把零件按英文关系
  // 组装成 peeing on a car wheel / smiling at the camera。词典只提供零件，
  // 不为某一句具体笑话写整句模板。

  function findRelationMarker(text, from) {
    for (let i = from; i < text.length; i += 1) {
      for (let t = 0; t < RELATION_MARKERS.length; t += 1) {
        const token = RELATION_MARKERS[t];
        if (!text.startsWith(token, i)) continue;
        // 「现在 / 正在 / 所在」里的「在」不是关系词。
        if (token === '在' && /[现正所]/.test(text.charAt(i - 1))) continue;
        return { token: token, index: i, end: i + token.length };
      }
    }
    return null;
  }

  function splitRelationSuffix(raw) {
    const text = String(raw || '').trim();
    const m = text.match(/(上面|旁边|上|里|中|旁|边|前|后|下)$/);
    if (!m) return { text: text, suffix: '' };
    return { text: text.slice(0, text.length - m[1].length).trim(), suffix: m[1] };
  }

  function relationPrep(marker, actionEn, suffix) {
    const action = String(actionEn || '');
    if (suffix === '里' || suffix === '中') return 'in';
    if (suffix === '旁边' || suffix === '旁' || suffix === '边') return 'next to';
    if (suffix === '前') return 'in front of';
    if (suffix === '后') return 'behind';
    if (suffix === '下') return 'under';
    if (suffix === '上面' || suffix === '上') return 'on';
    if (EXCRETION_RE.test(action)) return 'on';
    if (marker.token === '在' || marker.token === '给' || marker.token === '往') return 'on';
    if (GAZE_RE.test(action)) return 'at';
    if (MOVEMENT_RE.test(action)) return /chasing/i.test(action) ? 'after' : 'toward';
    return 'toward';
  }

  function withIndefiniteArticle(text) {
    const t = String(text || '').trim();
    if (!t || U.hasCjk(t)) return t;
    if (/^(a|an|the|this|that|these|those|his|her|their|its|my|your|our|some|many|several|two|three|four|five)\b/i.test(t)) return t;
    if (/^(he|she|it|they|we|i|you)\b/i.test(t)) return t;
    if (/^(people|children|men|women|feet|teeth|mice|geese)$/i.test(t)) return t;
    if (/(?:s|es)$/i.test(t) && !/(glass|grass|dress|bus|class|lens|series|species)$/i.test(t)) return t;
    return (/^[aeiou]/i.test(t) ? 'an ' : 'a ') + t;
  }

  function uniqueList(list) {
    const out = [];
    (list || []).forEach(function (item) {
      if (item && !out.includes(item)) out.push(item);
    });
    return out;
  }

  function decomposeRelation(text) {
    const source = U.normalizeSpace(text);
    if (!source || !U.hasCjk(source)) return null;

    const matches = scanZh(source);
    const subjectMatch = matches.find(function (m) { return m.entry.category === 'subject'; });
    if (!subjectMatch) return null;

    const marker = findRelationMarker(source, subjectMatch.end);
    if (!marker || marker.index <= 0) return null;

    const subjectText = source.slice(0, marker.index).trim();
    if (!subjectText) return null;

    // 先找关系词后面的目标物体，再把动作限定在目标之后，避免把「跑车」
    // 里的「跑」误当动作。
    const targetCandidates = matches.filter(function (m) {
      return m.start >= marker.end && TARGET_CATEGORIES.indexOf(m.entry.category) !== -1;
    });
    let targetMatch = null;
    let actionMatch = null;
    for (let i = 0; i < targetCandidates.length; i += 1) {
      const target = targetCandidates[i];
      const action = matches.find(function (m) {
        return m.start >= target.end && ACTION_CATEGORIES.indexOf(m.entry.category) !== -1;
      });
      if (action) {
        targetMatch = target;
        actionMatch = action;
        break;
      }
    }
    if (!actionMatch) {
      actionMatch = matches.find(function (m) {
        return m.start >= marker.end && ACTION_CATEGORIES.indexOf(m.entry.category) !== -1;
      });
    }
    if (!actionMatch) return null;

    const objectRaw = source.slice(marker.end, actionMatch.start)
      .replace(/^[，,、\s]+|[，,、\s]+$/g, '');
    const objectParts = splitRelationSuffix(objectRaw);
    const objectText = objectParts.text;
    if (!objectText) return null;

    // 目标词后面的「的搞笑画面」是氛围，不是动作的一部分。
    let moodText = source.slice(actionMatch.end).trim()
      .replace(/^[的地得，,、\s]+/, '');
    let moodResult = null;
    if (moodText && stripStopZh(moodText)) {
      moodResult = translateZhPhrase(moodText, { slot: 'style', allowRelation: false });
      if (!moodResult.en) moodResult = null;
    }

    const subjectResult = translateZhPhrase(subjectText, { slot: 'person', allowRelation: false });
    const actionResult = translateZhPhrase(actionMatch.alias, { slot: 'pose', allowRelation: false });
    const objectResult = translateZhPhrase(objectText, { slot: 'scene', allowRelation: false });

    const subjectEn = withIndefiniteArticle(subjectResult.en || subjectText);
    let objectEn = objectResult.en || objectText;
    // 「对着镜头」在英文里说 at the camera，而不是 at a lens。
    if (targetMatch && targetMatch.entry.category === 'camera' && /^(lens|camera lens)$/i.test(objectEn)) {
      objectEn = 'camera';
    }
    const actionEn = actionResult.en || actionMatch.alias;
    const actionZh = actionResult.zh || actionMatch.alias;
    const objectZh = objectResult.zh || objectText;

    // 「给 / 往 / 在」必须带上「上 / 里 / 旁…」这类方位补语，或者目标
    // 明确是物体/场景且动作是排泄，才按关系句处理。这样「给朋友打电话」
    // 「在咖啡馆喝咖啡」仍走普通短语翻译，不会被拼成 on a friend / on a cafe。
    const needsLocative = marker.token === '给' || marker.token === '往' || marker.token === '在';
    if (needsLocative && !objectParts.suffix) {
      const targetCategory = targetMatch ? targetMatch.entry.category : '';
      const excretionTarget = EXCRETION_RE.test(actionEn) &&
        (targetCategory === 'object' || targetCategory === 'scene');
      if (!excretionTarget) return null;
    }

    let prep = relationPrep(marker, actionEn, objectParts.suffix);
    if (!objectParts.suffix && marker.token === '在' && targetMatch && targetMatch.entry.category === 'scene') {
      prep = 'in';
    }
    // 动作词本身已带介词（peeing on）时不再重复。
    if (/\b(on|at|in|toward|towards|after|by|against|into|over|under)\s*$/i.test(actionEn)) prep = '';
    const targetPhraseEn = /^camera$/i.test(objectEn) ? 'the camera' : withIndefiniteArticle(objectEn);
    const relationEn = prep
      ? joinWords([actionEn, prep, targetPhraseEn])
      : joinWords([actionEn, targetPhraseEn]);

    let relationZh;
    if (marker.token === '给' || marker.token === '往' || marker.token === '在') {
      relationZh = '在' + objectZh + (objectParts.suffix || '上');
    } else {
      relationZh = marker.token + objectZh;
    }
    const actionZhFull = relationZh + actionZh;

    const moodZh = moodResult ? (moodResult.zh || moodText) : '';
    const moodEn = moodResult ? moodResult.en : '';
    const subjectZh = subjectResult.zh || subjectText;

    const segments = [
      {
        text: subjectText,
        zh: subjectZh,
        en: subjectEn,
        slot: 'person',
        matches: subjectResult.matches || [],
        unknown: subjectResult.unknown || []
      },
      {
        text: relationZh + actionZh,
        zh: actionZhFull,
        en: relationEn,
        slot: 'pose',
        matches: actionResult.matches || [],
        unknown: actionResult.unknown || []
      },
      {
        text: objectText,
        zh: objectZh,
        en: objectEn,
        slot: 'scene',
        matches: objectResult.matches || [],
        unknown: objectResult.unknown || []
      }
    ];
    if (moodResult) {
      segments.push({
        text: moodText,
        zh: moodZh,
        en: moodEn,
        slot: 'style',
        matches: moodResult.matches || [],
        unknown: moodResult.unknown || []
      });
    }

    const allMatches = uniqueList(subjectResult.matches || []);
    (actionResult.matches || []).forEach(function (m) {
      if (allMatches.indexOf(m) === -1) allMatches.push(m);
    });
    (objectResult.matches || []).forEach(function (m) {
      if (allMatches.indexOf(m) === -1) allMatches.push(m);
    });
    if (moodResult) {
      (moodResult.matches || []).forEach(function (m) {
        if (allMatches.indexOf(m) === -1) allMatches.push(m);
      });
    }
    const unknown = uniqueList(
      (subjectResult.unknown || [])
        .concat(actionResult.unknown || [])
        .concat(objectResult.unknown || [])
        .concat(moodResult ? moodResult.unknown || [] : [])
    );

    return {
      relation: marker.token,
      en: U.joinPhrasesEn([subjectEn, relationEn, moodEn].filter(Boolean)),
      zh: U.joinPhrasesZh([subjectZh, actionZhFull, moodZh].filter(Boolean)),
      matches: allMatches,
      unknown: unknown,
      segments: segments
    };
  }

  function translateZhPhrase(phrase, options) {
    const text = U.normalizeSpace(phrase);
    if (!text) return { en: '', matches: [], unknown: [] };

    // 已经是英文的短语直接保留，并顺手记录可识别的词典命中。
    if (!U.hasCjk(text)) {
      return {
        en: U.cleanEnglish(text),
        matches: scanEn(text),
        unknown: [],
        passthrough: true
      };
    }

    // 只有「的 / 一个 / 她」这类虚词时不进入提示词。
    if (!stripStopZh(text)) {
      return { en: '', matches: [], unknown: [], passthrough: true };
    }

    const key = text.toLowerCase().replace(/\s+/g, '');
    let exact = exactZh[key];
    if (exact) {
      const wear = exact.category === 'accessory' && /^(戴|系|围|穿)/.test(text);
      return {
        en: wear ? 'wearing ' + exact.en : exact.en,
        matches: [{ entry: exact, alias: text, start: 0, end: text.length }],
        unknown: []
      };
    }

    const opts = options || {};

    // 关系句式先拆角色再组装；递归翻译各角色时关闭关系解析，避免套娃。
    if (opts.allowRelation !== false) {
      const relation = decomposeRelation(text);
      if (relation) {
        return {
          en: relation.en,
          zh: relation.zh,
          matches: relation.matches,
          unknown: relation.unknown,
          relation: relation.relation,
          segments: relation.segments
        };
      }
    }

    const matches = scanZh(text);
    const unknown = unknownZhSpans(text, matches);

    // 「拿着 / 撑着 / 端着…」这类动作短语。
    let m = text.match(/^(拿着|端着|举着|托着|扶着|抱着|握着|撑着)(.+)$/);
    if (m) {
      const rest = translateZhPhrase(m[2], { slot: 'outfit' });
      if (rest.en) {
        const indefinite = /^(a|an|the|his|her|their)\b/i.test(rest.en) || /s$/i.test(rest.en)
          ? '' : (/^[aeiou]/i.test(rest.en) ? 'an ' : 'a ');
        return {
          en: joinWords(['holding', indefinite + rest.en]),
          matches: matches,
          unknown: rest.unknown
        };
      }
    }

    // 「穿…的… / 戴…的…」定语结构：一个穿米色风衣的女人。
    // 必须放在「主语 + 穿」之前，否则会被误判成两个并列短语。
    m = text.match(/^(.*?)(身穿|穿着|穿了|身着|套着|戴着|穿(?!越|梭|透|过)|戴(?!着)|围着|围(?!着)|系着)(.+?)的(.+)$/);
    if (m) {
      const subjectText = (m[1] || '') + (m[4] || '');
      const subject = translateZhPhrase(subjectText, { slot: 'person' });
      const outfit = translateZhPhrase(m[3], { slot: 'outfit' });
      if (subject.en && outfit.en) {
        return {
          en: joinWords([subject.en, 'wearing', outfit.en]),
          matches: matches,
          unknown: subject.unknown.concat(outfit.unknown)
        };
      }
    }

    // 结构模板：先剥掉中文引导词，再翻译真正的信息。
    m = text.match(/^(穿着|身穿|穿了|身着|套着|披着|戴着|戴(?!着)|穿(?!越|梭|透|过))(.+)$/);
    if (m) {
      const rest = translateZhPhrase(m[2], { slot: 'outfit' });
      return {
        en: joinWords(['wearing', rest.en]),
        matches: matches,
        unknown: rest.unknown,
        passthrough: rest.passthrough
      };
    }

    m = text.match(/^(戴着|佩戴|佩带|系着)(.+)$/);
    if (m) {
      const rest = translateZhPhrase(m[2], { slot: 'outfit' });
      return { en: joinWords(['wearing', rest.en]), matches: matches, unknown: rest.unknown };
    }

    // 主语在前的「她穿着… / 女人穿…」结构。
    m = text.match(/^(.+?)(身穿|穿着|穿了|身着|套着|穿(?!越|梭|透|过))(.+)$/);
    if (m) {
      const left = translateZhPhrase(m[1], { slot: 'person' });
      const right = translateZhPhrase(m[3], { slot: 'outfit' });
      if (left.en && right.en) {
        return {
          en: joinWords([left.en, 'wearing', right.en]),
          matches: matches,
          unknown: left.unknown.concat(right.unknown)
        };
      }
      if (!left.en && right.en) {
        return { en: right.en, matches: matches, unknown: right.unknown };
      }
    }

    m = text.match(/^(.+?)(戴着|佩戴|佩带|系着)(.+)$/);
    if (m) {
      const left = translateZhPhrase(m[1], { slot: 'person' });
      const right = translateZhPhrase(m[3], { slot: 'outfit' });
      if (left.en && right.en) {
        return {
          en: joinWords([left.en, 'wearing', right.en]),
          matches: matches,
          unknown: left.unknown.concat(right.unknown)
        };
      }
    }

    m = text.match(/^(站在|立于)(.+)$/);
    if (m) {
      const rest = translateZhPhrase(m[2], { slot: 'scene' });
      const prep = placePrep(rest.en);
      return {
        en: joinWords(['standing', prep ? placePhrase(prep, rest.en) : rest.en]),
        matches: matches,
        unknown: rest.unknown
      };
    }

    m = text.match(/^(坐在|坐于)(.+)$/);
    if (m) {
      const rest = translateZhPhrase(m[2], { slot: 'scene' });
      const prep = placePrep(rest.en);
      return {
        en: joinWords(['sitting', prep ? placePhrase(prep, rest.en) : rest.en]),
        matches: matches,
        unknown: rest.unknown
      };
    }

    m = text.match(/^(躺在|卧在)(.+)$/);
    if (m) {
      const rest = translateZhPhrase(m[2], { slot: 'scene' });
      return { en: joinWords(['lying on', placePhrase('on', rest.en).replace(/^on\s+/, '')]), matches: matches, unknown: rest.unknown };
    }

    m = text.match(/^(走在)(.+)$/);
    if (m) {
      const rest = translateZhPhrase(m[2], { slot: 'scene' });
      return { en: joinWords(['walking', placePhrase(placePrep(rest.en), rest.en)]), matches: matches, unknown: rest.unknown };
    }

    m = text.match(/^(靠在|倚在)(.+)$/);
    if (m) {
      const rest = translateZhPhrase(m[2], { slot: 'scene' });
      const prep = /window|wall|railing/i.test(rest.en) ? 'against' : 'on';
      return { en: joinWords(['leaning', prep, rest.en]), matches: matches, unknown: rest.unknown };
    }

    m = text.match(/^(背景是|背景为|身后是)(.+)$/);
    if (m) {
      const rest = translateZhPhrase(m[2], { slot: 'scene' });
      return { en: joinWords([rest.en, 'background']), matches: matches, unknown: rest.unknown };
    }

    m = text.match(/^(光线是|光线为)(.+)$/);
    if (m) {
      const rest = translateZhPhrase(m[2], { slot: 'light' });
      return { en: rest.en, matches: matches, unknown: rest.unknown };
    }

    m = text.match(/^(镜头是|镜头为)(.+)$/);
    if (m) {
      const rest = translateZhPhrase(m[2], { slot: 'light' });
      return { en: rest.en, matches: matches, unknown: rest.unknown };
    }

    m = text.match(/^(风格是|风格为|画风是|质感是)(.+)$/);
    if (m) {
      const rest = translateZhPhrase(m[2], { slot: 'style' });
      return { en: rest.en, matches: matches, unknown: rest.unknown };
    }

    m = text.match(/^在(.+?)(里|中|内)$/);
    if (m) {
      const rest = translateZhPhrase(m[1], { slot: 'scene' });
      return { en: joinWords(['in', rest.en]), matches: matches, unknown: rest.unknown };
    }

    // 按当前框的上下文优先选择组合方式：
    // 光线框里的「暖黄色路灯」应译成 warm yellow streetlight，而不是当成服装。
    if (opts.slot === 'light') {
      const lit = lightComposition(matches);
      if (lit) return { en: lit, matches: matches, unknown: unknown };
    }
    if (opts.slot === 'outfit') {
      const outfit = outfitComposition(matches);
      if (outfit) return { en: outfit, matches: matches, unknown: unknown };
    }
    if (opts.slot === 'scene') {
      const scene = sceneComposition(matches);
      if (scene) return { en: scene, matches: matches, unknown: unknown };
    }
    if (opts.slot === 'style') {
      const style = styleComposition(matches);
      if (style) return { en: style, matches: matches, unknown: unknown };
    }
    if (opts.slot === 'person') {
      const personCtx = personComposition(matches, text);
      if (personCtx) return { en: personCtx, matches: matches, unknown: unknown };
    }

    // 场景里的时间后置，避免出现 dusk street 这类不自然语序。
    const scene = sceneComposition(matches);
    if (scene) {
      return { en: scene, matches: matches, unknown: unknown };
    }

    const person = personComposition(matches, text);
    if (person) {
      return { en: person, matches: matches, unknown: unknown };
    }

    // 没有服装主体、只有光质 + 光型时，先按光线组合，避免被质量词吞掉。
    const hasLight = matches.some(function (m) { return m.entry.category === 'light'; });
    const hasClothing = matches.some(function (m) {
      return m.entry.category === 'outfit' || m.entry.category === 'accessory';
    });
    if (hasLight && !hasClothing) {
      const light = lightComposition(matches);
      if (light) return { en: light, matches: matches, unknown: unknown };
    }

    const outfit = outfitComposition(matches);
    if (outfit) {
      return { en: outfit, matches: matches, unknown: unknown };
    }

    const style = styleComposition(matches);
    if (style) {
      return { en: style, matches: matches, unknown: unknown };
    }

    const generic = genericComposition(text, matches);
    if (generic) {
      return { en: generic, matches: matches, unknown: unknown };
    }

    // 词典完全没命中：保留原文，交给用户改成英文。
    return { en: text, matches: [], unknown: [text], passthrough: false };
  }

  function translateZh(text, options) {
    const phrases = U.splitPhrases(text);
    if (!phrases.length) return { en: '', zh: '', matches: [], unknown: [], complete: true, confidence: 1 };
    const enParts = [];
    const unknown = [];
    const matches = [];
    phrases.forEach(function (phrase) {
      const result = translateZhPhrase(phrase, options);
      let en = result.en;
      // 专业组合器可能只取到了已知词；这里保证未收录原文一定被保留。
      (result.unknown || []).forEach(function (u) {
        if (u && en.indexOf(u) === -1) en = joinWords([en, u]);
        if (!unknown.includes(u)) unknown.push(u);
      });
      if (en) enParts.push(en);
      (result.matches || []).forEach(function (m) {
        matches.push(Object.assign({}, m, { phrase: phrase }));
      });
    });
    const en = U.joinPhrasesEn(enParts);
    return {
      en: en,
      zh: U.cleanChinese(phrases.join('，')),
      matches: matches,
      unknown: unknown,
      complete: unknown.length === 0,
      confidence: en ? Math.max(0, 1 - unknown.length * 0.25) : 0
    };
  }

  function translateEnPhrase(phrase) {
    const text = U.normalizeSpace(phrase);
    if (!text) return { zh: '', matches: [], unknown: [] };
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    let exact = exactEn[key];
    if (exact) {
      return { zh: exact.zh, matches: [{ entry: exact, alias: text, start: 0, end: text.length }], unknown: [] };
    }

    // 先处理「站在 / 坐在 / 躺在 + 地点」结构，避免被后面的 at 模板拆坏。
    const preMatches = scanEn(text);
    const preUnknown = extractUnknownEn(text, preMatches);
    const prePose = preMatches.find(function (x) {
      return x.entry.category === 'pose' && POSE_PLACEMENT[x.entry.en];
    });
    const preScene = preMatches.filter(function (x) { return x.entry.category === 'scene'; });
    if (prePose && preScene.length) {
      const preTime = preMatches.filter(function (x) { return x.entry.category === 'time'; });
      const preWeather = preMatches.filter(function (x) { return x.entry.category === 'weather'; });
      return {
        zh: (preTime.length ? preTime.map(function (x) { return x.entry.zh; }).join('') + '，' : '') +
          POSE_PLACEMENT[prePose.entry.en] +
          (preWeather.length ? preWeather.map(function (x) { return x.entry.zh; }).join('') + '的' : '') +
          preScene.map(function (x) { return x.entry.zh; }).join(''),
        matches: preMatches,
        unknown: preUnknown
      };
    }

    let m = text.match(/^(.+?)\s+with\s+(.+)$/i);
    if (m) {
      const left = translateEnPhrase(m[1]);
      const pieces = m[2].split(/\s+and\s+/i);
      const rights = pieces.map(function (piece) { return translateEnPhrase(piece); });
      const rightZh = rights.map(function (r) { return r.zh; }).filter(Boolean);
      const rightHasExtra = rights.some(function (r) {
        return r.matches.some(function (x) {
          return ['hair', 'eyes', 'appearance', 'expression', 'makeup'].indexOf(x.entry.category) === -1;
        });
      });
      if (!rightHasExtra && left.zh && rightZh.length === rights.length && rightZh.length) {
        return {
          zh: rightZh.join('、') + '的' + left.zh,
          matches: left.matches.concat.apply(left.matches, rights.map(function (r) { return r.matches; })),
          unknown: left.unknown.concat.apply(left.unknown, rights.map(function (r) { return r.unknown; }))
        };
      }
    }

    m = text.match(/^(.+?)\s+and\s+(.+)$/i);
    if (m) {
      const left = translateEnPhrase(m[1]);
      const right = translateEnPhrase(m[2]);
      if (left.zh && right.zh) {
        const cats = left.matches.concat(right.matches).map(function (x) { return x.entry.category; });
        const clothing = cats.every(function (c) {
          return ['outfit', 'accessory', 'color', 'material'].indexOf(c) !== -1;
        });
        if (clothing) {
          return {
            zh: left.zh + '和' + right.zh,
            matches: left.matches.concat(right.matches),
            unknown: left.unknown.concat(right.unknown)
          };
        }
      }
    }

    m = text.match(/^(.+?)\s+at\s+(.+)$/i);
    if (m) {
      const place = translateEnPhrase(m[1]);
      const time = translateEnPhrase(m[2]);
      if (place.zh && time.zh) {
        return {
          zh: time.zh + place.zh,
          matches: place.matches.concat(time.matches),
          unknown: place.unknown.concat(time.unknown)
        };
      }
    }

    m = text.match(/^wearing\s+(.+)$/i);
    if (m) {
      const rest = translateEnPhrase(m[1]);
      return { zh: rest.zh ? '穿着' + rest.zh : '', matches: rest.matches, unknown: rest.unknown };
    }

    m = text.match(/^(.+?)\s+in\s+(?:a\s+|an\s+|the\s+)?(.+)$/i);
    if (m) {
      const left = translateEnPhrase(m[1]);
      const right = translateEnPhrase(m[2]);
      if (left.zh && right.zh) {
        const rightEntry = right.matches[0] && right.matches[0].entry;
        if (rightEntry && (rightEntry.slot === 'outfit')) {
          return {
            zh: '穿着' + right.zh + '的' + left.zh,
            matches: left.matches.concat(right.matches),
            unknown: left.unknown.concat(right.unknown)
          };
        }
        return {
          zh: left.zh + '在' + right.zh,
          matches: left.matches.concat(right.matches),
          unknown: left.unknown.concat(right.unknown)
        };
      }
    }

    m = text.match(/^(.+?)\s+on\s+(.+)$/i);
    if (m) {
      const left = translateEnPhrase(m[1]);
      const right = translateEnPhrase(m[2]);
      if (left.zh && right.zh) {
        return {
          zh: left.zh + '在' + right.zh,
          matches: left.matches.concat(right.matches),
          unknown: left.unknown.concat(right.unknown)
        };
      }
    }

    const matches = preMatches;
    const unknown = preUnknown;
    if (!matches.length) {
      return { zh: '', matches: [], unknown: unknown.length ? unknown : [] };
    }

    const sceneMatches = matches.filter(function (x) { return x.entry.category === 'scene'; });
    const timeMatches = matches.filter(function (x) { return x.entry.category === 'time'; });

    const subject = matches.find(function (x) { return x.entry.category === 'subject'; });
    if (subject) {
      const descriptors = matches.filter(function (x) {
        return x !== subject && ['hair', 'eyes', 'expression', 'appearance', 'makeup'].indexOf(x.entry.category) !== -1;
      });
      const preZh = descriptors
        .filter(function (x) { return PRE_PERSON_EN[x.entry.en]; })
        .map(function (x) { return x.entry.zh; });
      const withZh = descriptors
        .filter(function (x) { return !PRE_PERSON_EN[x.entry.en]; })
        .map(function (x) { return x.entry.zh; });
      let zh = preZh.join('') + subject.entry.zh;
      if (withZh.length) zh = withZh.join('、') + (preZh.length ? '的' : '') + zh;

      // 人物短语里夹带的动作 / 服装不要丢。
      const extras = matches.filter(function (x) {
        return x !== subject && ['hair', 'eyes', 'expression', 'appearance', 'makeup', 'subject', 'connector'].indexOf(x.entry.category) === -1;
      });
      if (extras.length) {
        const clothing = extras.filter(function (x) {
          return ['outfit', 'accessory', 'color', 'material'].indexOf(x.entry.category) !== -1;
        });
        const actions = extras.filter(function (x) {
          return ['outfit', 'accessory', 'color', 'material'].indexOf(x.entry.category) === -1;
        });
        const clothingZh = clothing.map(function (x) { return x.entry.zh; }).join('');
        const onlyAccessory = clothing.length && clothing.every(function (x) {
          return x.entry.category === 'accessory' || x.entry.category === 'color';
        });
        if (clothing.length && !actions.length) {
          zh = (onlyAccessory ? '戴着' : '穿着') + clothingZh + '的' + zh;
        } else if (clothing.length) {
          zh += '，' + (onlyAccessory ? '戴着' : '穿着') + clothingZh;
        }
        if (actions.length) {
          zh += '，' + actions.map(function (x) { return x.entry.zh; }).join('，');
        }
      }
      return { zh: zh, matches: matches, unknown: unknown };
    }

    if (sceneMatches.length && timeMatches.length) {
      return {
        zh: timeMatches.map(function (x) { return x.entry.zh; }).join('') +
          sceneMatches.map(function (x) { return x.entry.zh; }).join(''),
        matches: matches,
        unknown: unknown
      };
    }

    const zh = matches
      .filter(function (x) { return x.entry.category !== 'connector'; })
      .map(function (x) { return x.entry.zh; })
      .join('');
    return { zh: zh, matches: matches, unknown: unknown };
  }

  function translateEn(text) {
    const phrases = U.splitPhrases(text);
    if (!phrases.length) return { zh: '', en: '', matches: [], unknown: [], complete: true };
    const zhParts = [];
    const unknown = [];
    const matches = [];
    phrases.forEach(function (phrase) {
      const result = translateEnPhrase(phrase);
      if (result.zh) zhParts.push(result.zh);
      (result.matches || []).forEach(function (m) { matches.push(m); });
      (result.unknown || []).forEach(function (u) {
        if (!unknown.includes(u)) unknown.push(u);
      });
    });
    const zh = U.joinPhrasesZh(zhParts);
    return {
      zh: zh,
      en: U.cleanEnglish(phrases.join(', ')),
      matches: matches,
      unknown: unknown,
      complete: unknown.length === 0,
      confidence: unknown.length ? Math.max(0, 1 - unknown.length * 0.2) : (zh ? 1 : 0)
    };
  }

  T2I.Translator = {
    scanZh: scanZh,
    scanEn: scanEn,
    translateZh: translateZh,
    translateEn: translateEn,
    translateZhPhrase: translateZhPhrase,
    translateEnPhrase: translateEnPhrase,
    decomposeRelation: decomposeRelation,
    hasCjk: U.hasCjk,
    stopZh: STOP_ZH,
    stopEn: EN_STOP
  };
})();
