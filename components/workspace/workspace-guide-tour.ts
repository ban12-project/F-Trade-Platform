import { type DriveStep, driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./workspace-guide.css";

type Hint = { selector: string; title: string; description: string };

const hints: Hint[] = [
  {
    selector: '[data-guide="mobile-navigation"]',
    title: "打开工作区导航",
    description:
      "退出引导后，点击这里打开产品资料、内容与发布、客户与询盘等入口。每个页面顶部都可以重新打开使用引导。",
  },
  {
    selector: '[data-guide="new-work"]',
    title: "先选工作，再选项目",
    description:
      "录入产品、制作内容和记录询盘都从这里开始。已有项目可以继续使用；只有需要独立管理资料和成员时才新建。",
  },
  {
    selector: '[data-guide="products"]',
    title: "1 · 产品资料",
    description:
      "上传获授权的 PDF、CSV 或 Excel。多产品文件选择产品目录，解析后选取要导入的条目，再逐项核实事实与来源。",
  },
  {
    selector: '[data-guide="content"]',
    title: "2 · 内容与素材",
    description:
      "从已核验产品制作文案或视频。检查内容和素材权利、保存修改，再提交审核；审核通过后才安排具体发布。",
  },
  {
    selector: '[data-guide="customers"]',
    title: "3 · 询盘到商机",
    description:
      "整理客户需求并补齐 RFQ，再由人确认报价和交期。根据客户回复跟进，最后明确认定有效商机。演示询盘请标明模拟。",
  },
  {
    selector: "#product-source-file",
    title: "选择资料文件",
    description:
      "先选择文件，再确认录入方式。上传文件会保存为来源证据；目录解析是异步任务，可刷新进度继续，避免重复上传。",
  },
  {
    selector: '[aria-label="资料录入方式"]',
    title: "区分单个产品与目录",
    description:
      "一份资料对应一个产品时使用单个产品；包含多条产品时选择产品目录。也可以手动录入已经核实的信息并绑定证据。",
  },
  {
    selector: "#catalog-progress",
    title: "等待目录解析完成",
    description:
      "扫描目录需要逐页识别，可能等待数分钟。可以刷新进度或稍后返回；若解析失败，使用原任务的重试入口，不必重新上传相同文件。",
  },
  {
    selector: "#catalog-selection-heading",
    title: "选取需要录入的产品",
    description:
      "按目录编号和原件页码选取记录，每批最多 20 条。先从一条开始核对也可以。抽取完成后打开对应草稿，原件不清晰的字段需要逐项核实。",
  },
  {
    selector: 'form[id$="-product-review"]',
    title: "核实产品事实",
    description:
      "对照原件确认名称、编号、类型和 OE 或适配信息。缺少依据时退回补充；批准只覆盖有证据的事实。",
  },
  {
    selector: 'form[id$="-revise-product"], form[id$="-create-product"]',
    title: "补充有来源依据的字段",
    description:
      "根据审核备注对照原件，填写产品名称、类型和编号，并为每个字段选择对应证据。没有依据的规格和商业条款保持空白；提交修订后重新审核。",
  },
  {
    selector: "form[data-content-review]",
    title: "审核当前内容版本",
    description:
      "检查文案是否与已核验产品一致，并记录审核依据。需要修改时先退回；修订后的版本需要重新审核。",
  },
  {
    selector: 'a[href*="/new/content?product="]',
    title: "用已核验产品制作内容",
    description:
      "从这里开始第一条图文内容，产品会自动带入。没有实物图片时可以先制作文字内容；视频按需制作。",
  },
  {
    selector: 'form[id^="register-product-media-"]',
    title: "按需登记视频素材",
    description:
      "制作视频前，先登记确实属于当前产品的图片或视频，并说明来源、可见内容和授权范围。素材经独立审核后才能复用；没有匹配素材时可以先继续图文流程。",
  },
  {
    selector: "#publication-channel",
    title: "审核通过后安排发布",
    description:
      "核对最终文案、已启用渠道和账户，再单独确认本次发布。没有可用渠道时，可以保留已批准内容并继续其他工作；已批准不代表已发布。",
  },
  {
    selector: 'a[href*="/new/rfq"]',
    title: "从客户会话整理需求",
    description:
      "从这里把当前会话带入 RFQ，先整理消息建议，再核对并保存。演示会话需要标明模拟，已经记录的需求可以直接继续处理。",
  },
  {
    selector: 'form#create-rfq, form[id^="revise-rfq-"]',
    title: "整理并保存客户需求",
    description:
      "有客户会话时可先从消息整理建议。核对产品类型、OE 或品牌与车型、数量和目的地，再保存；建议不会自动创建或确认 RFQ。",
  },
  {
    selector: '[aria-label="需求完整度"]',
    title: "补齐后确认需求",
    description:
      "先补全缺失字段并保存，再确认需求完整。随后引用已核验产品创建人工报价。已有有效 RFQ 可以直接继续，无需等待新私信。",
  },
  {
    selector: 'a[href*="/new/quotation"]',
    title: "需求确认后创建报价",
    description:
      "带着当前 RFQ 进入报价，选择已核验产品并录入人工确认的商业条款。系统不会根据产品目录自动承诺价格或交期。",
  },
  {
    selector: 'form#quotation-new, form[id^="quotation-"]',
    title: "录入人工报价",
    description:
      "确认所选产品和 RFQ，再填写经人工确认的价格、MOQ、交期、付款条件和报价依据，提交审核。演示数据必须标明模拟。",
  },
  {
    selector: 'form[id^="quote-decision-"]',
    title: "审核报价",
    description:
      "检查当前版本的商业条款及依据，再批准或退回。报价修订后，旧版本的批准不能继续使用。",
  },
  {
    selector: "#content-source-product",
    title: "引用已核验产品",
    description:
      "选定产品和需要引用的事实，再填写内容目标与目标客户。生成后逐项检查文案，不把营销表达当作新的工程事实。",
  },
  {
    selector: "#content-body",
    title: "编辑并保存内容",
    description: "检查正文、行动提示和视觉说明。保存草稿后提交审核；批准当前内容不等于已经发布。",
  },
  {
    selector: '[aria-label="视频总时长"]',
    title: "检查视频剪辑",
    description:
      "检查片段顺序、时长和字幕。产品外观使用获授权的素材，事实字幕引用已核验字段；保存后合成并预览成片。",
  },
  {
    selector: "#video-review-evidence",
    title: "记录成片审核依据",
    description:
      "先完整播放成片，核对字幕与素材权利，再填写本次审核依据。成片批准与具体渠道发布分别处理。",
  },
  {
    selector: 'form[id^="quote-send-"]',
    title: "登记报价发送凭据",
    description:
      "通过审核后，按实际发送情况填写渠道和凭据。演示时使用明确标记的模拟凭据；登记状态不会代替真实外部投递。",
  },
  {
    selector: 'form[id^="delivery-"]',
    title: "确认本次交期",
    description:
      "根据工厂或人工确认结果填写天数与依据。未确认、已过期或不属于当前询盘的交期不能用于回复承诺。",
  },
  {
    selector: 'form[id^="follow-up-"]',
    title: "按客户反馈制定跟进",
    description:
      "选择未读、已读未回、嫌贵、以后采购、要样品或询问交期，核对建议和提醒时间。保存计划与确认发送是两个独立操作。",
  },
  {
    selector: 'form[id^="opportunity-"]',
    title: "明确认定有效商机",
    description:
      "核对需求、报价、交期和意向评分，填写本次认定依据，再确认有效商机。评分建议本身不会自动完成认定。",
  },
];

function visible(selector: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
    (element) =>
      element.getClientRects().length > 0 && !element.closest('[inert], [aria-hidden="true"]'),
  );
}

export function startWorkspaceGuide(pathname: string, onDestroyed: () => void) {
  const kind = pathname.match(/\/(?:records|new)\/([^/]+)/)?.[1];
  const record = !!kind || pathname.endsWith("/video");
  const steps: DriveStep[] = [
    {
      element: visible("main h1"),
      popover: {
        title: record ? "从当前这一步继续" : "从资料到有效商机",
        description: record
          ? "这里讲解当前可见的操作。退出引导后填写、保存或审核；进入下一页面后，可以再次打开使用引导。"
          : "产品资料 → 内容与素材 → 客户询盘 → 人工报价与交期 → 跟进和商机。先熟悉入口，再从自己的项目开始。",
      },
    },
  ];
  for (const hint of hints) {
    if (record && hint.selector.startsWith("[data-guide=")) continue;
    const element = visible(hint.selector);
    if (element)
      steps.push({ element, popover: { title: hint.title, description: hint.description } });
  }
  steps.push({
    popover: {
      title: "按实际资料继续操作",
      description:
        "关闭引导后继续当前工作。看不到某项操作时，先检查记录状态、项目归属和成员权限。保存、审核、发送和商机认定都需要单独操作；看完引导不会改变业务状态。",
    },
  });
  const tour = driver({
    steps,
    animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    smoothScroll: false,
    allowClose: true,
    disableActiveInteraction: true,
    showProgress: true,
    progressText: "{{current}} / {{total}}",
    nextBtnText: "下一步",
    prevBtnText: "上一步",
    doneBtnText: "开始操作",
    closeBtnLabel: "退出引导",
    popoverClass: "workspace-guide-popover",
    onDestroyStarted: (_element, _step, { driver }) => {
      // onDestroyed is skipped by Driver when closed during its first animation.
      driver.destroy();
      onDestroyed();
    },
  });
  tour.drive();
  return tour;
}
