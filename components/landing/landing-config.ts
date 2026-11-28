export interface SocialChannelStage {
  id: string;
  label: string;
  shortLabel: string;
  status: "supported" | "planned" | "brand";
  badge: string;
  description: string;
  colorHex: string;
  secondaryHex: string;
  rgb: readonly [number, number, number];
  secondaryRgb: readonly [number, number, number];
}

/**
 * 品牌配置单一事实源：
 * 修改 brandName 后，首页 WebGPU 光束粒子最终汇聚的品牌文字与页面标题将自动同步更新。
 */
export const LANDING_BRAND_CONFIG = {
  brandName: "F-Trade-Platform",
  shortBrand: "F-Trade",
  heroLine1: "让工厂资料有序运转，",
  heroLine2: "把精力留给海外成单。",
  heroLeadPrefix: "F-Trade 面向制造与外贸企业，帮助你",
  heroLeadHighlight: "以可核验的工程事实开展海外获客。",
  heroLeadSuffix:
    "在同一工作台打通产品资料结构化、多渠道内容与 15 秒实拍短视频、受控社媒发布、客户询盘补全与人工报价，每一步都清晰可控。",
  accessNote:
    "仅受邀用户可访问 · 邮箱 OTP 与 Passkey 登录 · 不自动生成正式报价、交期或未经确认的工程事实",
} as const;

export const SOCIAL_CHANNEL_STAGES: readonly SocialChannelStage[] = [
  {
    id: "facebook",
    label: "Facebook",
    shortLabel: "Facebook",
    status: "supported",
    badge: "MVP1 已接入",
    description: "已完成受控图文与 15 秒营销视频发布回执验收，以及被动 DM 客户询盘入站闭环。",
    colorHex: "#4AB0FF",
    secondaryHex: "#FFFFFF",
    rgb: [0.29, 0.69, 1.0],
    secondaryRgb: [0.92, 0.97, 1.0],
  },
  {
    id: "youtube",
    label: "YouTube",
    shortLabel: "YouTube",
    status: "planned",
    badge: "16:9 预设就绪",
    description:
      "已内置 1920×1080 横屏 ABCD 创意框架与字幕规范，支持后续海外长视频与 Shorts 扩展。",
    colorHex: "#FF5C5C",
    secondaryHex: "#FFD1D1",
    rgb: [1.0, 0.36, 0.36],
    secondaryRgb: [1.0, 0.82, 0.82],
  },
  {
    id: "instagram",
    label: "Instagram",
    shortLabel: "Instagram",
    status: "planned",
    badge: "9:16 预设就绪",
    description: "已具备 1080×1920 竖屏 Reels 剪辑预设与静音可读字幕约束，规划接入品牌视觉获客。",
    colorHex: "#F472B6",
    secondaryHex: "#FBCFE8",
    rgb: [0.96, 0.45, 0.71],
    secondaryRgb: [0.99, 0.81, 0.91],
  },
  {
    id: "tiktok",
    label: "TikTok",
    shortLabel: "TikTok",
    status: "planned",
    badge: "9:16 预设就绪",
    description: "适配海外短视频快速触达节奏，坚持真实工厂授权素材剪辑，不虚构产品结构。",
    colorHex: "#38BDF8",
    secondaryHex: "#99F6E4",
    rgb: [0.22, 0.74, 0.97],
    secondaryRgb: [0.6, 0.96, 0.89],
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    shortLabel: "LinkedIn",
    status: "planned",
    badge: "B2B 规划中",
    description: "面向海外汽配进口商、批发商与分销商的决策人内容分发与专业询盘承接。",
    colorHex: "#60A5FA",
    secondaryHex: "#DBEAFE",
    rgb: [0.38, 0.65, 0.98],
    secondaryRgb: [0.86, 0.92, 1.0],
  },
  {
    id: "x",
    label: "X",
    shortLabel: "X",
    status: "planned",
    badge: "行业动态规划",
    description: "面向行业快讯与静音信息流的轻量产品曝光与线索导流渠道。",
    colorHex: "#E5E7EB",
    secondaryHex: "#4AB0FF",
    rgb: [0.9, 0.91, 0.92],
    secondaryRgb: [0.29, 0.69, 1.0],
  },
  {
    id: "brand",
    label: LANDING_BRAND_CONFIG.brandName,
    shortLabel: LANDING_BRAND_CONFIG.shortBrand,
    status: "brand",
    badge: "统一工作台汇聚",
    description:
      "所有社媒触点最终汇聚于同一受控工作台：统一证据库、统一人工门禁、统一询盘与商机流转。",
    colorHex: "#4AB0FF",
    secondaryHex: "#FFFFFF",
    rgb: [0.29, 0.69, 1.0],
    secondaryRgb: [1.0, 1.0, 1.0],
  },
] as const;

export const HERO_STATS = [
  { value: "4", suffix: "个", label: "专职业务 Agent · 产品 / 内容 / 销售 / 跟单" },
  { value: "3", suffix: "类", label: "强制人工把关 · 事实 / 报价 / 交期" },
  { value: "100", suffix: "%", label: "产品字段绑定工厂私有证据来源" },
] as const;

export const MARQUEE_ITEMS = [
  "Facebook · MVP1 已接入",
  "YouTube · 16:9 预设就绪",
  "Instagram · 9:16 预设就绪",
  "TikTok · 9:16 预设就绪",
  "LinkedIn · B2B 规划中",
  "X · 动态渠道规划",
  "Product Agent · 目录结构化",
  "Content Agent · 15 秒实拍剪辑",
  "Sales Agent · RFQ 补全",
  "Follow-up Agent · 可解释跟单",
] as const;

export interface WorkflowTabItem {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  breadcrumb: string;
  actionLabel: string;
  statusBadge: string;
  rows: readonly {
    id: string;
    primary: string;
    secondary: string;
    meta: string;
    state: "verified" | "pending" | "active";
  }[];
  footerTitle: string;
  footerMeta: string;
  footerStatus: string;
}

export const WORKFLOW_TABS: readonly WorkflowTabItem[] = [
  {
    id: "product",
    eyebrow: "Product Agent · 产品结构化",
    title: "把工厂原始目录，整理为逐字段可溯源的产品对象",
    subtitle:
      "支持上传授权 PDF、CSV、XLS 与 XLSX 目录（最大 25MB），通过私有存储与 MarkItDown 预处理提取 SKU、OE 号、车型适配与离合器规格，自动标记缺失项并阻断无依据字段。",
    breadcrumb: "工作台 › 产品资料 › 目录录入",
    actionLabel: "提交核验",
    statusBadge: "待核对",
    rows: [
      {
        id: "1",
        primary: "Clutch_Kit_Catalog_2026.pdf",
        secondary: "OE 编号与车型适配提取",
        meta: "私有证据已绑定",
        state: "verified",
      },
      {
        id: "2",
        primary: "CK-240-TY08 · 离合器套装",
        secondary: "直径 240mm · 花键齿数与尺寸",
        meta: "来源页码 #14",
        state: "verified",
      },
      {
        id: "3",
        primary: "摩擦材料与包装规格",
        secondary: "缺少工厂实测寿命与 MOQ 依据",
        meta: "待核对",
        state: "pending",
      },
      {
        id: "4",
        primary: "真实产品图册 (3 张实拍)",
        secondary: "校验像素与权利来源，禁止 AI 伪造结构",
        meta: "证据已归档",
        state: "verified",
      },
    ],
    footerTitle: "进入人工事实核验",
    footerMeta: "营销语言可生成，工程事实必须有工厂来源",
    footerStatus: "待核对",
  },
  {
    id: "review",
    eyebrow: "人工事实与发布把关",
    title: "关键业务边界，始终由人做最终决定",
    subtitle:
      "审批记录与业务对象独立存储，运行时状态机强制校验审批人、时间与版本引用。Agent 无法绕过门禁直接将产品置为就绪、对外发布或发送报价。",
    breadcrumb: "工作台 › 审核中心 › 门禁规则",
    actionLabel: "批准进入就绪",
    statusBadge: "人工把关",
    rows: [
      {
        id: "1",
        primary: "产品与内容真实性审核",
        secondary: "核对 OE 号、适配车型、尺寸与图文一致性",
        meta: "人工把关",
        state: "active",
      },
      {
        id: "2",
        primary: "正式报价审批与有效期",
        secondary: "价格、MOQ、付款条款与日历起止日期人工确认",
        meta: "仅限人工创建",
        state: "verified",
      },
      {
        id: "3",
        primary: "交期与产能确认",
        secondary: "绑定当前 RFQ，批准结果 7 天有效，过期自动拦截",
        meta: "工厂管理员确认",
        state: "verified",
      },
      {
        id: "4",
        primary: "逐帖发布二次确认",
        secondary: "审批通过不等于自动发布，需人工显式排入队列",
        meta: "签名回执留痕",
        state: "verified",
      },
    ],
    footerTitle: "三道强制人工防线",
    footerMeta: "独立审批表 + 不可变事件流重放",
    footerStatus: "人工把关",
  },
  {
    id: "content",
    eyebrow: "Content Agent · 图文与短视频",
    title: "基于已核验产品，生成三类外贸内容与 15 秒实拍视频",
    subtitle:
      "围绕已通过核验的产品事实生成产品介绍、应用场景与专业采购指南，并可在独立视频工作台剪辑授权工厂素材，输出多平台静音可读成片。",
    breadcrumb: "工作台 › 内容与发布 › 草稿队列",
    actionLabel: "逐帖确认发布",
    statusBadge: "待审发布",
    rows: [
      {
        id: "1",
        primary: "产品型图文 · Clutch Kit 适配解析",
        secondary: "全部 OE 与规格字段自动关联已核验产品",
        meta: "待审发布",
        state: "pending",
      },
      {
        id: "2",
        primary: "15 秒竖屏营销视频 (1080×1920)",
        secondary: "授权实拍片段剪辑 · 双语硬字幕 · 静音可读",
        meta: "成片已渲染",
        state: "verified",
      },
      {
        id: "3",
        primary: "受控 Facebook 发布队列",
        secondary: "单一授权 Worker 短期签名命令领取执行",
        meta: "固定出口校验",
        state: "active",
      },
      {
        id: "4",
        primary: "永久链接回执自动写回",
        secondary: "仅验签后的平台回执可标记为已发布",
        meta: "异常自动熔断",
        state: "verified",
      },
    ],
    footerTitle: "受控渠道发布边界",
    footerMeta: "遇风控或页面异动立即暂停，禁止自动重试",
    footerStatus: "待审发布",
  },
  {
    id: "sales",
    eyebrow: "Sales & Follow-up · 询盘到商机",
    title: "把模糊的社媒私信，推进为结构化 RFQ 与有效商机",
    subtitle:
      "被动接收客户主动发起的海外询盘，由 Sales Agent 识别缺失参数并生成澄清建议；业务员补齐 RFQ、发起人工报价与交期确认，配合可控跟进计划推进至有效商机。",
    breadcrumb: "工作台 › 客户与询盘 › 商机闭环",
    actionLabel: "发起人工报价",
    statusBadge: "跟进中",
    rows: [
      {
        id: "1",
        primary: "被动 DM 入站去重领取",
        secondary: "仅接收客户主动消息，严禁窗口外自动骚扰回复",
        meta: "原子去重",
        state: "verified",
      },
      {
        id: "2",
        primary: "模糊询盘 → 标准 RFQ 补全",
        secondary: "追问车型年份、发动机、OE 号、目标数量与目的港",
        meta: "字段完整度 92%",
        state: "active",
      },
      {
        id: "3",
        primary: "人工报价单与时区有效期",
        secondary: "明确起止日期与适用时区，复制不等于已发送",
        meta: "已审批待发",
        state: "verified",
      },
      {
        id: "4",
        primary: "可解释线索评分与提醒计划",
        secondary: "支持设备时区与夏令时消歧，人工认定有效商机",
        meta: "目标：有效商机",
        state: "verified",
      },
    ],
    footerTitle: "可审计的外贸销售漏斗",
    footerMeta: "从首条私信到正式报价全程留痕",
    footerStatus: "有效商机",
  },
] as const;

export const COMPARISON_ROWS = [
  {
    stage: "产品目录整理",
    before: "Excel / PDF 分散在个人电脑，参数口径不一",
    after: "Product Agent 结构化提取 + 逐字段绑定私有证据",
    result: "参数准确可追溯",
  },
  {
    stage: "社媒图文与视频",
    before: "外包周期长，或 AI 生成失真产品结构图",
    after: "基于已核验事实生成文案 + 15 秒授权实拍剪辑",
    result: "真实专业、合规发布",
  },
  {
    stage: "海外渠道运营",
    before: "多平台盲目铺量，风控与回执状态黑盒",
    after: "逐帖人工确认 + 签名回执写回 + 异常自动熔断",
    result: "账号与投放更可控",
  },
  {
    stage: "客户询盘响应",
    before: "社媒私信漏跟、缺参数直接凭感觉报低价",
    after: "被动入站去重 + 标准 RFQ 缺失项追问引导",
    result: "有效询盘率提升",
  },
  {
    stage: "正式报价与交期",
    before: "口头承诺交期与价格，历史版本难以核对",
    after: "人工报价审批 + 7 天有效交期确认 + 审计留痕",
    result: "零越权承诺风险",
  },
] as const;

export interface FaqItem {
  id: string;
  category: "产品与事实" | "安全与把关" | "渠道与部署";
  question: string;
  answer: string;
}

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: "faq-1",
    category: "产品与事实",
    question: "AI 会不会自行编造 OE 号、车型适配或离合器尺寸？",
    answer:
      "不会。平台严格遵循“营销语言可生成，工程事实必须来自工厂资料或人工确认”的边界。所有产品字段均需绑定已上传的私有证据引用，未绑定证据或核心参数缺失的产品无法进入就绪状态。",
  },
  {
    id: "faq-2",
    category: "产品与事实",
    question: "营销视频是 AI 直接生成的吗？会不会导致花键或零件结构失真？",
    answer:
      "不是。第一阶段营销视频只剪辑工厂已上传且登记权利证据的真实素材（最长 15 秒），AI 仅提供可编辑的剪辑初稿与字幕建议，不在第一阶段启用文生视频或图生视频模型，避免机械结构失真。",
  },
  {
    id: "faq-3",
    category: "安全与把关",
    question: "系统会自动给海外客户发报价或承诺交期吗？",
    answer:
      "绝不会。Sales Agent 只负责整理和追问 RFQ 信息。正式报价必须由业务员人工创建并经审批通过后才能登记发送；涉及生产交期与样品承诺时，必须由工厂管理员人工确认，且确认结果具有 7 天有效期。",
  },
  {
    id: "faq-4",
    category: "安全与把关",
    question: "工厂原始目录、报价与模型密钥如何保护？",
    answer:
      "工厂上传的目录和素材以受限私有对象存储，不暴露公开链接；工作区采用邀请制登录（邮箱 OTP 验证码与 Passkey，无公开注册、无密码登录）；模型 API Key 采用 AES-256-GCM 加密保存且永不回显。",
  },
  {
    id: "faq-5",
    category: "渠道与部署",
    question: "目前支持哪些海外社交媒体？未来会扩展哪些平台？",
    answer:
      "第一阶段优先打通 Facebook 受控图文/视频发布与被动 DM 询盘闭环，确保单渠道转化可衡量；平台已内置 YouTube（16:9）、Instagram（9:16）、TikTok（9:16）等视频导出预设，后续将按业务验证节奏逐步扩展至 LinkedIn 与 X 等渠道。",
  },
] as const;
