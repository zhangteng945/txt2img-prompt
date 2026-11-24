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
  const PLACE_ON = /(street|beach|rooftop|bridge|stage|grass|snowfield|boardwalk|field|road|roadside|summit|mountain|floor|ground|bench|balcony)/i;
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
  const RELATION_MARKERS = ['对着', '朝着', '向着', '冲着', '冲向', '沿着', '穿过', '给', '往', '向', '朝', '从', '在', '对', '把'];
  const EXCRETION_RE = /^(peeing|urinating|pooping|defecating|spraying|marking)\b/i;
  const MOVEMENT_RE = /^(running|walking|jumping|charging|flying|swimming|driving|riding|climbing|chasing|skipping)\b/i;
  const GAZE_RE = /^(looking|gazing|staring|smiling|grinning|laughing|barking|growling|pointing|waving|glancing)\b/i;

  const exactZh = Object.create(null);
  const exactEn = Object.create(null);

  // 单字动作别名（飞 / 打 / 拍…）不应把未知复合词拆成「已知字 + 残片」。
  // 这里只保护最常见的未收录词，保证「飞碟」整词留在未收录列表里。
  const PROTECTED_ZH_WORDS = ['飞碟', '飞船', '飞蛾', '飞镖', '飞艇', '飞絮', '飞鸟'];

  // 中文单字别名（烟 / 笑 / 猫…）的边界。词库索引虽然按长度从长到短
  // 排序，但更长的词不在词库里时，单字别名仍可能从词中间切开它
  // （「抽|烟」「搞|笑」）。单字别名只允许出现在真正的词边界上：
  // 句首/句尾、空白、标点，或「的 / 了 / 在 / 把」这类虚词旁边。
  const ZH_BOUNDARY_CHARS = '的了着过和与或及是在有把被给对向朝往从到于为之其也都还又很太更最带个位件条双只张座片群套头身款种些上下里中旁前后边内外处间';
  const ZH_BOUNDARY_RE = /[\s，,。.、；;：:！!？?（）()【】\[\]{}<>《》〈〉「」『』“”‘’"'…—\-·/\\|+*=&%#@~`^]/;
  // 单字动词/颜色/外貌词可以紧贴宾语或名词（吃苹果、红裙、瘦女人），
  // 这是汉语的正常组合，不是把词从中间切开。
  const ZH_PREFIX_CATEGORIES = ['pose', 'expression', 'action', 'appearance', 'color', 'material', 'pattern'];
  const ZH_ACTION_CATEGORIES = ['pose', 'expression', 'action'];

  function isZhBoundary(ch) {
    if (!ch) return true;
    if (ZH_BOUNDARY_RE.test(ch)) return true;
    return ZH_BOUNDARY_CHARS.indexOf(ch) !== -1;
  }

  function hasKnownAliasAt(text, index) {
    const candidates = L.zhIndex[String(text.charAt(index) || '').toLowerCase()];
    if (!candidates) return false;
    for (let i = 0; i < candidates.length; i += 1) {
      if (text.startsWith(candidates[i].alias, index)) return true;
    }
    return false;
  }

  function hasActionAliasAt(text, index) {
    const candidates = L.zhIndex[String(text.charAt(index) || '').toLowerCase()];
    if (!candidates) return false;
    for (let i = 0; i < candidates.length; i += 1) {
      const cand = candidates[i];
      if (text.startsWith(cand.alias, index) && ZH_ACTION_CATEGORIES.indexOf(cand.entry.category) !== -1) {
        return true;
      }
    }
    return false;
  }

  function singleAliasAllowed(cand, source, start) {
    const before = source.charAt(start - 1);
    const after = source.charAt(start + cand.alias.length);
    const leftBoundary = isZhBoundary(before);
    const rightBoundary = isZhBoundary(after);
    if (leftBoundary && rightBoundary) return true;

    const category = cand.entry.category;
    const prefixable = ZH_PREFIX_CATEGORIES.indexOf(category) !== -1;
    const action = ZH_ACTION_CATEGORIES.indexOf(category) !== -1;

    // 句首的动词/颜色/外貌词只有在后面确实接着已知词时才组合
    // （吃苹果、红裙、瘦女人）；「笑点」这类未知复合词不能被拆成笑 + 点。
    if (start === 0 && prefixable) return hasKnownAliasAt(source, start + cand.alias.length);
    // 虚词后的单字：把书放在、她笑了、的烟。若后面紧跟已知动作，
    // 说明这是「宾语 + 动作」，不是未知复合词的一部分。
    if (leftBoundary && !rightBoundary && before) {
      if (prefixable || hasActionAliasAt(source, start + cand.alias.length)) return true;
    }
    // 句尾的动作：他笑、她哭。名词在句尾且前面仍是汉字时（抽烟、熊猫）
    // 不允许，否则会把更长的词切开。
    if (rightBoundary && !leftBoundary && action) return true;
    return false;
  }

  function shortAliasAllowed(cand, source, start) {
    const length = cand.alias.length;
    if (length === 1) return singleAliasAllowed(cand, source, start);
    if (length === 2) {
      // 双字动作短语（跳到 / 放在 / 走向）本来就是连接两个名词的动词，
      // 不能按名词复合词的边界去卡它。
      if (ZH_ACTION_CATEGORIES.indexOf(cand.entry.category) !== -1) return true;
      // 双字名词也只在至少一侧是边界时命中，避免从「宣传广告设计」这类
      // 更长复合词中间切出「广告」。
      const before = source.charAt(start - 1);
      const after = source.charAt(start + 2);
      return isZhBoundary(before) || isZhBoundary(after);
    }
    return true;
  }

  // 规范词优先于别名：避免后补的「大门 / 玻璃窗 / 被套」被更早条目的
  // 别名先占用，导致规范词自己反而译不出来。先登记所有规范词，再挂别名。
  L.entries.forEach(function (entry) {
    const zhKey = entry.zh.trim().toLowerCase();
    const enKey = entry.en.trim().toLowerCase();
    if (!exactZh[zhKey]) exactZh[zhKey] = entry;
    if (!exactEn[enKey]) exactEn[enKey] = entry;
  });
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
        // 索引已按别名长度从长到短排序：同一位置只认最长命中。
        // 若最长命中不是合法词边界，直接前进一格，不再退回更短别名把
        // 已经构成的长词切开（「抽烟」不能退成「抽」+「烟」）。
        for (let c = 0; c < candidates.length; c += 1) {
          const cand = candidates[c];
          const slice = source.slice(i, i + cand.alias.length);
          if (slice.toLowerCase() === cand.alias.toLowerCase()) {
            found = cand;
            break;
          }
        }
      }
      if (found && !shortAliasAllowed(found, source, i)) found = null;
      if (found && found.alias.length === 1 && PROTECTED_ZH_WORDS.some(function (word) {
        return source.startsWith(word, i);
      })) {
        found = null;
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
    // 连字符和撇号也算词内字符：short word 不能在 anti-smoking / don't 里命中。
    return /[A-Za-z0-9'’\-]/.test(ch || '');
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
    const out = relevant.map(function (m) { return m.entry.en; }).join(', ');
    // 同一片段里还夹着动作 / 物体时（拒绝抽烟的广告）不能因为落到画风框
    // 就把主题动作吞掉；把非画风零件放在媒介词前面。
    const extras = matches.filter(function (m) {
      return m.entry.category !== 'style' && m.entry.category !== 'quality' &&
        m.entry.category !== 'mood' && m.entry.category !== 'connector';
    });
    if (!extras.length) return out;
    return joinWords(extras.map(function (m) { return m.entry.en; }).concat([out]));
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
    // 「河边 / 路边 / 旁边」本身可能就是完整地点词，不能把「边」误拆成方位。
    if (exactZh[text.toLowerCase()]) return { text: text, suffix: '' };
    const m = text.match(/(后面|前面|下面|里面|上面|旁边|之间|中间|附近|对面|之下|之中|上|里|中|旁|边|前|后|下)$/);
    if (!m) return { text: text, suffix: '' };
    return { text: text.slice(0, text.length - m[1].length).trim(), suffix: m[1] };
  }

  function relationPrep(marker, actionEn, suffix) {
    const action = String(actionEn || '');
    if (suffix === '之间' || suffix === '中间') return 'between';
    if (suffix === '附近') return 'near';
    if (suffix === '对面') return 'across from';
    if (suffix === '里' || suffix === '里面' || suffix === '中' || suffix === '之中') return 'in';
    if (suffix === '旁边' || suffix === '旁' || suffix === '边') return 'next to';
    if (suffix === '前面' || suffix === '前') return 'in front of';
    if (suffix === '后面' || suffix === '后') return 'behind';
    if (suffix === '下面' || suffix === '下' || suffix === '之下') return 'under';
    if (suffix === '上面' || suffix === '上') return 'on';
    if (marker.token === '沿着') return 'along';
    if (marker.token === '穿过') return 'through';
    if (marker.token === '从') return 'from';
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
    // utility / university / European 等拼写以元音字母开头但读辅音，仍用 a。
    if (/^(uni|uti|use|user|eu|one|once)/i.test(t)) return 'a ' + t;
    return (/^[aeiou]/i.test(t) ? 'an ' : 'a ') + t;
  }

  function pluralizeNoun(text) {
    const t = String(text || '').trim();
    if (!t || U.hasCjk(t)) return t;
    if (/(s|x|z|ch|sh)$/i.test(t)) return t + 'es';
    if (/[^aeiou]y$/i.test(t)) return t.slice(0, -1) + 'ies';
    return t + 's';
  }

  function uniqueList(list) {
    const out = [];
    (list || []).forEach(function (item) {
      if (item && !out.includes(item)) out.push(item);
    });
    return out;
  }

  function decomposeSubjectRelation(text) {
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
    let passThroughAction = null;
    // 「穿过森林」没有显式动作，关系词本身承担 through 的动作；目标后的
    // 「紧张」等氛围词不能再被当成 action。
    if (marker.token === '穿过') {
      const target = targetCandidates[0];
      if (!target) return null;
      targetMatch = target;
      actionMatch = { entry: null, alias: '穿过', start: target.end, end: target.end };
      passThroughAction = { en: 'walking through', zh: '穿过', matches: [], unknown: [] };
    }
    for (let i = 0; !actionMatch && i < targetCandidates.length; i += 1) {
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

    // 「从 A 跳到 B / 把 A 放在 B」：动作后的第二个目标是终点/落点，
    // 不能当成「的搞笑画面」这种氛围尾巴。
    let secondaryObjectText = '';
    let secondarySuffix = '';
    let secondaryResult = null;
    let secondaryEn = '';
    let secondaryZh = '';
    let moodStart = actionMatch.end;
    if (marker.token === '从' || marker.token === '把') {
      const tailTargets = matches.filter(function (m) {
        return m.start >= actionMatch.end &&
          TARGET_CATEGORIES.indexOf(m.entry.category) !== -1 &&
          ['subject', 'outfit', 'accessory'].indexOf(m.entry.category) === -1;
      });
      const candidate = tailTargets[0];
      if (candidate) {
        const between = source.slice(actionMatch.end, candidate.start)
          .replace(/[到在往上下里中旁前后面之间，,、\s的]/g, '');
        if (!between) {
          secondaryObjectText = source.slice(candidate.start, candidate.end);
          const after = source.slice(candidate.end);
          const suffixMatch = after.match(/^(之间|中间|上面|旁边|上|里|中|旁|前|后|下)/);
          secondarySuffix = suffixMatch ? suffixMatch[1] : '';
          secondaryResult = translateZhPhrase(secondaryObjectText, { slot: 'scene', allowRelation: false });
          secondaryEn = secondaryResult.en || secondaryObjectText;
          secondaryZh = secondaryResult.zh || secondaryObjectText;
          moodStart = candidate.end + secondarySuffix.length;
        }
      }
    }

    // 目标词后面的「的搞笑画面」是氛围，不是动作的一部分。
    let moodText = source.slice(moodStart).trim()
      .replace(/^[的地得，,、\s]+/, '');
    let moodResult = null;
    if (moodText && stripStopZh(moodText)) {
      moodResult = translateZhPhrase(moodText, { slot: 'style', allowRelation: false });
      if (!moodResult.en) moodResult = null;
    }

    const subjectResult = translateZhPhrase(subjectText, { slot: 'person', allowRelation: false });
    const actionResult = passThroughAction || translateZhPhrase(actionMatch.alias, { slot: 'pose', allowRelation: false });
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
      // 「在厨房做饭 / 在咖啡馆聊天」是日常高频的「地点 + 动作」，
      // 只要动作后没有另一个宾语（如「在客厅修理台灯」），就按 in 关系组装。
      const locationScene = marker.token === '在' && targetCategory === 'scene';
      const tailTarget = locationScene && matches.some(function (m) {
        return m.start >= actionMatch.end &&
          TARGET_CATEGORIES.indexOf(m.entry.category) !== -1 &&
          ['subject', 'outfit', 'accessory'].indexOf(m.entry.category) === -1;
      });
      if (!excretionTarget && (!locationScene || tailTarget)) return null;
    }

    let prep = relationPrep(marker, actionEn, objectParts.suffix);
    if (!objectParts.suffix && marker.token === '在' && targetMatch && targetMatch.entry.category === 'scene') {
      prep = placePrep(objectEn);
    }
    // 动作词本身已带介词（peeing on）时不再重复。
    if (/\b(on|at|in|toward|towards|after|by|against|into|over|under|from|through|along)\s*$/i.test(actionEn)) prep = '';
    if (prep === 'between' && !U.hasCjk(objectEn)) objectEn = pluralizeNoun(objectEn);
    let targetPhraseEn = /^camera$/i.test(objectEn) ? 'the camera' : withIndefiniteArticle(objectEn);

    let relationEn;
    let relationZh;
    if (secondaryResult) {
      const secondPhraseEn = withIndefiniteArticle(secondaryEn);
      if (marker.token === '把') {
        const destPrep = relationPrep({ token: '在' }, actionEn, secondarySuffix || '上');
        relationEn = joinWords([actionEn, targetPhraseEn, destPrep, secondPhraseEn]);
        relationZh = '把' + objectZh + actionZh + secondaryZh + (secondarySuffix || '上');
      } else {
        const destPrep = secondarySuffix === '上' || secondarySuffix === '上面'
          ? 'onto'
          : (secondarySuffix === '里' || secondarySuffix === '中' ? 'into' : 'to');
        relationEn = joinWords([actionEn, 'from', targetPhraseEn, destPrep, secondPhraseEn]);
        relationZh = '从' + objectZh + actionZh + secondaryZh;
      }
    } else if (prep) {
      relationEn = joinWords([actionEn, prep, targetPhraseEn]);
      if (marker.token === '给' || marker.token === '往' || marker.token === '在') {
        relationZh = '在' + objectZh + (objectParts.suffix || '上');
      } else {
        relationZh = marker.token + objectZh;
      }
    } else {
      relationEn = joinWords([actionEn, targetPhraseEn]);
      if (marker.token === '给' || marker.token === '往' || marker.token === '在') {
        relationZh = '在' + objectZh + (objectParts.suffix || '上');
      } else {
        relationZh = marker.token + objectZh;
      }
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
    if (secondaryResult) {
      segments.push({
        text: secondaryObjectText,
        zh: secondaryZh,
        en: secondaryEn,
        slot: 'scene',
        matches: secondaryResult.matches || [],
        unknown: secondaryResult.unknown || []
      });
    }
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
    if (secondaryResult) {
      (secondaryResult.matches || []).forEach(function (m) {
        if (allMatches.indexOf(m) === -1) allMatches.push(m);
      });
    }
    if (moodResult) {
      (moodResult.matches || []).forEach(function (m) {
        if (allMatches.indexOf(m) === -1) allMatches.push(m);
      });
    }
    const unknown = uniqueList(
      (subjectResult.unknown || [])
        .concat(actionResult.unknown || [])
        .concat(objectResult.unknown || [])
        .concat(secondaryResult ? secondaryResult.unknown || [] : [])
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


  // ── 动作 + 地点关系：走在沙滩上 / 坐在椅子上 / 跑过街道 ──────────
  // 这类句子没有显式「谁」，也可能把动作写在关系词前面。先拆成
  // 「动作（姿态框）+ 方位短语（场景框）」，再由 assemble 粘回
  // walking on the beach，避免整句挤进姿态框、场景框空白。

  function scanZhFrom(source, offset) {
    return scanZh(source.slice(offset)).map(function (m) {
      return { entry: m.entry, alias: m.alias, start: m.start + offset, end: m.end + offset };
    });
  }

  // 在 source 的 [start, end) 里找恰好结束于 end 的动作别名。
  // 不直接用 scanZh，是因为「坐在椅子上」会被整条长别名吃掉。
  function actionEndingAt(source, start, end) {
    const candidates = L.zhIndex[String(source.charAt(start) || '').toLowerCase()] || [];
    let best = null;
    for (let i = 0; i < candidates.length; i += 1) {
      const cand = candidates[i];
      if (ZH_ACTION_CATEGORIES.indexOf(cand.entry.category) === -1) continue;
      if (cand.alias.length > 3) continue;
      if (start + cand.alias.length !== end) continue;
      if (!source.startsWith(cand.alias, start)) continue;
      if (!best || cand.alias.length > best.alias.length) best = cand;
    }
    return best;
  }

  function actionStartingAt(source, start) {
    const candidates = L.zhIndex[String(source.charAt(start) || '').toLowerCase()] || [];
    for (let i = 0; i < candidates.length; i += 1) {
      const cand = candidates[i];
      if (ZH_ACTION_CATEGORIES.indexOf(cand.entry.category) === -1) continue;
      if (cand.alias.length > 4) continue;
      if (source.startsWith(cand.alias, start)) return cand;
    }
    return null;
  }

  function locativeSuffixAt(source, index) {
    const m = String(source.slice(index)).match(/^(后面|前面|下面|里面|上面|旁边|之间|中间|附近|对面|之下|之中|上|里|中|旁|边|前|后|下)/);
    return m ? m[1] : '';
  }

  function locativePrep(marker, actionEn, suffix, targetEn, targetCategory) {
    if (/^lean/i.test(actionEn) && (suffix === '上' || suffix === '上面')) return 'against';
    if (/^lean/i.test(actionEn) && (suffix === '边' || suffix === '旁' || suffix === '旁边')) return 'by';
    if (marker === '过') return 'across';
    if (marker === '穿过') return 'through';
    if (marker === '沿着') return 'along';
    if (marker === '从') return 'from';
    if (marker === '到') return /jump|climb|step|sit|lie/i.test(actionEn) ? 'onto' : 'to';
    if (marker === '向' || marker === '朝' || marker === '往') return 'toward';
    if (suffix) return relationPrep({ token: marker }, actionEn, suffix);
    if (marker === '在') {
      if (targetCategory === 'object') {
        if (/window|wall/i.test(targetEn)) return 'by';
        return 'on';
      }
      return placePrep(targetEn);
    }
    return relationPrep({ token: marker }, actionEn, suffix);
  }

  function locativePhrase(prep, targetEn, targetCategory) {
    const text = String(targetEn || '').trim();
    if (!text) return '';
    if (!prep) return text;
    if (/^(on|onto|in|into|at|by|near|under|behind|next to|between|in front of|across|along|through|from|toward|towards|against|inside|outside|over)\b/i.test(text)) return text;
    const isObject = targetCategory === 'object';
    if (prep === 'between') {
      return 'between ' + (isObject ? pluralizeNoun(text) : text);
    }
    if (isObject) {
      // 窗/墙是画面里默认被指认的那一个：standing in front of the window。
      if (/^(window|wall)$/i.test(text)) return prep + ' the ' + text;
      return prep + ' ' + withIndefiniteArticle(text);
    }
    // 地面/街道/沙滩这类「一整片」的地点用 the：walking on the beach；
    // 咖啡馆、森林、河边等可数/泛指地点用 a：in a cafe / through a forest。
    if ((prep === 'on' || prep === 'across') &&
        /(beach|shore|coast|street|road|sidewalk|pavement|ground|floor|grass|snow|bridge|stage|rooftop)/i.test(text)) {
      return prep + ' the ' + text;
    }
    return prep + ' ' + withIndefiniteArticle(text);
  }

  function isStyleLikeResult(result) {
    if (!result || !result.en) return false;
    const matches = result.matches || [];
    return matches.length > 0 && matches.every(function (m) {
      return ['mood', 'style', 'quality', 'connector'].indexOf(m.entry.category) !== -1;
    });
  }

  function locativeResult(source, subjectText, subjectResult, actionCand, actionResult,
    marker, targetText, targetResult, suffix, moodText, moodResult) {
    let actionEn = actionResult.en || actionCand.alias;
    if (/^(靠|倚)$/.test(actionCand.alias)) actionEn = 'leaning';
    const actionZh = actionResult.zh || actionCand.alias;
    const targetEn = targetResult.en || targetText;
    const targetZh = targetResult.zh || targetText;
    const targetCategory = targetResult.matches && targetResult.matches[0]
      ? targetResult.matches[0].entry.category
      : 'scene';
    const prep = locativePrep(marker, actionEn, suffix, targetEn, targetCategory);
    const locEn = locativePhrase(prep, targetEn, targetCategory);
    const locZh = targetZh + (suffix ? suffix : '');

    const subjectEn = subjectResult && subjectResult.en
      ? withIndefiniteArticle(subjectResult.en)
      : subjectText;
    const relationEn = joinWords([actionEn, locEn]);
    const moodEn = moodResult ? (moodResult.en || '') : '';
    const moodZh = moodResult ? (moodResult.zh || moodText) : '';

    const segments = [];
    if (subjectText) {
      segments.push({
        text: subjectText,
        zh: subjectResult.zh || subjectText,
        en: subjectEn,
        slot: 'person',
        matches: subjectResult.matches || [],
        unknown: subjectResult.unknown || []
      });
    }
    segments.push({
      text: actionCand.alias,
      zh: actionZh,
      en: actionEn,
      slot: 'pose',
      matches: actionResult.matches || [],
      unknown: actionResult.unknown || []
    });
    segments.push({
      text: targetText,
      zh: locZh,
      en: locEn,
      slot: 'scene',
      matches: targetResult.matches || [],
      unknown: targetResult.unknown || []
    });
    if (moodResult && moodEn) {
      segments.push({
        text: moodText,
        zh: moodZh,
        en: moodEn,
        slot: 'style',
        matches: moodResult.matches || [],
        unknown: moodResult.unknown || []
      });
    }

    const allMatches = uniqueList((subjectResult ? subjectResult.matches || [] : [])
      .concat(actionResult.matches || [])
      .concat(targetResult.matches || [])
      .concat(moodResult ? moodResult.matches || [] : []));
    const unknown = uniqueList((subjectResult ? subjectResult.unknown || [] : [])
      .concat(actionResult.unknown || [])
      .concat(targetResult.unknown || [])
      .concat(moodResult ? moodResult.unknown || [] : []));

    return {
      relation: marker,
      en: U.joinPhrasesEn([subjectEn, relationEn, moodEn].filter(Boolean)),
      zh: U.joinPhrasesZh([subjectResult ? subjectResult.zh || subjectText : '', actionZh, locZh, moodZh].filter(Boolean)),
      matches: allMatches,
      unknown: unknown,
      segments: segments
    };
  }

  function decomposeLocativeRelation(text) {
    const source = U.normalizeSpace(text);
    if (!source || !U.hasCjk(source)) return null;

    const matches = scanZh(source);
    let subjectText = '';
    let subjectEnd = 0;
    let subjectResult = null;
    const subjectMatch = matches.find(function (m) {
      return m.entry.category === 'subject' && m.start === 0;
    });
    if (subjectMatch) {
      subjectEnd = subjectMatch.end;
      subjectText = source.slice(0, subjectEnd).trim();
      subjectResult = translateZhPhrase(subjectText, { slot: 'person', allowRelation: false });
    } else {
      // 「她 / 他 / 我」等代词不一定在词典里，仍可当作人物前缀。
      const pronoun = source.match(/^(她们|他们|我们|你们|她|他|我|你)/);
      if (pronoun) {
        subjectEnd = pronoun[1].length;
        subjectText = pronoun[1];
        const pronounEn = {
          '她': 'a woman', '他': 'a man', '她们': 'people', '他们': 'people',
          '我们': 'people', '你们': 'people', '我': 'a person', '你': 'a person'
        };
        subjectResult = { en: pronounEn[subjectText] || 'a person', zh: subjectText, matches: [], unknown: [] };
      }
      // 单字动物主语（狗 / 猫 / 狼…）后面直接跟动作时，scanZh 的通用边界
      // 规则会把它当成未知长词的一部分。这里只在「后面确实还能拆出
      // 动作 + 地点关系」时才认作主语，避免把「熊猫」之类的长词切开。
      if (!subjectResult) {
        const first = source.charAt(0);
        const firstCands = L.zhIndex[String(first).toLowerCase()] || [];
        const singleSubject = firstCands.find(function (c) {
          return c.entry.category === 'subject' && c.alias.length === 1 && source.startsWith(c.alias, 0);
        });
        if (singleSubject) {
          const rest = source.slice(1);
          const restMatches = scanZh(rest);
          const restMarker = restMatches.some(function (m) {
            return ['在', '到', '过', '沿着', '穿过', '从', '向', '朝', '往'].some(function (token) {
              return m.alias === token || rest.indexOf(token) !== -1;
            });
          });
          if (restMarker) {
            subjectEnd = 1;
            subjectText = first;
            subjectResult = translateZhPhrase(subjectText, { slot: 'person', allowRelation: false });
          }
        }
      }
    }
    const predicateStart = subjectEnd;

    // 情况一：关系词在前，地点在后，动作最后（沿着河边散步 / 在沙滩上走）。
    const leadingMarkers = ['沿着', '穿过', '在', '从', '向', '朝', '往'];
    for (let i = 0; i < leadingMarkers.length; i += 1) {
      const marker = leadingMarkers[i];
      if (!source.startsWith(marker, predicateStart)) continue;
      const markerEnd = predicateStart + marker.length;
      const targetMatches = scanZhFrom(source, markerEnd);
      const target = targetMatches.find(function (m) {
        return m.start === markerEnd &&
          TARGET_CATEGORIES.indexOf(m.entry.category) !== -1 &&
          ['subject', 'outfit', 'accessory'].indexOf(m.entry.category) === -1;
      });
      if (!target) continue;
      const suffix = locativeSuffixAt(source, target.end);
      const actionStart = target.end + suffix.length;
      const actionCand = actionStart < source.length ? actionStartingAt(source, actionStart) : null;
      if (!actionCand && marker !== '穿过') continue;
      const targetText = source.slice(markerEnd, target.end).trim();
      if (!targetText) continue;
      const leftover = source.slice(actionStart + (actionCand ? actionCand.alias.length : 0)).trim();
      if (leftover && /[，,。.；;、]/.test(leftover)) continue;
      const targetResult = translateZhPhrase(targetText, { slot: 'scene', allowRelation: false });
      const actionAlias = actionCand ? actionCand.alias : marker;
      const actionResult = actionCand
        ? translateZhPhrase(actionAlias, { slot: 'pose', allowRelation: false })
        : { en: 'walking', zh: '走', matches: [], unknown: [] };
      const moodResult = leftover
        ? translateZhPhrase(leftover, { slot: 'style', allowRelation: false })
        : null;
      if (leftover && !isStyleLikeResult(moodResult)) continue;
      return locativeResult(source, subjectText, subjectResult, actionCand || { alias: marker },
        actionResult, marker, targetText, targetResult, suffix, leftover, moodResult);
    }

    // 情况二：动作 + 关系词 + 地点（走在沙滩上 / 坐在椅子上 / 跑过街道）。
    const inlineMarkers = ['沿着', '穿过', '在', '到', '过', '从', '向', '朝', '往'];
    let marker = null;
    let markerIndex = -1;
    for (let i = predicateStart; i < source.length; i += 1) {
      for (let t = 0; t < inlineMarkers.length; t += 1) {
        const token = inlineMarkers[t];
        if (!source.startsWith(token, i)) continue;
        if (token === '在' && /[现正所]/.test(source.charAt(i - 1))) continue;
        marker = token;
        markerIndex = i;
        break;
      }
      if (marker) break;
    }
    if (!marker || markerIndex <= predicateStart) return null;

    const actionCand = actionEndingAt(source, predicateStart, markerIndex);
    if (!actionCand) return null;

    const targetStart = markerIndex + marker.length;
    const targetMatches = scanZhFrom(source, targetStart);
    const target = targetMatches.find(function (m) {
      return m.start === targetStart &&
        TARGET_CATEGORIES.indexOf(m.entry.category) !== -1 &&
        ['subject', 'outfit', 'accessory'].indexOf(m.entry.category) === -1;
    });
    if (!target) return null;

    const suffix = locativeSuffixAt(source, target.end);
    const targetText = source.slice(targetStart, target.end).trim();
    if (!targetText) return null;
    const leftover = source.slice(target.end + suffix.length).trim();
    // 目标后面如果还有第二个动作（老人坐在长椅上看报纸），交给原先的
    // 「谁 + 地点 + 动作」关系解析，避免把「看报纸」吞掉。
    if (leftover && actionStartingAt(source, target.end + suffix.length)) return null;
    const targetResult = translateZhPhrase(targetText, { slot: 'scene', allowRelation: false });
    const actionResult = translateZhPhrase(actionCand.alias, { slot: 'pose', allowRelation: false });
    const moodResult = leftover
      ? translateZhPhrase(leftover, { slot: 'style', allowRelation: false })
      : null;
    if (leftover && !isStyleLikeResult(moodResult)) return null;

    return locativeResult(source, subjectText, subjectResult, actionCand, actionResult,
      marker, targetText, targetResult, suffix, leftover, moodResult);
  }

  function decomposeRelation(text) {
    // 动作/地点关系优先拆成「动作 + 方位短语」。若目标后还有第二个动作
    //（老人坐在长椅上看报纸），locative 会放弃，再交给原来的关系解析。
    return decomposeLocativeRelation(text) || decomposeSubjectRelation(text);
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

    // 只有「的 / 一个 / 她」这类虚词时不进入提示词。规范词命中已在前面
    // 返回，所以「被套 / 座套」这类含虚词字的真实物体不会被清空。
    if (!stripStopZh(text)) {
      return { en: '', matches: [], unknown: [], passthrough: true };
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
