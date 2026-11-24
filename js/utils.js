/* 通用小工具：不依赖任何框架，浏览器与 Node 测试都可复用。 */
(function () {
  'use strict';

  const T2I = (window.T2I = window.T2I || {});

  function normalizeSpace(text) {
    return String(text == null ? '' : text)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\f\v]+/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  function normalizeQuotes(text) {
    return String(text)
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[－—–]/g, '-');
  }

  // 中英文标点都能切；小数点和 f/1.8 这类写法不会被拆开。
  function splitPhrases(text) {
    const input = normalizeQuotes(String(text == null ? '' : text));
    const out = [];
    let buf = '';
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      const isDot = ch === '.';
      const decimalDot = isDot && /\d/.test(input[i - 1] || '') && /\d/.test(input[i + 1] || '');
      const isSep = !decimalDot && /[，,、；;。！!？?|\n]/.test(ch);
      if (isSep) {
        if (buf.trim()) out.push(buf.trim());
        buf = '';
      } else {
        buf += ch;
      }
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  function splitEnglishPhrases(text) {
    return splitPhrases(text);
  }

  function uniqueBy(list, keyFn) {
    const seen = Object.create(null);
    const out = [];
    list.forEach(function (item) {
      const key = keyFn ? keyFn(item) : item;
      if (!key) return;
      const k = String(key).toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(item);
    });
    return out;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hasCjk(text) {
    return /[\u3400-\u9fff]/.test(String(text));
  }

  function hasLatin(text) {
    return /[A-Za-z]/.test(String(text));
  }

  function cleanEnglish(text) {
    return normalizeSpace(
      String(text)
        .replace(/[，、；;。]/g, ',')
        .replace(/\s*,\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .replace(/,\s*,/g, ',')
    ).replace(/^,\s*|,\s*$/g, '');
  }

  /*
   * 把模型/旧记录里可能出现的「英语叙述句」压成生图提示词短语。
   *
   * 只处理语言形态，不负责翻译，也不增删用户没说的内容：
   *   - 去掉 A scene of / This image depicts / There is / The picture shows 等套话；
   *   - 去掉 be 动词/助动词，把 "A woman is sitting..." 变成 "a woman sitting..."；
   *   - 把 while 连接的并列叙述改成逗号分隔的短语；
   *   - 保留介词、动作对象和否定，不把关系拆成孤立单词。
   */
  const PROMPT_LEADIN_RES = [
    /^(?:a|an|the)\s+scene\s+(?:of|showing|with|depicting)\s+/i,
    /^(?:this|the)\s+(?:image|picture|photo|photograph|illustration|artwork|frame)\s+(?:depicts|shows|features|contains|captures|portrays|presents)\s+/i,
    /^(?:in|within)\s+(?:this|the)\s+(?:image|picture|photo|photograph|frame|scene)\s*[,:：-]?\s*/i,
    /^(?:there)\s+(?:is|are)\s+/i,
    /^(?:a|an)\s+(?:photograph|photo|picture|image|illustration|painting|drawing)\s+of\s+/i,
    /^(?:this|it)\s+(?:is|shows|depicts|features|contains|portrays)\s+/i,
    /^we\s+(?:can\s+)?see\s+/i,
    /^(?:the|this)\s+(?:scene|composition)\s+(?:shows|features|depicts|contains)\s+/i,
    /^(?:depicting|showing|portraying)\s+/i
  ];

  // 这些第三人称/过去式动词是叙述句的强信号；只在词表内转成 -ing，避免误伤名词。
  const FINITE_TO_GERUND = {
    stands: 'standing',
    sits: 'sitting',
    sat: 'sitting',
    reads: 'reading',
    looks: 'looking',
    wears: 'wearing',
    wore: 'wearing',
    holds: 'holding',
    held: 'holding',
    walks: 'walking',
    watched: 'watching',
    watches: 'watching',
    smiles: 'smiling',
    smiled: 'smiling',
    waits: 'waiting',
    waited: 'waiting',
    cooks: 'cooking',
    cooked: 'cooking',
    eats: 'eating',
    ate: 'eating',
    drinks: 'drinking',
    drank: 'drinking',
    talks: 'talking',
    talked: 'talking',
    leans: 'leaning',
    leaned: 'leaning',
    carries: 'carrying',
    carried: 'carrying',
    runs: 'running',
    ran: 'running',
    sleeps: 'sleeping',
    slept: 'sleeping',
    works: 'working',
    worked: 'working',
    writes: 'writing',
    wrote: 'writing',
    paints: 'painting',
    painted: 'painting',
    plays: 'playing',
    played: 'playing',
    sings: 'singing',
    sang: 'singing',
    dances: 'dancing',
    danced: 'dancing',
    smokes: 'smoking',
    smoked: 'smoking',
    rests: 'resting',
    rested: 'resting',
    rides: 'riding',
    rode: 'riding',
    drives: 'driving',
    drove: 'driving',
    swims: 'swimming',
    swam: 'swimming',
    listens: 'listening',
    listened: 'listening',
    studies: 'studying',
    studied: 'studying',
    buys: 'buying',
    bought: 'buying',
    sells: 'selling',
    sold: 'selling',
    opens: 'opening',
    opened: 'opening',
    closes: 'closing',
    closed: 'closing',
    cleans: 'cleaning',
    cleaned: 'cleaning',
    kneels: 'kneeling',
    knelt: 'kneeling',
    bends: 'bending',
    bent: 'bending',
    reaches: 'reaching',
    reached: 'reaching'
  };

  const FINITE_VERB_RE = new RegExp(
    '\\b(?:' + Object.keys(FINITE_TO_GERUND).join('|') + ')\\b',
    'i'
  );
  const AUXILIARY_RE = /\b(?:is|are|was|were|has|have|had|will|would|can|could|does|do|did)\b/i;

  function stripPromptLeadIns(text) {
    let out = normalizeSpace(text).trim();
    for (let pass = 0; pass < 4; pass += 1) {
      let changed = false;
      PROMPT_LEADIN_RES.forEach(function (re) {
        if (re.test(out)) {
          out = out.replace(re, '').trim();
          changed = true;
        }
      });
      if (!changed) break;
    }
    return out;
  }

  function lowerPromptStart(text) {
    return String(text).replace(/^(A|An|The)\b/, function (word) {
      return word.toLowerCase();
    });
  }

  function convertNarrativeClause(text) {
    let out = normalizeSpace(text).trim();
    // "there is a cat" -> "a cat"
    out = out.replace(/\bthere\s+(?:is|are)\s+/gi, '');
    // "a woman is sitting" -> "a woman sitting"（只去掉 be + -ing 的助动词）
    out = out.replace(/\b(?:is|are|was|were)\s+(?=[A-Za-z]+ing\b)/gi, '');
    // "a room has a window" -> "a room with a window"
    out = out.replace(/\b(?:has|have)\s+/gi, 'with ');
    // "a woman stands" -> "a woman standing"；仅限词表，避免把 jeans 之类当动词。
    out = out.replace(/\b[A-Za-z]+\b/g, function (word) {
      const gerund = FINITE_TO_GERUND[word.toLowerCase()];
      return gerund || word;
    });
    // "the man cooking while his wife standing" -> 逗号分隔的绝对短语。
    out = out.replace(/\s+while\s+/gi, ', ');
    // 剩余的主语 + be 动词：the room is dimly lit -> the room dimly lit。
    out = out.replace(/^([^,;]{2,}?)\s+(?:is|are|was|were)\s+(?=[A-Za-z])/i, '$1 ');
    out = out.replace(/\s+/g, ' ').trim();
    return lowerPromptStart(out);
  }

  function promptPhrases(text) {
    const first = splitPhrases(normalizeQuotes(String(text == null ? '' : text)));
    const out = [];
    first.forEach(function (raw) {
      let piece = normalizeSpace(raw)
        .replace(/^[\s,;:，；：、]+|[\s,;:，；：、]+$/g, '')
        .replace(/[.!?。！？]+$/g, '')
        .trim();
      piece = stripPromptLeadIns(piece);
      piece = convertNarrativeClause(piece);
      piece = stripPromptLeadIns(piece);
      piece = piece.replace(/[.!?。！？]+$/g, '').trim();
      // convertNarrativeClause 可能把 while 改成逗号，再切一次。
      splitPhrases(piece).forEach(function (part) {
        let phrase = normalizeSpace(part)
          .replace(/^[\s,;:，；：、]+|[\s,;:，；：、]+$/g, '')
          .replace(/[.!?。！？]+$/g, '')
          .trim();
        phrase = stripPromptLeadIns(phrase);
        phrase = convertNarrativeClause(phrase);
        phrase = phrase.replace(/[.!?。！？]+$/g, '').trim();
        if (phrase && !/^(?:a|an|the)?\s*(?:scene|image|picture|photograph)$/i.test(phrase)) {
          out.push(phrase);
        }
      });
    });
    return out;
  }

  function promptifyEnglish(text) {
    return joinPhrasesEn(promptPhrases(text));
  }

  // 判断一段英文是否仍像完整叙述句；不判断内容好坏，只看形态。
  function isNarrativeStyle(text) {
    const value = normalizeSpace(text);
    if (!value) return false;
    for (let i = 0; i < PROMPT_LEADIN_RES.length; i += 1) {
      if (PROMPT_LEADIN_RES[i].test(value)) return true;
    }
    if (/\b(?:there\s+(?:is|are)|this\s+(?:image|picture|photo)|the\s+(?:image|picture|photo))\b/i.test(value)) {
      return true;
    }
    if (AUXILIARY_RE.test(value)) return true;
    if (FINITE_VERB_RE.test(value)) return true;
    if (/[.!?。！？]\s*$/.test(value)) return true;
    return false;
  }

  function isPromptStyle(text) {
    return !isNarrativeStyle(text);
  }

  function cleanChinese(text) {
    return normalizeSpace(
      String(text)
        .replace(/\s*[,;]\s*/g, '，')
        .replace(/，{2,}/g, '，')
    ).replace(/^，|，$/g, '');
  }

  function joinPhrasesEn(parts) {
    return uniqueBy(
      parts
        .map(function (p) { return cleanEnglish(p).replace(/^,+|,+$/g, '').trim(); })
        .filter(Boolean),
      function (p) { return p.toLowerCase(); }
    ).join(', ');
  }

  function joinPhrasesZh(parts) {
    return uniqueBy(
      parts
        .map(function (p) { return String(p).replace(/^[，,、\s]+|[，,、\s]+$/g, '').trim(); })
        .filter(Boolean)
    ).join('，');
  }

  T2I.Utils = {
    normalizeSpace: normalizeSpace,
    normalizeQuotes: normalizeQuotes,
    splitPhrases: splitPhrases,
    splitEnglishPhrases: splitEnglishPhrases,
    uniqueBy: uniqueBy,
    escapeHtml: escapeHtml,
    hasCjk: hasCjk,
    hasLatin: hasLatin,
    cleanEnglish: cleanEnglish,
    cleanChinese: cleanChinese,
    joinPhrasesEn: joinPhrasesEn,
    joinPhrasesZh: joinPhrasesZh,
    stripPromptLeadIns: stripPromptLeadIns,
    convertNarrativeClause: convertNarrativeClause,
    promptPhrases: promptPhrases,
    promptifyEnglish: promptifyEnglish,
    isNarrativeStyle: isNarrativeStyle,
    isPromptStyle: isPromptStyle
  };
})();
