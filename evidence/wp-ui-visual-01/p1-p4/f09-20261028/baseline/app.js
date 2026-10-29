// Isolated visual fixtures. No product imports, network requests or persistence.
const fixtures = {
  roomy:{income:13000,fixed:4800,debt:1300,spend:748,budget:1100,cash:12600,cashFloor:10000},
  tight:{income:13000,fixed:8700,debt:3000,spend:912,budget:1100,cash:11100,cashFloor:10000},
  balanced:{income:13000,fixed:9800,debt:3200,spend:1100,budget:1100,cash:10000,cashFloor:10000},
  'light-over':{income:13000,fixed:10500,debt:3500,spend:1230,budget:1100,cash:9400,cashFloor:10000},
  overload:{income:13000,fixed:11800,debt:4200,spend:1580,budget:1100,cash:7800,cashFloor:10000},
  'zero-clear':{income:0,fixed:0,debt:0,spend:0,budget:1100,cash:10000,cashFloor:10000},
  'zero-burden':{income:0,fixed:2500,debt:1000,spend:0,budget:1100,cash:7800,cashFloor:10000},
  pending:{income:null,fixed:null,debt:null,spend:null,budget:null,cash:null,cashFloor:null},
  // F-08 marker fixtures. Isolated synthetic values, no ledger data.
  'over-outer':{income:13000,fixed:15600,debt:0,spend:900,budget:1100,cash:7800,cashFloor:10000},
  'over-both':{income:13000,fixed:15600,debt:0,spend:1320,budget:1100,cash:7800,cashFloor:10000},
  'over-large':{income:10000,fixed:23000,debt:0,spend:900,budget:1100,cash:7800,cashFloor:10000},
};
const homeStates = [['roomy','余量充足'],['tight','余量偏紧'],['balanced','刚好打平'],['light-over','轻度超出'],['overload','明显超出'],['zero-clear','零收入 · 零负担'],['zero-burden','零收入 · 有负担'],['pending','待确认债务候选'],['over-outer','单环超额 · 固定负担 120%'],['over-both','双环超额 · 两环各 120%'],['over-large','单环超额 230%']];
const fixedStates = [['normal','列表 · 已付 / 未付'],['overdue','逾期状态'],['empty','空态'],['loading','骨架屏'],['error','局部错误 / 重试'],['overpaid','B-03 已付超额候选'],['zero-plan','B-03 零计划候选']];
const paths = {
  home:'<path d="m3.5 10.5 8.5-7 8.5 7v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z"/><path d="M9 21v-7h6v7"/>',
  record:'<path d="M12 3v18M3 12h18"/>',
  progress:'<path d="M4 19V9m6 10V5m6 14v-7m5 7H2"/>',
  person:'<circle cx="12" cy="8" r="4"/><path d="M4.8 21a7.2 7.2 0 0 1 14.4 0"/>',
  wallet:'<path d="M4 6.5h14.5A1.5 1.5 0 0 1 20 8v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11"/><path d="M16 11h5v5h-5a2.5 2.5 0 0 1 0-5Z"/>',
  receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6m-6 4h6"/>',
  shield:'<path d="M12 3 20 6v5c0 5-3.2 8.4-8 10-4.8-1.6-8-5-8-10V6Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
  debt:'<path d="M4 7h16M6 3v4m12-4v4M5 7v13h14V7"/><path d="M8 12h3m2 0h3m-8 4h3"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.wallet}</svg>`;
const params = new URLSearchParams(location.search);
const page = document.body.dataset.page;
let review = params.get('view') === 'review';
let state = params.get('state') || (page === 'fixed' ? 'normal' : 'roomy');
if (!(page === 'home' ? homeStates : fixedStates).some(([key]) => key === state)) state = page === 'home' ? 'roomy' : 'normal';
// Boundary candidates are deliberately unavailable as an unmarked clean view.
if (['pending','overpaid','zero-plan'].includes(state)) review = true;
let showNotes = params.get('notes') === 'open';
const money = n => n == null ? '—' : `¥${Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const shortMoney = n => n == null ? '—' : `¥${Number(n).toLocaleString('en-US',{maximumFractionDigits:0})}`;
const signedMoney = n => n == null ? '—' : n < 0 ? `−${money(-n)}` : money(n);
const percentage = n => `${(n * 100).toFixed(1).replace(/\.0$/,'')}%`;

function structureCopy(d) {
  if (d.income == null) return '资料不齐，花点时间补一下';
  const burden = d.fixed + d.debt;
  if (d.income === 0) return burden === 0 ? '收入：你不来？账单：那我也不来了。' : '收入：暂未出场。账单：戏份拉满。';
  const ratio = (d.income - burden) / d.income;
  if (ratio >= .2) return '账单：不是，他怎么还剩钱？';
  if (ratio > 0) return '钱包：还活着，先别开香槟。';
  if (ratio === 0) return '工资：来过，爱过，没留过。';
  if (ratio > -.1) return '工资：你们分赃怎么不带我商量？';
  return '收入：我一个人打五个？';
}

function pageUrl(name, nextState = '') {
  const file = name === 'fixed' ? 'fixed-v3-source.html' : 'index.html';
  const query = new URLSearchParams();
  if (review) query.set('view','review');
  if (nextState) query.set('state',nextState);
  return file + (query.size ? `?${query}` : '');
}

function toolbar() {
  if (!review) return '';
  const selectors = page === 'home' ? homeStates : fixedStates;
  const cleanState = ['pending','overpaid','zero-plan'].includes(state) ? (page === 'home' ? 'roomy' : 'normal') : state;
  return `<section class="review-tools" aria-label="原型外部审核工具栏">
    <div class="tool-top"><strong>WP-UI-VISUAL-01 · 定向返工 v2</strong><span>设计审核视图 · 合成数据 · 不连接正式产品</span><a data-clean-link href="${page === 'home' ? 'index.html' : 'fixed-v3-source.html'}?state=${cleanState}">打开干净产品参考视图 ↗</a></div>
    <div class="tool-actions"><a href="${pageUrl('home')}">首页结构卡</a><a href="${pageUrl('fixed')}">固定支出页</a><button data-notes aria-expanded="${showNotes}">B-01 至 B-06 注释层</button><a href="screenshots.html">新截图索引 ↗</a></div>
    <div class="tool-selectors" aria-label="审核状态选择">${selectors.map(([key,label])=>`<button data-state="${key}" aria-pressed="${state===key}">${label}</button>`).join('')}</div>
    ${page === 'fixed' ? `<div class="tool-actions"><button data-panel="collapsed">付款 · 默认收起</button><button data-panel="date">付款 · 日期展开</button><button data-panel="note">付款 · 备注展开</button></div>`:''}
    <p class="tool-note"><code>REWORK-20261028</code> · 本轮 F-01 至 F-07 已验收，F-08 按 Owner 选定 A 落地：明细旁固定短标记，红色斜纹超额弧已移除。Signed 口径以任务书为准。${page==='home' ? ' 本资产内环仍是旧「消费进度」示意，B-01 已签认口径为「必须偿还月供占收入」；图形不得作为实现依据。' : ' 逾期天数来自隔离审核夹具日期，未给固定支出新增到期日业务字段；页头「导出备份」是 v2 遗留禁用按钮，本轮不新增导出入口。'}<span data-preview-result aria-live="polite"></span></p>
  </section>`;
}

function annotations() {
  if (!review || !showNotes) return '';
  return `<aside class="annotation-panel"><h2>设计注释 · 定向返工 2026-10-28</h2><ul>
    <li><b>B-01</b>：Owner 已签认固定负担 = 固定支出总额 + 必须偿还的月供，双环各自占收入；本资产内环仍画旧「消费进度」，实施以任务书为准。</li>
    <li><b>B-02</b>：超过 100% 主弧最多一圈 + 明细旁固定短标记（A，F-08 已落地）；整体超载只由主卡负结构余量表达，不挂到任一环。</li>
    <li><b>B-03</b>：五态边界已签认，逐字文案以任务书为准；本资产候选只检查视觉，不截断金额、不输出伪百分比。</li>
    <li><b>B-04</b>：负收入文案已签认为「所选月份收入合计为负，建议核对相关流水。」；本资产未画负收入状态。</li>
    <li><b>B-05</b>：请求隔离、骨架屏与局部错误文案已签认；本资产是静态夹具，没有跨月加载，跨月一致性未验证。</li>
    <li><b>B-06</b>：动效与无障碍基线已签认；本资产参数只是示意，实现阶段按任务书执行。</li>
  </ul><p>本资产是参考资产返工稿（F-01 至 F-08），不得当作实现依据；产品实现须另行授权。图标仍沿用 v1 线性 SVG。</p></aside>`;
}

function navigation() {
  const items = [['home','今天'],['record','记录'],['progress','进展'],['person','我的']];
  const buttons = items.map(([name,label])=>`<button type="button" ${name==='home' ? `data-home class="active" aria-current="page"` : 'disabled'}>${icon(name)}<span>${label}</span></button>`).join('');
  return {side:`<aside class="side"><span class="brand-icon">${icon('wallet')}</span><nav class="nav" aria-label="主导航">${buttons}</nav></aside>`,bottom:`<nav class="bottom-nav" aria-label="主导航">${buttons}</nav>`};
}

// F-08: one revolution max. Values above 100% are never drawn as extra laps or hatching;
// the overage is stated in the matching detail row instead.
function ringStroke(r, ratio, inner = false) {
  const length = 2 * Math.PI * r;
  const base = ratio == null ? 0 : Math.min(1,Math.max(0,ratio));
  const dash = `${base*length} ${length}`;
  const kind = inner?' inner':'';
  // Dark state line under each data arc/track keeps the necessary graphic boundary >= 3:1
  // while the brand fill stays a supporting fill (F-04).
  const circle = `<circle class="track-edge${kind}" cx="120" cy="120" r="${r}"/>
    <circle class="track${kind}" cx="120" cy="120" r="${r}"/>
    <circle class="ring-edge${kind}" cx="120" cy="120" r="${r}" stroke-dasharray="${dash}" transform="rotate(-90 120 120)"/>
    <circle class="ring-progress${kind}" data-ratio="${ratio ?? 'unknown'}" cx="120" cy="120" r="${r}" stroke-dasharray="${dash}" transform="rotate(-90 120 120)"/>`;
  return circle + (ratio===1 ? `<circle class="ring-completion" cx="120" cy="120" r="${r+9}"/>` : '');
}

// F-08 / A: a fixed short bar sits left of the amount of the ring that itself exceeds 100%.
// The complete value stays visible in the same group; no icon, no red small text.
function ringDetailRow(swatchClass, label, ratio, overAmount) {
  const over = ratio != null && ratio > 1;
  return `<div class="legend-row" data-over="${over}"><span><i class="swatch ${swatchClass}"></i>${label}</span><b>${over?'<i class="overage-mark" aria-hidden="true"></i>':''}${percentage(ratio)}</b></div>${over?`<div class="overage-note">已超出 ${money(overAmount)}</div>`:''}`;
}

function ringChart(d) {
  const known = d.income != null;
  const nonzero = known && d.income > 0;
  const outer = nonzero ? (d.fixed+d.debt)/d.income : null;
  const inner = nonzero && d.budget > 0 ? d.spend/d.budget : null;
  const outerOver = outer != null && outer > 1;
  const innerOver = inner != null && inner > 1;
  return `<article class="card chart-card" data-chart-state="${state}" aria-label="双层运动圆环视觉候选">
    <div class="double-ring" role="img" aria-label="${nonzero ? `固定负担 ${percentage(outer)}${outerOver?`，已超出 ${money(d.fixed+d.debt-d.income)}`:''}，消费 ${percentage(inner)}${innerOver?`，已超出 ${money(d.spend-d.budget)}`:''}` : known ? `收入 ¥0，固定负担 ${money(d.fixed+d.debt)}，不显示百分比` : '资料不齐，金额与比例待确认'}">
      <svg viewBox="0 0 240 240">${ringStroke(94,outer)}${ringStroke(71,inner,true)}</svg>
      <div class="ring-center"><small>收入</small><strong>${known?shortMoney(d.income):'待确认'}</strong></div>
    </div>
    ${nonzero ? `<div class="ring-detail">${ringDetailRow('','固定负担',outer,d.fixed+d.debt-d.income)}${ringDetailRow('yellow','消费',inner,d.spend-d.budget)}</div>` : known ? `<div class="chart-zero"><span>固定负担</span><b>${money(d.fixed+d.debt)}</b></div>` : ''}
  </article>`;
}

function modules(d) {
  const known=d.income!=null;
  const surplus=known?d.income-d.fixed-d.debt:null;
  const values=[surplus,known?d.budget-d.spend:null,known?d.cash-d.cashFloor:null];
  const titles=['固定支出','消费','现金安全'];
  const labels=['结构余量','余量','余量'];
  const details=known?[`收入 − 固定支出 − 月供`,`已花 ${money(d.spend)} / 目标 ${money(d.budget)}`,`现金 ${money(d.cash)} / 安全线 ${money(d.cashFloor)}`]:['待确认','待确认','待确认'];
  return `<section class="modules" aria-label="首页前三个模块">${titles.map((title,i)=>`<${i===0?'a':'article'} ${i===0?`href="${pageUrl('fixed')}"`:''} class="card module">
    <div class="module-top"><span class="module-icon">${icon(['wallet','receipt','shield'][i])}</span><span class="balance-pill ${values[i]<0?'negative':''}"><small>${labels[i]}</small><b>${signedMoney(values[i])}</b></span></div>
    <div class="module-bottom"><div><h3>${title}</h3><p>${details[i]}</p></div>${i===0?icon('chevron'):''}</div>
  </${i===0?'a':'article'}>`).join('')}</section>`;
}

function homePage() {
  const d=fixtures[state];
  const known=d.income!=null;
  const surplus=known?d.income-d.fixed-d.debt:null;
  const ratio=known&&d.income>0?surplus/d.income:null;
  const over=ratio!=null&&ratio<0;
  return `<header class="heading"><div><p class="kicker">10 月 27 日 · 今天</p><h1>你好，今天</h1></div><span class="month">2026 年 10 月</span></header>
    <section class="hero-grid"><article class="card hero" data-tone="${state}" data-negative="${surplus<0}"><div class="eyebrow"><span class="state-dot"></span>每月固定收支</div>
      <h2 id="state-copy">${structureCopy(d)}</h2>
      <div class="surplus-layout"><div class="surplus"><small>结构余量</small><strong id="surplus-value">${signedMoney(surplus)}</strong>${ratio!=null?`<span class="ratio">占收入 ${percentage(ratio)}</span>`:''}</div>${over?`<div class="overflow-summary"><small>${icon('info')}已超出</small><b>${money(-surplus)}</b></div>`:''}</div>
      <div class="hero-facts"><div><small>收入</small><b>${money(d.income)}</b></div><div><small>固定支出</small><b>${money(d.fixed)}</b></div><div><small>月供</small><b>${money(d.debt)}</b></div></div>
      <div class="hero-links"><a class="button" href="${pageUrl('fixed')}">查看固定支出</a><button class="text-button" data-why>为什么 ${icon('chevron')}</button></div>
      <p class="review-slot" data-formula hidden>结构余量 · 收入 − 固定支出 − 月供</p>
    </article>${ringChart(d)}</section>${modules(d)}`;
}

const expenses=[
  {name:'房租',category:'住房',plan:1800,paid:1800,icon:'home'},
  {name:'水电与通讯',category:'水电通讯',plan:828,paid:828,icon:'receipt'},
  {name:'通勤',category:'通勤',plan:900,paid:0,icon:'wallet',fixtureDueDate:'2026-10-24'},
];
function fixtureOverdueDays(date) {
  // Calendar-day fixture calculation; no real due-day field exists on fixed expenses.
  const asOf=params.get('asof')||'2026-10-27';
  const valid=/^\d{4}-\d{2}-\d{2}$/;
  if(!valid.test(asOf)||!valid.test(date)) return 0;
  const delta=(Date.parse(`${asOf}T00:00:00Z`)-Date.parse(`${date}T00:00:00Z`))/86400000;
  return Number.isFinite(delta)?Math.max(0,Math.floor(delta)):0;
}

function fixedCategories() {
  const items=expenses.map(item=>({...item}));
  if(state==='overpaid') items[2].paid=1125;
  if(state==='zero-plan'){items[2].plan=0;items[2].paid=120;}
  return `<aside class="card categories"><h3>分类小计</h3>${state==='error'?`<button class="error-retry" data-retry>${icon('info')}这一块没读出来，点这里重试</button>`:items.map(item=>`<div class="category-item"><div class="category-top"><b>${item.category}</b><span>${money(item.plan)}</span></div>
    ${item.plan>0?`<div class="category-track"><div class="category-fill" style="--paid:${Math.min(item.paid/item.plan,1)*100}%"></div></div>${item.paid>item.plan?`<div class="category-extra" style="width:${((item.paid-item.plan)/item.plan)*100}%"></div>`:''}`:`<div class="category-unbased">${review?'PENDING_OWNER_DECISION · 不计算百分比':''}</div>`}
    <div class="category-bottom"><span>${item.paid===0?'未付':`已付 ${money(item.paid)}`}</span><span>${item.plan>0&&item.paid>0?percentage(item.paid/item.plan):''}</span></div>${item.paid>item.plan?`<div class="review-slot">B-03 候选 · 实付 ${money(item.paid)} · 超额 ${money(item.paid-item.plan)} · 口径待确认</div>`:''}</div>`).join('')}</aside>`;
}

function fixedPage() {
  const count=state==='empty'?0:3;
  const header=`<a class="page-back" href="${pageUrl('home')}">${icon('chevron')}返回首页</a><header class="heading"><h1>固定支出·${count}项</h1><button class="button" disabled>导出备份</button></header>`;
  if(['overpaid','zero-plan'].includes(state)) return `${header}<p class="review-slot">B-03 独立分类视觉候选 · PENDING_OWNER_DECISION · 仅检查本分类的超额或零计划表达，未定义整页汇总联动。</p>${fixedCategories()}`;
  if(state==='empty') return `${header}<section class="card empty-state"><p>暂无固定支出</p></section>`;
  if(state==='loading') return `${header}<section class="card fixed-summary" aria-label="固定支出骨架屏"><div class="skeleton big"></div><div class="skeleton big"></div><div class="skeleton big"></div></section><section class="card fixed-list" aria-busy="true" aria-label="固定支出列表骨架屏">${[1,2,3].map(()=>`<div class="skeleton-row"><span class="skeleton-round"></span><span class="skeleton-content"><span class="skeleton medium"></span><span class="skeleton short"></span></span><span class="skeleton skeleton-amount"></span></div>`).join('')}</section>`;
  return `${header}<section class="card fixed-summary"><div class="summary-numbers"><div><small>本月计划</small><b>${money(3528)}</b></div><div class="paid-number"><small>已付</small><b>${money(2628)}</b></div><div><small>未付</small><b>${money(900)}</b></div></div><div class="summary-ring-block"><div class="summary-ring" role="img" aria-label="所选月份已付占比 74.5%"><svg viewBox="0 0 80 80" aria-hidden="true"><circle class="summary-ring-track-edge" cx="40" cy="40" r="33"/><circle class="summary-ring-track" cx="40" cy="40" r="33"/><circle class="summary-ring-edge" cx="40" cy="40" r="33" stroke-dasharray="154.4 207.3"/><circle class="summary-ring-progress" cx="40" cy="40" r="33" stroke-dasharray="154.4 207.3"/></svg><strong>74.5%</strong></div><small class="summary-ring-name">所选月份已付占比</small></div></section>
    <section class="fixed-grid"><section class="card fixed-list" aria-label="每月要付的">${expenses.map((item,index)=>`<article class="expense-row"><span class="item-icon">${icon(item.icon)}</span><div class="item-main"><h3>${item.name}${state==='overdue'&&index===2?`<span class="overdue-badge">逾期 ${fixtureOverdueDays(item.fixtureDueDate)} 天</span>`:''}</h3><small>${item.category}</small></div><div class="item-action"><b class="amount">${money(item.plan)} <small>/ 月</small></b>${item.paid>=item.plan?`<span class="paid-status">${icon('check')}已付</span>`:`<button class="button primary" data-pay="${index}">记一笔</button>`}</div></article>`).join('')}<button class="add-row" disabled>${icon('record')}添加一项固定支出</button></section>${fixedCategories()}</section>`;
}

function sheetMarkup() {
  return `<dialog class="payment-sheet" aria-labelledby="payment-title"><div class="sheet-handle" aria-hidden="true"></div><div class="sheet-header"><div><h2 id="payment-title">记一笔实际支付</h2><small data-payment-item>通勤</small></div><button class="close-button" data-close-sheet aria-label="关闭付款面板">${icon('close')}</button></div>
    <div class="payment-fields collapsed"><label class="field amount-field"><span>金额</span><input aria-label="金额" inputmode="decimal" value="900.00"></label><div class="detail-fields" id="payment-details" hidden><label class="field date-field" hidden><span>支付日期</span><input aria-label="支付日期" type="date" value="2026-10-27"></label><label class="field note-field" hidden><span>备注（选填）</span><input aria-label="备注（选填）" value="地铁月卡"></label></div></div>
    <button class="detail-toggle" aria-expanded="false" aria-controls="payment-details" data-toggle-details><span data-detail-text>支付日期 · 备注（选填）</span>${icon('chevron')}</button>
    <div class="payment-actions"><button class="button" data-close-sheet>取消</button><button class="button primary" data-confirm-preview>确认付款</button></div>
  </dialog>`;
}

function render() {
  const nav=navigation();
  document.body.dataset.view=review?'review':'clean';
  document.getElementById('app').innerHTML=`${toolbar()}${annotations()}<div class="shell">${nav.side}<main class="workspace"><header class="topbar"><a class="brand" href="${pageUrl('home')}"><span class="brand-icon">${icon('wallet')}</span><span><b>小钱家</b><small>本地账本</small></span></a><div class="top-actions"><span class="month">2026-10</span></div></header><div class="content">${page==='home'?homePage():fixedPage()}</div></main></div>${nav.bottom}${page==='fixed'?sheetMarkup():''}`;
  bind();
}
function updateLocation() {
  const url=new URL(location.href);
  url.searchParams.set('state',state);
  if(review)url.searchParams.set('view','review'); else url.searchParams.delete('view');
  history.replaceState(null,'',url);
}
let restoreFocus=null;
function openSheet(mode='collapsed',index=2) {
  const sheet=document.querySelector('.payment-sheet');
  if(!sheet)return;
  restoreFocus=document.activeElement;
  sheet.querySelector('[data-payment-item]').textContent=expenses[index].name;
  sheet.querySelector('[aria-label="金额"]').value=expenses[index].plan.toFixed(2);
  sheet.querySelector('.date-field input').value='2026-10-27';
  sheet.querySelector('.note-field input').value='地铁月卡';
  sheet.originValues={amount:expenses[index].plan.toFixed(2),date:'2026-10-27',note:'地铁月卡'};
  if(!sheet.open)sheet.showModal();
  expandFields(mode!=='collapsed');
  const target=mode==='note'?'.note-field input':mode==='date'?'.date-field input':'.amount-field input';
  sheet.querySelector(target).focus();
}
function closeSheet(){document.querySelector('.payment-sheet')?.close();restoreFocus?.focus();}
const DETAIL_PLACEHOLDER='支付日期 · 备注（选填）';
// F-01: the collapsed row is generated from the values actually filled in.
// Only existing field labels are reused; no new sentence is introduced.
function detailSummaryValues(sheet) {
  const date=sheet.querySelector('.date-field input')?.value||'';
  const note=(sheet.querySelector('.note-field input')?.value||'').trim();
  const parts=[];
  if(date)parts.push(`支付日期 ${date}`);
  if(note)parts.push(`备注 ${note}`);
  return parts.length?parts.join(' · '):DETAIL_PLACEHOLDER;
}
function updateDetailSummary() {
  const sheet=document.querySelector('.payment-sheet');
  const button=sheet?.querySelector('[data-toggle-details]');
  if(!button)return;
  const text=detailSummaryValues(sheet);
  const label=button.querySelector('[data-detail-text]');
  if(label)label.textContent=text;
  const expanded=button.getAttribute('aria-expanded')==='true';
  button.setAttribute('aria-label',expanded?`收起支付日期与备注（${text}）`:`展开支付日期与备注（${text}）`);
}
function resetSheetValues() {
  const sheet=document.querySelector('.payment-sheet');
  if(!sheet||!sheet.originValues)return;
  sheet.querySelector('[aria-label="金额"]').value=sheet.originValues.amount;
  sheet.querySelector('.date-field input').value=sheet.originValues.date;
  sheet.querySelector('.note-field input').value=sheet.originValues.note;
  updateDetailSummary();
}
function expandFields(expanded) {
  const sheet=document.querySelector('.payment-sheet');
  sheet.querySelector('.payment-fields').classList.toggle('collapsed',!expanded);
  const group=sheet.querySelector('#payment-details');
  if(group)group.hidden=!expanded;
  sheet.querySelectorAll('.date-field,.note-field').forEach(field=>field.hidden=!expanded);
  sheet.querySelector('[data-toggle-details]').setAttribute('aria-expanded',String(expanded));
  updateDetailSummary();
}
function bind() {
  document.querySelectorAll('[data-state]').forEach(button=>button.onclick=()=>{
    state=button.dataset.state;updateLocation();render();
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
      document.querySelector('#surplus-value')?.classList.add('is-number-changing');
      document.querySelector('.state-dot')?.classList.add('icon-feedback');
    }
  });
  document.querySelector('[data-notes]')?.addEventListener('click',()=>{showNotes=!showNotes;render();});
  document.querySelectorAll('[data-home]').forEach(button=>button.onclick=()=>location.href=pageUrl('home'));
  document.querySelector('[data-why]')?.addEventListener('click',()=>{const field=document.querySelector('[data-formula]');field.hidden=!field.hidden;});
  document.querySelectorAll('[data-panel]').forEach(button=>button.onclick=()=>openSheet(button.dataset.panel));
  document.querySelectorAll('[data-pay]').forEach(button=>button.onclick=()=>openSheet('collapsed',Number(button.dataset.pay)));
  document.querySelectorAll('[data-close-sheet]').forEach(button=>button.onclick=closeSheet);
  document.querySelector('[data-toggle-details]')?.addEventListener('click',event=>expandFields(event.currentTarget.getAttribute('aria-expanded')!=='true'));
  document.querySelectorAll('.date-field input,.note-field input').forEach(input=>{
    input.addEventListener('input',updateDetailSummary);
    input.addEventListener('change',updateDetailSummary);
  });
  document.querySelector('.payment-sheet')?.addEventListener('close',resetSheetValues);
  document.querySelector('[data-confirm-preview]')?.addEventListener('click',()=>{
    closeSheet();
    const output=document.querySelector('[data-preview-result]');
    if(output)output.textContent=' · 已结束付款视觉样片；未保存、未修改已付状态。';
  });
  document.querySelector('[data-retry]')?.addEventListener('click',()=>{state='normal';updateLocation();render();});
}

render();
if(page==='fixed'&&params.get('panel'))openSheet(params.get('panel'));
window.visualReference={version:'revision-v2',page,get state(){return state;},review,fixtureOverdueDays,structureCopy};
