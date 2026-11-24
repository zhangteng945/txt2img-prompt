/*
 * negative.js — 通用、稳妥的 SDXL 负面提示词
 *
 * 负面词按「解剖 → 手部 → 面部 → 皮肤 → 画质 → 水印文字 → 曝光/色彩 →
 * 透视构图」排序。若正面已经明确要求某种效果（例如浅景深、胶片颗粒、
 * 全身照、高饱和），会自动移除会互相打架的负面词。
 */
(function () {
  'use strict';

  const T2I = (window.T2I = window.T2I || {});
  const L = T2I.Lexicon;

  const ORDER = [
    '畸形', '解剖错误', '多余肢体', '缺失肢体', '多余手臂',
    '多余手指', '缺失手指', '手指粘连', '手部畸形', '变异的手',
    '手部模糊', '手部比例错误', '手臂错误', '腿部错误', '脚部畸形',
    '面目扭曲', '面部畸变', '面部不对称', '双眼不对称', '斗鸡眼',
    '长脖子', '比例失调', '克隆脸', '重复', '面部绘制粗糙',
    '牙齿畸形', '双头', '身体融合', '多余眼睛',
    '塑料皮肤', '磨皮过度', '不自然皮肤',
    '模糊', '失焦', '低质量', '最差质量', '低分辨率', '像素化',
    'JPEG压缩痕迹', '画面伪影', '噪点', '运动模糊',
    '水印', '文字', '签名', '标志', '网址',
    '过饱和', '过曝', '欠曝', '平淡光照', '色偏', '曝光错误', '光线错误',
    '透视畸变', '裁切不当', '构图不佳', '边框', '拉伸'
  ];

  const CONFLICT_RULES = {
    '模糊': /(bokeh|shallow depth of field|soft focus|blurred background|dreamy)/i,
    '失焦': /(bokeh|shallow depth of field|soft focus|blurred background)/i,
    '噪点': /(film grain|grainy|analog|35mm film|coarse grain)/i,
    '裁切不当': /(full body shot|full-body|full length|wide shot|environmental portrait)/i,
    '透视畸变': /(wide-angle lens|fisheye|dutch angle)/i,
    '平淡光照': /(high contrast|dramatic lighting|cinematic lighting|chiaroscuro|low-key)/i,
    '过饱和': /(high saturation|vivid colors|colorful|teal and orange)/i,
    '过曝': /(high-key lighting|overexposed)/i,
    '欠曝': /(low-key lighting|dark tones)/i,
    '运动模糊': /(motion blur)/i,
    '文字': /(typography|text overlay|lettering)/i
  };

  const byZh = Object.create(null);
  (L.byCategory.negative || []).forEach(function (entry) {
    if (!byZh[entry.zh]) byZh[entry.zh] = entry;
  });

  function build(positiveEn) {
    const positive = String(positiveEn || '');
    const items = [];
    const skipped = [];

    ORDER.forEach(function (zh) {
      const entry = byZh[zh];
      if (!entry) return;
      const rule = CONFLICT_RULES[zh];
      if (rule && rule.test(positive)) {
        skipped.push(entry);
        return;
      }
      items.push(entry);
    });

    const negativeEn = items.map(function (e) { return e.en; }).join(', ');
    const negativeZh = items.map(function (e) { return e.zh; }).join('，');

    return {
      negativeEn: negativeEn,
      negativeZh: negativeZh,
      items: items,
      skipped: skipped
    };
  }

  T2I.Negative = { build: build, order: ORDER };
})();
