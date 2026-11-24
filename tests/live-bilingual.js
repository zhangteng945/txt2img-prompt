/*
 * 真实本机 Ollama 双向校对证据脚本（不参与默认 mock 测试）。
 *
 * 运行：node tests/live-bilingual.js
 * 只读取现有 Ollama，不启动/停止服务，不改系统配置，不写词库。
 * 输出 logs/live-bilingual-<本地时间>.json 和同名 .txt，包含实际模型输出。
 */
'use strict';

const fs = require('fs');
const path = require('path');

global.window = global;
['utils', 'lexicon', 'translator', 'scene', 'parser', 'slot-fill', 'complete', 'assemble', 'negative', 'feedback', 'bilingual-verify', 'local-llm', 'prompt-flow']
  .forEach(function (name) {
    require(path.join(__dirname, '..', 'js', name + '.js'));
  });

const T = global.T2I;
const LocalLLM = T.LocalLLM;
const PromptFlow = T.PromptFlow;
const settings = LocalLLM.defaultSettings();
const TIMEOUT = 60000;

function stamp() {
  const d = new Date();
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function generate(idea) {
  return LocalLLM.generate(settings, idea, { timeoutMs: TIMEOUT });
}

function review(fields, negative, idea, compareIdea) {
  return LocalLLM.review(settings, {
    fields: fields,
    negative: negative,
    idea: compareIdea ? idea : '',
    compareIdea: compareIdea === true
  }, { timeoutMs: TIMEOUT, correctionTimeoutMs: TIMEOUT });
}

function conciseReview(result) {
  if (!result) return null;
  const review = result.review || {};
  return {
    status: result.status,
    code: result.code,
    reason: result.reason,
    reviewStatus: result.reviewStatus,
    corrected: review.corrected === true,
    round: review.round || 0,
    correctedKeys: review.correctedKeys || [],
    calls: result.calls || review.calls || [],
    elapsedMs: result.elapsedMs,
    finalFields: result.fields,
    finalNegative: result.negative,
    initial: review.initial ? {
      fields: review.initial.fields,
      negative: review.initial.negative,
      back: review.initial.back,
      backNegative: review.initial.backNegative,
      issues: review.initial.issues,
      status: review.initial.status
    } : null,
    final: review.final ? {
      fields: review.final.fields,
      negative: review.final.negative,
      back: review.final.back,
      backNegative: review.final.backNegative,
      issues: review.final.issues,
      status: review.final.status
    } : null
  };
}

async function runStaticScenario(name, idea) {
  const generated = await generate(idea);
  const record = {
    scenario: name,
    idea: idea,
    generated: {
      status: generated.status,
      code: generated.code,
      reason: generated.reason,
      elapsedMs: generated.elapsedMs,
      fields: generated.fields,
      negative: generated.negative
    }
  };
  if (generated.status !== 'ok') {
    record.review = null;
    return record;
  }
  const reviewed = await review(generated.fields, generated.negative, idea, true);
  record.review = conciseReview(reviewed);
  return record;
}

async function runWomanEditScenario() {
  const idea = '一个女孩坐在窗边看书，白衬衫，柔和窗光';
  const generated = await generate(idea);
  const record = {
    scenario: 'woman-edit-after-user-changes-pose',
    idea: idea,
    generated: {
      status: generated.status,
      code: generated.code,
      reason: generated.reason,
      elapsedMs: generated.elapsedMs,
      fields: generated.fields,
      negative: generated.negative
    },
    userEdit: {
      field: 'pose.zh',
      before: generated.status === 'ok' ? generated.fields.pose.zh : '',
      after: '女人转身走向门口'
    }
  };
  if (generated.status !== 'ok') {
    record.review = null;
    return record;
  }
  const slots = PromptFlow.normalizeSlots(generated.fields);
  slots.pose.zh = '女人转身走向门口';
  PromptFlow.markChineseEdited(slots, 'pose');
  const retranslated = await LocalLLM.retranslate(settings, {
    idea: idea,
    fields: slots,
    pending: PromptFlow.pendingKeys(slots),
    negative: generated.negative
  }, { timeoutMs: TIMEOUT });
  record.retranslate = {
    status: retranslated.status,
    code: retranslated.code,
    fields: retranslated.fields,
    elapsedMs: retranslated.elapsedMs
  };
  if (retranslated.status === 'ok') {
    PromptFlow.applyEnglish(slots, retranslated.fields, PromptFlow.pendingKeys(slots));
    record.afterRetranslate = PromptFlow.serialize(slots);
  }
  const reviewed = await review(slots, (retranslated.negative || generated.negative), '', false);
  record.review = conciseReview(reviewed);
  return record;
}

(async function main() {
  const started = Date.now();
  const records = [];
  records.push(await runStaticScenario(
    'rain-cat-sunbathe-negation',
    '窗外下着雨的街道，一只橘猫趴在窗台上晒太阳，不要文字，不要水印'
  ));
  records.push(await runStaticScenario(
    'smoking-sign-distinction',
    '一块写着“禁止吸烟”的告示牌立在便利店门口，画面不要出现文字和水印，一个穿蓝外套的女人站在旁边'
  ));
  records.push(await runStaticScenario(
    'family-duplicate-subjects',
    '一家三口站在公园里，父亲牵着孩子，母亲拿着野餐篮，不要文字，不要水印'
  ));
  records.push(await runWomanEditScenario());

  const run = {
    ranAt: new Date().toISOString(),
    endpoint: LocalLLM.normalizeApiRoot(settings.apiRoot),
    model: LocalLLM.normalizeModel(settings.model),
    totalElapsedMs: Date.now() - started,
    records: records
  };
  const outDir = path.join(__dirname, '..', 'logs');
  const base = path.join(outDir, 'live-bilingual-' + stamp());
  fs.writeFileSync(base + '.json', JSON.stringify(run, null, 2));
  const lines = [];
  records.forEach(function (record, index) {
    lines.push('=== ' + (index + 1) + '. ' + record.scenario + ' ===');
    lines.push('原中文：' + record.idea);
    lines.push('初译：' + JSON.stringify(record.generated.fields));
    lines.push('初译负面：' + JSON.stringify(record.generated.negative));
    if (record.retranslate) lines.push('重译：' + JSON.stringify(record.retranslate.fields));
    if (record.review) {
      lines.push('校对状态：' + record.review.reviewStatus + '（status=' + record.review.status + '）');
      lines.push('是否修正：' + record.review.corrected + ' / round=' + record.review.round);
      lines.push('调用：' + JSON.stringify(record.review.calls));
      lines.push('初检差异：' + JSON.stringify((record.review.initial && record.review.initial.issues) || []));
      lines.push('回译：' + JSON.stringify((record.review.initial && record.review.initial.back) || {}));
      lines.push('终检差异：' + JSON.stringify((record.review.final && record.review.final.issues) || []));
      lines.push('终稿回译：' + JSON.stringify((record.review.final && record.review.final.back) || {}));
      lines.push('终稿英文：' + JSON.stringify(record.review.finalFields));
      lines.push('终稿负面：' + JSON.stringify(record.review.finalNegative));
    }
    lines.push('');
  });
  fs.writeFileSync(base + '.txt', lines.join('\n'));
  console.log(lines.join('\n'));
  console.log('saved: ' + base + '.json');
  console.log('total: ' + Math.round((Date.now() - started) / 1000) + 's');
})().catch(function (error) {
  console.error('LIVE TEST FAILED');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
