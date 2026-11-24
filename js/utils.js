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
    joinPhrasesZh: joinPhrasesZh
  };
})();
