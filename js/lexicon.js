/*
 * lexicon.js — 内置中英双语提示词词典（无网络依赖）
 *
 * 每条词条格式：[中文规范词, 英文规范译法, 中文同义词[], 英文同义词[]]
 * 同义词最终都指向同一个规范译法；英文尽量采用 SDXL / 摄影提示词惯用表达。
 * 词典是只读数据，parser / translator / slot-fill 都从这里取词。
 */
(function () {
  'use strict';

  const T2I = (window.T2I = window.T2I || {});

  const SLOT_OF_CATEGORY = {
    subject: 'person',
    appearance: 'person',
    hair: 'person',
    eyes: 'person',
    expression: 'person',
    makeup: 'person',
    outfit: 'outfit',
    accessory: 'outfit',
    material: 'outfit',
    pattern: 'outfit',
    shoe: 'outfit',
    color: 'outfit', // 颜色需结合上下文，slot-fill 会单独判断
    pose: 'pose',
    scene: 'scene',
    time: 'scene',
    weather: 'scene',
    light: 'light',
    camera: 'light',
    style: 'style',
    quality: 'style',
    negative: '',
    connector: ''
  };

  const CATEGORY_LABEL = {
    subject: '人物身份',
    appearance: '外貌体型',
    hair: '发型发色',
    eyes: '眼睛',
    expression: '表情神态',
    makeup: '妆容',
    outfit: '服装',
    accessory: '配饰',
    material: '材质',
    pattern: '图案',
    shoe: '鞋履',
    color: '颜色',
    pose: '姿态动作',
    scene: '场景地点',
    time: '时间',
    weather: '天气',
    light: '光线',
    camera: '镜头构图',
    style: '画风质感',
    quality: '质量词',
    negative: '负面词',
    connector: '连接词'
  };

  const GROUPS = {
    subject: [
      ['女人', 'woman', ['女性', '女子', '女生', '女的', '女人家', '女士'], ['women', 'female', 'lady']],
      ['男人', 'man', ['男性', '男子', '男生', '男的', '男士'], ['men', 'male', 'gentleman']],
      ['女孩', 'girl', ['小女孩', '女孩子', '姑娘', '少女'], ['girls', 'young girl']],
      ['男孩', 'boy', ['小男孩', '男孩子', '少年'], ['boys', 'young boy']],
      ['年轻女性', 'young woman', ['年轻女人', '年轻女子', '青年女性', '年轻女生'], ['young women', 'young lady']],
      ['年轻男子', 'young man', ['年轻男人', '年轻男生', '青年男性'], ['young men', 'young gentleman']],
      ['儿童', 'child', ['小孩', '孩子', '小朋友'], ['children', 'kid']],
      ['老人', 'elderly person', ['老年人', '长者'], ['elderly people', 'senior']],
      ['老爷爷', 'elderly man', ['老爷爷', '老伯伯', '老先生'], ['old man', 'elderly gentleman']],
      ['老奶奶', 'elderly woman', ['老奶奶', '老婆婆', '老太太'], ['old woman', 'elderly lady']],
      ['模特', 'fashion model', ['女模', '男模', '模特儿'], ['model', 'models']],
      ['摄影师', 'photographer', ['摄影者'], ['photographers']],
      ['旅行者', 'traveler', ['旅人', '游客', '背包客'], ['traveller', 'tourist', 'backpacker']],
      ['上班族', 'office worker', ['白领', '职员'], ['office workers', 'white-collar worker']],
      ['学生', 'student', ['学生党'], ['students']],
      ['情侣', 'couple', ['恋人', '一对情侣'], ['couples', 'lovers']],
      ['朋友', 'friends', ['好友', '闺蜜', '伙伴'], ['friend', 'companions']],
      ['一家人', 'family', ['全家', '家庭'], ['families', 'family members']],
      ['骑士', 'knight', ['女骑士', '男骑士'], ['knights']],
      ['武士', 'samurai', ['侍'], ['samurais']],
      ['战士', 'warrior', ['女战士', '男战士'], ['warriors', 'fighter']],
      ['法师', 'mage', ['魔法师', '巫师'], ['mages', 'wizard', 'sorcerer']],
      ['女巫', 'witch', ['魔女'], ['witches', 'sorceress']],
      ['精灵', 'elf', ['精灵族'], ['elves', 'elven']],
      ['精灵骑士', 'elf knight', ['精灵战士'], ['elven knight']],
      ['公主', 'princess', ['王国公主'], ['princesses']],
      ['王子', 'prince', ['王国王子'], ['princes']],
      ['美人鱼', 'mermaid', ['人鱼'], ['mermaids']],
      ['天使', 'angel', ['天使般'], ['angels', 'angelic']],
      ['恶魔', 'demon', ['魔鬼'], ['demons', 'devil']],
      ['机器人', 'robot', ['机械人'], ['robots', 'android']],
      ['仿生人', 'android', ['人造人'], ['androids', 'synthetic human']],
      ['宇航员', 'astronaut', ['航天员'], ['astronauts', 'spaceman']],
      ['赛博格', 'cyborg', ['半机械人'], ['cyborgs']],
      ['侦探', 'detective', ['私家侦探'], ['detectives', 'investigator']],
      ['牛仔', 'cowboy', ['牛仔女郎'], ['cowboys', 'cowgirl']],
      ['舞者', 'dancer', ['舞蹈演员'], ['dancers', 'ballerina']],
      ['音乐人', 'musician', ['乐手', '歌手'], ['musicians', 'singer']],
      ['画家', 'painter', ['艺术家'], ['painters', 'artist']],
      ['厨师', 'chef', ['大厨'], ['chefs', 'cook']],
      ['医生', 'doctor', ['医师'], ['doctors', 'physician']],
      ['护士', 'nurse', ['护理'], ['nurses']],
      ['士兵', 'soldier', ['军人'], ['soldiers', 'troops']],
      ['海盗', 'pirate', ['海盗船长'], ['pirates']],
      ['忍者', 'ninja', ['忍者刺客'], ['ninjas', 'shinobi']],
      ['修女', 'nun', ['修女服'], ['nuns']],
      ['女仆', 'maid', ['女佣'], ['maids', 'maid servant']],
      ['管家', 'butler', ['执事'], ['butlers']],
      ['橘猫', 'orange cat', ['橘色猫', '黄猫'], ['ginger cat']],
      ['猫', 'cat', ['猫咪', '小猫'], ['cats', 'kitten']],
      ['黑猫', 'black cat', ['黑猫咪'], ['black cats']],
      ['白猫', 'white cat', ['白猫咪'], ['white cats']],
      ['狗', 'dog', ['狗狗', '小狗'], ['dogs', 'puppy']],
      ['柴犬', 'shiba inu', ['柴狗'], ['shiba']],
      ['金毛', 'golden retriever', ['金毛犬'], ['golden retriever dog']],
      ['兔子', 'rabbit', ['兔兔', '小兔'], ['bunny', 'rabbits']],
      ['狐狸', 'fox', ['狐狸精'], ['foxes']],
      ['鹿', 'deer', ['小鹿', '梅花鹿'], ['deers']],
      ['马', 'horse', ['骏马'], ['horses']],
      ['鸟', 'bird', ['小鸟'], ['birds']],
      ['蝴蝶', 'butterfly', ['蝴蝶群'], ['butterflies']],
      ['龙', 'dragon', ['巨龙'], ['dragons']],
      ['狼', 'wolf', ['野狼'], ['wolves']]
    ],

    appearance: [
      ['年轻', 'young', ['青春', '年少'], ['youthful']],
      ['中年', 'middle-aged', ['中年人'], ['middle aged']],
      ['老年', 'elderly', ['年老'], ['old aged']],
      ['可爱', 'cute', ['萌', '可爱风'], ['adorable']],
      ['成熟', 'mature', ['成熟感'], ['mature-looking']],
      ['优雅', 'elegant', ['优雅的', '高贵'], ['graceful', 'classy']],
      ['有气质', 'poised', ['气质', '有气场'], ['elegant presence']],
      ['苗条', 'slim', ['瘦', '纤细', '纤瘦'], ['slender', 'thin']],
      ['高挑', 'tall', ['个子高', '身材高挑'], ['tall figure']],
      ['娇小', 'petite', ['小巧', '娇小玲珑'], ['small frame']],
      ['匀称', 'well-proportioned', ['身材匀称'], ['balanced figure', 'well proportioned']],
      ['健美', 'athletic', ['运动型', '健身'], ['fit', 'toned']],
      ['肌肉发达', 'muscular', ['肌肉', '健壮'], ['muscular build', 'buff']],
      ['微胖', 'curvy', ['丰满', '圆润'], ['full figure', 'voluptuous']],
      ['长腿', 'long legs', ['大长腿'], ['long legged']],
      ['细腰', 'slim waist', ['小蛮腰'], ['narrow waist']],
      ['白皙', 'fair-skinned', ['白皮肤', '白皙皮肤', '皮肤白皙'], ['pale skin', 'fair skin', 'light skin']],
      ['小麦色', 'tan-skinned', ['小麦色皮肤', '古铜色'], ['tanned skin', 'sun-kissed skin']],
      ['深色皮肤', 'dark-skinned', ['黑皮肤', '深肤色'], ['dark skin', 'deep skin tone']],
      ['雀斑', 'freckles', ['小雀斑'], ['freckled']],
      ['美人痣', 'beauty mark', ['泪痣'], ['mole']],
      ['酒窝', 'dimples', ['梨涡'], ['dimpled']],
      ['高颧骨', 'high cheekbones', ['颧骨高'], ['prominent cheekbones']],
      ['尖下巴', 'sharp chin', ['下巴尖'], ['pointed chin']],
      ['方脸', 'square face', ['方形脸'], ['square jaw']],
      ['圆脸', 'round face', ['娃娃脸', '婴儿肥'], ['baby face', 'round-faced']],
      ['鹅蛋脸', 'oval face', ['椭圆脸'], ['oval face shape']],
      ['瓜子脸', 'heart-shaped face', ['心形脸'], ['heart shaped face']],
      ['高鼻梁', 'high nose bridge', ['鼻梁高挺', '高鼻'], ['tall nose bridge']],
      ['小鼻子', 'small nose', ['秀气鼻子'], ['button nose']],
      ['厚唇', 'full lips', ['饱满嘴唇'], ['plump lips']],
      ['薄唇', 'thin lips', ['薄嘴唇'], ['narrow lips']],
      ['红唇', 'red lips', ['红色嘴唇'], ['red lipstick', 'crimson lips']],
      ['无瑕肌肤', 'flawless skin', ['无瑕皮肤', '完美肌肤'], ['perfect skin', 'smooth skin']],
      ['自然肤质', 'natural skin texture', ['真实肤质', '皮肤纹理'], ['realistic skin texture', 'skin texture']],
      ['皮肤细腻', 'smooth skin', ['细腻皮肤'], ['refined skin']],
      ['机械义肢', 'mechanical prosthetic arm', ['机械臂', '义肢'], ['cybernetic arm', 'prosthetic arm']]
    ],

    hair: [
      ['短发', 'short hair', ['短头发', '短发造型', '剪短发'], ['short-haired', 'short bob']],
      ['长发', 'long hair', ['长头发', '秀发'], ['long-haired', 'flowing hair']],
      ['中长发', 'medium-length hair', ['中长头发'], ['medium hair', 'shoulder-length hair']],
      ['齐肩发', 'shoulder-length hair', ['齐肩短发'], ['shoulder length hair']],
      ['波波头', 'bob cut', ['波波短发', 'Bob头'], ['bob haircut', 'bob']],
      ['精灵短发', 'pixie cut', ['超短发', '精灵头'], ['pixie haircut']],
      ['马尾', 'ponytail', ['马尾辫'], ['ponytails', 'tied hair']],
      ['高马尾', 'high ponytail', ['高马尾辫'], ['high pony']],
      ['低马尾', 'low ponytail', ['低马尾辫'], ['low pony']],
      ['双马尾', 'twin tails', ['双马尾辫'], ['twintails', 'two ponytails']],
      ['麻花辫', 'braid', ['辫子', '编发'], ['braids', 'plaited hair']],
      ['侧编发', 'side braid', ['侧麻花辫'], ['side braid hairstyle']],
      ['盘发', 'updo', ['挽发', '发髻'], ['updo hairstyle', 'hair bun']],
      ['丸子头', 'bun', ['丸子发型'], ['top knot', 'hair bun']],
      ['凌乱丸子头', 'messy bun', ['慵懒丸子头'], ['messy hair bun']],
      ['直发', 'straight hair', ['顺直发', '直长发'], ['straight-haired', 'sleek hair']],
      ['卷发', 'curly hair', ['卷头发'], ['curls', 'curly-haired']],
      ['波浪卷', 'wavy hair', ['大波浪', '波浪发'], ['waves', 'wavy-haired']],
      ['微卷', 'slightly wavy hair', ['微卷发'], ['soft waves']],
      ['刘海', 'bangs', ['前刘海', '留海'], ['fringe']],
      ['齐刘海', 'blunt bangs', ['平刘海'], ['straight fringe', 'full fringe']],
      ['斜刘海', 'side-swept bangs', ['斜分刘海'], ['side fringe', 'side-swept fringe']],
      ['空气刘海', 'wispy bangs', ['轻薄刘海'], ['thin fringe', 'see-through bangs']],
      ['黑发', 'black hair', ['黑色头发'], ['black-haired', 'raven hair']],
      ['棕发', 'brown hair', ['棕色头发', '栗色头发'], ['brown-haired', 'chestnut hair']],
      ['金发', 'blonde hair', ['金色头发', '金发女郎'], ['blond hair', 'golden hair']],
      ['铂金发', 'platinum blonde hair', ['铂金色头发', '白金色头发'], ['platinum hair', 'platinum blond']],
      ['银发', 'silver hair', ['银色头发'], ['silver-haired', 'white hair']],
      ['灰发', 'gray hair', ['灰色头发', '花白头发'], ['grey hair', 'gray-haired']],
      ['红发', 'red hair', ['红色头发'], ['red-haired', 'ginger hair']],
      ['酒红发', 'burgundy hair', ['酒红色头发'], ['wine red hair']],
      ['蓝发', 'blue hair', ['蓝色头发'], ['blue-haired']],
      ['粉发', 'pink hair', ['粉色头发'], ['pink-haired']],
      ['紫发', 'purple hair', ['紫色头发'], ['purple-haired', 'violet hair']],
      ['绿发', 'green hair', ['绿色头发'], ['green-haired']],
      ['挑染', 'highlights', ['挑染发'], ['highlighted hair', 'hair streaks']],
      ['渐变发', 'ombre hair', ['渐变发色'], ['gradient hair']],
      ['湿发', 'wet hair', ['湿漉漉的头发'], ['wet-look hair']],
      ['蓬松头发', 'voluminous hair', ['蓬松发型'], ['voluminous hairstyle']],
      ['凌乱头发', 'tousled hair', ['乱发', '慵懒发型'], ['messy hair', 'bedhead']],
      ['被风吹乱的头发', 'windblown hair', ['风吹头发', '凌乱发丝'], ['hair blowing in the wind']],
      ['光泽头发', 'glossy hair', ['柔顺头发'], ['shiny hair', 'silky hair']]
    ],

    eyes: [
      ['大眼睛', 'big eyes', ['大眼'], ['large eyes']],
      ['小眼睛', 'small eyes', ['细长眼睛'], ['narrow eyes']],
      ['杏眼', 'almond eyes', ['杏仁眼'], ['almond-shaped eyes']],
      ['桃花眼', 'peach blossom eyes', ['含情眼'], ['phoenix eyes']],
      ['深邃眼睛', 'deep-set eyes', ['深邃眼眸', '深眼窝'], ['deep eyes', 'sunken eyes']],
      ['蓝色眼睛', 'blue eyes', ['蓝眼睛', '蓝眼', '蓝眸'], ['blue-eyed']],
      ['棕色眼睛', 'brown eyes', ['棕眼睛', '棕眼', '棕眸'], ['brown-eyed']],
      ['绿色眼睛', 'green eyes', ['绿眼睛', '绿眼', '绿眸'], ['green-eyed']],
      ['灰色眼睛', 'gray eyes', ['灰眼睛', '灰眼', '灰眸'], ['grey eyes', 'gray-eyed']],
      ['黑色眼睛', 'dark eyes', ['黑眼睛', '黑眼', '黑眸'], ['black eyes', 'dark-eyed']],
      ['异色瞳', 'heterochromia', ['双色瞳', '异色眼睛'], ['different colored eyes']],
      ['单眼皮', 'monolids', ['单眼皮眼睛'], ['monolid eyes']],
      ['双眼皮', 'double eyelids', ['双眼皮眼睛'], ['double-lidded eyes']],
      ['长睫毛', 'long eyelashes', ['浓密睫毛'], ['long lashes']],
      ['浓眉', 'thick eyebrows', ['粗眉', '浓密眉毛'], ['bold eyebrows']],
      ['柳叶眉', 'arched eyebrows', ['弯眉'], ['arched brows']]
    ],

    expression: [
      ['微笑', 'smiling', ['笑', '微微笑', '含笑'], ['smile', 'gentle smile']],
      ['淡淡微笑', 'subtle smile', ['浅浅微笑', '面带微笑'], ['faint smile', 'soft smile']],
      ['大笑', 'laughing', ['开怀大笑', '笑声'], ['laugh', 'big smile']],
      ['严肃', 'serious expression', ['严肃表情', '神情严肃'], ['serious', 'stern look']],
      ['冷漠', 'cold expression', ['高冷', '冷淡'], ['cold look', 'aloof expression']],
      ['温柔', 'gentle expression', ['温柔表情', '柔和神情'], ['tender expression', 'gentle look']],
      ['自信', 'confident expression', ['自信满满'], ['confident look']],
      ['忧郁', 'melancholy', ['忧郁感', '忧伤'], ['sad', 'melancholic']],
      ['惊讶', 'surprised expression', ['吃惊', '惊讶表情'], ['surprised', 'astonished']],
      ['生气', 'angry expression', ['愤怒', '生气表情'], ['angry', 'furious']],
      ['悲伤', 'sad expression', ['难过', '悲伤表情'], ['sad', 'sorrowful']],
      ['闭眼', 'eyes closed', ['闭上眼睛', '闭着眼睛'], ['closed eyes']],
      ['看向镜头', 'looking at viewer', ['看着镜头', '注视镜头', '看镜头'], ['looking at camera', 'gazing at viewer']],
      ['侧脸', 'side profile', ['侧颜', '侧面', '侧脸轮廓'], ['profile', 'side view']],
      ['面无表情', 'neutral expression', ['无表情', '平静表情'], ['blank expression', 'expressionless']],
      ['若有所思', 'pensive expression', ['沉思', '若有所思的样子'], ['thoughtful', 'lost in thought']],
      ['眼神坚定', 'determined gaze', ['坚定眼神'], ['determined look']],
      ['眼神温柔', 'tender gaze', ['温柔眼神'], ['soft gaze']]
    ],

    makeup: [
      ['自然妆容', 'natural makeup', ['自然妆', '清透妆容'], ['natural look', 'subtle makeup']],
      ['淡妆', 'light makeup', ['轻薄妆容'], ['light make-up']],
      ['浓妆', 'heavy makeup', ['浓重妆容'], ['bold makeup']],
      ['裸妆', 'no-makeup look', ['伪素颜', '素颜妆'], ['bare-faced look']],
      ['烟熏妆', 'smoky eye makeup', ['烟熏眼妆'], ['smokey eyes']],
      ['红唇妆', 'red lipstick', ['红唇', '烈焰红唇'], ['red lips', 'crimson lipstick']],
      ['裸色唇', 'nude lips', ['裸色口红'], ['nude lipstick']],
      ['猫眼妆', 'cat-eye makeup', ['猫眼眼线'], ['cat eye liner']],
      ['哥特妆', 'gothic makeup', ['暗黑妆'], ['goth makeup']],
      ['舞台妆', 'stage makeup', ['演出妆'], ['performance makeup']],
      ['无妆', 'bare face', ['素颜', '不化妆'], ['no makeup', 'bare-faced']],
      ['眼线', 'eyeliner', ['画眼线'], ['eye liner']],
      ['睫毛膏', 'mascara', ['涂睫毛膏'], ['lashes']],
      ['腮红', 'blush', ['涂腮红'], ['rouge']]
    ],

    outfit: [
      ['风衣', 'trench coat', ['长风衣', '风衣外套'], ['trenchcoat', 'trench coats']],
      ['米色风衣', 'beige trench coat', ['卡其色风衣'], ['beige coat', 'camel trench coat']],
      ['大衣', 'coat', ['外套', '长外套'], ['coats', 'overcoat']],
      ['长款大衣', 'long coat', ['长大衣'], ['long overcoat']],
      ['羽绒服', 'puffer jacket', ['羽绒外套', '面包服'], ['down jacket', 'puffer coat']],
      ['皮夹克', 'leather jacket', ['皮衣', '机车夹克'], ['leather coat', 'biker jacket']],
      ['夹克', 'jacket', ['短外套', '夹克衫'], ['jackets']],
      ['牛仔外套', 'denim jacket', ['牛仔夹克'], ['denim coat']],
      ['西装', 'blazer', ['西服', '西装外套'], ['suit jacket']],
      ['西装套装', 'suit', ['套装', '正装'], ['business suit', 'two-piece suit']],
      ['衬衫', 'shirt', ['衬衣'], ['shirts', 'button-down shirt']],
      ['白衬衫', 'white shirt', ['白色衬衫'], ['white blouse']],
      ['T恤', 't-shirt', ['T恤衫', '短袖T恤'], ['tee', 'tshirt']],
      ['黑色T恤', 'black t-shirt', ['黑T恤'], ['black tee']],
      ['背心', 'tank top', ['吊带背心', '无袖上衣'], ['vest top', 'camisole']],
      ['针织衫', 'knit sweater', ['毛衣', '针织毛衣'], ['sweater', 'knitwear']],
      ['高领毛衣', 'turtleneck sweater', ['高领针织衫'], ['turtleneck']],
      ['开衫', 'cardigan', ['针织开衫'], ['cardigans']],
      ['卫衣', 'hoodie', ['连帽卫衣', '帽衫'], ['hooded sweatshirt']],
      ['连衣裙', 'dress', ['裙子', '连身裙'], ['dresses', 'frock']],
      ['长裙', 'long dress', ['长连衣裙', '拖地长裙'], ['maxi dress', 'long gown']],
      ['短裙', 'short skirt', ['迷你裙'], ['mini skirt']],
      ['吊带裙', 'slip dress', ['吊带连衣裙'], ['camisole dress']],
      ['礼服', 'evening gown', ['晚礼服', '长礼服'], ['formal gown', 'gala dress']],
      ['婚纱', 'wedding dress', ['新娘婚纱'], ['bridal gown', 'wedding gown']],
      ['旗袍', 'qipao', ['中式旗袍', '旗袍裙'], ['cheongsam', 'mandarin gown']],
      ['汉服', 'hanfu', ['传统汉服'], ['chinese hanfu']],
      ['和服', 'kimono', ['日式和服'], ['kimonos']],
      ['半身裙', 'skirt', ['下裙'], ['skirts']],
      ['百褶裙', 'pleated skirt', ['褶皱裙'], ['pleated skirts']],
      ['牛仔裤', 'jeans', ['丹宁裤', '牛仔长裤'], ['denim pants', 'jean']],
      ['破洞牛仔裤', 'distressed jeans', ['破洞牛仔', '做旧牛仔裤'], ['ripped jeans', 'torn jeans']],
      ['阔腿裤', 'wide-leg pants', ['阔腿长裤'], ['wide leg trousers', 'palazzo pants']],
      ['西装裤', 'tailored trousers', ['西裤', '正装裤'], ['dress pants', 'suit trousers']],
      ['短裤', 'shorts', ['热裤'], ['short pants']],
      ['紧身裤', 'leggings', ['打底裤', '瑜伽裤'], ['tight pants', 'yoga pants']],
      ['工装裤', 'cargo pants', ['工装长裤'], ['cargo trousers']],
      ['背带裤', 'overalls', ['吊带裤'], ['dungarees']],
      ['运动服', 'sportswear', ['运动装', '健身服'], ['athletic wear', 'activewear']],
      ['校服', 'school uniform', ['学生制服'], ['school uniforms']],
      ['制服', 'uniform', ['职业制服'], ['uniforms']],
      ['军装', 'military uniform', ['军服'], ['army uniform']],
      ['雨衣', 'raincoat', ['雨披'], ['rain jacket']],
      ['冲锋衣', 'windbreaker', ['户外外套'], ['wind jacket', 'shell jacket']],
      ['斗篷', 'cloak', ['披风', '斗篷外套'], ['cloaks', 'cape']],
      ['长袍', 'robe', ['法袍', '长衫'], ['robes', 'gown']],
      ['盔甲', 'armor', ['铠甲', '甲胄'], ['armour', 'plate armor']],
      ['奇幻盔甲', 'fantasy armor', ['奇幻铠甲', '精灵盔甲'], ['fantasy armour', 'ornate armor']],
      ['泳衣', 'swimsuit', ['泳装', '连体泳衣'], ['bathing suit', 'one-piece swimsuit']],
      ['睡衣', 'pajamas', ['居家睡衣'], ['pyjamas', 'nightwear']],
      ['家居服', 'loungewear', ['居家服'], ['homewear']],
      ['围裙', 'apron', ['厨房围裙'], ['aprons']],
      ['机能风外套', 'techwear jacket', ['机能外套', '战术外套'], ['techwear coat', 'technical jacket']]
    ],

    accessory: [
      ['眼镜', 'glasses', ['戴眼镜', '框架眼镜'], ['eyeglasses', 'spectacles']],
      ['墨镜', 'sunglasses', ['太阳镜', '蛤蟆镜'], ['shades', 'sun glasses']],
      ['帽子', 'hat', ['戴帽子'], ['hats', 'headwear']],
      ['贝雷帽', 'beret', ['法式贝雷帽'], ['berets']],
      ['棒球帽', 'baseball cap', ['鸭舌帽'], ['ball cap']],
      ['针织帽', 'beanie', ['毛线帽'], ['knit hat']],
      ['草帽', 'straw hat', ['编织草帽'], ['summer hat']],
      ['礼帽', 'fedora', ['绅士帽'], ['fedoras']],
      ['围巾', 'scarf', ['戴围巾', '围脖'], ['scarves']],
      ['披肩', 'shawl', ['披巾'], ['shawls']],
      ['团扇', 'round fan', ['团扇子', '中式团扇'], ['hand fan']],
      ['丝巾', 'silk scarf', ['真丝丝巾'], ['silk scarves']],
      ['手套', 'gloves', ['戴手套'], ['glove']],
      ['项链', 'necklace', ['戴项链'], ['necklaces']],
      ['珍珠项链', 'pearl necklace', ['珍珠链'], ['pearls']],
      ['耳环', 'earrings', ['耳坠', '戴耳环'], ['earring', 'drop earrings']],
      ['耳钉', 'stud earrings', ['耳钉饰'], ['studs']],
      ['手链', 'bracelet', ['手镯'], ['bracelets', 'bangle']],
      ['手表', 'watch', ['腕表'], ['wristwatch', 'watches']],
      ['戒指', 'ring', ['戴戒指'], ['rings']],
      ['腰带', 'belt', ['皮带', '束腰'], ['belts']],
      ['背包', 'backpack', ['双肩包', '书包'], ['back pack', 'rucksack']],
      ['手提包', 'handbag', ['手提袋', '拎包'], ['purse', 'tote bag']],
      ['单肩包', 'shoulder bag', ['腋下包'], ['shoulder purse']],
      ['斜挎包', 'crossbody bag', ['斜挎小包'], ['cross-body bag']],
      ['帆布包', 'canvas bag', ['帆布袋'], ['tote bag']],
      ['行李箱', 'suitcase', ['旅行箱', '拉杆箱'], ['luggage']],
      ['雨伞', 'umbrella', ['打伞'], ['umbrellas', 'parasol']],
      ['发带', 'hairband', ['发箍'], ['headband']],
      ['发夹', 'hair clip', ['发卡'], ['hairpin']],
      ['蝴蝶结', 'bow', ['蝴蝶结装饰'], ['ribbon bow']],
      ['皇冠', 'crown', ['王冠'], ['crowns', 'tiara']],
      ['面纱', 'veil', ['头纱'], ['veils']],
      ['面具', 'mask', ['戴面具'], ['masks']],
      ['护目镜', 'goggles', ['防风镜'], ['goggle']],
      ['耳机', 'headphones', ['戴耳机'], ['headset']],
      ['书', 'book', ['书本'], ['books']],
      ['长剑', 'longsword', ['剑', '宝剑'], ['long sword', 'sword']],
      ['花', 'flowers', ['花束', '鲜花'], ['flower', 'bouquet']],
      ['咖啡杯', 'coffee cup', ['咖啡杯子'], ['cup of coffee', 'coffee mug']],
      ['咖啡', 'coffee', ['一杯咖啡'], ['coffees']],
      ['拿铁', 'latte', ['拿铁咖啡'], ['latte coffee']],
      ['酒杯', 'wine glass', ['高脚杯'], ['wineglass']]
    ],

    material: [
      ['棉', 'cotton', ['棉质', '纯棉'], ['cotton fabric']],
      ['亚麻', 'linen', ['亚麻质', '麻布'], ['linen fabric']],
      ['丝绸', 'silk', ['真丝', '丝质'], ['silky', 'silk fabric']],
      ['缎面', 'satin', ['缎子', '缎面材质'], ['satin finish']],
      ['羊毛', 'wool', ['羊毛质'], ['woolen', 'wool fabric']],
      ['羊绒', 'cashmere', ['开司米'], ['cashmere fabric']],
      ['皮革', 'leather', ['皮质', '真皮'], ['leathery']],
      ['牛仔', 'denim', ['丹宁', '牛仔布'], ['denim fabric']],
      ['天鹅绒', 'velvet', ['丝绒', '绒面'], ['velvety']],
      ['雪纺', 'chiffon', ['雪纺纱'], ['chiffon fabric']],
      ['蕾丝', 'lace', ['蕾丝边', '镂空蕾丝'], ['lacy', 'lace fabric']],
      ['针织', 'knit', ['针织材质'], ['knitted', 'knitwear']],
      ['粗花呢', 'tweed', ['花呢'], ['tweed fabric']],
      ['麂皮', 'suede', ['翻毛皮'], ['suede leather']],
      ['尼龙', 'nylon', ['锦纶'], ['nylon fabric']],
      ['金属', 'metal', ['金属质'], ['metallic']],
      ['金色', 'gold', ['黄金色', '鎏金'], ['golden', 'golden-colored']],
      ['银色', 'silver', ['银白', '白银'], ['silvery']],
      ['珍珠', 'pearl', ['珍珠质'], ['pearlescent']],
      ['透明', 'transparent', ['半透明', '透视'], ['translucent', 'see-through']],
      ['轻薄', 'lightweight', ['轻盈', '薄'], ['light fabric']],
      ['厚实', 'thick', ['厚重'], ['heavy fabric']],
      ['有光泽', 'glossy', ['亮面'], ['shiny', 'lustrous']],
      ['哑光', 'matte', ['雾面'], ['matte finish']]
    ],

    color: [
      ['米色', 'beige', ['米白', '米黄色'], ['cream beige']],
      ['奶油色', 'cream', ['奶油白'], ['creamy white']],
      ['象牙白', 'ivory', ['象牙色'], ['ivory white']],
      ['黑色', 'black', ['黑', '纯黑'], ['jet black']],
      ['白色', 'white', ['白', '纯白'], ['snow white']],
      ['灰色', 'gray', ['灰', '灰色调'], ['grey']],
      ['深灰', 'dark gray', ['深灰色'], ['charcoal gray']],
      ['浅灰', 'light gray', ['浅灰色'], ['pale gray']],
      ['藏青', 'navy blue', ['藏蓝色', '海军蓝'], ['navy']],
      ['蓝色', 'blue', ['蓝', '蓝色调'], ['blue-colored']],
      ['天蓝', 'sky blue', ['天蓝色', '浅蓝色'], ['light blue']],
      ['深蓝', 'deep blue', ['深蓝色'], ['dark blue']],
      ['红色', 'red', ['红', '大红色'], ['crimson']],
      ['酒红', 'burgundy', ['酒红色', '勃艮第红'], ['wine red', 'maroon']],
      ['正红', 'bright red', ['鲜红', '正红色'], ['vivid red']],
      ['粉色', 'pink', ['粉', '粉红'], ['rose pink']],
      ['浅粉', 'light pink', ['淡粉色'], ['pale pink']],
      ['玫瑰粉', 'rose pink', ['玫瑰色'], ['dusty rose']],
      ['紫色', 'purple', ['紫', '紫罗兰色'], ['violet']],
      ['薰衣草紫', 'lavender', ['薰衣草色'], ['lavender purple']],
      ['绿色', 'green', ['绿', '绿色调'], ['emerald green']],
      ['墨绿', 'dark green', ['墨绿色'], ['deep green']],
      ['橄榄绿', 'olive green', ['橄榄色'], ['olive']],
      ['薄荷绿', 'mint green', ['薄荷色'], ['mint']],
      ['黄色', 'yellow', ['黄', '黄色调'], ['golden yellow']],
      ['芥末黄', 'mustard yellow', ['芥末色'], ['mustard']],
      ['橙色', 'orange', ['橘色', '橙'], ['tangerine']],
      ['暖黄色', 'warm yellow', ['暖黄', '暖黄色调'], ['warm golden yellow']],
      ['棕色', 'brown', ['棕', '褐色'], ['brunette brown']],
      ['咖啡色', 'coffee brown', ['咖啡棕', '深棕色'], ['mocha brown']],
      ['卡其色', 'khaki', ['卡其'], ['khaki tan']],
      ['驼色', 'camel', ['驼色系'], ['camel brown']],
      ['多彩色', 'colorful', ['缤纷', '多彩'], ['multicolored', 'vibrant colors']],
      ['马卡龙色', 'pastel colors', ['马卡龙色系', '淡彩色'], ['pastel palette']],
      ['单色', 'monochrome', ['同色系'], ['monochromatic']],
      ['深色', 'dark tones', ['深色调'], ['dark colors']],
      ['浅色', 'light tones', ['浅色调'], ['light colors']]
    ],

    pose: [
      ['站着', 'standing', ['站立', '站姿', '站着不动'], ['stood', 'stand']],
      ['坐着', 'sitting', ['坐姿', '坐着休息'], ['seated', 'sit']],
      ['坐在椅子上', 'sitting on a chair', ['坐在凳子上', '坐在椅子里'], ['seated on a chair']],
      ['躺着', 'lying down', ['躺卧', '平躺'], ['lying', 'reclining']],
      ['躺在草地上', 'lying on the grass', ['躺在草坪上'], ['lying on grass']],
      ['靠在墙上', 'leaning against a wall', ['靠墙', '倚墙'], ['leaning on wall']],
      ['靠在栏杆上', 'leaning on a railing', ['倚着栏杆'], ['leaning on railings']],
      ['走在路上', 'walking down the street', ['走在街上', '街上行走'], ['walking on the street']],
      ['行走', 'walking', ['走路', '漫步', '步行'], ['strolling', 'walk']],
      ['奔跑', 'running', ['跑', '跑步'], ['run', 'sprinting']],
      ['跳跃', 'jumping', ['跳起', '腾空'], ['jump', 'leaping']],
      ['蹲着', 'crouching', ['蹲下', '蹲姿'], ['crouch', 'squatting']],
      ['跪着', 'kneeling', ['跪姿', '跪下'], ['kneel']],
      ['跳舞', 'dancing', ['舞蹈', '起舞'], ['dance', 'dancing pose']],
      ['转身', 'turning around', ['回身', '转过身'], ['turning back']],
      ['回头', 'looking back', ['回头看', '回过头'], ['glancing back', 'looking over shoulder']],
      ['回头看镜头', 'looking back at the camera', ['回眸看镜头', '回头看相机'], ['looking back at viewer']],
      ['回眸', 'looking back over the shoulder', ['回眸一笑', '回望'], ['looking over shoulder']],
      ['侧身回眸', 'looking back over the shoulder in profile', ['侧身回望'], ['side profile looking back']],
      ['晒太阳', 'sunbathing', ['晒阳光', '晒太阳取暖'], ['basking in the sun']],
      ['侧身', 'sideways', ['侧身站', '身体侧向'], ['side-on', 'turned sideways']],
      ['看向远处', 'looking into the distance', ['望向远方', '眺望远方', '看着远方'], ['gazing into the distance', 'looking afar']],
      ['低头', 'looking down', ['低着头', '垂下目光'], ['head down', 'gazing down']],
      ['抬头', 'looking up', ['仰头', '抬起头'], ['head up', 'gazing up']],
      ['双手插兜', 'hands in pockets', ['手插口袋', '双手插口袋'], ['hands in pockets']],
      ['双手抱胸', 'arms crossed', ['抱臂', '双臂交叉'], ['crossed arms']],
      ['叉腰', 'hands on hips', ['双手叉腰'], ['hand on hip', 'arms akimbo']],
      ['一只手叉腰', 'one hand on hip', ['单手叉腰'], ['hand on one hip']],
      ['拿着杯子', 'holding a cup', ['端着杯子', '手拿杯子'], ['holding a mug']],
      ['拿着咖啡杯', 'holding a coffee cup', ['端着咖啡杯', '手拿咖啡杯'], ['holding a coffee mug']],
      ['拿着书', 'holding a book', ['抱着书', '手捧书'], ['holding books']],
      ['拿着伞', 'holding an umbrella', ['撑着伞', '打着伞'], ['holding umbrella', 'with umbrella']],
      ['拿着花', 'holding flowers', ['捧着花', '手拿花束'], ['holding a bouquet']],
      ['托腮', 'resting chin on hand', ['手托腮', '托着下巴'], ['chin resting on hand']],
      ['摸头发', 'touching hair', ['撩头发', '拨弄头发'], ['hand in hair']],
      ['整理衣领', 'adjusting collar', ['整理领口'], ['fixing collar']],
      ['扶帽檐', 'adjusting hat', ['按着帽子', '扶帽'], ['touching hat brim']],
      ['伸手', 'reaching out', ['伸出手', '伸手向前'], ['outstretched hand']],
      ['挥手', 'waving', ['招手', '挥手致意'], ['waving hand']],
      ['靠在窗边', 'leaning by the window', ['倚窗', '靠窗'], ['leaning against window']],
      ['坐在窗边', 'sitting by the window', ['坐窗边'], ['seated by the window']],
      ['站在窗边', 'standing by the window', ['站窗边'], ['standing at the window']],
      ['骑自行车', 'riding a bicycle', ['骑车', '骑单车'], ['riding a bike']],
      ['看书', 'reading', ['阅读', '读书'], ['reading a book']],
      ['喝咖啡', 'drinking coffee', ['品尝咖啡'], ['sipping coffee']],
      ['弹吉他', 'playing guitar', ['弹琴'], ['playing the guitar']],
      ['手握长剑', 'holding a longsword', ['手握剑', '持剑'], ['holding a sword']],
      ['撑着雨伞', 'holding an umbrella', ['撑伞', '打着雨伞'], ['holding umbrella']],
      ['拍照', 'taking a photo', ['拍照片', '拍摄照片'], ['taking pictures']],
      ['回头微笑', 'looking back with a smile', ['回眸一笑'], ['smiling over shoulder']],
      ['凝视镜头', 'gazing at viewer', ['凝望镜头'], ['eye contact']],
      ['半身姿态', 'half-body pose', ['半身姿态'], ['half-body pose']],
      ['全身姿态', 'full-body pose', ['全身姿态'], ['full-body pose']]
    ],

    scene: [
      ['街边', 'street', ['街头', '街道', '街上'], ['street side', 'roadside']],
      ['路边', 'roadside', ['路旁', '道边'], ['side of the road']],
      ['城市街道', 'city street', ['城市街头'], ['urban street']],
      ['老街道', 'old street', ['老街', '老街巷'], ['old town street']],
      ['小巷', 'alley', ['巷子', '胡同', '弄堂'], ['alleyway', 'lane']],
      ['屋顶', 'rooftop', ['楼顶', '天台'], ['roof top', 'rooftops']],
      ['天台', 'rooftop terrace', ['露台'], ['terrace']],
      ['咖啡馆', 'cafe', ['咖啡店', '咖啡厅'], ['coffee shop', 'café']],
      ['餐厅', 'restaurant', ['饭馆', '饭店'], ['restaurants', 'dining room']],
      ['酒吧', 'bar', ['酒馆', '小酒馆'], ['pub', 'tavern']],
      ['图书馆', 'library', ['图书室'], ['libraries']],
      ['书店', 'bookstore', ['书吧'], ['bookshop']],
      ['卧室', 'bedroom', ['房间', '睡房'], ['bed room']],
      ['客厅', 'living room', ['起居室'], ['lounge']],
      ['厨房', 'kitchen', ['厨房里'], ['kitchens']],
      ['浴室', 'bathroom', ['卫生间'], ['bath room']],
      ['办公室', 'office', ['写字楼', '办公区'], ['office interior']],
      ['教室', 'classroom', ['课室'], ['class room']],
      ['酒店房间', 'hotel room', ['酒店客房'], ['hotel suite']],
      ['火车站', 'train station', ['车站', '月台'], ['railway station', 'platform']],
      ['地铁站', 'subway station', ['地铁'], ['metro station', 'underground station']],
      ['机场', 'airport', ['航站楼'], ['airport terminal']],
      ['公交站', 'bus stop', ['公交车站'], ['bus station']],
      ['汽车内', 'car interior', ['车内', '车里'], ['inside a car']],
      ['花园', 'garden', ['庭院', '院子'], ['gardens', 'courtyard']],
      ['公园', 'park', ['城市公园'], ['parks']],
      ['森林', 'forest', ['树林', '林中'], ['woods', 'woodland']],
      ['竹林', 'bamboo forest', ['竹海'], ['bamboo grove']],
      ['海滩', 'beach', ['沙滩', '海滨'], ['beaches', 'sandy beach']],
      ['海边', 'seaside', ['海岸', '海畔'], ['coast', 'seashore']],
      ['海洋', 'ocean', ['大海', '海面'], ['sea', 'open water']],
      ['湖边', 'lakeside', ['湖畔', '湖岸'], ['lake shore']],
      ['河边', 'riverside', ['河畔', '河岸'], ['river bank']],
      ['山谷', 'valley', ['峡谷'], ['valleys', 'canyon']],
      ['山顶', 'mountain top', ['山峰', '山巅'], ['summit', 'mountain peak']],
      ['雪山', 'snow-capped mountains', ['雪山山脉'], ['snowy mountains']],
      ['沙漠', 'desert', ['沙丘'], ['deserts', 'dunes']],
      ['草原', 'grassland', ['草地', '大草原'], ['prairie', 'meadow']],
      ['田野', 'field', ['农田', '田野间'], ['fields', 'farmland']],
      ['花田', 'flower field', ['花海'], ['flower fields']],
      ['薰衣草田', 'lavender field', ['薰衣草花田'], ['lavender fields']],
      ['乡村', 'countryside', ['农村', '乡下'], ['rural area', 'village countryside']],
      ['村庄', 'village', ['村落'], ['villages', 'hamlet']],
      ['古镇', 'ancient town', ['古城', '古镇街道'], ['old town']],
      ['城堡', 'castle', ['古堡'], ['castles', 'fortress']],
      ['废墟', 'ruins', ['遗迹', '废墟场景'], ['ruined place', 'ruin']],
      ['寺庙', 'temple', ['寺院', '庙宇'], ['temples']],
      ['神社', 'shrine', ['神道神社'], ['shrines']],
      ['教堂', 'church', ['大教堂'], ['cathedral', 'chapel']],
      ['博物馆', 'museum', ['展馆'], ['museums']],
      ['美术馆', 'art gallery', ['画廊'], ['gallery']],
      ['摄影棚', 'photo studio', ['影棚', '工作室'], ['studio', 'photo studio background']],
      ['舞台', 'stage', ['舞台上'], ['performance stage']],
      ['桥', 'bridge', ['桥上', '大桥'], ['bridges']],
      ['码头', 'pier', ['栈桥'], ['pier dock', 'dock']],
      ['港口', 'harbor', ['海港'], ['harbour', 'port']],
      ['灯塔', 'lighthouse', ['灯塔边'], ['lighthouses']],
      ['摩天大楼', 'skyscraper', ['高楼大厦', '摩天楼'], ['skyscrapers', 'high-rise']],
      ['霓虹街道', 'neon-lit street', ['霓虹街', '霓虹灯街道'], ['neon street']],
      ['雨夜街道', 'rainy street at night', ['雨夜街头'], ['rainy night street']],
      ['雨夜霓虹街道', 'rainy neon-lit street at night', ['雨夜霓虹街头'], ['neon-lit rainy street']],
      ['木地板', 'wooden floor', ['木质地板'], ['wood floor', 'wooden flooring']],
      ['公园长椅', 'park bench', ['长椅', '公园长凳'], ['park bench seat']],
      ['落叶', 'fallen leaves', ['秋叶', '落叶满地'], ['autumn leaves']],
      ['赛博朋克城市', 'cyberpunk city', ['赛博城市'], ['cyberpunk metropolis']],
      ['未来城市', 'futuristic city', ['未来都市'], ['futuristic metropolis']],
      ['太空站', 'space station', ['空间站'], ['space stations']],
      ['外星星球', 'alien planet', ['外星世界'], ['alien world']],
      ['奇幻风景', 'fantasy landscape', ['奇幻场景'], ['fantasy scenery']],
      ['室内', 'indoor', ['室内场景', '屋里'], ['indoors', 'interior']],
      ['室外', 'outdoor', ['户外', '室外场景'], ['outdoors', 'open air']],
      ['纯色背景', 'solid background', ['纯色底'], ['plain background']],
      ['白色背景', 'white background', ['白底'], ['white backdrop']],
      ['黑色背景', 'black background', ['黑底'], ['black backdrop']],
      ['深色背景', 'dark background', ['暗色背景'], ['dark backdrop']],
      ['浅色背景', 'light background', ['亮色背景'], ['light backdrop']],
      ['渐变背景', 'gradient background', ['渐变底色'], ['gradient backdrop']],
      ['背景虚化', 'blurred background', ['虚化背景', '背景模糊'], ['background blur', 'bokeh background']],
      ['壁炉', 'fireplace', ['壁炉边'], ['fireplaces', 'hearth']],
      ['壁炉旁', 'by the fireplace', ['壁炉旁边', '炉火旁'], ['beside the fireplace']],
      ['窗边', 'by the window', ['窗户边', '窗旁'], ['near the window', 'window side']],
      ['墙边', 'by the wall', ['墙壁边'], ['against the wall']],
      ['门口', 'doorway', ['门口处', '门前'], ['doorway entrance']],
      ['楼梯', 'staircase', ['楼梯间'], ['stairs', 'stairway']],
      ['阳台', 'balcony', ['露台边'], ['balconies']],
      ['海边栈道', 'seaside boardwalk', ['海滨栈道'], ['boardwalk']],
      ['雨中', 'in the rain', ['雨里', '下雨的街头'], ['rainy scene']],
      ['雪地', 'snowfield', ['雪原', '雪地里'], ['snowy ground']],
      ['雪山之巅', 'snow-capped mountain summit', ['雪山山顶', '雪山巅峰'], ['snowy mountain peak']],
      ['湿漉漉的地面', 'wet ground', ['潮湿地面', '地面潮湿'], ['wet pavement']],
      ['湿漉漉的地面反光', 'reflections on the wet ground', ['湿地面反光', '地面积水反光'], ['wet ground reflections']],
      ['地面反光', 'reflections on the ground', ['地面倒影'], ['ground reflections']],
      ['森林小径', 'forest path', ['林间小路'], ['forest trail']],
      ['湖边小屋', 'lakeside cabin', ['湖畔小屋'], ['lake house']],
      ['城市夜景', 'city night view', ['城市夜晚'], ['city at night']],
      ['城市灯光', 'city lights', ['都市灯光', '城市灯火'], ['city light', 'city lights at night']],
      ['天际线', 'skyline', ['城市天际线'], ['city skyline']]
    ],

    time: [
      ['清晨', 'early morning', ['早晨', '早上'], ['morning']],
      ['黎明', 'dawn', ['破晓', '天刚亮'], ['daybreak', 'first light']],
      ['日出', 'sunrise', ['朝阳', '日出时分'], ['sun rise']],
      ['正午', 'noon', ['中午', '晌午'], ['midday']],
      ['下午', 'afternoon', ['午后'], ['late afternoon']],
      ['黄昏', 'dusk', ['傍晚', '傍晚时分', '日暮'], ['evening', 'twilight']],
      ['日落', 'sunset', ['夕阳时分', '落日'], ['sundown', 'setting sun']],
      ['夜晚', 'night', ['晚上', '夜里'], ['nighttime', 'at night']],
      ['雨夜', 'rainy night', ['下雨的夜晚'], ['wet night']],
      ['深夜', 'late night', ['半夜', '夜深'], ['deep night']],
      ['午夜', 'midnight', ['零点'], ['midnight hour']],
      ['黄金时刻', 'golden hour', ['黄金时段'], ['golden light hour']],
      ['蓝调时刻', 'blue hour', ['蓝调时间'], ['blue hour light']],
      ['春天', 'spring', ['春季'], ['springtime']],
      ['夏天', 'summer', ['夏季'], ['summertime']],
      ['秋天', 'autumn', ['秋季'], ['fall']],
      ['冬天', 'winter', ['冬季'], ['wintertime']]
    ],

    weather: [
      ['晴天', 'sunny', ['晴朗', '大晴天'], ['clear sky', 'sunny day']],
      ['多云', 'cloudy', ['多云天'], ['partly cloudy']],
      ['阴天', 'overcast', ['阴云', '阴沉'], ['overcast sky', 'grey sky']],
      ['下雨', 'rainy', ['雨天', '下雨天'], ['raining', 'rain']],
      ['小雨', 'light rain', ['细雨', '毛毛雨'], ['drizzle', 'drizzling']],
      ['暴雨', 'heavy rain', ['大雨', '倾盆大雨'], ['downpour', 'pouring rain']],
      ['雨后', 'after rain', ['雨过天晴', '雨后地面'], ['wet ground', 'post-rain']],
      ['下雪', 'snowy', ['下雪天', '雪天'], ['snowing', 'snow']],
      ['大雪', 'heavy snow', ['鹅毛大雪'], ['snowfall']],
      ['雾', 'fog', ['雾气'], ['misty fog']],
      ['薄雾', 'mist', ['轻雾'], ['haze', 'light fog']],
      ['雾天', 'foggy', ['大雾'], ['foggy weather']],
      ['刮风', 'windy', ['大风', '有风'], ['strong wind', 'wind']],
      ['暴风雨', 'storm', ['雷暴', '风暴'], ['thunderstorm', 'tempest']]
    ],

    light: [
      ['柔和自然光', 'soft natural light', ['自然柔光', '柔和的自然光'], ['gentle natural light']],
      ['自然光', 'natural light', ['环境自然光'], ['daylight']],
      ['柔光', 'soft light', ['柔和光', '柔光照明'], ['diffused light']],
      ['硬光', 'hard light', ['强烈光线'], ['harsh light']],
      ['窗光', 'window light', ['窗户光', '窗边光'], ['light from window']],
      ['柔和窗光', 'soft window light', ['温柔窗光', '柔和窗户光'], ['soft window lighting']],
      ['暖色窗光', 'warm window light', ['暖窗光', '温暖窗光'], ['warm window lighting']],
      ['暖色烛光', 'warm candlelight', ['温暖烛光', '暖烛光'], ['warm candle light']],
      ['午后阳光', 'afternoon sunlight', ['午后日光', '下午阳光'], ['afternoon sun']],
      ['逆光', 'backlight', ['背光', '逆光拍摄'], ['back light', 'backlit']],
      ['侧光', 'side light', ['侧面光'], ['side lighting', 'sidelight']],
      ['顶光', 'top light', ['顶部光'], ['overhead light']],
      ['暖光', 'warm light', ['暖色光', '暖色调光'], ['warm lighting']],
      ['冷光', 'cool light', ['冷色光', '冷色调光'], ['cool lighting']],
      ['金光', 'golden light', ['金色光线'], ['golden glow']],
      ['阳光', 'sunlight', ['日光', '太阳光'], ['sun light', 'sunshine']],
      ['晨光', 'morning light', ['早晨光线'], ['dawn light']],
      ['夕阳', 'sunset light', ['夕阳余晖', '落日余晖'], ['sunset glow', 'golden sunset']],
      ['月光', 'moonlight', ['月色'], ['moon light']],
      ['烛光', 'candlelight', ['蜡烛光'], ['candle light']],
      ['霓虹光', 'neon light', ['霓虹灯', '霓虹灯光'], ['neon lighting', 'neon glow']],
      ['影棚光', 'studio lighting', ['棚拍灯光', '影棚灯光'], ['studio light']],
      ['柔光箱', 'softbox lighting', ['柔光箱光'], ['soft box lighting']],
      ['电影光', 'cinematic lighting', ['电影感光线'], ['cinematic light']],
      ['戏剧性光', 'dramatic lighting', ['戏剧光'], ['dramatic light']],
      ['高调光', 'high-key lighting', ['高调照明'], ['high key lighting']],
      ['低调光', 'low-key lighting', ['低调照明'], ['low key lighting']],
      ['高对比', 'high contrast', ['高对比度', '强对比'], ['strong contrast']],
      ['低对比', 'low contrast', ['低对比度', '柔和对比'], ['soft contrast']],
      ['斑驳光影', 'dappled light', ['斑驳光', '树影斑驳'], ['dappled sunlight', 'dappled shadows']],
      ['丁达尔光', 'god rays', ['耶稣光', '光束'], ['crepuscular rays', 'sunbeams']],
      ['体积光', 'volumetric light', ['体积光照'], ['volumetric lighting']],
      ['镜头光晕', 'lens flare', ['光晕', '眩光'], ['lens flares', 'flare']],
      ['光斑', 'bokeh', ['散景', '焦外光斑'], ['bokeh lights']],
      ['柔和阴影', 'soft shadows', ['柔影'], ['gentle shadows']],
      ['硬阴影', 'hard shadows', ['强烈阴影'], ['harsh shadows']],
      ['明暗对比', 'chiaroscuro', ['明暗交界', '光影对比'], ['light and shadow contrast']],
      ['环境光', 'ambient light', ['环境照明'], ['ambient lighting']],
      ['荧光灯', 'fluorescent lighting', ['日光灯'], ['fluorescent light']],
      ['路灯', 'streetlight', ['路灯光', '街灯'], ['street lamp', 'street lighting']],
      ['反射光', 'reflected light', ['反光'], ['bounced light']],
      ['轮廓光', 'rim light', ['边缘光', '发丝光'], ['rim lighting', 'edge light']],
      ['补光', 'fill light', ['辅助光'], ['fill lighting']],
      ['氛围光', 'ambient glow', ['环境氛围光'], ['atmospheric glow']],
      ['暖色光', 'warm-toned light', ['暖调光'], ['warm toned lighting']],
      ['冷色光', 'cool-toned light', ['冷调光'], ['cool toned lighting']],
      ['低调氛围光', 'low-key ambient light', ['暗调环境光'], ['low key ambient lighting']]
    ],

    camera: [
      ['50mm', '50mm', ['50毫米', '50mm镜头'], ['50 mm', '50mm lens']],
      ['35mm', '35mm', ['35毫米', '35mm镜头'], ['35 mm', '35mm lens']],
      ['85mm', '85mm', ['85毫米', '85mm镜头'], ['85 mm', '85mm lens']],
      ['24mm', '24mm', ['24毫米', '24mm镜头'], ['24 mm', '24mm lens']],
      ['135mm', '135mm', ['135毫米', '135mm镜头'], ['135 mm']],
      ['广角', 'wide-angle lens', ['广角镜头', '超广角'], ['wide angle', 'wide angle lens']],
      ['长焦', 'telephoto lens', ['长焦镜头'], ['telephoto', 'tele lens']],
      ['微距', 'macro lens', ['微距镜头'], ['macro photography']],
      ['鱼眼', 'fisheye lens', ['鱼眼镜头'], ['fisheye']],
      ['大光圈', 'wide aperture', ['大光圈镜头'], ['fast aperture']],
      ['浅景深', 'shallow depth of field', ['景深浅', '背景虚化景深'], ['shallow dof', 'narrow depth of field']],
      ['深景深', 'deep depth of field', ['景深深'], ['deep dof']],
      ['f/1.8', 'f/1.8', ['光圈1.8'], ['f1.8', 'f 1.8']],
      ['f/2.8', 'f/2.8', ['光圈2.8'], ['f2.8', 'f 2.8']],
      ['f/8', 'f/8', ['光圈8'], ['f8', 'f 8']],
      ['全身照', 'full body shot', ['全身镜头', '全身像', '全身'], ['full-body shot', 'full length shot']],
      ['半身照', 'half-body shot', ['半身镜头', '半身'], ['half body shot', 'waist-up shot']],
      ['上半身', 'upper body shot', ['上半身特写'], ['upper body']],
      ['特写', 'close-up', ['近景', '特写镜头'], ['close up', 'closeup']],
      ['大特写', 'extreme close-up', ['极近特写'], ['extreme closeup']],
      ['中景', 'medium shot', ['中景镜头'], ['medium-shot']],
      ['广角镜头', 'wide shot', ['广角全景'], ['wide-angle shot']],
      ['低角度', 'low angle', ['低机位', '仰拍'], ['low-angle', 'from below']],
      ['高角度', 'high angle', ['高机位', '俯拍'], ['high-angle', 'from above']],
      ['平视', 'eye level', ['平视角度', '水平视角'], ['eye-level', 'eye level shot']],
      ['俯拍', 'high-angle shot', ['俯视', '鸟瞰'], ['overhead shot', 'top-down shot']],
      ['鸟瞰', 'bird\'s-eye view', ['鸟瞰视角', '上帝视角'], ['birds eye view', 'aerial view']],
      ['仰拍', 'low-angle shot', ['仰视'], ['looking up shot']],
      ['荷兰角', 'Dutch angle', ['倾斜构图', '斜角镜头'], ['dutch tilt', 'canted angle']],
      ['过肩镜头', 'over-the-shoulder shot', ['过肩拍'], ['over the shoulder shot']],
      ['三分法', 'rule of thirds', ['三分构图'], ['rule-of-thirds']],
      ['中心构图', 'centered composition', ['居中构图'], ['center composition']],
      ['对称构图', 'symmetrical composition', ['对称式构图'], ['symmetry composition']],
      ['留白', 'negative space', ['空白构图'], ['negative-space']],
      ['竖构图', 'portrait orientation', ['竖幅', '竖屏'], ['vertical composition']],
      ['横构图', 'landscape orientation', ['横幅', '横屏'], ['horizontal composition']],
      ['电影构图', 'cinematic framing', ['电影式构图'], ['cinematic composition']],
      ['电影剧照', 'film still', ['电影截图', '剧照'], ['movie still']],
      ['单反', 'DSLR', ['单反相机'], ['dslr camera']],
      ['微单', 'mirrorless camera', ['无反相机'], ['mirrorless']],
      ['胶片相机', 'film camera', ['胶卷相机'], ['analog camera']],
      ['徕卡', 'Leica', ['徕卡相机'], ['leica camera']],
      ['哈苏', 'Hasselblad', ['哈苏相机'], ['hasselblad camera']],
      ['35mm胶片', '35mm film', ['35毫米胶片'], ['35 mm film']],
      ['正面', 'front view', ['正面视角', '正脸'], ['frontal view', 'front-facing']],
      ['低角度仰拍', 'low-angle shot', ['仰角拍摄', '低机位仰拍'], ['low angle shot']],
      ['镜头', 'lens', ['相机镜头'], ['camera lens']]
    ],

    style: [
      ['真实摄影', 'realistic photography', ['写实摄影', '真实照片'], ['realistic photo', 'photorealistic photography']],
      ['照片级', 'photorealistic', ['照片级真实', '超真实照片'], ['photo-realistic']],
      ['电影感', 'cinematic', ['电影氛围', '电影质感'], ['cinematic feel', 'movie-like']],
      ['电影质感', 'cinematic look', ['电影观感'], ['cinematic style']],
      ['胶片摄影', 'film photography', ['胶片风', '胶卷摄影'], ['analog photography']],
      ['胶片感', 'film look', ['胶卷感'], ['analog look']],
      ['日系胶片感', 'Japanese film look', ['日系胶片', '日系胶片风'], ['japanese film style']],
      ['日系', 'Japanese style', ['日式风格'], ['japanese aesthetic']],
      ['奇幻概念艺术', 'fantasy concept art', ['奇幻概念设计'], ['fantasy concept artwork']],
      ['电影摄影', 'cinematic photography', ['电影摄影感', '电影级摄影'], ['cinematic photo']],
      ['商业人像', 'commercial portrait photography', ['商业肖像', '商业人像摄影'], ['commercial portrait']],
      ['机能风', 'techwear style', ['机能风格', '机能穿搭'], ['techwear aesthetic']],
      ['摄影', 'photography', ['摄影艺术'], ['photographic']],
      ['虚化', 'blurred', ['模糊'], ['blurry']],
      ['胶片颗粒', 'film grain', ['颗粒感', '胶片噪点'], ['grain', 'analog grain']],
      ['时尚摄影', 'fashion photography', ['时尚大片'], ['fashion photo']],
      ['杂志大片', 'editorial photography', ['杂志摄影', '编辑大片'], ['editorial photo']],
      ['街头摄影', 'street photography', ['街拍'], ['street photo']],
      ['纪实摄影', 'documentary photography', ['纪实风'], ['documentary photo']],
      ['人像摄影', 'portrait photography', ['肖像摄影'], ['portrait photo']],
      ['影棚摄影', 'studio photography', ['棚拍'], ['studio photo']],
      ['自然主义', 'naturalistic', ['自然风格'], ['natural style']],
      ['超写实', 'hyperrealistic', ['超现实写实'], ['hyper realistic']],
      ['柔焦', 'soft focus', ['柔焦效果'], ['soft-focus']],
      ['柯达Portra 400', 'Kodak Portra 400', ['柯达Portra', 'Portra 400'], ['kodak portra']],
      ['富士胶片', 'Fujifilm', ['富士', '富士色彩'], ['fuji film', 'fujifilm look']],
      ['黑白', 'black and white', ['黑白摄影', '黑白照片'], ['b&w', 'monochrome photography']],
      ['彩色', 'color', ['全彩'], ['colour', 'colorful']],
      ['电影调色', 'color grading', ['电影色调', '调色'], ['cinematic color grading']],
      ['青橙色调', 'teal and orange', ['青橙调色', '橙青色调'], ['orange and teal']],
      ['低饱和', 'muted colors', ['低饱和度', '莫兰迪色'], ['desaturated', 'muted palette']],
      ['高饱和', 'high saturation', ['高饱和度', '鲜艳色彩'], ['saturated colors', 'vibrant colors']],
      ['复古', 'vintage', ['怀旧', '复古风'], ['retro']],
      ['90年代', '1990s', ['九十年代', '90s'], ['1990s style', 'nineties']],
      ['千禧风', 'Y2K', ['千禧年风格', 'Y2K风'], ['y2k aesthetic']],
      ['赛博朋克', 'cyberpunk', ['赛博朋克风'], ['cyber punk']],
      ['蒸汽朋克', 'steampunk', ['蒸汽朋克风'], ['steam punk']],
      ['奇幻', 'fantasy', ['奇幻风'], ['fantasy art']],
      ['暗黑奇幻', 'dark fantasy', ['黑暗奇幻'], ['gothic fantasy']],
      ['动漫', 'anime', ['二次元', '动画风'], ['anime style', 'manga']],
      ['插画', 'illustration', ['插画风'], ['illustrated']],
      ['水彩', 'watercolor', ['水彩画'], ['watercolour']],
      ['油画', 'oil painting', ['油画风'], ['oil on canvas']],
      ['油画质感', 'oil painting texture', ['油画笔触', '厚涂质感'], ['painterly texture']],
      ['3D渲染', '3D render', ['三维渲染', '3D渲染图'], ['3d rendering', 'cgi render']],
      ['CGI', 'CGI', ['电脑CG'], ['computer graphics']],
      ['概念艺术', 'concept art', ['概念设计', '概念图'], ['concept artwork']],
      ['数字绘画', 'digital painting', ['数字画', '板绘'], ['digital art']],
      ['低多边形', 'low poly', ['低模', '低多边形风'], ['lowpoly']],
      ['像素风', 'pixel art', ['像素画'], ['pixelated art']],
      ['极简', 'minimalism', ['极简主义', '极简风'], ['minimalist']],
      ['超现实', 'surrealism', ['超现实主义'], ['surreal']],
      ['巴洛克', 'baroque', ['巴洛克风'], ['baroque style']],
      ['文艺复兴', 'Renaissance', ['文艺复兴风'], ['renaissance style']],
      ['印象派', 'impressionism', ['印象派风格'], ['impressionist']],
      ['浮世绘', 'ukiyo-e', ['浮世绘风格'], ['ukiyoe']],
      ['中国水墨', 'Chinese ink painting', ['水墨画', '国画'], ['chinese ink wash', 'ink painting']],
      ['黏土动画', 'claymation', ['黏土风格'], ['clay animation']],
      ['梦幻', 'dreamy', ['梦幻感'], ['dreamlike']],
      ['情绪感', 'moody', ['情绪氛围', '氛围感'], ['moody atmosphere']],
      ['粗粝', 'gritty', ['粗粝质感', '颗粒质感'], ['gritty texture']],
      ['光泽感', 'glossy', ['亮面质感'], ['gloss finish']],
      ['哑光质感', 'matte texture', ['磨砂质感'], ['matte finish']],
      ['优雅', 'elegant', ['优雅风'], ['elegance']],
      ['高级感', 'high-end', ['奢华感', '高级质感'], ['luxury', 'premium feel']],
      ['氛围感', 'atmospheric', ['氛围', '氛围感强'], ['atmosphere']],
      ['自然', 'natural', ['自然感'], ['naturalistic look']],
      ['情绪化', 'emotional', ['有情绪'], ['emotional tone']],
      ['粗颗粒', 'coarse grain', ['粗颗粒感'], ['heavy grain']]
    ],

    quality: [
      ['高细节', 'highly detailed', ['细节丰富', '大量细节'], ['lots of detail', 'intricate detail']],
      ['最佳质量', 'best quality', ['最高质量', '高质量'], ['high quality']],
      ['清晰对焦', 'sharp focus', ['对焦清晰', '锐利对焦'], ['in focus', 'sharp details']],
      ['专业摄影', 'professional photography', ['专业照片', '专业拍摄'], ['professional photo']],
      ['高分辨率', 'high resolution', ['高清', '高清晰度'], ['high-res']],
      ['复杂细节', 'intricate details', ['精细细节'], ['fine details']],
      ['良好光照', 'well-lit', ['光线充足'], ['well lit']],
      ['真实纹理', 'realistic textures', ['真实材质'], ['real texture']],
      ['电影级细节', 'cinematic detail', ['电影细节'], ['movie detail']],
      ['柔和', 'soft', ['轻柔'], ['gentle']]
    ],

    negative: [
      ['畸形', 'deformed', ['变形', '畸形扭曲'], ['deformity']],
      ['解剖错误', 'bad anatomy', ['人体结构错误', '错误解剖'], ['wrong anatomy']],
      ['多余肢体', 'extra limbs', ['多出的肢体', '多余的手脚'], ['additional limbs']],
      ['缺失肢体', 'missing limbs', ['缺少肢体'], ['limb missing']],
      ['多余手指', 'extra fingers', ['多指', '手指过多'], ['additional fingers']],
      ['手指粘连', 'fused fingers', ['连指', '手指融合'], ['fingers fused']],
      ['手部畸形', 'malformed hands', ['坏手', '手部崩坏'], ['bad hands', 'deformed hands']],
      ['变异的手', 'mutated hands', ['突变手'], ['mutated hand']],
      ['面目扭曲', 'disfigured', ['面部扭曲', '脸崩'], ['distorted face']],
      ['模糊', 'blurry', ['画面模糊', '不清楚'], ['blur']],
      ['失焦', 'out of focus', ['焦点错误', '未对焦'], ['unfocused']],
      ['低质量', 'low quality', ['低画质'], ['poor quality']],
      ['最差质量', 'worst quality', ['质量最差'], ['bad quality']],
      ['JPEG压缩痕迹', 'jpeg artifacts', ['压缩噪点', 'JPEG伪影'], ['jpeg artifact']],
      ['水印', 'watermark', ['带水印'], ['watermarks']],
      ['文字', 'text', ['乱码文字', '字幕'], ['words', 'lettering']],
      ['签名', 'signature', ['作者签名'], ['signatures']],
      ['标志', 'logo', ['商标'], ['logos']],
      ['过饱和', 'oversaturated', ['颜色过艳'], ['over saturation']],
      ['过曝', 'overexposed', ['曝光过度'], ['over exposed']],
      ['欠曝', 'underexposed', ['曝光不足'], ['under exposed']],
      ['平淡光照', 'flat lighting', ['平光', '光线平淡'], ['flat light']],
      ['透视畸变', 'distorted perspective', ['透视错误'], ['warped perspective']],
      ['面部畸变', 'warped face', ['脸歪', '面部变形'], ['face distortion']],
      ['双眼不对称', 'asymmetric eyes', ['眼睛不对称'], ['asymmetrical eyes']],
      ['斗鸡眼', 'cross-eyed', ['斜视'], ['cross eyed']],
      ['长脖子', 'long neck', ['脖子过长'], ['elongated neck']],
      ['比例失调', 'bad proportions', ['比例错误', '身材比例差'], ['wrong proportions']],
      ['重复', 'duplicate', ['重复人物', '复制'], ['duplicated']],
      ['克隆脸', 'cloned face', ['同一张脸'], ['copy face']],
      ['面部绘制粗糙', 'poorly drawn face', ['脸部粗糙'], ['bad face']],
      ['塑料皮肤', 'plastic skin', ['假皮肤', '塑料感皮肤'], ['waxy skin']],
      ['磨皮过度', 'airbrushed skin', ['过度磨皮'], ['over-smoothed skin']],
      ['不自然皮肤', 'unnatural skin', ['皮肤不自然'], ['fake skin']],
      ['画面伪影', 'artifacts', ['伪影', '杂点'], ['visual artifacts']],
      ['噪点', 'noise', ['噪波', '画面噪点'], ['noisy']],
      ['裁切不当', 'cropped', ['被裁切', '裁切错误'], ['bad crop']],
      ['构图不佳', 'bad framing', ['构图错误'], ['poor framing']],
      ['运动模糊', 'motion blur', ['拖影'], ['blurred motion']]
    ],

    connector: [
      ['穿着', 'wearing', ['身穿', '穿了', '身着', '套着'], ['dressed in', 'in']],
      ['戴着', 'wearing', ['佩带', '佩戴', '系着'], ['with']],
      ['站在', 'standing at', ['立于'], ['standing by']],
      ['坐在', 'sitting at', ['坐于'], ['seated at']],
      ['背景是', 'background is', ['背景为', '身后是'], ['background']],
      ['光线是', 'lighting is', ['光线为'], ['lighting']],
      ['镜头是', 'camera is', ['镜头为'], ['shot with']],
      ['风格是', 'style is', ['风格为', '画风是'], ['style']]
    ]
  };

  // 第二轮扩充的人工词条。与上面的基础分组合并后，再按规则生成组合词条。
  const EXTRA_GROUPS = {
    subject: [
      ['亚洲女性', 'Asian woman', ['亚洲女人', '亚裔女性'], ['asian women']],
      ['欧洲女性', 'European woman', ['欧洲女人', '欧美女性的'], ['european women']],
      ['非洲女性', 'African woman', ['非洲女人'], ['african women']],
      ['拉丁裔女性', 'Latina woman', ['拉美女性'], ['latina women']],
      ['混血女性', 'mixed-race woman', ['混血儿', '混血美女'], ['mixed race woman']],
      ['成熟女性', 'mature woman', ['成熟女人', '熟女'], ['mature women']],
      ['青少年', 'teenager', ['青春期的少年', '青少年人'], ['teenagers', 'teen']],
      ['婴儿', 'baby', ['宝宝', '婴孩'], ['babies', 'infant']],
      ['大学生', 'college student', ['女大学生', '男大学生'], ['university student']],
      ['咖啡师', 'barista', ['咖啡店员'], ['baristas']],
      ['调酒师', 'bartender', ['酒保'], ['bartenders']],
      ['图书管理员', 'librarian', ['图书馆员'], ['librarians']],
      ['记者', 'journalist', ['新闻记者'], ['journalists', 'reporter']],
      ['科学家', 'scientist', ['科研人员'], ['scientists', 'researcher']],
      ['程序员', 'programmer', ['开发者', '码农'], ['programmers', 'developer']],
      ['工程师', 'engineer', ['技术人员'], ['engineers']],
      ['建筑师', 'architect', ['建筑设计师'], ['architects']],
      ['设计师', 'designer', ['服装设计师'], ['designers']],
      ['作家', 'writer', ['小说家', '作者'], ['writers', 'author']],
      ['演员', 'actor', ['女演员', '男演员'], ['actors', 'actress']],
      ['导演', 'film director', ['电影导演'], ['directors']],
      ['警察', 'police officer', ['警官', '女警'], ['police', 'cop']],
      ['消防员', 'firefighter', ['消防队员'], ['firefighters']],
      ['飞行员', 'pilot', ['机长'], ['pilots']],
      ['水手', 'sailor', ['船员'], ['sailors']],
      ['渔夫', 'fisherman', ['渔民'], ['fishermen']],
      ['农民', 'farmer', ['农夫'], ['farmers']],
      ['园丁', 'gardener', ['花匠'], ['gardeners']],
      ['面包师', 'baker', ['烘焙师'], ['bakers']],
      ['空乘', 'flight attendant', ['空姐', '空少'], ['flight attendants', 'stewardess']],
      ['服务员', 'waitress', ['女服务员', '服务生'], ['waiters', 'server']],
      ['矿工', 'miner', ['矿工工人'], ['miners']],
      ['猎人', 'hunter', ['猎手'], ['hunters']],
      ['女猎手', 'huntress', ['女猎人'], ['huntresses']],
      ['吟游诗人', 'bard', ['游吟诗人'], ['bards']],
      ['祭司', 'priestess', ['女祭司'], ['priestesses']],
      ['僧侣', 'monk', ['和尚'], ['monks']],
      ['圣骑士', 'paladin', ['圣武士'], ['paladins']],
      ['弓箭手', 'archer', ['弓手'], ['archers']],
      ['剑士', 'swordsman', ['剑客', '女剑士'], ['swordsmen', 'swordswoman']],
      ['国王', 'king', ['国王陛下'], ['kings']],
      ['女王', 'queen', ['女王陛下'], ['queens']],
      ['将军', 'general', ['女将军'], ['generals', 'commander']],
      ['刺客', 'assassin', ['暗杀者'], ['assassins']],
      ['盗贼', 'thief', ['小偷', '盗贼女'], ['thieves', 'rogue']],
      ['牧师', 'priest', ['神父'], ['priests', 'clergyman']],
      ['吸血鬼', 'vampire', ['吸血鬼伯爵'], ['vampires']],
      ['狼人', 'werewolf', ['狼人形态'], ['werewolves']],
      ['半兽人', 'orc', ['兽人'], ['orcs']],
      ['矮人', 'dwarf', ['矮人族'], ['dwarves']],
      ['巨人', 'giant', ['巨人族'], ['giants']],
      ['仙女', 'fairy', ['小仙女', '妖精'], ['fairies']],
      ['幽灵', 'ghost', ['鬼魂'], ['ghosts', 'spirit']],
      ['骷髅', 'skeleton', ['骷髅人'], ['skeletons']],
      ['丧尸', 'zombie', ['僵尸'], ['zombies']],
      ['外星人', 'alien', ['外星生物'], ['aliens']],
      ['虚拟偶像', 'virtual idol', ['虚拟歌手'], ['virtual idols']],
      ['人工智能', 'artificial intelligence', ['AI人物'], ['AI character']]
    ],

    appearance: [
      ['长脸', 'long face', ['长形脸'], ['long-faced']],
      ['高额头', 'high forehead', ['额头高'], ['tall forehead']],
      ['宽额头', 'broad forehead', ['额头宽'], ['wide forehead']],
      ['下颌线', 'sharp jawline', ['下颚线', '清晰下颌线'], ['defined jawline']],
      ['小巧五官', 'delicate features', ['五官小巧', '秀气五官'], ['fine features']],
      ['立体五官', 'sculpted features', ['五官立体', '深邃五官'], ['strong features']],
      ['清纯', 'fresh-faced', ['清纯感', '清纯气质'], ['innocent look']],
      ['冷艳', 'cool beauty', ['冷艳感', '高冷美'], ['cool and elegant']],
      ['明艳', 'striking beauty', ['明艳动人'], ['strikingly beautiful']],
      ['英气', 'androgynous charm', ['英气十足', '中性美'], ['charismatic androgyny']],
      ['梨形身材', 'pear-shaped figure', ['梨形身材比例'], ['pear figure']],
      ['沙漏身材', 'hourglass figure', ['沙漏型身材'], ['hourglass body']],
      ['宽肩', 'broad shoulders', ['肩膀宽'], ['wide shoulders']],
      ['窄肩', 'narrow shoulders', ['肩膀窄'], ['slim shoulders']],
      ['长颈', 'long neck', ['颈部修长', '天鹅颈'], ['slender neck']],
      ['修长手指', 'slender fingers', ['手指修长'], ['long fingers']],
      ['橄榄皮', 'olive skin', ['橄榄色皮肤'], ['olive complexion']],
      ['冷白皮', 'cool fair skin', ['冷白皮肤'], ['cool pale skin']],
      ['暖白皮', 'warm fair skin', ['暖白皮肤'], ['warm pale skin']],
      ['健康肤色', 'healthy glow', ['健康肤质'], ['healthy skin']],
      ['面部疤痕', 'facial scar', ['脸上有疤'], ['face scar']],
      ['纹身', 'tattoo', ['刺青', '纹身图案'], ['tattoos']],
      ['美人尖', 'widow\'s peak', ['发际线美人尖'], ['widows peak']],
      ['浓密胡须', 'thick beard', ['大胡子'], ['full beard']],
      ['胡茬', 'stubble', ['短胡须'], ['beard stubble']],
      ['八字胡', 'mustache', ['小胡子'], ['moustache']],
      ['山羊胡', 'goatee', ['山羊胡子'], ['goatees']],
      ['肌肉线条', 'muscle definition', ['肌肉轮廓', '肌肉线条明显'], ['defined muscles']],
      ['锁骨', 'collarbone', ['锁骨线条'], ['collarbones']],
      ['背部线条', 'back muscles', ['背部肌肉'], ['defined back']],
      ['高个子', 'tall person', ['个子高'], ['tall figure']],
      ['矮个子', 'short person', ['个子矮'], ['short figure']],
      ['偏瘦', 'very slim', ['很瘦', '瘦削'], ['skinny', 'slender']],
      ['健壮', 'burly', ['壮实', '体格健壮'], ['strong build']],
      ['中性风', 'androgynous', ['中性气质', '中性风格'], ['androgyny']]
    ],

    hair: [
      ['公主切', 'hime cut', ['公主切发型'], ['hime haircut']],
      ['狼尾发型', 'wolf cut', ['狼尾头', '狼尾剪'], ['wolf haircut']],
      ['鲻鱼头', 'mullet', ['鲻鱼发型'], ['mullet haircut']],
      ['层次剪', 'layered hair', ['层次发型', '层次感发型'], ['layers haircut']],
      ['碎发', 'textured hair', ['碎发造型'], ['choppy hair']],
      ['大背头', 'slicked-back hair', ['背头', '油头背头'], ['slick back hair']],
      ['油头', 'pompadour', ['飞机头'], ['pomp']],
      ['法式编发', 'French braid', ['法式辫子'], ['french braids']],
      ['鱼骨辫', 'fishtail braid', ['鱼骨编发'], ['fishtail braids']],
      ['荷兰辫', 'Dutch braid', ['荷兰编发'], ['dutch braids']],
      ['高盘发', 'high updo', ['高发髻'], ['high bun updo']],
      ['低盘发', 'low bun', ['低发髻'], ['low updo']],
      ['半扎发', 'half-up half-down', ['半扎发型', '半披发'], ['half up half down hair']],
      ['公主头', 'half-up hairstyle', ['公主头发型'], ['princess hairstyle']],
      ['双丸子头', 'double buns', ['双丸子发型', '哪吒头'], ['space buns']],
      ['双麻花辫', 'double braids', ['双辫子', '双麻花'], ['twin braids']],
      ['八字刘海', 'curtain bangs', ['八字刘海发型'], ['curtain fringe']],
      ['法式刘海', 'French bangs', ['法式空气刘海'], ['french fringe']],
      ['眉上刘海', 'micro bangs', ['短刘海', '眉上短刘海'], ['micro fringe']],
      ['短卷发', 'short curly hair', ['短卷发型'], ['short curls']],
      ['长卷发', 'long curly hair', ['长卷发型'], ['long curls']],
      ['蓬松卷发', 'voluminous curls', ['蓬松卷发造型'], ['big curls']],
      ['手推波纹', 'finger waves', ['手推波纹卷'], ['finger wave hair']],
      ['复古卷发', 'vintage curls', ['复古卷'], ['retro curls']],
      ['爆炸头', 'afro', ['爆炸发型'], ['afro hair']],
      ['脏辫', 'dreadlocks', ['脏辫发型'], ['dreads']],
      ['编发盘发', 'braided updo', ['编发发髻'], ['braided bun']],
      ['发髻', 'chignon', ['低发髻'], ['chignons']],
      ['侧分', 'side part', ['侧分头发', '偏分'], ['side parting']],
      ['中分', 'center part', ['中分头发', '中间分'], ['middle part']],
      ['发尾挑染', 'dip-dyed ends', ['发尾染'], ['dip dyed hair']],
      ['刘海编发', 'braided bangs', ['编刘海'], ['braided fringe']],
      ['高马尾卷发', 'high ponytail with curls', ['卷发高马尾'], ['curly high ponytail']],
      ['低发髻', 'low chignon', ['低盘发髻'], ['low bun chignon']]
    ],

    eyes: [
      ['狐狸眼', 'fox eyes', ['狐狸眼睛'], ['fox eye shape']],
      ['丹凤眼', 'phoenix eyes', ['丹凤眼睛'], ['phoenix eye shape']],
      ['下垂眼', 'droopy eyes', ['狗狗眼'], ['puppy eyes']],
      ['上挑眼', 'upturned eyes', ['上挑眼睛'], ['upturned eye shape']],
      ['圆眼', 'round eyes', ['圆圆的眼睛'], ['round eye shape']],
      ['细长眼', 'narrow eyes', ['细长眼睛'], ['slender eyes']],
      ['卧蚕', 'aegyo-sal', ['卧蚕眼'], ['under-eye fat']],
      ['泪痣', 'tear mole', ['眼旁泪痣'], ['teardrop mole']],
      ['浓密睫毛', 'dense eyelashes', ['浓密长睫毛'], ['thick lashes']],
      ['湿漉漉眼睛', 'watery eyes', ['水汪汪眼睛', '含泪眼睛'], ['teary eyes']],
      ['发光眼睛', 'glowing eyes', ['发光的眼睛'], ['luminous eyes']],
      ['红色眼睛', 'red eyes', ['红眼睛', '红瞳'], ['crimson eyes']],
      ['金色眼睛', 'golden eyes', ['金眼睛', '金瞳'], ['gold eyes']],
      ['紫色眼睛', 'purple eyes', ['紫眼睛', '紫瞳'], ['violet eyes']],
      ['银色眼睛', 'silver eyes', ['银眼睛', '银瞳'], ['silver-colored eyes']]
    ],

    expression: [
      ['羞涩', 'shy expression', ['害羞表情', '羞涩表情'], ['shy look']],
      ['脸红', 'blushing', ['脸颊泛红', '脸红害羞'], ['blush']],
      ['媚笑', 'alluring smile', ['妩媚微笑'], ['seductive smile']],
      ['冷笑', 'smirk', ['冷笑表情'], ['smirking']],
      ['苦笑', 'wry smile', ['无奈的笑'], ['bitter smile']],
      ['咬唇', 'biting lip', ['轻咬嘴唇'], ['lip bite']],
      ['惊讶张嘴', 'open-mouthed surprise', ['张嘴惊讶'], ['surprised open mouth']],
      ['愤怒瞪视', 'angry glare', ['生气瞪眼'], ['furious glare']],
      ['含泪', 'eyes brimming with tears', ['眼中含泪'], ['teary-eyed']],
      ['哭泣', 'crying', ['流泪', '哭'], ['tears']],
      ['眨眼', 'winking', ['单眼眨眼'], ['wink']],
      ['吐舌', 'tongue out', ['吐舌头'], ['blep']],
      ['嘟嘴', 'pouting', ['撅嘴'], ['pout']],
      ['认真', 'focused expression', ['专注表情', '认真表情'], ['focused look']],
      ['平静', 'calm expression', ['平静神情'], ['calm look']],
      ['神秘', 'mysterious expression', ['神秘笑容'], ['mysterious look']]
    ],

    makeup: [
      ['水光妆', 'dewy makeup', ['水光肌妆容'], ['dewy look']],
      ['雾面妆', 'matte makeup', ['雾面妆容'], ['matte look']],
      ['韩系妆容', 'Korean makeup', ['韩妆', '韩式妆容'], ['korean style makeup']],
      ['日系妆容', 'Japanese makeup', ['日妆', '日式妆容'], ['japanese style makeup']],
      ['欧美妆', 'Western glam makeup', ['欧美妆容', '欧美浓妆'], ['western makeup']],
      ['复古红唇', 'retro red lips', ['复古红唇妆'], ['vintage red lips']],
      ['豆沙色唇', 'mauve lips', ['豆沙唇', '豆沙色口红'], ['mauve lipstick']],
      ['咬唇妆', 'gradient lips', ['咬唇妆感'], ['gradient lip makeup']],
      ['卧蚕妆', 'aegyo-sal makeup', ['卧蚕妆容'], ['under-eye makeup']],
      ['截断式眼妆', 'cut crease eyeshadow', ['截断眼妆'], ['cut crease']],
      ['亮片眼妆', 'glitter eye makeup', ['亮片眼影'], ['glitter eyes']],
      ['蓝色眼影', 'blue eyeshadow', ['蓝眼影'], ['blue eye shadow']],
      ['紫色眼影', 'purple eyeshadow', ['紫眼影'], ['purple eye shadow']],
      ['大地色眼影', 'earth-tone eyeshadow', ['大地色眼妆'], ['neutral eyeshadow']],
      ['野生眉', 'fluffy brows', ['野生眉毛'], ['bushy eyebrows']],
      ['细眉', 'thin eyebrows', ['细眉毛'], ['thin brows']],
      ['假睫毛', 'false lashes', ['假睫毛妆'], ['fake eyelashes']],
      ['美瞳', 'colored contacts', ['彩色隐形眼镜'], ['color contacts']],
      ['高光修容', 'highlighter and contour', ['修容高光'], ['contouring and highlight']],
      ['晒伤妆', 'sunburn makeup', ['晒伤腮红'], ['sunburn blush']],
      ['雀斑妆', 'freckled makeup', ['雀斑妆容'], ['faux freckles']],
      ['猫眼眼线', 'cat-eye eyeliner', ['猫眼线'], ['cat eye liner']],
      ['红色眼影', 'red eyeshadow', ['红眼影'], ['red eye shadow']],
      ['金色眼影', 'gold eyeshadow', ['金眼影'], ['gold eye shadow']]
    ],

    outfit: [
      ['抹胸裙', 'strapless dress', ['抹胸连衣裙'], ['strapless gown']],
      ['一字肩连衣裙', 'off-shoulder dress', ['一字肩裙', '露肩连衣裙'], ['off shoulder dress']],
      ['泡泡袖连衣裙', 'puff-sleeve dress', ['泡泡袖裙'], ['puff sleeve dress']],
      ['衬衫裙', 'shirt dress', ['衬衫式连衣裙'], ['shirtdress']],
      ['针织连衣裙', 'knit dress', ['毛线连衣裙'], ['knitted dress']],
      ['毛衣裙', 'sweater dress', ['毛衣连衣裙'], ['sweater dresses']],
      ['皮裙', 'leather skirt', ['皮质半身裙'], ['leather skirts']],
      ['牛仔裙', 'denim skirt', ['丹宁裙'], ['denim skirts']],
      ['百褶短裙', 'pleated mini skirt', ['短款百褶裙'], ['pleated mini skirts']],
      ['A字裙', 'A-line skirt', ['A字半身裙', 'A形裙'], ['a line skirt']],
      ['包臀裙', 'pencil skirt', ['铅笔裙', '紧身裙'], ['pencil skirts']],
      ['伞裙', 'full skirt', ['大摆裙'], ['flared skirt']],
      ['鱼尾裙', 'mermaid skirt', ['鱼尾半身裙'], ['mermaid skirts']],
      ['工装裙', 'cargo skirt', ['工装半身裙'], ['cargo skirts']],
      ['骑行裤', 'biker shorts', ['单车裤'], ['cycling shorts']],
      ['西装短裤', 'tailored shorts', ['正装短裤'], ['dress shorts']],
      ['背带裙', 'pinafore dress', ['吊带背带裙'], ['pinafores']],
      ['连体裤', 'jumpsuit', ['连身裤', '连体衣'], ['jumpsuits']],
      ['呢子大衣', 'wool coat', ['羊毛大衣'], ['woolen coat']],
      ['派克大衣', 'parka', ['派克服'], ['parkas']],
      ['羊羔毛外套', 'shearling jacket', ['羊羔绒外套'], ['shearling coat']],
      ['飞行员夹克', 'bomber jacket', ['飞行夹克'], ['bomber jackets']],
      ['棒球服', 'varsity jacket', ['棒球夹克'], ['letterman jacket']],
      ['运动夹克', 'track jacket', ['运动外套'], ['sports jacket']],
      ['防晒服', 'sun-protection jacket', ['防晒衣'], ['sun jacket']],
      ['马甲', 'vest', ['背心马甲'], ['vests']],
      ['西装马甲', 'suit vest', ['西装背心'], ['waistcoat']],
      ['针织背心', 'knit vest', ['毛衣背心'], ['sweater vest']],
      ['法式衬衫', 'French shirt', ['法式衬衣'], ['french blouse']],
      ['古巴领衬衫', 'camp collar shirt', ['古巴衬衫'], ['camp shirt']],
      ['夏威夷衬衫', 'Hawaiian shirt', ['花衬衫'], ['hawaiian shirts']],
      ['牛仔衬衫', 'denim shirt', ['丹宁衬衫'], ['denim shirts']],
      ['格子衬衫', 'plaid shirt', ['格纹衬衫'], ['plaid shirts']],
      ['短袖衬衫', 'short-sleeve shirt', ['短袖衬衣'], ['short sleeve shirt']],
      ['长袖T恤', 'long-sleeve t-shirt', ['长袖T恤衫'], ['long sleeve tee']],
      ['印花T恤', 'graphic t-shirt', ['图案T恤'], ['graphic tee']],
      ['运动内衣', 'sports bra', ['运动文胸'], ['sports bras']],
      ['比基尼', 'bikini', ['比基尼泳装'], ['bikinis']],
      ['连体泳衣', 'one-piece swimsuit', ['连体泳装'], ['one piece swimsuit']],
      ['潜水服', 'wetsuit', ['潜水衣'], ['wetsuits', 'diving suit']],
      ['滑雪服', 'ski suit', ['滑雪装'], ['ski suits']],
      ['羽绒马甲', 'down vest', ['羽绒背心'], ['puffer vest']],
      ['皮裤', 'leather pants', ['皮长裤'], ['leather trousers']],
      ['阔腿牛仔裤', 'wide-leg jeans', ['阔腿牛仔'], ['wide leg jeans']],
      ['直筒牛仔裤', 'straight-leg jeans', ['直筒牛仔'], ['straight leg jeans']],
      ['紧身牛仔裤', 'skinny jeans', ['修身牛仔裤'], ['skinny jean']],
      ['喇叭裤', 'flared pants', ['喇叭长裤'], ['flare pants']],
      ['烟管裤', 'cigarette pants', ['烟管长裤'], ['cigarette trousers']],
      ['哈伦裤', 'harem pants', ['灯笼裤'], ['harem trousers']],
      ['运动裤', 'sweatpants', ['卫裤'], ['track pants']],
      ['瑜伽裤', 'yoga pants', ['瑜伽长裤'], ['yoga leggings']],
      ['工装短裤', 'cargo shorts', ['工装裤短款'], ['cargo short']],
      ['百慕大短裤', 'Bermuda shorts', ['百慕达短裤'], ['bermuda short']],
      ['JK制服', 'JK uniform', ['JK校服', '日式校服'], ['jk school uniform']],
      ['洛丽塔', 'Lolita dress', ['洛丽塔裙', 'Lolita裙'], ['lolita fashion']],
      ['女仆装', 'maid outfit', ['女仆服装'], ['maid dress']],
      ['护士服', 'nurse uniform', ['护士制服'], ['nurse dress']],
      ['空姐制服', 'flight attendant uniform', ['空乘制服'], ['stewardess uniform']],
      ['警服', 'police uniform', ['警察制服'], ['police uniforms']],
      ['消防服', 'firefighter suit', ['消防战斗服'], ['firefighter gear']],
      ['太空服', 'spacesuit', ['宇航服'], ['space suit']],
      ['防护服', 'hazmat suit', ['防化服'], ['hazmat suits']],
      ['和风浴衣', 'yukata', ['浴衣'], ['yukatas']],
      ['韩服', 'hanbok', ['朝鲜族服饰'], ['hanboks']],
      ['纱丽', 'sari', ['印度纱丽'], ['saree']],
      ['苏格兰裙', 'kilt', ['苏格兰短裙'], ['kilts']],
      ['Cosplay服装', 'cosplay costume', ['角色扮演服装'], ['cosplay outfit']],
      ['吊带背心', 'camisole', ['吊带衫'], ['camisoles']],
      ['抹胸', 'bandeau top', ['抹胸上衣'], ['bandeau']],
      ['高腰裤', 'high-waisted pants', ['高腰长裤'], ['high waist pants']],
      ['低腰裤', 'low-rise pants', ['低腰长裤'], ['low rise pants']],
      ['直筒裤', 'straight-leg pants', ['直筒长裤'], ['straight leg pants']],
      ['背带短裤', 'overall shorts', ['背带短裤装'], ['short overalls']],
      ['机车裤', 'moto pants', ['机车长裤'], ['motorcycle pants']],
      ['工装马甲', 'utility vest', ['机能马甲'], ['utility vests']],
      ['战术背心', 'tactical vest', ['战术马甲'], ['tactical vests']]
    ],

    accessory: [
      ['渔夫帽', 'bucket hat', ['渔夫帽子'], ['bucket hats']],
      ['牛仔帽', 'cowboy hat', ['西部牛仔帽'], ['cowboy hats']],
      ['钟形帽', 'cloche hat', ['钟形女帽'], ['cloche hats']],
      ['头巾', 'headscarf', ['包头巾'], ['headscarves']],
      ['发簪', 'hair stick', ['簪子', '发钗'], ['hair sticks']],
      ['发绳', 'hair tie', ['发圈'], ['hair ties']],
      ['腰包', 'waist bag', ['腰包袋'], ['waist bags', 'fanny pack']],
      ['公文包', 'briefcase', ['商务公文包'], ['briefcases']],
      ['钱包', 'wallet', ['皮夹'], ['wallets']],
      ['手拿包', 'clutch', ['手抓包'], ['clutches']],
      ['托特包', 'tote bag', ['托特手提包'], ['tote bags']],
      ['水桶包', 'bucket bag', ['水桶手提包'], ['bucket bags']],
      ['链条包', 'chain bag', ['链条小包'], ['chain bags']],
      ['耳骨夹', 'ear cuff', ['耳骨夹饰'], ['ear cuffs']],
      ['鼻环', 'nose ring', ['鼻钉'], ['nose rings']],
      ['唇钉', 'lip ring', ['唇环'], ['lip rings']],
      ['眉钉', 'eyebrow piercing', ['眉环'], ['eyebrow piercings']],
      ['颈圈', 'choker', ['choker项链'], ['chokers']],
      ['锁骨链', 'collarbone chain', ['锁骨项链'], ['collarbone chains']],
      ['臂环', 'armlet', ['臂钏'], ['armlets']],
      ['脚链', 'anklet', ['脚踝链'], ['anklets']],
      ['领带', 'necktie', ['领带饰'], ['neckties', 'tie']],
      ['领结', 'bow tie', ['蝴蝶领结'], ['bow ties']],
      ['领巾', 'neckerchief', ['颈巾'], ['neckerchiefs']],
      ['胸针', 'brooch', ['胸花'], ['brooches']],
      ['徽章', 'badge', ['徽章饰'], ['badges']],
      ['肩章', 'epaulette', ['肩饰'], ['epaulettes']],
      ['眼罩', 'eyepatch', ['单眼眼罩'], ['eye patch']],
      ['手杖', 'walking stick', ['拐杖'], ['walking sticks', 'cane']],
      ['弓', 'bow', ['弓箭'], ['bows']],
      ['箭', 'arrows', ['箭矢'], ['arrow']],
      ['法杖', 'staff', ['魔法杖'], ['magic staff']],
      ['盾牌', 'shield', ['盾'], ['shields']],
      ['匕首', 'dagger', ['短刀'], ['daggers']],
      ['折扇', 'folding fan', ['扇子'], ['folding fans']],
      ['油纸伞', 'oil-paper umbrella', ['纸伞'], ['oil paper umbrella']],
      ['灯笼', 'lantern', ['提灯'], ['lanterns']]
    ],

    material: [
      ['棉麻', 'cotton-linen', ['棉麻材质'], ['cotton linen']],
      ['涤纶', 'polyester', ['聚酯纤维'], ['polyester fabric']],
      ['氨纶', 'spandex', ['弹力纤维'], ['elastane']],
      ['灯芯绒', 'corduroy', ['灯芯绒材质'], ['corduroy fabric']],
      ['欧根纱', 'organza', ['欧根纱材质'], ['organza fabric']],
      ['薄纱', 'tulle', ['薄纱材质'], ['tulle fabric']],
      ['网纱', 'mesh', ['网眼纱'], ['mesh fabric']],
      ['人造毛', 'faux fur', ['人造皮草'], ['faux fur fabric']],
      ['毛呢', 'woolen', ['毛呢材质'], ['wool fabric']],
      ['亮片', 'sequined', ['亮片材质'], ['sequin', 'sequins']],
      ['珠片', 'beaded', ['串珠'], ['beadwork']],
      ['羽毛', 'feather', ['羽毛装饰'], ['feathers']],
      ['绒毛', 'plush', ['长毛绒'], ['plush fabric']],
      ['全息', 'holographic', ['全息材质'], ['holo']],
      ['镭射', 'iridescent', ['镭射材质'], ['iridescent material']],
      ['磨砂', 'frosted', ['磨砂材质'], ['frosted finish']],
      ['亚克力', 'acrylic', ['亚克力材质'], ['acrylic material']]
    ],

    color: [
      ['珊瑚色', 'coral', ['珊瑚粉', '珊瑚红'], ['coral pink']],
      ['裸色', 'nude', ['裸粉色'], ['nude tone']],
      ['香槟色', 'champagne', ['香槟金'], ['champagne gold']],
      ['玫瑰金', 'rose gold', ['玫瑰金色'], ['rose golden']],
      ['亚麻色', 'flaxen', ['亚麻金', '亚麻棕'], ['flaxen blonde']],
      ['奶茶色', 'milk tea', ['奶茶棕', '奶茶色系'], ['milk tea brown']],
      ['焦糖色', 'caramel', ['焦糖棕'], ['caramel brown']],
      ['巧克力色', 'chocolate', ['巧克力棕'], ['chocolate brown']],
      ['铂金色', 'platinum blonde', ['铂金白金色'], ['platinum']],
      ['雾霾蓝', 'dusty blue', ['雾蓝色'], ['hazy blue']],
      ['深红', 'deep red', ['暗红', '深红色'], ['dark red']],
      ['柠檬黄', 'lemon yellow', ['柠檬色'], ['lemon']],
      ['奶油黄', 'butter yellow', ['奶油黄色'], ['buttery yellow']],
      ['孔雀蓝', 'peacock blue', ['孔雀蓝色'], ['peacock']],
      ['宝石蓝', 'sapphire blue', ['宝蓝色'], ['sapphire']],
      ['祖母绿', 'emerald green', ['祖母绿色'], ['emerald']],
      ['灰粉色', 'dusty pink', ['灰粉', '莫兰迪粉'], ['muted pink']],
      ['豆沙色', 'mauve', ['豆沙红'], ['mauve color']],
      ['墨蓝', 'ink blue', ['墨蓝色'], ['dark ink blue']],
      ['军绿', 'army green', ['军绿色'], ['military green']],
      ['荧光绿', 'neon green', ['荧光绿色'], ['neon lime']],
      ['荧光粉', 'neon pink', ['荧光粉色'], ['hot pink']],
      ['彩虹色', 'rainbow colors', ['彩虹色调'], ['rainbow']],
      ['金属色', 'metallic', ['金属质感色'], ['metallic tone']],
      ['珠光色', 'pearlescent', ['珠光白'], ['pearl finish']],
      ['双色', 'two-tone', ['双色调'], ['two tone']],
      ['金色', 'gold', ['黄金色'], ['golden']],
      ['银色', 'silver', ['银白色'], ['silvery']],
      ['铜色', 'bronze', ['古铜色'], ['bronze tone']],
      ['渐变色', 'gradient colors', ['渐变色调'], ['gradient']]
    ],

    pose: [
      ['侧躺', 'lying on side', ['侧卧', '侧躺着'], ['lying sideways']],
      ['趴着', 'lying on stomach', ['趴卧'], ['lying prone']],
      ['仰躺', 'lying on back', ['仰卧'], ['lying supine']],
      ['盘腿坐', 'sitting cross-legged', ['盘腿坐姿'], ['cross-legged sitting']],
      ['跷二郎腿', 'crossing legs', ['跷腿'], ['legs crossed']],
      ['抱膝', 'hugging knees', ['抱膝坐'], ['knees hugged']],
      ['单膝跪地', 'kneeling on one knee', ['单膝跪'], ['one knee down']],
      ['半蹲', 'half squat', ['半蹲姿势'], ['half-squatting']],
      ['弯腰', 'bending over', ['弯腰动作'], ['bent over']],
      ['伸懒腰', 'stretching', ['伸展身体'], ['stretching arms']],
      ['打哈欠', 'yawning', ['打呵欠'], ['yawn']],
      ['揉眼睛', 'rubbing eyes', ['揉眼'], ['rubbing her eyes']],
      ['整理头发', 'fixing hair', ['拨弄头发'], ['adjusting hair']],
      ['双手合十', 'hands clasped', ['合掌'], ['palms together']],
      ['祈祷', 'praying', ['祈祷姿势'], ['prayer pose']],
      ['鼓掌', 'clapping', ['拍手'], ['applauding']],
      ['比心', 'making a heart gesture', ['比心手势'], ['heart hands']],
      ['竖大拇指', 'thumbs up', ['点赞手势'], ['thumbs-up']],
      ['比耶', 'peace sign', ['剪刀手'], ['v sign']],
      ['指向前方', 'pointing forward', ['指向远处'], ['pointing ahead']],
      ['双手背后', 'hands behind back', ['手放背后'], ['hands clasped behind back']],
      ['扶眼镜', 'adjusting glasses', ['推眼镜'], ['pushing up glasses']],
      ['拿手机', 'holding a phone', ['拿着手机'], ['holding smartphone']],
      ['看手机', 'looking at phone', ['低头看手机'], ['looking at smartphone']],
      ['打电话', 'talking on phone', ['通电话'], ['on the phone']],
      ['写字', 'writing', ['写东西'], ['writing something']],
      ['画画', 'painting', ['作画'], ['painting a picture']],
      ['做饭', 'cooking', ['烹饪'], ['cooking food']],
      ['倒咖啡', 'pouring coffee', ['倒咖啡动作'], ['pouring a coffee']],
      ['切菜', 'chopping vegetables', ['切蔬菜'], ['chopping food']],
      ['浇花', 'watering plants', ['给花浇水'], ['watering flowers']],
      ['遛狗', 'walking a dog', ['遛狗狗'], ['walking the dog']],
      ['骑马', 'riding a horse', ['策马'], ['horseback riding']],
      ['游泳', 'swimming', ['游水'], ['swim']],
      ['冲浪', 'surfing', ['冲浪运动'], ['surf']],
      ['滑雪', 'skiing', ['滑雪运动'], ['ski']],
      ['滑板', 'skateboarding', ['玩滑板'], ['skateboard']],
      ['骑摩托', 'riding a motorcycle', ['骑摩托车'], ['motorcycle riding']],
      ['驾驶', 'driving', ['开车'], ['driving a car']],
      ['漂浮', 'floating', ['漂浮在空中'], ['float']],
      ['悬浮', 'levitating', ['悬浮空中'], ['levitation']],
      ['倒立', 'handstand', ['倒立姿势'], ['handstand pose']],
      ['武术动作', 'martial arts pose', ['武术姿势'], ['kung fu pose']],
      ['拔剑', 'drawing a sword', ['拔剑动作'], ['unsheathing a sword']],
      ['挥剑', 'swinging a sword', ['挥舞长剑'], ['sword swing']],
      ['射箭', 'drawing a bow', ['拉弓射箭'], ['archery pose']],
      ['施法', 'casting a spell', ['施放魔法'], ['spellcasting']],
      ['弹钢琴', 'playing piano', ['弹琴'], ['playing the piano']],
      ['拉小提琴', 'playing violin', ['拉琴'], ['playing the violin']],
      ['打鼓', 'playing drums', ['击鼓'], ['drumming']],
      ['唱歌', 'singing', ['歌唱'], ['sing']],
      ['旋转', 'spinning', ['旋转动作'], ['twirling']],
      ['坐在台阶上', 'sitting on steps', ['坐在阶梯上'], ['seated on stairs']],
      ['躺在沙发上', 'lying on sofa', ['躺在沙发'], ['lying on a couch']],
      ['趴在地上', 'lying on the ground', ['趴地'], ['prone on the ground']]
    ],

    scene: [
      ['公寓', 'apartment', ['公寓房间'], ['apartments', 'flat']],
      ['别墅', 'villa', ['独栋别墅'], ['villas']],
      ['豪宅', 'mansion', ['豪华宅邸'], ['mansions']],
      ['小屋', 'cabin', ['小木屋'], ['cabins']],
      ['宫殿', 'palace', ['皇宫'], ['palaces']],
      ['古城墙', 'ancient city wall', ['城墙'], ['old city wall']],
      ['广场', 'plaza', ['城市广场'], ['plazas', 'square']],
      ['商业街', 'shopping street', ['商业街区'], ['shopping district']],
      ['步行街', 'pedestrian street', ['步行街区'], ['pedestrian zone']],
      ['夜市', 'night market', ['夜市街道'], ['night markets']],
      ['便利店', 'convenience store', ['便利商店'], ['convenience shops']],
      ['超市', 'supermarket', ['超级市场'], ['supermarkets', 'grocery store']],
      ['商场', 'shopping mall', ['购物中心'], ['mall', 'shopping center']],
      ['市场', 'market', ['集市'], ['markets', 'bazaar']],
      ['学校', 'school', ['校园'], ['schools', 'campus']],
      ['医院', 'hospital', ['医院走廊'], ['hospitals']],
      ['电影院', 'cinema', ['影厅'], ['movie theater']],
      ['剧院', 'theater', ['歌剧院'], ['theatre', 'opera house']],
      ['体育馆', 'stadium', ['体育场'], ['stadiums', 'arena']],
      ['游泳池', 'swimming pool', ['泳池'], ['pools']],
      ['健身房', 'gym', ['健身中心'], ['gyms', 'fitness center']],
      ['录音棚', 'recording studio', ['录音室'], ['music studio']],
      ['舞台后台', 'backstage', ['后台'], ['back stage']],
      ['停车场', 'parking lot', ['地下停车场'], ['parking garage']],
      ['加油站', 'gas station', ['加油 station'], ['petrol station']],
      ['高速公路', 'highway', ['高速路'], ['freeway']],
      ['公路', 'road', ['公路旁'], ['roads']],
      ['立交桥', 'overpass', ['高架桥'], ['overpasses', 'flyover']],
      ['地铁车厢', 'subway car', ['地铁车内'], ['metro car']],
      ['公交车内', 'bus interior', ['公交车里'], ['inside a bus']],
      ['火车车厢', 'train car', ['火车内'], ['train interior']],
      ['飞机舱', 'airplane cabin', ['机舱'], ['aircraft cabin']],
      ['游艇', 'yacht', ['豪华游艇'], ['yachts']],
      ['帆船', 'sailboat', ['帆船船'], ['sailboats']],
      ['洞穴', 'cave', ['山洞'], ['caves']],
      ['火山', 'volcano', ['火山口'], ['volcanoes']],
      ['冰川', 'glacier', ['冰川地貌'], ['glaciers']],
      ['瀑布', 'waterfall', ['瀑布群'], ['waterfalls']],
      ['溪流', 'stream', ['小溪'], ['streams', 'creek']],
      ['稻田', 'rice field', ['水稻田'], ['rice fields']],
      ['茶园', 'tea plantation', ['茶园梯田'], ['tea fields']],
      ['葡萄园', 'vineyard', ['葡萄庄园'], ['vineyards']],
      ['樱花林', 'cherry blossom forest', ['樱花树林', '樱花林间'], ['sakura forest']],
      ['枫叶林', 'maple forest', ['枫树林'], ['maple woods']],
      ['雪松林', 'cedar forest', ['雪松林间'], ['cedar woods']],
      ['沙漠公路', 'desert highway', ['沙漠公路旁'], ['desert road']],
      ['海边悬崖', 'seaside cliff', ['海岸悬崖'], ['coastal cliff']],
      ['海底', 'underwater', ['海底世界'], ['under water']],
      ['珊瑚礁', 'coral reef', ['珊瑚礁群'], ['coral reefs']],
      ['极光', 'aurora', ['极光天空'], ['northern lights', 'aurora borealis']],
      ['星空', 'starry sky', ['满天星空'], ['starry night sky']],
      ['银河', 'milky way', ['银河星空'], ['galaxy']],
      ['月球', 'moon surface', ['月球表面'], ['lunar surface']],
      ['太空', 'outer space', ['宇宙空间'], ['space']],
      ['云端', 'above the clouds', ['云海'], ['cloud sea']],
      ['浮空岛', 'floating island', ['天空浮岛'], ['floating islands']],
      ['魔法森林', 'enchanted forest', ['奇幻森林'], ['magical forest']],
      ['废墟城市', 'ruined city', ['城市废墟'], ['ruins of a city']],
      ['未来都市', 'futuristic metropolis', ['未来城市'], ['future city']],
      ['赛博朋克街区', 'cyberpunk district', ['赛博朋克街道'], ['cyberpunk street']],
      ['蒸汽朋克城市', 'steampunk city', ['蒸汽朋克都市'], ['steampunk metropolis']],
      ['古代宫殿', 'ancient palace', ['古代皇宫'], ['old palace']],
      ['和风庭院', 'Japanese garden', ['日式庭院'], ['japanese style garden']],
      ['中式园林', 'Chinese garden', ['中国园林'], ['chinese style garden']],
      ['欧式庭院', 'European courtyard', ['欧式庭院'], ['european courtyard']],
      ['屋顶泳池', 'rooftop pool', ['天台泳池'], ['roof pool']],
      ['天台酒吧', 'rooftop bar', ['楼顶酒吧'], ['roof bar']],
      ['咖啡馆露台', 'cafe terrace', ['咖啡露台'], ['café terrace']],
      ['街角便利店', 'corner convenience store', ['街角小店'], ['corner store']],
      ['森林木屋', 'forest cabin', ['林间木屋'], ['woodland cabin']],
      ['灯塔海岸', 'lighthouse coast', ['灯塔海边'], ['lighthouse shoreline']]
    ],

    time: [
      ['凌晨', 'early hours', ['凌晨时分'], ['small hours']],
      ['拂晓', 'daybreak', ['破晓时分'], ['break of dawn']],
      ['上午', 'morning', ['上午时分'], ['late morning']],
      ['中午', 'midday', ['正午时分'], ['noon']],
      ['午后', 'early afternoon', ['午后时分'], ['afternoon']],
      ['入夜', 'nightfall', ['入夜时分'], ['fall of night']],
      ['夜半', 'middle of the night', ['半夜时分'], ['dead of night']],
      ['春末', 'late spring', ['暮春'], ['end of spring']],
      ['盛夏', 'midsummer', ['仲夏'], ['high summer']],
      ['深秋', 'late autumn', ['暮秋'], ['late fall']],
      ['隆冬', 'deep winter', ['寒冬'], ['midwinter']],
      ['雨季', 'rainy season', ['梅雨季'], ['wet season']],
      ['雪季', 'snowy season', ['冬季雪季'], ['snow season']],
      ['节日', 'holiday', ['节庆'], ['festival']]
    ],

    weather: [
      ['雷雨', 'thunderstorm', ['雷雨天'], ['thunder storm']],
      ['阵雨', 'shower', ['阵雨天'], ['rain shower']],
      ['毛毛雨', 'drizzle', ['毛毛雨天'], ['drizzling']],
      ['暴雪', 'blizzard', ['暴风雪'], ['snowstorm']],
      ['雨夹雪', 'sleet', ['雨雪'], ['rain and snow']],
      ['冰雹', 'hail', ['冰雹天'], ['hailstorm']],
      ['沙尘', 'dust storm', ['沙尘暴'], ['sandstorm']],
      ['彩虹', 'rainbow', ['彩虹天'], ['rainbows']],
      ['潮湿', 'humid', ['湿润'], ['humid weather']],
      ['闷热', 'muggy', ['闷热天气'], ['stuffy']],
      ['寒冷', 'cold', ['寒冷天气'], ['chilly']],
      ['微风', 'light breeze', ['微风吹拂'], ['gentle breeze']],
      ['大风', 'strong wind', ['强风'], ['gale']],
      ['台风', 'typhoon', ['台风天'], ['typhoons']],
      ['雪后', 'after snow', ['雪后初晴'], ['post-snow']]
    ],

    light: [
      ['底光', 'underlighting', ['底部光'], ['under lighting']],
      ['漫射光', 'diffused light', ['散射光'], ['diffuse light']],
      ['直射光', 'direct light', ['直射阳光'], ['direct sunlight']],
      ['星光', 'starlight', ['星星光'], ['star light']],
      ['火光', 'firelight', ['火焰光'], ['fire light']],
      ['LED光', 'LED lighting', ['LED灯'], ['led light']],
      ['环形灯', 'ring light', ['环形补光'], ['ring lighting']],
      ['聚光灯', 'spotlight', ['聚光照明'], ['spot light']],
      ['舞台光', 'stage lighting', ['舞台灯光'], ['stage light']],
      ['蝴蝶光', 'butterfly lighting', ['蝴蝶光布光'], ['butterfly light']],
      ['伦勃朗光', 'Rembrandt lighting', ['伦勃朗布光'], ['rembrandt light']],
      ['环形光', 'loop lighting', ['环形布光'], ['loop light']],
      ['分割光', 'split lighting', ['分割布光'], ['split light']],
      ['双色光', 'bi-color lighting', ['双色灯'], ['bicolor lighting']],
      ['边缘光', 'edge light', ['边缘轮廓光'], ['edge lighting']],
      ['中性光', 'neutral light', ['中性色温光'], ['neutral lighting']],
      ['蓝色光', 'blue light', ['蓝光'], ['blue lighting']],
      ['红色光', 'red light', ['红光'], ['red lighting']],
      ['紫色光', 'purple light', ['紫光'], ['purple lighting']],
      ['绿色光', 'green light', ['绿光'], ['green lighting']],
      ['暖白灯光', 'warm white light', ['暖白灯'], ['warm white lighting']],
      ['冷白灯光', 'cool white light', ['冷白灯'], ['cool white lighting']],
      ['水面反光', 'water reflections', ['水面倒影'], ['reflections on water']],
      ['玻璃反光', 'glass reflections', ['玻璃倒影'], ['reflections on glass']],
      ['霓虹反光', 'neon reflections', ['霓虹倒影'], ['neon reflection']],
      ['火光映照', 'firelight glow', ['火光映衬'], ['glow of firelight']]
    ],

    camera: [
      ['14mm', '14mm', ['14毫米'], ['14 mm']],
      ['20mm', '20mm', ['20毫米'], ['20 mm']],
      ['28mm', '28mm', ['28毫米'], ['28 mm']],
      ['100mm', '100mm', ['100毫米'], ['100 mm']],
      ['200mm', '200mm', ['200毫米'], ['200 mm']],
      ['400mm', '400mm', ['400毫米'], ['400 mm']],
      ['超广角', 'ultra-wide angle', ['超广角镜头'], ['ultra wide angle']],
      ['中焦', 'medium telephoto', ['中焦镜头'], ['medium tele']],
      ['微距特写', 'macro close-up', ['微距近摄'], ['macro closeup']],
      ['远景', 'extreme wide shot', ['大远景'], ['extreme wide']],
      ['中近景', 'medium close-up', ['中近景镜头'], ['medium closeup']],
      ['牛仔镜头', 'cowboy shot', ['牛仔景别'], ['cowboy framing']],
      ['虫眼视角', 'worm\'s-eye view', ['虫眼视角'], ['worm eye view']],
      ['四分之三侧脸', 'three-quarter view', ['四分之三侧面'], ['3/4 view']],
      ['背影', 'back view', ['背面视角', '背影镜头'], ['view from behind']],
      ['侧面侧拍', 'side view', ['侧面视角'], ['profile view']],
      ['第一人称视角', 'first-person view', ['第一人称'], ['first person view', 'pov']],
      ['主观镜头', 'POV shot', ['POV镜头'], ['point of view shot']],
      ['框架构图', 'frame within a frame', ['框中框构图'], ['framing within a frame']],
      ['引导线构图', 'leading lines', ['引导线'], ['leading line composition']],
      ['黄金分割', 'golden ratio composition', ['黄金比例构图'], ['golden ratio']],
      ['对角构图', 'diagonal composition', ['对角线构图'], ['diagonal framing']],
      ['极简构图', 'minimalist composition', ['极简构图法'], ['minimal composition']],
      ['紧凑构图', 'tight framing', ['紧凑取景'], ['tight frame']],
      ['宽松构图', 'loose framing', ['宽松取景'], ['loose frame']],
      ['宽银幕画幅', 'widescreen aspect ratio', ['宽银幕'], ['widescreen']],
      ['方形画幅', 'square format', ['正方形构图'], ['square aspect ratio']],
      ['电影宽银幕', 'cinematic widescreen', ['电影宽画幅'], ['cinematic wide screen']],
      ['移轴镜头', 'tilt-shift lens', ['移轴效果'], ['tilt shift']],
      ['变形镜头', 'anamorphic lens', ['宽银幕镜头'], ['anamorphic']],
      ['长焦压缩', 'telephoto compression', ['长焦压缩感'], ['compressed perspective']],
      ['广角透视', 'wide-angle perspective', ['广角视角'], ['wide angle perspective']]
    ],

    style: [
      ['商业摄影', 'commercial photography', ['商业摄影风'], ['commercial photo']],
      ['产品摄影', 'product photography', ['产品拍摄'], ['product photo']],
      ['美食摄影', 'food photography', ['食物摄影'], ['food photo']],
      ['建筑摄影', 'architecture photography', ['建筑拍摄'], ['architectural photography']],
      ['风景摄影', 'landscape photography', ['风光摄影'], ['landscape photo']],
      ['夜景摄影', 'night photography', ['夜景拍摄'], ['night photo']],
      ['婚礼摄影', 'wedding photography', ['婚纱摄影'], ['wedding photo']],
      ['暗调摄影', 'low-key photography', ['暗调照片'], ['low key photography']],
      ['高调摄影', 'high-key photography', ['高调照片'], ['high key photography']],
      ['极简摄影', 'minimalist photography', ['极简摄影风'], ['minimal photography']],
      ['复古胶片', 'retro film', ['复古胶卷'], ['vintage film']],
      ['宝丽来', 'Polaroid', ['拍立得'], ['polaroid photo']],
      ['135胶片', '135 film', ['135胶卷'], ['35mm film photography']],
      ['120胶片', '120 film', ['120胶卷'], ['medium format film']],
      ['中画幅', 'medium format', ['中画幅摄影'], ['medium-format']],
      ['大画幅', 'large format', ['大画幅摄影'], ['large-format']],
      ['电影海报', 'movie poster', ['电影海报风'], ['film poster']],
      ['游戏原画', 'game concept art', ['游戏概念艺术'], ['game art']],
      ['绘本插图', 'storybook illustration', ['绘本风'], ['children book illustration']],
      ['漫画', 'comic art', ['漫画风'], ['comics']],
      ['国漫', 'Chinese comic', ['中国漫画'], ['chinese comics']],
      ['日漫', 'Japanese manga', ['日本漫画'], ['manga style']],
      ['美漫', 'American comic', ['美国漫画'], ['american comics']],
      ['厚涂', 'impasto', ['厚涂画风'], ['thick paint']],
      ['平涂', 'flat color', ['平涂风格'], ['flat colors']],
      ['赛璐璐', 'cel shading', ['赛璐璐风格'], ['cel shaded']],
      ['吉卜力风', 'Studio Ghibli style', ['吉卜力风格'], ['ghibli style']],
      ['新海诚风', 'Makoto Shinkai style', ['新海诚风格'], ['shinkai style']],
      ['中国风', 'Chinese style', ['中式风格'], ['chinoiserie']],
      ['国潮', 'Chinese trendy style', ['国潮风'], ['guochao']],
      ['韩系风格', 'Korean style', ['韩风'], ['korean aesthetic']],
      ['北欧风', 'Scandinavian style', ['北欧风格'], ['scandinavian design']],
      ['蒸汽波', 'vaporwave', ['蒸汽波风格'], ['vapor wave']],
      ['合成器浪潮', 'synthwave', ['合成波'], ['synth wave']],
      ['复古未来主义', 'retrofuturism', ['复古未来风'], ['retro futurism']],
      ['废土风', 'wasteland style', ['废土风格'], ['post-apocalyptic style']],
      ['哥特', 'Gothic', ['哥特风'], ['gothic style']],
      ['洛可可', 'Rococo', ['洛可可风格'], ['rococo style']],
      ['装饰艺术', 'Art Deco', ['装饰艺术风格'], ['art-deco']],
      ['新艺术', 'Art Nouveau', ['新艺术风格'], ['art nouveau style']],
      ['表现主义', 'expressionism', ['表现主义风格'], ['expressionist']],
      ['野兽派', 'fauvism', ['野兽派风格'], ['fauvist']],
      ['立体主义', 'cubism', ['立体主义风格'], ['cubist']],
      ['抽象艺术', 'abstract art', ['抽象风'], ['abstract']],
      ['波普艺术', 'pop art', ['波普风'], ['pop-art']],
      ['故障艺术', 'glitch art', ['故障风'], ['glitch']],
      ['光绘', 'light painting', ['光绘摄影'], ['light paint']],
      ['双重曝光', 'double exposure', ['双重曝光效果'], ['double-exposure']],
      ['长曝光', 'long exposure', ['慢门摄影'], ['long-exposure']],
      ['高速摄影', 'high-speed photography', ['高速快门'], ['high speed photography']],
      ['湿版摄影', 'wet plate photography', ['湿版法'], ['wet plate']],
      ['蓝晒', 'cyanotype', ['蓝晒法'], ['cyanotype print']],
      ['红外摄影', 'infrared photography', ['红外线摄影'], ['infrared photo']],
      ['黑色电影', 'film noir', ['黑色电影风'], ['noir']],
      ['霓虹黑色', 'neon noir', ['霓虹黑色电影'], ['neon-noir']],
      ['太阳朋克', 'solarpunk', ['太阳能朋克'], ['solar punk']],
      ['生物朋克', 'biopunk', ['生化朋克'], ['bio punk']],
      ['丝网印刷', 'screen print', ['丝网印'], ['screenprinting']],
      ['版画', 'printmaking', ['版画风'], ['print making']],
      ['木刻', 'woodcut', ['木刻版画'], ['wood cut']],
      ['剪纸', 'paper cut', ['剪纸艺术'], ['papercut']],
      ['拼贴', 'collage', ['拼贴艺术'], ['collage art']],
      ['蜡笔', 'crayon', ['蜡笔画'], ['crayon drawing']],
      ['粉彩', 'pastel drawing', ['粉彩画'], ['pastel art']],
      ['钢笔画', 'pen and ink', ['钢笔素描'], ['ink drawing']],
      ['素描', 'pencil sketch', ['铅笔素描'], ['sketch']],
      ['炭笔', 'charcoal drawing', ['炭笔画'], ['charcoal art']],
      ['水粉', 'gouache', ['水粉画'], ['gouache painting']],
      ['丙烯', 'acrylic painting', ['丙烯画'], ['acrylic art']],
      ['壁画', 'mural', ['墙绘'], ['murals']],
      ['涂鸦', 'graffiti', ['涂鸦艺术'], ['graffiti art']],
      ['儿童插画', 'children\'s book illustration', ['童书插画'], ['kids illustration']]
    ],

    quality: [
      ['8K', '8K', ['8k分辨率'], ['8k resolution']],
      ['4K', '4K', ['4k分辨率'], ['4k resolution']],
      ['超高清', 'ultra high definition', ['UHD'], ['ultra hd']],
      ['完美构图', 'perfect composition', ['构图完美'], ['flawless composition']],
      ['构图平衡', 'balanced composition', ['平衡构图'], ['balanced framing']],
      ['色彩和谐', 'harmonious colors', ['和谐色彩'], ['harmonious color palette']],
      ['精细纹理', 'fine textures', ['纹理精细'], ['detailed textures']],
      ['真实材质', 'realistic materials', ['材质真实'], ['realistic material']],
      ['光线自然', 'natural lighting', ['自然光线'], ['natural light']],
      ['阴影自然', 'natural shadows', ['自然阴影'], ['soft natural shadows']],
      ['体积感', 'three-dimensional feel', ['立体感'], ['3d feel']],
      ['层次丰富', 'rich layers', ['丰富层次'], ['rich depth']],
      ['高动态范围', 'high dynamic range', ['HDR'], ['hdr']],
      ['低噪点', 'low noise', ['噪点低'], ['clean image']],
      ['锐利细节', 'crisp details', ['细节锐利'], ['crisp detail']],
      ['专业调色', 'professional color grading', ['专业色彩'], ['pro color grading']],
      ['获奖作品', 'award-winning', ['获奖摄影'], ['award winning']],
      ['杰作', 'masterpiece', ['大师作品'], ['masterpieces']],
      ['顶级画质', 'top-tier quality', ['顶级质量'], ['top quality']],
      ['丰富色彩', 'rich colors', ['色彩丰富'], ['rich color']],
      ['极致细节', 'extreme detail', ['细节极致'], ['extreme details']],
      ['真实感', 'sense of realism', ['写实感'], ['realistic feel']],
      ['氛围感强', 'strong atmosphere', ['强氛围'], ['strong atmospheric mood']],
      ['视觉冲击力', 'strong visual impact', ['视觉冲击'], ['visual impact']]
    ],

    negative: [
      ['缺失手指', 'missing fingers', ['少手指', '手指缺失'], ['finger missing']],
      ['手部模糊', 'blurry hands', ['模糊的手'], ['hands blurry']],
      ['手部比例错误', 'bad hand proportions', ['手部比例不对'], ['wrong hand proportions']],
      ['手臂错误', 'bad arms', ['手臂崩坏'], ['arm errors']],
      ['腿部错误', 'bad legs', ['腿崩'], ['leg errors']],
      ['脚部畸形', 'malformed feet', ['坏脚', '脚部崩坏'], ['bad feet', 'deformed feet']],
      ['多余手臂', 'extra arms', ['多手臂'], ['additional arms']],
      ['面部不对称', 'asymmetric face', ['脸不对称'], ['asymmetrical face']],
      ['牙齿畸形', 'malformed teeth', ['牙齿崩坏', '坏牙'], ['bad teeth']],
      ['双头', 'two heads', ['两个头'], ['double head']],
      ['身体融合', 'body fusion', ['身体粘连'], ['fused bodies']],
      ['多余眼睛', 'extra eyes', ['多眼睛'], ['additional eyes']],
      ['低分辨率', 'low resolution', ['分辨率低'], ['low-res']],
      ['像素化', 'pixelated', ['马赛克感'], ['pixelation']],
      ['色偏', 'color cast', ['偏色'], ['color shift']],
      ['曝光错误', 'bad exposure', ['错误曝光'], ['wrong exposure']],
      ['光线错误', 'bad lighting', ['光照错误'], ['wrong lighting']],
      ['网址', 'URL', ['网址文字'], ['url text']],
      ['边框', 'frame border', ['画框边框'], ['border frame']],
      ['拉伸', 'stretched', ['画面拉伸'], ['stretching']]
    ],

    pattern: [
      ['条纹', 'striped', ['条纹图案'], ['stripes']],
      ['格纹', 'plaid', ['格子', '格纹图案'], ['checkered']],
      ['千鸟格', 'houndstooth', ['千鸟格纹'], ['houndstooth pattern']],
      ['波点', 'polka dot', ['圆点', '波点图案'], ['polka dots']],
      ['碎花', 'floral print', ['碎花图案', '小花'], ['floral pattern']],
      ['豹纹', 'leopard print', ['豹纹图案'], ['leopard pattern']],
      ['斑马纹', 'zebra print', ['斑马纹图案'], ['zebra pattern']],
      ['蛇纹', 'snake print', ['蛇皮纹'], ['snakeskin']],
      ['鳄鱼纹', 'crocodile texture', ['鳄鱼皮纹'], ['crocodile pattern']],
      ['几何图案', 'geometric pattern', ['几何纹'], ['geometric print']],
      ['民族风图案', 'ethnic pattern', ['民族纹样'], ['ethnic print']],
      ['佩斯利花纹', 'paisley pattern', ['佩斯利纹'], ['paisley']],
      ['迷彩', 'camouflage', ['迷彩图案'], ['camo']],
      ['扎染', 'tie-dye', ['扎染图案'], ['tie dye']],
      ['渐变', 'gradient', ['渐变色'], ['gradient color']],
      ['纯色', 'solid color', ['纯色图案'], ['solid']],
      ['亮片装饰', 'sequined', ['亮片图案'], ['sequin embellished']],
      ['刺绣', 'embroidered', ['刺绣图案'], ['embroidery']],
      ['镂空', 'cutout', ['镂空图案'], ['cut-out']],
      ['荷叶边', 'ruffled', ['荷叶边装饰'], ['ruffles']],
      ['蕾丝边', 'lace trim', ['蕾丝装饰'], ['lace detailing']],
      ['棋盘格', 'checkerboard', ['棋盘格纹'], ['checkerboard pattern']],
      ['动物纹', 'animal print', ['动物纹图案'], ['animal pattern']],
      ['星空图案', 'starry pattern', ['星空纹'], ['starry print']],
      ['波西米亚图案', 'bohemian pattern', ['波西米亚纹'], ['boho pattern']],
      ['中国风图案', 'Chinese pattern', ['中式纹样'], ['chinese motif']],
      ['涂鸦图案', 'graffiti pattern', ['涂鸦纹'], ['graffiti print']],
      ['抽象图案', 'abstract pattern', ['抽象纹'], ['abstract print']]
    ],

    shoe: [
      ['高跟鞋', 'high heels', ['高跟鞋子'], ['heels']],
      ['细跟鞋', 'stiletto heels', ['细高跟'], ['stilettos']],
      ['粗跟鞋', 'block heels', ['粗高跟'], ['block heel']],
      ['运动鞋', 'sneakers', ['波鞋'], ['trainers']],
      ['小白鞋', 'white sneakers', ['白色运动鞋'], ['white trainers']],
      ['帆布鞋', 'canvas shoes', ['帆布运动鞋'], ['canvas sneakers']],
      ['乐福鞋', 'loafers', ['便鞋'], ['loafer']],
      ['牛津鞋', 'oxford shoes', ['牛津皮鞋'], ['oxfords']],
      ['皮鞋', 'leather shoes', ['皮革鞋'], ['dress shoes']],
      ['短靴', 'ankle boots', ['踝靴'], ['ankle boot']],
      ['长靴', 'tall boots', ['高筒靴'], ['tall boot']],
      ['过膝靴', 'over-the-knee boots', ['过膝长靴'], ['thigh high boots']],
      ['马丁靴', 'combat boots', ['马丁鞋'], ['dr martens']],
      ['雪地靴', 'snow boots', ['雪靴'], ['winter boots']],
      ['凉鞋', 'sandals', ['凉拖鞋'], ['sandal']],
      ['拖鞋', 'slippers', ['居家拖鞋'], ['slipper']],
      ['雨靴', 'rain boots', ['雨鞋'], ['wellingtons']],
      ['登山鞋', 'hiking boots', ['徒步鞋'], ['hiking shoes']],
      ['舞鞋', 'dance shoes', ['舞蹈鞋'], ['dancing shoes']],
      ['玛丽珍鞋', 'Mary Janes', ['玛丽珍'], ['mary jane shoes']]
    ]
  };

  // 合并基础词条与第二轮人工扩充词条。
  const ALL_GROUPS = Object.assign({}, GROUPS);
  Object.keys(EXTRA_GROUPS).forEach(function (category) {
    ALL_GROUPS[category] = (ALL_GROUPS[category] || []).concat(EXTRA_GROUPS[category]);
  });

  const entries = [];
  let sourceRowCount = 0;

  Object.keys(ALL_GROUPS).forEach(function (category) {
    ALL_GROUPS[category].forEach(function (row, index) {
      sourceRowCount += 1;
      const zh = row[0];
      const en = row[1];
      const zhAliases = [zh].concat(row[2] || []);
      const enAliases = [en].concat(row[3] || []);
      const dedupe = function (arr) {
        const seen = Object.create(null);
        return arr
          .map(function (s) { return String(s).trim(); })
          .filter(function (s) {
            const k = s.toLowerCase();
            if (!s || seen[k]) return false;
            seen[k] = true;
            return true;
          });
      };
      entries.push({
        id: category + '-' + index,
        category: category,
        slot: SLOT_OF_CATEGORY[category],
        zh: zh,
        en: en,
        zhAliases: dedupe(zhAliases),
        enAliases: dedupe(enAliases)
      });
    });
  });

  // ── 组合扩充 ────────────────────────────────────────────────
  // 人工词条保证准确；在此之上按「颜色 × 服装 / 材质 × 服装 /
  // 图案 × 服装 / 发色 × 发型 / 时间、天气 × 场景 / 光质 × 光型 /
  // 焦距 × 景别」生成规范的常用组合，让词典达到数千条量级。
  // 生成组合只使用已有的规范译法，不引入机器翻译。

  const manualEntryCount = entries.length;
  const categoryMap = Object.create(null);
  const canonicalZhMap = Object.create(null);
  const usedZh = Object.create(null);
  const usedEn = Object.create(null);

  entries.forEach(function (entry) {
    if (!categoryMap[entry.category]) categoryMap[entry.category] = [];
    categoryMap[entry.category].push(entry);
    if (!canonicalZhMap[entry.zh]) canonicalZhMap[entry.zh] = entry;
    entry.zhAliases.forEach(function (a) { usedZh[a.toLowerCase()] = true; });
    entry.enAliases.forEach(function (a) { usedEn[a.toLowerCase()] = true; });
  });

  function canonical(category, zh) {
    const list = categoryMap[category] || [];
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].zh === zh) return list[i];
    }
    return null;
  }

  function many(category, list) {
    return list.map(function (zh) { return canonical(category, zh); }).filter(Boolean);
  }

  let generatedCounter = 0;

  function addGenerated(category, zh, en, altZh, altEn, generation) {
    const zhKey = String(zh || '').trim();
    const enKey = String(en || '').trim();
    if (!zhKey || !enKey || usedZh[zhKey.toLowerCase()]) return false;

    const zhAliases = [zhKey];
    (altZh || []).forEach(function (alt) {
      const key = String(alt || '').trim();
      if (key && key !== zhKey && !usedZh[key.toLowerCase()]) {
        usedZh[key.toLowerCase()] = true;
        zhAliases.push(key);
      }
    });

    const enAliases = [enKey];
    (altEn || []).forEach(function (alt) {
      const key = String(alt || '').trim();
      if (key && key.toLowerCase() !== enKey.toLowerCase() && !usedEn[key.toLowerCase()]) {
        usedEn[key.toLowerCase()] = true;
        enAliases.push(key);
      }
    });

    generatedCounter += 1;
    const entry = {
      id: 'gen-' + generatedCounter,
      category: category,
      slot: SLOT_OF_CATEGORY[category],
      zh: zhKey,
      en: enKey,
      zhAliases: zhAliases,
      enAliases: enAliases,
      generated: true,
      generation: generation || 'combination'
    };
    usedZh[zhKey.toLowerCase()] = true;
    usedEn[enKey.toLowerCase()] = true;
    entries.push(entry);
    if (!categoryMap[category]) categoryMap[category] = [];
    categoryMap[category].push(entry);
    return true;
  }

  // 颜色 → 服装 / 鞋履 / 包帽
  const COLOR_ZH = [
    '黑色', '白色', '灰色', '深灰', '浅灰', '米色', '奶油色', '象牙白',
    '棕色', '咖啡色', '卡其色', '驼色', '藏青', '蓝色', '天蓝', '深蓝',
    '红色', '酒红', '正红', '深红', '粉色', '浅粉', '玫瑰粉', '灰粉色',
    '紫色', '薰衣草紫', '绿色', '墨绿', '橄榄绿', '薄荷绿', '军绿',
    '黄色', '芥末黄', '柠檬黄', '奶油黄', '橙色', '暖黄色', '珊瑚色',
    '裸色', '香槟色', '孔雀蓝', '宝石蓝', '祖母绿', '墨蓝', '雾霾蓝',
    '金色', '银色', '铜色',
    '荧光绿', '荧光粉', '金属色', '珠光色', '双色'
  ];
  const GARMENT_ZH = [
    '风衣', '大衣', '长款大衣', '呢子大衣', '派克大衣', '皮夹克', '牛仔外套',
    '飞行员夹克', '羊羔毛外套', '西装', '西装套装', '衬衫', '法式衬衫',
    '古巴领衬衫', '夏威夷衬衫', '牛仔衬衫', '短袖衬衫', 'T恤', '长袖T恤',
    '印花T恤', '背心', '吊带背心', '针织衫', '高领毛衣', '开衫', '卫衣',
    '马甲', '西装马甲', '针织背心', '连衣裙', '长裙', '短裙', '吊带裙',
    '抹胸裙', '一字肩连衣裙', '泡泡袖连衣裙', '衬衫裙', '针织连衣裙',
    '毛衣裙', '礼服', '婚纱', '旗袍', '汉服', '和服', '和风浴衣', '韩服',
    '纱丽', '半身裙', '百褶裙', '百褶短裙', 'A字裙', '包臀裙', '伞裙',
    '鱼尾裙', '工装裙', '皮裙', '牛仔裙', '牛仔裤', '阔腿牛仔裤',
    '直筒牛仔裤', '紧身牛仔裤', '阔腿裤', '西装裤', '短裤', '紧身裤',
    '工装裤', '背带裤', '连体裤', '背带裙', '运动服', '校服', 'JK制服',
    '洛丽塔', '女仆装', '护士服', '空姐制服', '军装', '警服', '消防服',
    '雨衣', '冲锋衣', '防晒服', '斗篷', '长袍', '盔甲', '奇幻盔甲',
    '太空服', '防护服', '泳衣', '比基尼', '连体泳衣', '潜水服', '滑雪服',
    '睡衣', '家居服', '围裙', '皮裤', '喇叭裤', '烟管裤', '哈伦裤',
    '运动裤', '瑜伽裤', '工装短裤', '百慕大短裤', '骑行裤', '西装短裤',
    '高腰裤', '低腰裤', '直筒裤', '背带短裤', '机车裤', '工装马甲',
    '战术背心', 'Cosplay服装'
  ];
  const SHOE_ZH = [
    '高跟鞋', '细跟鞋', '粗跟鞋', '运动鞋', '帆布鞋', '乐福鞋', '牛津鞋',
    '皮鞋', '短靴', '长靴', '过膝靴', '马丁靴', '雪地靴', '凉鞋', '拖鞋',
    '雨靴', '登山鞋', '舞鞋', '玛丽珍鞋'
  ];
  const BAG_HAT_ZH = [
    '手提包', '单肩包', '斜挎包', '背包', '帆布包', '腰包', '公文包', '钱包',
    '手拿包', '托特包', '水桶包', '链条包', '帽子', '贝雷帽', '棒球帽',
    '针织帽', '草帽', '礼帽', '渔夫帽', '牛仔帽', '钟形帽', '头巾',
    '珍珠项链', '项链', '耳环', '耳钉', '手链', '手表', '戒指', '腰带',
    '围巾', '丝巾', '墨镜', '眼镜', '发带', '发夹', '发簪', '发绳',
    '蝴蝶结', '皇冠', '面纱', '面具', '护目镜', '耳机'
  ];

  const colors = many('color', COLOR_ZH);
  const garments = many('outfit', GARMENT_ZH);
  const shoes = many('shoe', SHOE_ZH);
  const bagsHats = many('accessory', BAG_HAT_ZH);

  function colorAdjective(color) {
    if (color.zh === '香槟色') return 'champagne-colored';
    if (color.zh === '奶茶色') return 'milk-tea-colored';
    if (color.zh === '亚麻色') return 'flaxen';
    if (color.zh === '玫瑰金') return 'rose gold';
    if (color.zh === '珠光色') return 'pearlescent';
    if (color.zh === '金属色') return 'metallic';
    if (color.zh === '双色') return 'two-tone';
    return color.en;
  }

  colors.forEach(function (color) {
    garments.forEach(function (garment) {
      addGenerated(
        'outfit',
        color.zh + garment.zh,
        colorAdjective(color) + ' ' + garment.en,
        [color.zh + '的' + garment.zh],
        [],
        'color+outfit'
      );
    });
    shoes.forEach(function (shoe) {
      addGenerated(
        'shoe',
        color.zh + shoe.zh,
        colorAdjective(color) + ' ' + shoe.en,
        [color.zh + '的' + shoe.zh],
        [],
        'color+shoe'
      );
    });
    bagsHats.forEach(function (item) {
      addGenerated(
        'accessory',
        color.zh + item.zh,
        colorAdjective(color) + ' ' + item.en,
        [color.zh + '的' + item.zh],
        [],
        'color+accessory'
      );
    });
  });

  // 材质 → 服装
  const MATERIALS = [
    ['棉质', 'cotton'], ['亚麻', 'linen'], ['丝绸', 'silk'], ['缎面', 'satin'],
    ['羊毛', 'wool'], ['羊绒', 'cashmere'], ['皮革', 'leather'], ['牛仔', 'denim'],
    ['天鹅绒', 'velvet'], ['雪纺', 'chiffon'], ['蕾丝', 'lace'], ['针织', 'knit'],
    ['粗花呢', 'tweed'], ['麂皮', 'suede'], ['尼龙', 'nylon'], ['灯芯绒', 'corduroy'],
    ['欧根纱', 'organza'], ['薄纱', 'tulle'], ['网纱', 'mesh'], ['人造毛', 'faux fur']
  ];
  const MATERIAL_GARMENTS = GARMENT_ZH.slice(0, 70);
  MATERIALS.forEach(function (mat) {
    MATERIAL_GARMENTS.forEach(function (zh) {
      const garment = canonical('outfit', zh);
      if (!garment) return;
      addGenerated(
        'outfit',
        mat[0] + garment.zh,
        mat[1] + ' ' + garment.en,
        [mat[0] + '的' + garment.zh],
        [],
        'material+outfit'
      );
    });
  });

  // 图案 → 服装
  const patterns = many('pattern', [
    '条纹', '格纹', '千鸟格', '波点', '碎花', '豹纹', '斑马纹', '蛇纹',
    '几何图案', '民族风图案', '佩斯利花纹', '迷彩', '扎染', '蕾丝边',
    '棋盘格', '动物纹', '星空图案', '波西米亚图案', '中国风图案',
    '涂鸦图案', '抽象图案'
  ]);
  const PATTERN_GARMENTS = GARMENT_ZH.slice(0, 55);
  patterns.forEach(function (pattern) {
    PATTERN_GARMENTS.forEach(function (zh) {
      const garment = canonical('outfit', zh);
      if (!garment) return;
      addGenerated(
        'outfit',
        pattern.zh + garment.zh,
        pattern.en + ' ' + garment.en,
        [pattern.zh + '图案的' + garment.zh],
        [],
        'pattern+outfit'
      );
    });
  });

  // 发色 → 发型
  const HAIR_COLORS = [
    ['黑色', 'black'], ['棕色', 'brown'], ['金色', 'blonde'],
    ['铂金色', 'platinum blonde'], ['银色', 'silver'], ['灰色', 'gray'],
    ['红色', 'red'], ['酒红', 'burgundy'], ['蓝色', 'blue'], ['粉色', 'pink'],
    ['紫色', 'purple'], ['绿色', 'green'], ['亚麻色', 'flaxen'],
    ['奶茶色', 'milk tea brown'], ['焦糖色', 'caramel'], ['巧克力色', 'chocolate'],
    ['香槟色', 'champagne'], ['雾霾蓝', 'dusty blue'], ['玫瑰金', 'rose gold'],
    ['深红', 'deep red']
  ];
  const HAIR_STYLES = many('hair', [
    '短发', '长发', '中长发', '齐肩发', '波波头', '精灵短发', '马尾', '高马尾',
    '低马尾', '双马尾', '麻花辫', '侧编发', '盘发', '丸子头', '凌乱丸子头',
    '直发', '卷发', '波浪卷', '微卷', '公主切', '狼尾发型', '鲻鱼头',
    '层次剪', '碎发', '大背头', '油头', '法式编发', '鱼骨辫', '荷兰辫',
    '双丸子头', '双麻花辫', '八字刘海', '法式刘海', '眉上刘海', '短卷发',
    '长卷发', '蓬松卷发', '复古卷发', '爆炸头', '脏辫', '低盘发', '半扎发',
    '公主头', '中分', '侧分'
  ]);
  HAIR_COLORS.forEach(function (color) {
    HAIR_STYLES.forEach(function (style) {
      addGenerated(
        'hair',
        color[0] + style.zh,
        color[1] + ' ' + style.en,
        [color[0] + '的' + style.zh],
        [],
        'haircolor+hairstyle'
      );
    });
  });

  // 时间 / 天气 × 场景
  const TIME_ZH = [
    '清晨', '黎明', '日出', '上午', '中午', '午后', '黄金时刻', '蓝调时刻',
    '黄昏', '日落', '傍晚', '夜晚', '深夜', '午夜', '春天', '夏天', '秋天',
    '冬天', '雨季', '雪季'
  ];
  const SCENE_ZH = [
    '街边', '城市街道', '老街道', '小巷', '咖啡馆', '餐厅', '酒吧', '图书馆',
    '书店', '卧室', '客厅', '厨房', '办公室', '教室', '火车站', '地铁站',
    '机场', '公园', '花园', '森林', '竹林', '海滩', '海边', '湖边', '河边',
    '山谷', '山顶', '雪山', '草原', '花田', '薰衣草田', '乡村', '古镇',
    '城堡', '宫殿', '寺庙', '教堂', '博物馆', '美术馆', '摄影棚', '舞台',
    '桥', '码头', '港口', '灯塔', '摩天大楼', '天台', '广场', '商业街',
    '步行街', '夜市', '便利店', '商场', '地铁车厢', '公交车内', '火车车厢',
    '飞机舱', '游艇', '洞穴', '火山', '冰川', '瀑布', '溪流', '稻田',
    '茶园', '葡萄园', '樱花林', '枫叶林', '沙漠公路', '海边悬崖', '海底',
    '珊瑚礁', '星空', '银河', '浮空岛', '魔法森林', '废墟城市', '未来都市',
    '赛博朋克街区', '蒸汽朋克城市', '和风庭院', '中式园林', '屋顶泳池',
    '天台酒吧', '咖啡馆露台', '森林木屋', '灯塔海岸'
  ];
  const scenes = many('scene', SCENE_ZH);
  const times = many('time', TIME_ZH);

  function timePhrase(en) {
    if (/^(golden hour|blue hour|sunrise|sunset)$/i.test(en)) return 'during ' + en;
    if (/^(early morning|morning|afternoon|early afternoon|spring|summer|autumn|winter|late spring|midsummer|late autumn|deep winter|rainy season|snowy season|holiday)$/i.test(en)) {
      return 'in the ' + en;
    }
    return 'at ' + en;
  }

  times.forEach(function (time) {
    scenes.forEach(function (scene) {
      addGenerated(
        'scene',
        time.zh + '的' + scene.zh,
        scene.en + ' ' + timePhrase(time.en),
        [time.zh + scene.zh],
        [],
        'time+scene'
      );
    });
  });

  const WEATHER_MODS = [
    ['晴天', 'sunny'], ['多云', 'cloudy'], ['阴天', 'overcast'], ['下雨', 'rainy'],
    ['小雨', 'drizzly'], ['暴雨', 'stormy'], ['下雪', 'snowy'], ['雾', 'foggy'],
    ['薄雾', 'misty'], ['刮风', 'windy'], ['暴风雨', 'stormy'], ['雷雨', 'stormy'],
    ['阵雨', 'showery'], ['沙尘', 'dusty'], ['潮湿', 'humid'], ['闷热', 'muggy'],
    ['雪后', 'snow-covered'], ['雨后', 'wet'], ['彩虹', 'rainbow'], ['冰雹', 'hail'],
    ['台风', 'stormy']
  ];
  const WEATHER_SCENE_ZH = [
    '街边', '城市街道', '老街道', '小巷', '公园', '花园', '森林', '竹林',
    '海滩', '海边', '湖边', '河边', '山谷', '山顶', '雪山', '草原', '花田',
    '薰衣草田', '乡村', '古镇', '城堡', '寺庙', '教堂', '桥', '码头', '港口',
    '灯塔', '摩天大楼', '天台', '广场', '商业街', '步行街', '夜市', '游艇',
    '洞穴', '火山', '冰川', '瀑布', '溪流', '稻田', '茶园', '葡萄园',
    '樱花林', '枫叶林', '沙漠公路', '海边悬崖', '浮空岛', '魔法森林',
    '废墟城市', '未来都市', '赛博朋克街区', '蒸汽朋克城市', '和风庭院',
    '中式园林', '屋顶泳池', '天台酒吧', '咖啡馆露台', '森林木屋', '灯塔海岸'
  ];
  const weatherScenes = many('scene', WEATHER_SCENE_ZH);
  const COLD_SCENES = { '雪山': true, '冰川': true, '极光': true };
  const DRY_SCENES = { '沙漠公路': true, '火山': true, '洞穴': true };
  const PEACEFUL_SCENES = {
    '花园': true, '和风庭院': true, '中式园林': true, '葡萄园': true,
    '茶园': true, '咖啡馆露台': true, '屋顶泳池': true, '天台酒吧': true
  };
  WEATHER_MODS.forEach(function (weather) {
    weatherScenes.forEach(function (scene) {
      if ((weather[0] === '闷热' || weather[0] === '潮湿') && (COLD_SCENES[scene.zh] || DRY_SCENES[scene.zh])) return;
      if (/暴风雨|台风|雷雨/.test(weather[0]) && PEACEFUL_SCENES[scene.zh]) return;
      if (/冰雹|彩虹/.test(weather[0]) && (scene.zh === '海底' || scene.zh === '珊瑚礁')) return;
      const en = weather[1] === 'rainbow'
        ? scene.en + ' with a rainbow'
        : weather[1] === 'hail'
          ? scene.en + ' with hail'
          : weather[1] + ' ' + scene.en;
      addGenerated(
        'scene',
        weather[0] + '的' + scene.zh,
        en,
        [weather[0] + scene.zh],
        [],
        'weather+scene'
      );
    });
  });

  // 光质 × 光型
  const LIGHT_MODIFIERS = [
    ['柔和', 'soft'], ['温暖', 'warm'], ['冷色', 'cool'], ['金色', 'golden'],
    ['蓝色', 'blue'], ['红色', 'red'], ['紫色', 'purple'], ['绿色', 'green'],
    ['明亮', 'bright'], ['昏暗', 'dim'], ['高对比', 'high-contrast'],
    ['低对比', 'low-contrast']
  ];
  const LIGHT_TYPES = many('light', [
    '自然光', '窗光', '逆光', '侧光', '顶光', '轮廓光', '月光', '烛光',
    '星光', '火光', '霓虹光', '影棚光', '电影光', '戏剧性光', '斑驳光影',
    '丁达尔光', '体积光', '镜头光晕', '路灯光', '环境光', '阳光', '晨光',
    '聚光灯', '舞台光', '蝴蝶光', '伦勃朗光', '环形光', '分割光',
    '漫射光', '直射光'
  ]);
  LIGHT_MODIFIERS.forEach(function (mod) {
    LIGHT_TYPES.forEach(function (light) {
      if (mod[0] === '柔和' && /直射光/.test(light.zh)) return;
      if (mod[0] === '昏暗' && /阳光|晨光|直射光|自然光|聚光灯/.test(light.zh)) return;
      if (mod[0] === '低对比' && /直射光/.test(light.zh)) return;
      if (mod[0] === '高对比' && /柔光|漫射光/.test(light.zh)) return;
      if (mod[0] === '冷色' && /烛光|火光/.test(light.zh)) return;
      if (mod[0] === '温暖' && /月光/.test(light.zh)) return;
      addGenerated(
        'light',
        mod[0] + light.zh,
        mod[1] + ' ' + light.en,
        [mod[0] + '的' + light.zh],
        [],
        'light+light'
      );
    });
  });

  // 焦距 × 景别
  const FOCALS = many('camera', ['24mm', '35mm', '50mm', '85mm', '135mm']);
  const SHOTS = many('camera', ['特写', '大特写', '中景', '全身照', '半身照', '上半身', '远景', '中近景']);
  FOCALS.forEach(function (focal) {
    SHOTS.forEach(function (shot) {
      addGenerated(
        'camera',
        focal.zh + shot.zh,
        focal.en + ' ' + shot.en,
        [],
        [],
        'focal+shot'
      );
    });
  });

  // 以首字符/首字母分桶，匹配时只检查同首字符候选，保证移动端也够快。
  function buildIndex(field) {
    const index = Object.create(null);
    entries.forEach(function (entry) {
      entry[field].forEach(function (alias) {
        const key = alias.charAt(0).toLowerCase();
        if (!index[key]) index[key] = [];
        index[key].push({ alias: alias, entry: entry });
      });
    });
    Object.keys(index).forEach(function (key) {
      index[key].sort(function (a, b) {
        return b.alias.length - a.alias.length;
      });
    });
    return index;
  }

  const zhIndex = buildIndex('zhAliases');
  const enIndex = buildIndex('enAliases');

  const byCategory = Object.create(null);
  entries.forEach(function (entry) {
    if (!byCategory[entry.category]) byCategory[entry.category] = [];
    byCategory[entry.category].push(entry);
  });

  const totalZhAliases = entries.reduce(function (sum, e) { return sum + e.zhAliases.length; }, 0);
  const totalEnAliases = entries.reduce(function (sum, e) { return sum + e.enAliases.length; }, 0);

  T2I.Lexicon = {
    entries: entries,
    byCategory: byCategory,
    zhIndex: zhIndex,
    enIndex: enIndex,
    slotOfCategory: SLOT_OF_CATEGORY,
    categoryLabel: CATEGORY_LABEL,
    stats: {
      canonicalEntries: entries.length,
      sourceRows: sourceRowCount,
      zhAliases: totalZhAliases,
      enAliases: totalEnAliases,
      categories: Object.keys(ALL_GROUPS).length,
      manualEntries: manualEntryCount,
      generatedEntries: entries.length - manualEntryCount
    }
  };
})();
