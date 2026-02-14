export interface WordPair {
  civilian: string;
  undercover: string;
}

export interface PickedWordPair {
  pair: WordPair;
  key: string;
}

interface WordDomain {
  words: readonly string[];
  offsets: readonly number[];
  sceneTags: readonly string[];
}

const curatedFunnyWordPairs: WordPair[] = [
  { civilian: '地铁', undercover: '公交车' },
  { civilian: '共享单车', undercover: '共享电动车' },
  { civilian: '奶奶', undercover: '老母鸡' },
  { civilian: '榴莲', undercover: '大粪' },
  { civilian: '臭豆腐', undercover: '臭袜子' },
  { civilian: '香菜', undercover: '牙膏' },
  { civilian: '外卖小哥', undercover: '快递小哥' },
  { civilian: '老板', undercover: '甲方' },
  { civilian: '甲方', undercover: '乙方' },
  { civilian: '班主任', undercover: '教导主任' },
  { civilian: '数学老师', undercover: '体育老师' },
  { civilian: '同桌', undercover: '同事' },
  { civilian: '室友', undercover: '上铺' },
  { civilian: '下铺', undercover: '蚊子' },
  { civilian: '电梯', undercover: '扶梯' },
  { civilian: '雨伞', undercover: '雨衣' },
  { civilian: '拖把', undercover: '扫把' },
  { civilian: '垃圾桶', undercover: '回收箱' },
  { civilian: '热水壶', undercover: '保温杯' },
  { civilian: '电饭煲', undercover: '微波炉' },
  { civilian: '炒锅', undercover: '电磁炉' },
  { civilian: '菜刀', undercover: '砧板' },
  { civilian: '牙刷', undercover: '马桶刷' },
  { civilian: '洗发水', undercover: '沐浴露' },
  { civilian: '吹风机', undercover: '吸尘器' },
  { civilian: '门锁', undercover: '指纹锁' },
  { civilian: '拖鞋', undercover: '棉鞋' },
  { civilian: '米饭', undercover: '稀饭' },
  { civilian: '饺子', undercover: '馄饨' },
  { civilian: '包子', undercover: '馒头' },
  { civilian: '泡面', undercover: '螺蛳粉' },
  { civilian: '牛肉面', undercover: '酸辣粉' },
  { civilian: '手抓饼', undercover: '鸡蛋灌饼' },
  { civilian: '煎饺', undercover: '锅贴' },
  { civilian: '烤冷面', undercover: '凉皮' },
  { civilian: '汉堡', undercover: '肉夹馍' },
  { civilian: '炸鸡', undercover: '烤鸭' },
  { civilian: '披萨', undercover: '葱油饼' },
  { civilian: '火锅', undercover: '麻辣烫' },
  { civilian: '烧烤', undercover: '串串' },
  { civilian: '小龙虾', undercover: '螃蟹' },
  { civilian: '奶茶', undercover: '咖啡' },
  { civilian: '可乐', undercover: '啤酒' },
  { civilian: '雪碧', undercover: '苏打水' },
  { civilian: '酸奶', undercover: '豆浆' },
  { civilian: '柠檬水', undercover: '白开水' },
  { civilian: '冰淇淋', undercover: '雪糕' },
  { civilian: '蛋挞', undercover: '蛋糕' },
  { civilian: '提拉米苏', undercover: '驴打滚' },
  { civilian: '糖葫芦', undercover: '冰糖雪梨' },
  { civilian: '辣条', undercover: '猫条' },
  { civilian: '薯片', undercover: '锅巴' },
  { civilian: '瓜子', undercover: '花生' },
  { civilian: '猫', undercover: '狗' },
  { civilian: '仓鼠', undercover: '荷兰猪' },
  { civilian: '兔子', undercover: '羊驼' },
  { civilian: '大鹅', undercover: '保安' },
  { civilian: '公鸡', undercover: '闹钟' },
  { civilian: '蟑螂', undercover: '小强' },
  { civilian: '蚊子', undercover: '吸血鬼' },
  { civilian: '蜗牛', undercover: '快递龟速件' },
  { civilian: '海豚', undercover: '鲨鱼' },
  { civilian: '章鱼', undercover: '鱿鱼' },
  { civilian: '手机', undercover: '平板' },
  { civilian: '电脑', undercover: '笔记本' },
  { civilian: '键盘', undercover: '电子琴' },
  { civilian: '鼠标', undercover: '遥控器' },
  { civilian: '耳机', undercover: '助听器' },
  { civilian: '音箱', undercover: '广场舞音响' },
  { civilian: '充电宝', undercover: '暖手宝' },
  { civilian: '路由器', undercover: '光猫' },
  { civilian: '验证码', undercover: '红包口令' },
  { civilian: '朋友圈', undercover: '家族群' },
  { civilian: '表情包', undercover: '身份证照' },
  { civilian: '短视频', undercover: '监控录像' },
  { civilian: '直播间', undercover: '菜市场叫卖' },
  { civilian: '网盘', undercover: '抽屉' },
  { civilian: '云盘', undercover: 'U盘' },
  { civilian: '超市', undercover: '菜市场' },
  { civilian: '便利店', undercover: '小卖部' },
  { civilian: '药店', undercover: '奶茶店' },
  { civilian: '医院', undercover: '修理厂' },
  { civilian: '学校', undercover: '驾校' },
  { civilian: '图书馆', undercover: '咖啡馆' },
  { civilian: '网吧', undercover: '电竞酒店' },
  { civilian: '电影院', undercover: 'KTV' },
  { civilian: '夜市', undercover: '庙会' },
  { civilian: '商场', undercover: '步行街' },
  { civilian: '奶茶店', undercover: '彩票站' },
  { civilian: '早餐店', undercover: '烧烤摊' },
  { civilian: '办公室', undercover: '会议室' },
  { civilian: '跑步', undercover: '逃课' },
  { civilian: '加班', undercover: '摸鱼' },
  { civilian: '早起', undercover: '熬夜' },
  { civilian: '排队', undercover: '插队' },
  { civilian: '打卡', undercover: '补签' },
  { civilian: '请假', undercover: '旷工' },
  { civilian: '叫代驾', undercover: '走路回家' },
  { civilian: '点外卖', undercover: '自己做饭' },
  { civilian: '砍价', undercover: '一口价' },
  { civilian: '拼单', undercover: '独享' },
  { civilian: '团购', undercover: '冲动消费' },
  { civilian: '抢红包', undercover: '发红包' },
  { civilian: '唱歌', undercover: '喊麦' },
  { civilian: '跳舞', undercover: '广播体操' },
  { civilian: '斗地主', undercover: '打麻将' },
  { civilian: '狼人杀', undercover: '谁是卧底' },
  { civilian: '剧本杀', undercover: '密室逃脱' },
  { civilian: '看电影', undercover: '看监控' },
  { civilian: '拍照', undercover: '扫脸' },
  { civilian: '修图', undercover: '美颜' },
  { civilian: '连麦', undercover: '开会' },
  { civilian: '追星', undercover: '追债' },
  { civilian: '飞盘', undercover: '锅盖' }
];

const everydayDomains: WordDomain[] = [
  {
    words: [
      '地铁',
      '公交车',
      '出租车',
      '网约车',
      '共享单车',
      '共享电动车',
      '电动车',
      '摩托车',
      '私家车',
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
      '喇叭',
      '后备箱',
      '雨刷',
      '车票',
      '月票',
      '一卡通',
      '站牌',
      '终点站',
      '末班车'
    ],
    offsets: [1, 3, 5, 7],
    sceneTags: ['早高峰', '晚高峰', '下雨天']
  },
  {
    words: [
      '米饭',
      '面条',
      '饺子',
      '包子',
      '馒头',
      '油条',
      '豆浆',
      '煎饼',
      '麻辣烫',
      '火锅',
      '烧烤',
      '烤鱼',
      '小龙虾',
      '牛肉面',
      '鸡蛋灌饼',
      '手抓饼',
      '炸鸡',
      '汉堡',
      '薯条',
      '披萨',
      '炒饭',
      '盖浇饭',
      '卤肉饭',
      '泡面',
      '凉皮',
      '米线',
      '螺蛳粉',
      '臭豆腐',
      '烤冷面',
      '肉夹馍',
      '煎饺',
      '馄饨',
      '羊肉串',
      '鸭血粉丝',
      '番茄炒蛋',
      '拍黄瓜'
    ],
    offsets: [1, 3, 5, 7],
    sceneTags: ['食堂', '夜宵', '周末吃']
  },
  {
    words: [
      '奶茶',
      '咖啡',
      '可乐',
      '雪碧',
      '果汁',
      '酸梅汤',
      '绿茶',
      '红茶',
      '乌龙茶',
      '柠檬水',
      '矿泉水',
      '气泡水',
      '酸奶',
      '纯牛奶',
      '豆奶',
      '椰汁',
      '冰淇淋',
      '雪糕',
      '双皮奶',
      '布丁',
      '蛋挞',
      '慕斯',
      '芝士蛋糕',
      '提拉米苏',
      '糖葫芦',
      '烤红薯',
      '爆米花',
      '棉花糖',
      '巧克力',
      '薯片',
      '瓜子',
      '花生',
      '开心果',
      '辣条',
      '山楂片',
      '果冻'
    ],
    offsets: [1, 3, 5, 7],
    sceneTags: ['便利店', '追剧', '加班夜']
  },
  {
    words: [
      '奶奶',
      '外婆',
      '爷爷',
      '外公',
      '老母鸡',
      '老爸',
      '老妈',
      '叔叔',
      '阿姨',
      '舅舅',
      '舅妈',
      '姑姑',
      '姑父',
      '表哥',
      '表姐',
      '堂哥',
      '堂姐',
      '弟弟',
      '妹妹',
      '哥哥',
      '姐姐',
      '邻居大爷',
      '小区保安',
      '快递小哥',
      '外卖小哥',
      '理发师',
      '修鞋匠',
      '小卖部老板',
      '班主任',
      '体育老师',
      '数学老师',
      '前台小姐姐',
      '老板',
      '店员',
      '同桌',
      '室友'
    ],
    offsets: [1, 3, 5, 7],
    sceneTags: ['家庭群', '过年', '小区里']
  },
  {
    words: [
      '猫',
      '狗',
      '仓鼠',
      '兔子',
      '乌龟',
      '金鱼',
      '鹦鹉',
      '鸽子',
      '麻雀',
      '燕子',
      '大鹅',
      '鸭子',
      '母鸡',
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
      '长颈鹿',
      '斑马',
      '海豚',
      '企鹅',
      '章鱼',
      '鲨鱼',
      '蜗牛',
      '蟑螂'
    ],
    offsets: [1, 3, 5, 7],
    sceneTags: ['动物园', '乡下', '宠物店']
  },
  {
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
    ],
    offsets: [1, 3, 5, 7],
    sceneTags: ['家里', '宿舍', '出租屋']
  },
  {
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
      '打印机',
      '二维码',
      '验证码',
      '短视频',
      '直播间',
      '弹幕',
      '热搜',
      '朋友圈',
      '群聊',
      '表情包',
      '红包',
      '语音消息',
      '视频通话',
      '截图',
      '录屏',
      '云盘',
      '网盘',
      '浏览器',
      '搜索框',
      '输入法',
      '显卡',
      '硬盘'
    ],
    offsets: [1, 3, 5, 7],
    sceneTags: ['办公室', '地铁上', '网课时']
  },
  {
    words: [
      '超市',
      '菜市场',
      '小卖部',
      '便利店',
      '药店',
      '医院',
      '学校',
      '图书馆',
      '自习室',
      '食堂',
      '操场',
      '篮球场',
      '羽毛球馆',
      '网吧',
      '电影院',
      'KTV',
      '理发店',
      '洗车店',
      '加油站',
      '火车站',
      '高铁站',
      '机场',
      '地铁站',
      '公交站',
      '停车场',
      '公园',
      '广场',
      '夜市',
      '商场',
      '步行街',
      '奶茶店',
      '咖啡店',
      '早餐店',
      '烧烤摊',
      '健身房',
      '会议室'
    ],
    offsets: [1, 3, 5, 7],
    sceneTags: ['周末', '雨天', '下班后']
  },
  {
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
      '熬夜',
      '早起',
      '打卡',
      '迟到',
      '请假',
      '背单词',
      '聊天',
      '发呆',
      '遛狗',
      '喂猫',
      '买菜',
      '砍价',
      '拼单'
    ],
    offsets: [1, 3, 5, 7],
    sceneTags: ['工作日', '休息日', '摸鱼时']
  },
  {
    words: [
      '唱歌',
      '跳舞',
      '看电影',
      '看综艺',
      '听相声',
      '打麻将',
      '斗地主',
      '狼人杀',
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
      '下棋',
      '围棋',
      '象棋',
      '台球',
      '飞盘'
    ],
    offsets: [1, 3, 5, 7],
    sceneTags: ['周末局', '团建', '假期里']
  }
];

function sanitizeWord(raw: string): string {
  return raw.trim().replace(/\s+/g, '');
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

function looksTooSimilar(leftRaw: string, rightRaw: string): boolean {
  const left = sanitizeWord(leftRaw);
  const right = sanitizeWord(rightRaw);
  if (!left || !right || left === right) {
    return true;
  }

  if (left.length >= 3 && right.length >= 3 && (left.includes(right) || right.includes(left))) {
    return true;
  }

  const distance = levenshteinDistance(left, right);
  const maxLength = Math.max(left.length, right.length);
  if (maxLength <= 8 && distance <= 2) {
    return true;
  }
  const similarityRatio = 1 - distance / maxLength;
  if (maxLength <= 12 && similarityRatio >= 0.82) {
    return true;
  }
  if (maxLength > 12 && similarityRatio >= 0.88) {
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
    if (!civilian || !undercover) {
      continue;
    }
    if (looksTooSimilar(civilian, undercover)) {
      continue;
    }

    const key = canonicalPairKey(civilian, undercover);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({ civilian, undercover });
  }

  return result;
}

function buildShiftPairs(words: readonly string[], offsets: readonly number[]): WordPair[] {
  const normalizedWords = words.map((word) => sanitizeWord(word)).filter((word) => Boolean(word));
  const uniqueWords = Array.from(new Set(normalizedWords));
  const pairs: WordPair[] = [];

  if (uniqueWords.length < 2) {
    return pairs;
  }

  for (const rawOffset of offsets) {
    const offset = Math.abs(rawOffset) % uniqueWords.length;
    if (offset === 0) {
      continue;
    }

    for (let index = 0; index < uniqueWords.length; index += 1) {
      const civilian = uniqueWords[index];
      const undercover = uniqueWords[(index + offset) % uniqueWords.length];
      pairs.push({ civilian, undercover });
    }
  }

  return pairs;
}

function buildSceneVariantPairs(basePairs: WordPair[], sceneTags: readonly string[]): WordPair[] {
  const result: WordPair[] = [];

  for (const tag of sceneTags) {
    const normalizedTag = sanitizeWord(tag);
    if (!normalizedTag) {
      continue;
    }

    for (const pair of basePairs) {
      result.push({
        civilian: `${normalizedTag}${pair.civilian}`,
        undercover: `${normalizedTag}${pair.undercover}`
      });
    }
  }

  return result;
}

function buildGeneratedWordPairs(): WordPair[] {
  const generated: WordPair[] = [];

  for (const domain of everydayDomains) {
    const basePairs = buildShiftPairs(domain.words, domain.offsets);
    generated.push(...basePairs);
    generated.push(...buildSceneVariantPairs(basePairs, domain.sceneTags));
  }

  return generated;
}

export const wordPairs: WordPair[] = dedupeWordPairs([...curatedFunnyWordPairs, ...buildGeneratedWordPairs()]);

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
