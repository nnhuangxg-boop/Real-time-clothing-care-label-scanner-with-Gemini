const $=id=>document.getElementById(id);
const number=n=>Number(n||0).toLocaleString('zh-CN');
const seconds=n=>n===null?'—':(n/1000).toFixed(2)+' 秒';
const outcomes={cancelled:'用户取消',success:'明确结果',uncertain:'不确定',no_label:'未见标签',upstream_error:'模型接口失败',incomplete:'输出不完整',timeout:'超时',invalid_result:'解析或网络失败',pending:'处理中 / 中断未回报'};
const reasons={browser_limit:'浏览器 10 次',ip_limit:'IP 每日 30 次',site_limit:'全站每日 200 次'};
function table(id,headers,rows){
 const el=document.createElement('table'),thead=document.createElement('thead'),tr=document.createElement('tr');
 for(const title of headers){const th=document.createElement('th');th.textContent=title;tr.append(th);}thead.append(tr);el.append(thead);
 const body=document.createElement('tbody');for(const row of rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=value??'—';tr.append(td);}body.append(tr);}el.append(body);$(id).replaceChildren(el);
 if(!rows.length){const p=document.createElement('p');p.textContent='暂无记录';$(id).append(p);}
}
function grouped(id,rows){table(id,['标识','测试 Key 调用','自带 Key 调用','测试 Key 浏览器','自带 Key 浏览器'],rows.map(r=>[r.id,number(r.owner.calls),number(r.personal.calls),number(r.owner.browsers),number(r.personal.browsers)]));}
async function load(){
 $('refresh').disabled=true;$('error').textContent='';
 try{
  const response=await fetch('/admin/usage');if(!response.ok)throw Error();const data=await response.json();
  $('updated').textContent='更新时间：'+data.generatedAt+' · 统计窗口：'+data.since+' 起';
  $('cards').replaceChildren();
  for(const [label,value] of [['今日测试 Key 调用',data.today.owner.calls],['今日自带 Key 调用',data.today.personal.calls],['今日测试 Key 剩余额度',Math.max(0,data.limits.siteDaily-data.today.owner.calls)],['近 30 天扫描浏览器',data.funnel.scanning_browsers]]){const card=document.createElement('div');card.className='card';const title=document.createElement('span');title.textContent=label;const n=document.createElement('strong');n.textContent=number(value);card.append(title,n);$('cards').append(card);}
  table('sources',['来源','调用','浏览器','IP','超时退回体验次数','明确结果','不确定','未见标签','其他/失败','响应 P50','响应 P95','输入 token','输出 token','思考 token','有用量记录'],Object.entries(data.period).map(([source,r])=>[source==='owner'?'测试 Key':'自带 Key',number(r.calls),number(r.browsers),number(r.ips),number(r.refunded_trials),number(r.outcomes.success),number(r.outcomes.uncertain),number(r.outcomes.no_label),number(r.calls-(r.outcomes.success||0)-(r.outcomes.uncertain||0)-(r.outcomes.no_label||0)),seconds(r.p50_ms),seconds(r.p95_ms),number(r.input_tokens),number(r.output_tokens),number(r.thinking_tokens),`${r.metered_calls}/${r.calls}`]));
  const f=data.funnel;table('funnel',['指标','浏览器数'],[['访问过页面',f.visited_browsers],['发起过模型调用',f.scanning_browsers],['两类 Key 都使用过',f.both_key_types],['额度用尽或被拦截后使用自带 Key',f.personal_after_limit],['至少两天有调用',f.returning_on_multiple_days]]);
  table('blocked',['限制','拦截请求','涉及浏览器'],data.blocked.map(r=>[reasons[r.reason]||r.reason,number(r.requests),number(r.browsers)]));
  for(const id of ['daily','browsers','ips','languages','models'])grouped(id,data[id]);
  table('recent',['时间 UTC','来源','浏览器','IP','结果','耗时','接口状态'],data.recent.map(r=>[new Date(r.started).toISOString(),r.source==='owner'?'测试 Key':'自带 Key',r.browser,r.ip,outcomes[r.outcome]||r.outcome,seconds(r.duration_ms),r.http_status]));
 }catch{$('error').textContent='无法读取统计，请确认本机服务正在运行。';}finally{$('refresh').disabled=false;}
}
$('refresh').addEventListener('click',load);load();
