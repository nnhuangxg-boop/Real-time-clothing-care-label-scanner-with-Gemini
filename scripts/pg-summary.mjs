export function createSummary({all,get,clock,hash,limits}) {
const dayOf=ms=>new Date(ms).toISOString().slice(0,10);
 async function summary(){
  const now=clock(),today=dayOf(now),since=dayOf(now-29*86400000);
  const rows=(await all('SELECT * FROM calls WHERE day>=? ORDER BY started', [since]));
  const summarize=list=>{
   const durations=list.map(r=>r.duration_ms).filter(Number.isFinite).sort((a,b)=>a-b);
   const outcomes={};for(const r of list)outcomes[r.outcome]=(outcomes[r.outcome]||0)+1;
   return {refunded_trials:list.filter(r=>r.source==='owner'&&r.outcome==='timeout').length,calls:list.length,browsers:new Set(list.map(r=>r.browser)).size,ips:new Set(list.map(r=>r.ip)).size,outcomes,p50_ms:durations.length?durations[Math.ceil(durations.length*.5)-1]:null,p95_ms:durations.length?durations[Math.ceil(durations.length*.95)-1]:null,input_tokens:list.reduce((n,r)=>n+(r.input_tokens||0),0),output_tokens:list.reduce((n,r)=>n+(r.output_tokens||0),0),thinking_tokens:list.reduce((n,r)=>n+(r.thinking_tokens||0),0),metered_calls:list.filter(r=>r.total_tokens!==null).length};
  };
  const bySource=list=>Object.fromEntries(['owner','personal'].map(source=>[source,summarize(list.filter(r=>r.source===source))]));
  const group=(key,list=rows)=>{const groups=new Map();for(const r of list){const id=r[key];if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);}return [...groups].map(([id,items])=>({id,...bySource(items)})).sort((a,b)=>(b.owner.calls+b.personal.calls)-(a.owner.calls+a.personal.calls));};
  const ownerBrowsers=new Set(rows.filter(r=>r.source==='owner').map(r=>r.browser));
  const personalBrowsers=new Set(rows.filter(r=>r.source==='personal').map(r=>r.browser));
  const quotaThenPersonal=(await get(`SELECT count(DISTINCT c.browser) n FROM calls c WHERE c.source='personal' AND c.day>=? AND (EXISTS(SELECT 1 FROM blocked b WHERE b.browser=c.browser AND b.created<c.started) OR (SELECT count(*) FROM calls prior WHERE prior.browser=c.browser AND prior.source='owner' AND prior.outcome!='timeout' AND prior.id<c.id)>=10)`, [since])).n;
  const returners=(await get('SELECT count(*) n FROM (SELECT browser FROM calls WHERE day>=? GROUP BY browser HAVING count(DISTINCT day)>1) returning_browsers', [since])).n;
  return {generatedAt:new Date(now).toISOString(),timezone:'UTC',limits,today:bySource(rows.filter(r=>r.day===today)),period:bySource(rows),since,
   lifetime:(await all('SELECT source,count(*) calls,count(DISTINCT browser) browsers,count(DISTINCT ip) ips FROM calls GROUP BY source', [])),
   funnel:{visited_browsers:(await get('SELECT count(*) n FROM browsers WHERE last_seen>=?', [Date.parse(since+'T00:00:00Z')])).n,scanning_browsers:new Set(rows.map(r=>r.browser)).size,both_key_types:[...personalBrowsers].filter(id=>ownerBrowsers.has(id)).length,personal_after_limit:quotaThenPersonal,returning_on_multiple_days:returners},
   blocked:(await all('SELECT reason,count(*) requests,count(DISTINCT browser) browsers FROM blocked WHERE day>=? GROUP BY reason', [since])),
   daily:group('day').sort((a,b)=>b.id.localeCompare(a.id)),browsers:group('browser').slice(0,30).map(r=>({...r,id:hash('report:'+r.id).slice(0,12)})),ips:group('ip').slice(0,30).map(r=>({...r,id:r.id.slice(0,12)})),languages:group('language'),models:group('model'),
   recent:rows.slice(-50).reverse().map(({browser,ip,...r})=>({...r,browser:hash('report:'+browser).slice(0,12),ip:ip.slice(0,12)}))};
 }
return summary;
}
