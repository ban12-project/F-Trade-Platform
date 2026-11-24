import { type DriveStep, driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./workspace-guide.css";

type Hint = { selector: string; title: string; description: string };

const hints: Hint[] = [
  {
    selector: '[data-guide="mobile-navigation"]',
    title: "打开工作区导航",
    description:
      "退出引导后，点击这里切换产品资料、内容与发布、客户与询盘。顶部随时可重新打开使用引导。",
  },
  {
    selector: '[data-guide="new-work"]',
    title: "先选工作，再选项目",
    description: "录入产品、制作内容和记录询盘都从这里开始。已有项目可继续使用，无需每次新建。",
  },
  {
    selector: '[data-guide="task-refresh"]',
    title: "确认任务列表是否最新",
    description:
      "页面停留期间状态不会自动更新；退出引导后可点刷新任务重新读取，并保留当前筛选。刷新不会发送消息或提交审核。",
  },
  {
    selector: '[data-guide="products"]',
    title: "1 · 产品资料",
    description: "上传获授权的 PDF、CSV 或 Excel；多产品目录解析后挑选条目导入，再逐项核实来源。",
  },
  {
    selector: '[data-guide="content"]',
    title: "2 · 内容与素材",
    description: "用已核验产品制作文案或视频，保存后提交审核；审核通过后才可安排发布。",
  },
  {
    selector: '[data-guide="customers"]',
    title: "3 · 询盘到商机",
    description: "整理客户需求并补齐 RFQ，由人工确认报价和交期，跟进客户回复后认定有效商机。",
  },
  {
    selector: "#product-source-file",
    title: "选择资料文件",
    description:
      "选择文件后不会立即上传，点击开始后可随时停止。若目录提交状态不明确，先看已有进度再决定是否重传。",
  },
  {
    selector: '[aria-label="资料录入方式"]',
    title: "区分单个产品与目录",
    description: "单品资料选“单个产品”，多款汇总表选“产品目录”，也可手动录入并绑定来源资料。",
  },
  {
    selector: "#catalog-progress",
    title: "等待目录解析完成",
    description:
      "目录开始解析后可随时返回查看进度。若解析失败，可直接在原任务点击重试，不必重新上传。",
  },
  {
    selector: "#catalog-selection-heading",
    title: "选取需要录入的产品",
    description: "按编号和页码勾选要导入的产品（每批最多 20 条），生成草稿后对照原件核实即可。",
  },
  {
    selector: 'form[id$="-product-review"]',
    title: "核实产品事实",
    description: "对照原件确认名称、编号、类型和 OE 适配信息；缺少依据时退回补充。",
  },
  {
    selector: 'form[id$="-revise-product"], form[id$="-create-product"]',
    title: "补充有来源依据的字段",
    description:
      "根据审核意见对照原件补充字段并绑定对应资料；无依据的参数保持空白，提交后重新审核。",
  },
  {
    selector: "form[data-content-review]",
    title: "审核当前内容版本",
    description: "确认文案与已核验产品一致并记录依据；修改后需重新审核。",
  },
  {
    selector: 'a[href*="/new/content?product="]',
    title: "用已核验产品制作内容",
    description:
      "从此入口制作图文内容会自动带入当前产品；没有实物图片时可先发纯文贴，视频按需制作。",
  },
  {
    selector: 'form[id^="register-product-media-"]',
    title: "按需登记视频素材",
    description: "制作视频前先登记属于该产品的授权图片或视频，审核通过后即可在编辑器中使用。",
  },
  {
    selector: 'form[data-publication-composer="true"]',
    title: "审核通过后安排发布",
    description:
      "核对正文与素材，逐个选择本次账号并确认发布。已批准不代表已发布，提交后请等待平台回执。",
  },
  {
    selector: 'a[href*="/new/rfq"]',
    title: "从客户会话整理需求",
    description: "将当前客户会话带入 RFQ，先一键整理建议再核对保存。",
  },
  {
    selector: 'form#create-rfq, form[id^="revise-rfq-"]',
    title: "整理并保存客户需求",
    description:
      "核对产品类型、OE 或车型、数量和目的地后保存；智能建议仅作填充参考，不会自动创建 RFQ。",
  },
  {
    selector: '[aria-label="需求完整度"]',
    title: "补齐后确认需求",
    description: "补全缺失字段并确认需求完整后，即可引用已核验产品创建人工报价。",
  },
  {
    selector: 'a[href*="/new/quotation"]',
    title: "需求确认后创建报价",
    description: "基于当前 RFQ 选择已核验产品并填写人工确认的价格、MOQ 与交期。",
  },
  {
    selector: 'form#quotation-new, form[id^="quotation-"]',
    title: "录入人工报价",
    description: "确认产品和 RFQ，填写商业条款与依据。有效日期可留空；填写时须确认起止日期和时区。",
  },
  {
    selector: 'form[id^="quote-decision-"]',
    title: "审核报价",
    description: "核对商业条款、有效期及其依据后批准或退回；修订后需重新批准。",
  },
  {
    selector: "#content-source-product",
    title: "引用已核验产品",
    description: "选定产品和需要引用的参数，设置目标与客户后生成初稿，再人工通读检查。",
  },
  {
    selector: "#content-body",
    title: "编辑并保存内容",
    description: "检查正文与行动号召，保存草稿后提交审核。",
  },
  {
    selector: '[aria-label="视频总时长"]',
    title: "检查视频剪辑",
    description: "核对片段顺序、时长与事实字幕，保存后合成并预览成片。",
  },
  {
    selector: "#video-review-evidence",
    title: "记录成片审核依据",
    description: "完整播放成片并核对字幕与授权后填写审核依据。",
  },
  {
    selector: 'form[id^="quote-send-"]',
    title: "登记报价发送凭据",
    description: "核对已批准报价文案后人工发送给客户，并在此登记发送渠道与凭据。",
  },
  {
    selector: 'form[id^="delivery-"]',
    title: "确认本次交期",
    description: "按工厂确认结果填写交期天数与依据，过期或未确认的交期不能对外承诺。",
  },
  {
    selector: 'form[id^="follow-up-"]',
    title: "按客户反馈制定跟进",
    description:
      "选择跟进场景并安排提醒。保存计划不会发送消息，也不会清空待发送草稿；实际回复需单独人工确认。",
  },
  {
    selector: 'input[name="nextFollowUpAt"]',
    title: "用当前设备时区设置提醒",
    description:
      "按设备当前时区填写时间，清空后保存可取消提醒；夏令时切换产生的重复时间需选择第一次或第二次。",
  },
  {
    selector: 'form[id^="opportunity-"]',
    title: "明确认定有效商机",
    description: "综合需求、报价、交期与跟进情况填写依据并确认有效商机。",
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
