export interface WordPair {
  civilian: string;
  undercover: string;
  hint: string;
}

export interface PickedWordPair {
  pair: WordPair;
  key: string;
}

interface WordDomain {
  topic: string;
  words: readonly string[];
  offsets: readonly number[];
  hintTemplates: readonly string[];
}

const curatedChaosPairs: WordPair[] = [
  {
    civilian: '袜子',
    undercover: '臭豆腐',
    hint: '都和“独特味道”有关，描述得太具体就会翻车。'
  },
  {
    civilian: '老婆',
    undercover: '老板',
    hint: '通常都是你最怕的人，而且都要经常汇报。'
  },
  {
    civilian: '大饼',
    undercover: '披萨',
    hint: '都偏圆形面食，看着像亲戚但细节差很多。'
  },
  {
    civilian: '温度计',
    undercover: '验孕棒',
    hint: '都像“测结果”的细长工具，但用途完全不同。'
  },
  {
    civilian: '垃圾',
    undercover: '前男友',
    hint: '在某些情绪里，常被归为“不该留在身边的东西”。'
  },
  {
    civilian: '人工呼吸',
    undercover: '接吻',
    hint: '都要嘴对嘴，旁观者容易先想歪。'
  },
  {
    civilian: '黑洞',
    undercover: '肚脐眼',
    hint: '都像一个“洞”，但一个是宇宙级，一个是人体级。'
  },
  {
    civilian: '毛绒玩具',
    undercover: '泰迪犬',
    hint: '都毛茸茸，经常被抱着，但一个会动一个不会。'
  },
  {
    civilian: '电灯泡',
    undercover: '秃头',
    hint: '都可能亮晶晶反光，画面感非常强。'
  },
  {
    civilian: '厨房',
    undercover: '洗手间',
    hint: '家里都常去，也都离不开水。'
  },
  {
    civilian: '奶奶',
    undercover: '老母鸡',
    hint: '都可能让你联想到“喂你吃东西的存在”。'
  },
  {
    civilian: '榴莲',
    undercover: '大粪',
    hint: '都主打“闻名不如闻到”，气味争议巨大。'
  },
  {
    civilian: '房子',
    undercover: '棺材',
    hint: '都能“住人”，但入住时机完全不同。'
  },
  {
    civilian: '相亲',
    undercover: '面试',
    hint: '都要展示自己，结束后都可能说“回去等通知”。'
  },
  {
    civilian: '体检',
    undercover: '查岗',
    hint: '都让人紧张，生怕被发现问题。'
  },
  {
    civilian: '自拍',
    undercover: '证件照',
    hint: '都是拍自己，一个滤镜拉满，一个表情冻结。'
  },
  {
    civilian: '闹钟',
    undercover: '公鸡',
    hint: '都擅长叫你起床，而且都很不讲情面。'
  },
  {
    civilian: '围裙',
    undercover: '防弹衣',
    hint: '都像穿在身前的“保护装备”，只是场景不同。'
  },
  {
    civilian: '地铁',
    undercover: '公交车',
    hint: '都负责通勤，挤的时候都很考验心理素质。'
  },
  {
    civilian: '共享单车',
    undercover: '共享电动车',
    hint: '都在路边扫一下就走，但体力消耗不一样。'
  },
  {
    civilian: '外卖小哥',
    undercover: '快递小哥',
    hint: '都常在门口出现，一个送吃的，一个送买的。'
  },
  {
    civilian: '甲方',
    undercover: '老板',
    hint: '都能让你反复改方案，且你不敢怼。'
  },
  {
    civilian: '加班',
    undercover: '摸鱼',
    hint: '都发生在工位上，精神状态却完全相反。'
  },
  {
    civilian: '泡面',
    undercover: '螺蛳粉',
    hint: '都能深夜救命，但一个“味道攻击”更强。'
  },
  {
    civilian: '奶茶',
    undercover: '咖啡',
    hint: '都能续命提神，但阵营常年互喷。'
  },
  {
    civilian: '辣条',
    undercover: '猫条',
    hint: '名字听着像同类，但适用对象会决定你是否进医院。'
  },
  {
    civilian: '耳机',
    undercover: '助听器',
    hint: '都挂耳边，一个听歌，一个听世界。'
  },
  {
    civilian: '路由器',
    undercover: '光猫',
    hint: '都跟网有关，家里断网时谁都逃不过背锅。'
  },
  {
    civilian: '验证码',
    undercover: '红包口令',
    hint: '都得“输对了”才有下一步，错了就白忙。'
  },
  {
    civilian: '朋友圈',
    undercover: '家族群',
    hint: '都能看到消息，一个晒生活，一个催婚催生。'
  },
  {
    civilian: '短视频',
    undercover: '监控录像',
    hint: '都能看回放，一个解闷，一个破案。'
  },
  {
    civilian: '直播间',
    undercover: '菜市场',
    hint: '都有人吆喝、讲优惠、让你赶紧下单。'
  },
  {
    civilian: '图书馆',
    undercover: '咖啡馆',
    hint: '都能久坐，一个靠书香，一个靠咖香。'
  },
  {
    civilian: '夜市',
    undercover: '庙会',
    hint: '都热闹、都能边走边吃、都容易钱包变瘦。'
  },
  {
    civilian: '跑步',
    undercover: '逃课',
    hint: '都看起来很快，但一个是自律，一个是心虚。'
  },
  {
    civilian: '请假',
    undercover: '旷工',
    hint: '都可能不出现在工位，合规程度天差地别。'
  },
  {
    civilian: '团购',
    undercover: '冲动消费',
    hint: '都可能让你省钱失败，事后只剩反思。'
  },
  {
    civilian: '抢红包',
    undercover: '发红包',
    hint: '都发生在群里，一个激动，一个心痛。'
  },
  {
    civilian: '唱歌',
    undercover: '喊麦',
    hint: '都拿麦克风输出情绪，优雅程度各有看法。'
  },
  {
    civilian: '狼人杀',
    undercover: '谁是卧底',
    hint: '都靠演技和逻辑，朋友局常常变恩怨局。'
  },
  {
    civilian: '看电影',
    undercover: '看监控',
    hint: '都在盯画面，一个图享受，一个图证据。'
  },
  {
    civilian: '追星',
    undercover: '追债',
    hint: '都在“追”，一个花钱，一个要钱。'
  },
  {
    civilian: '飞盘',
    undercover: '锅盖',
    hint: '都圆圆的能甩，使用场景决定你像运动员还是厨子。'
  }
];

const sharedHintTemplates = [
  '都和“{topic}”有关，听着像一类，细讲用途就会露馅。',
  '都很日常，描述时稍微多说两句就容易翻车。',
  '都能在生活里碰到，越想伪装越容易暴露细节。',
  '都像同阵营词，但关键差异往往特别搞笑。'
] as const;

const domainWordBank: WordDomain[] = [
  {
    topic: '通勤交通',
    offsets: [2, 5, 9, 14, 17],
    hintTemplates: sharedHintTemplates,
    words: [
      '地铁',
      '公交车',
      '出租车',
      '网约车',
      '共享单车',
      '共享电动车',
      '私家车',
      '摩托车',
      '电动车',
      '高铁',
      '火车',
      '飞机',
      '轮船',
      '电梯',
      '扶梯',
      '过街天桥',
      '地下通道',
      '红绿灯',
      '斑马线',
      '站台',
      '候车亭',
      '停车场',
      '加油站',
      '收费站',
      '导航',
      '方向盘',
      '安全带',
      '后备箱',
      '喇叭',
      '雨刷',
      '车票',
      '月票',
      '一卡通',
      '站牌',
      '终点站',
      '末班车'
    ]
  },
  {
    topic: '主食和正餐',
    offsets: [2, 5, 9, 14, 17],
    hintTemplates: sharedHintTemplates,
    words: [
      '米饭',
      '面条',
      '饺子',
      '馄饨',
      '包子',
      '馒头',
      '油条',
      '煎饼',
      '手抓饼',
      '鸡蛋灌饼',
      '牛肉面',
      '酸辣粉',
      '米线',
      '螺蛳粉',
      '凉皮',
      '烤冷面',
      '肉夹馍',
      '麻辣烫',
      '火锅',
      '烧烤',
      '串串',
      '烤鱼',
      '小龙虾',
      '炒饭',
      '盖浇饭',
      '卤肉饭',
      '炸鸡',
      '汉堡',
      '披萨',
      '薯条',
      '番茄炒蛋',
      '拍黄瓜',
      '宫保鸡丁',
      '红烧肉',
      '白粥',
      '泡面'
    ]
  },
  {
    topic: '饮料和甜品',
    offsets: [2, 5, 9, 14, 17],
    hintTemplates: sharedHintTemplates,
    words: [
      '奶茶',
      '咖啡',
      '可乐',
      '雪碧',
      '气泡水',
      '矿泉水',
      '白开水',
      '柠檬水',
      '果汁',
      '酸梅汤',
      '绿茶',
      '红茶',
      '乌龙茶',
      '豆浆',
      '纯牛奶',
      '酸奶',
      '椰汁',
      '冰淇淋',
      '雪糕',
      '双皮奶',
      '布丁',
      '蛋挞',
      '芝士蛋糕',
      '提拉米苏',
      '慕斯',
      '糖葫芦',
      '巧克力',
      '棉花糖',
      '爆米花',
      '果冻',
      '薯片',
      '瓜子',
      '花生',
      '开心果',
      '辣条',
      '山楂片'
    ]
  },
  {
    topic: '家居用品',
    offsets: [2, 5, 9, 14, 17],
    hintTemplates: sharedHintTemplates,
    words: [
      '牙刷',
      '牙膏',
      '毛巾',
      '脸盆',
      '香皂',
      '洗发水',
      '沐浴露',
      '吹风机',
      '梳子',
      '镜子',
      '拖鞋',
      '雨伞',
      '钥匙',
      '门锁',
      '窗帘',
      '床单',
      '被子',
      '枕头',
      '台灯',
      '插座',
      '充电器',
      '插线板',
      '热水壶',
      '保温杯',
      '电饭煲',
      '炒锅',
      '菜刀',
      '砧板',
      '冰箱',
      '微波炉',
      '洗衣机',
      '扫把',
      '拖把',
      '垃圾桶',
      '纸巾',
      '抹布'
    ]
  },
  {
    topic: '数码网络',
    offsets: [2, 5, 9, 14, 17],
    hintTemplates: sharedHintTemplates,
    words: [
      '手机',
      '平板',
      '电脑',
      '笔记本',
      '鼠标',
      '键盘',
      '显示器',
      '耳机',
      '音箱',
      '充电宝',
      '数据线',
      '蓝牙',
      'WiFi',
      '路由器',
      '光猫',
      '打印机',
      '二维码',
      '验证码',
      '短视频',
      '直播间',
      '弹幕',
      '热搜',
      '朋友圈',
      '家族群',
      '表情包',
      '红包口令',
      '语音消息',
      '视频通话',
      '截图',
      '录屏',
      '云盘',
      '网盘',
      '浏览器',
      '搜索框',
      '输入法',
      '监控录像'
    ]
  },
  {
    topic: '职场校园',
    offsets: [2, 5, 9, 14, 17],
    hintTemplates: sharedHintTemplates,
    words: [
      '老板',
      '甲方',
      '乙方',
      '同事',
      '实习生',
      '前台',
      'HR',
      '班主任',
      '教导主任',
      '数学老师',
      '体育老师',
      '同桌',
      '室友',
      '上铺',
      '下铺',
      '组长',
      '部门经理',
      '老板娘',
      '秘书',
      '会议室',
      '工位',
      '办公室',
      '白板',
      '投影仪',
      '打卡机',
      '请假条',
      '绩效表',
      '周报',
      '方案',
      'PPT',
      '作业本',
      '考试卷',
      '草稿纸',
      '自习室',
      '图书馆',
      '食堂'
    ]
  },
  {
    topic: '人物关系',
    offsets: [2, 5, 9, 14, 17],
    hintTemplates: sharedHintTemplates,
    words: [
      '奶奶',
      '外婆',
      '爷爷',
      '外公',
      '老妈',
      '老爸',
      '叔叔',
      '阿姨',
      '舅舅',
      '舅妈',
      '姑姑',
      '姑父',
      '哥哥',
      '姐姐',
      '弟弟',
      '妹妹',
      '表哥',
      '表姐',
      '堂哥',
      '堂姐',
      '邻居大爷',
      '小区保安',
      '外卖小哥',
      '快递小哥',
      '理发师',
      '修鞋匠',
      '小卖部老板',
      '前男友',
      '前女友',
      '现男友',
      '现女友',
      '老婆',
      '老公',
      '闺蜜',
      '兄弟',
      '损友'
    ]
  },
  {
    topic: '身体和健康',
    offsets: [2, 5, 9, 14, 17],
    hintTemplates: sharedHintTemplates,
    words: [
      '头发',
      '秃头',
      '电灯泡',
      '黑眼圈',
      '肚脐眼',
      '黑洞',
      '心脏',
      '肺',
      '胃',
      '肝',
      '肾',
      '血压计',
      '温度计',
      '验孕棒',
      '创可贴',
      '绷带',
      '口罩',
      '消毒液',
      '体温',
      '发烧',
      '感冒',
      '咳嗽',
      '打喷嚏',
      '失眠',
      '熬夜',
      '早起',
      '人工呼吸',
      '接吻',
      '减肥',
      '增肌',
      '体检',
      '挂号',
      '急诊',
      '牙疼',
      '胃疼',
      '腰疼'
    ]
  },
  {
    topic: '动物和宠物',
    offsets: [2, 5, 9, 14, 17],
    hintTemplates: sharedHintTemplates,
    words: [
      '猫',
      '狗',
      '泰迪犬',
      '毛绒玩具',
      '仓鼠',
      '荷兰猪',
      '兔子',
      '羊驼',
      '乌龟',
      '金鱼',
      '鹦鹉',
      '鸽子',
      '麻雀',
      '燕子',
      '大鹅',
      '鸭子',
      '老母鸡',
      '公鸡',
      '猪',
      '牛',
      '羊',
      '马',
      '驴',
      '骆驼',
      '熊猫',
      '松鼠',
      '刺猬',
      '狐狸',
      '狼',
      '老虎',
      '狮子',
      '猴子',
      '海豚',
      '鲨鱼',
      '章鱼',
      '蟑螂'
    ]
  },
  {
    topic: '城市场所',
    offsets: [2, 5, 9, 14, 17],
    hintTemplates: sharedHintTemplates,
    words: [
      '超市',
      '菜市场',
      '便利店',
      '小卖部',
      '药店',
      '医院',
      '学校',
      '图书馆',
      '自习室',
      '操场',
      '篮球场',
      '羽毛球馆',
      '网吧',
      '电影院',
      'KTV',
      '理发店',
      '洗车店',
      '火车站',
      '高铁站',
      '机场',
      '地铁站',
      '公交站',
      '停车场',
      '公园',
      '广场',
      '夜市',
      '庙会',
      '商场',
      '步行街',
      '奶茶店',
      '咖啡店',
      '早餐店',
      '烧烤摊',
      '健身房',
      '厨房',
      '洗手间'
    ]
  },
  {
    topic: '娱乐活动',
    offsets: [2, 5, 9, 14, 17],
    hintTemplates: sharedHintTemplates,
    words: [
      '唱歌',
      '喊麦',
      '跳舞',
      '广播体操',
      '看电影',
      '看综艺',
      '听相声',
      '打麻将',
      '斗地主',
      '狼人杀',
      '谁是卧底',
      '剧本杀',
      '密室逃脱',
      '羽毛球',
      '乒乓球',
      '篮球',
      '足球',
      '游泳',
      '滑冰',
      '滑雪',
      '爬山',
      '露营',
      '野餐',
      '拍照',
      '修图',
      '发朋友圈',
      '直播',
      '连麦',
      '看球赛',
      '追星',
      '逛漫展',
      '拼乐高',
      '看小说',
      '听播客',
      '台球',
      '飞盘'
    ]
  },
  {
    topic: '日常行为',
    offsets: [2, 5, 9, 14, 17],
    hintTemplates: sharedHintTemplates,
    words: [
      '跑步',
      '散步',
      '骑车',
      '开车',
      '挤地铁',
      '等公交',
      '排队',
      '插队',
      '刷牙',
      '洗脸',
      '洗头',
      '洗衣服',
      '做饭',
      '点外卖',
      '叫代驾',
      '追剧',
      '刷短视频',
      '打游戏',
      '写作业',
      '开会',
      '摸鱼',
      '加班',
      '午睡',
      '发呆',
      '打卡',
      '补签',
      '请假',
      '旷工',
      '背单词',
      '聊天',
      '遛狗',
      '喂猫',
      '买菜',
      '砍价',
      '拼单',
      '团购'
    ]
  }
];

function sanitizeWord(raw: string): string {
  return raw.trim().replace(/\s+/g, '');
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) {
      break;
    }
    count += 1;
  }
  return count;
}

function commonSuffixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  for (let index = 1; index <= limit; index += 1) {
    if (left[left.length - index] !== right[right.length - index]) {
      break;
    }
    count += 1;
  }
  return count;
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function looksTooTemplateLike(leftRaw: string, rightRaw: string): boolean {
  const left = sanitizeWord(leftRaw);
  const right = sanitizeWord(rightRaw);
  if (!left || !right || left === right) {
    return true;
  }

  if (left.length >= 5 && right.length >= 5 && (left.includes(right) || right.includes(left))) {
    return true;
  }

  const prefix = commonPrefixLength(left, right);
  const suffix = commonSuffixLength(left, right);
  if (Math.min(left.length, right.length) >= 4 && (prefix >= 3 || suffix >= 3)) {
    return true;
  }

  const maxLength = Math.max(left.length, right.length);
  const distance = levenshteinDistance(left, right);
  if (maxLength >= 5 && distance <= 1 && (prefix >= 2 || suffix >= 2)) {
    return true;
  }

  return false;
}

function canonicalPairKey(civilian: string, undercover: string): string {
  return civilian < undercover ? `${civilian}|${undercover}` : `${undercover}|${civilian}`;
}

function dedupeWordPairs(input: WordPair[]): WordPair[] {
  const seen = new Set<string>();
  const result: WordPair[] = [];

  for (const pair of input) {
    const civilian = sanitizeWord(pair.civilian);
    const undercover = sanitizeWord(pair.undercover);
    const hint = pair.hint.trim();

    if (!civilian || !undercover || !hint) {
      continue;
    }

    if (looksTooTemplateLike(civilian, undercover)) {
      continue;
    }

    const key = canonicalPairKey(civilian, undercover);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({ civilian, undercover, hint });
  }

  return result;
}

function buildDomainHint(domain: WordDomain, index: number, offset: number): string {
  const template = domain.hintTemplates[(index + offset) % domain.hintTemplates.length] ??
    '都和“{topic}”有关，越解释越容易暴露。';
  return template.replace('{topic}', domain.topic);
}

function buildDomainPairs(domain: WordDomain): WordPair[] {
  const uniqueWords = Array.from(new Set(domain.words.map((word) => sanitizeWord(word)).filter((word) => Boolean(word))));
  const result: WordPair[] = [];

  if (uniqueWords.length < 2) {
    return result;
  }

  for (const rawOffset of domain.offsets) {
    const normalizedOffset = Math.abs(rawOffset) % uniqueWords.length;
    if (normalizedOffset === 0) {
      continue;
    }

    for (let index = 0; index < uniqueWords.length; index += 1) {
      const civilian = uniqueWords[index];
      const undercover = uniqueWords[(index + normalizedOffset) % uniqueWords.length];
      result.push({
        civilian,
        undercover,
        hint: buildDomainHint(domain, index, normalizedOffset)
      });
    }
  }

  return result;
}

function buildGeneratedWordPairs(): WordPair[] {
  const generated: WordPair[] = [];

  for (const domain of domainWordBank) {
    generated.push(...buildDomainPairs(domain));
  }

  return generated;
}

export const wordPairs: WordPair[] = dedupeWordPairs([...curatedChaosPairs, ...buildGeneratedWordPairs()]);

export const WORD_PAIR_COUNT = wordPairs.length;

export function createWordPairKey(pair: WordPair): string {
  return `${pair.civilian}|${pair.undercover}`;
}

export function getRandomWordPair(lastKey?: string): PickedWordPair {
  const candidates = lastKey ? wordPairs.filter((pair) => createWordPairKey(pair) !== lastKey) : wordPairs;
  const pool = candidates.length > 0 ? candidates : wordPairs;
  const pair = pool[Math.floor(Math.random() * pool.length)];

  return {
    pair,
    key: createWordPairKey(pair)
  };
}
