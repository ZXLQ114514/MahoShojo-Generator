export type ConfigurationCatalogEntry = {
  name: string;
  key: string;
  defaultValue: string;
  effect: string;
  management: 'admin' | 'env' | 'file';
};

export type ConfigurationCatalogCategory = {
  id: string;
  title: string;
  description: string;
  entries: ConfigurationCatalogEntry[];
};

export const configurationCatalog: ConfigurationCatalogCategory[] = [
  {
    id: 'generation',
    title: '生成与供应商',
    description: 'AI 供应商、模型选择和生成请求策略。密钥仅允许放在服务端环境变量中。',
    entries: [
      { name: 'AI 供应商列表', key: 'AI_PROVIDERS_CONFIG', defaultValue: '空数组', effect: '配置服务端供应商、模型、权重、重试次数和跳过概率。', management: 'env' },
      { name: '负载均衡策略', key: 'AI_LOAD_BALANCE_STRATEGY', defaultValue: 'random', effect: '控制多个供应商的选择方式：sequential、random、round_robin。', management: 'env' },
      { name: '公开 AI 生成间隔', key: 'public_ai_cooldown_*', defaultValue: '系统 60 秒 / 免费 120 秒 / 自定义 3 秒 / 战斗 120 秒', effect: '限制公开生成和战斗战报的连续请求频率。', management: 'admin' },
      { name: '公开战报角色评价总结', key: 'public_battle_summary_*', defaultValue: '启用 / 1440 分钟 / 系统默认模型', effect: '按周期总结非日常公开战报并生成角色评价；分数和等级由服务端固定公式计算。', management: 'admin' },
      { name: '流式读取超时', key: 'NEXT_PUBLIC_STREAM_READ_*_TIMEOUT_MS', defaultValue: 'idle 150000 / total 600000', effect: '控制流式生成的空闲超时和总超时。', management: 'env' },
    ],
  },
  {
    id: 'safety',
    title: '内容安全与原生性',
    description: '控制敏感词、AI 安全审查、打包连坐和原生数据校验。',
    entries: [
      { name: '安全检查总开关', key: 'NEXT_PUBLIC_ENABLE_AI_SAFETY_CHECK', defaultValue: 'false', effect: '启用或关闭 AI 内容安全检查。', management: 'env' },
      { name: '安全检查策略', key: 'NEXT_PUBLIC_SAFETY_CHECK_POLICY', defaultValue: 'character/scenario non-native-only；userGuidance all', effect: '分别控制角色、情景和故事引导的检查范围。', management: 'env' },
      { name: '安全提示词等级', key: 'NEXT_PUBLIC_AI_SAFETY_PROMPT_LEVEL', defaultValue: 'moderate', effect: '可选 strict、moderate、lenient。', management: 'env' },
      { name: '敏感词过滤', key: 'NEXT_PUBLIC_ENABLE_SENSITIVE_WORD_FILTER', defaultValue: 'true', effect: '控制敏感词和拼音检测。', management: 'env' },
      { name: '打包安全检查', key: 'NEXT_PUBLIC_ENABLE_BUNDLE_SAFETY_CHECK', defaultValue: 'true', effect: '控制组合内容的连带安全检查。', management: 'env' },
      { name: '原生场景检查跳过', key: 'NEXT_PUBLIC_SKIP_NATIVE_SCENARIO_CHECK', defaultValue: 'true', effect: '控制原生情景是否跳过部分检查。', management: 'env' },
      { name: '引导升华原生签名', key: 'ALLOW_GUIDED_SUBLIMATION_NATIVE_SIGNING', defaultValue: 'false', effect: '控制引导升华结果是否允许保持原生签名。', management: 'env' },
    ],
  },
  {
    id: 'account',
    title: '账号、邮件与安全',
    description: '账号系统和邮件服务的部署配置，不在网页中显示具体密钥。',
    entries: [
      { name: 'Better Auth 密钥', key: 'BETTER_AUTH_SECRET', defaultValue: '必填随机密钥', effect: '签发和校验账号会话。', management: 'env' },
      { name: 'Better Auth 地址', key: 'BETTER_AUTH_URL', defaultValue: '根据请求推断', effect: '设置认证回调和来源校验的基准地址。', management: 'env' },
      { name: '受信任来源', key: 'BETTER_AUTH_TRUSTED_ORIGINS', defaultValue: '空', effect: '配置登录/注册允许的来源地址，多个地址用逗号分隔。', management: 'env' },
      { name: 'Resend 邮件密钥', key: 'RESEND_API_KEY', defaultValue: '可选', effect: '用于验证邮件、找回密码等邮件发送。', management: 'env' },
      { name: 'Turnstile', key: 'NEXT_PUBLIC_TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY', defaultValue: '可选', effect: '配置注册和登录的人机验证。', management: 'env' },
    ],
  },
  {
    id: 'storage',
    title: 'Cloudflare 与存储',
    description: 'D1 为核心数据库，R2 用于可选的大对象存储。',
    entries: [
      { name: 'Cloudflare D1', key: 'CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID / CLOUDFLARE_API_TOKEN', defaultValue: '必填', effect: '连接用户、角色卡、审核和站点设置数据。', management: 'env' },
      { name: 'Cloudflare R2', key: 'R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME / R2_ENDPOINT', defaultValue: '可选', effect: '存储战报全文等大对象，未配置时回退到 D1。', management: 'env' },
      { name: '战报预览存储', key: 'config/battle-report.ts', defaultValue: 'persistPreviewInD1 true / full', effect: '控制战报预览是否保存在 D1，以及全文或摘要模式。', management: 'file' },
    ],
  },
  {
    id: 'site',
    title: '站点功能与资格',
    description: '功能入口、容量和测试资格属于代码配置，修改后需要重新构建部署。',
    entries: [
      { name: '功能入口分类', key: 'config/features.ts', defaultValue: '代码默认值', effect: '控制首页功能入口、名称、图片和链接。', management: 'file' },
      { name: '数据卡容量与回收站', key: 'lib/config.ts: DEFAULT_DATA_CARD_CAPACITY / RECYCLE_BIN_LIMIT', defaultValue: '20 / 5', effect: '控制用户默认卡槽和回收站数量。', management: 'file' },
      { name: '公开卡自动审核', key: 'lib/config.ts: DATA_CARD_AUTO_REVIEW', defaultValue: '启用', effect: '控制公开角色卡的自动审核队列、批量阈值和模型回退。', management: 'file' },
      { name: '测试功能资格', key: 'config/beta-access.ts', defaultValue: '按徽章/公开卡/使用量/收藏量', effect: '控制魔法茶会、魔法茶馆、立绘和挑战入口资格。', management: 'file' },
      { name: '赛季配置', key: 'public/config/seasons.json', defaultValue: '当前赛季文件', effect: '控制排位赛季的名称、状态和时间。', management: 'file' },
    ],
  },
];
