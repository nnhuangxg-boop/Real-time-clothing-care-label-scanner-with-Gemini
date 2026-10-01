import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export const limits=Object.freeze({browser:10,ipDaily:30,siteDaily:200});
const dayOf=ms=>new Date(ms).toISOString().slice(0,10);
export function createUsageStore(path,{clock=Date.now}={}){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS browsers(id TEXT PRIMARY KEY,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS calls(id INTEGER PRIMARY KEY,browser TEXT NOT NULL,ip TEXT NOT NULL,source TEXT NOT NULL,model TEXT NOT NULL,language TEXT NOT NULL,started INTEGER NOT NULL,day TEXT NOT NULL,outcome TEXT NOT NULL DEFAULT 'pending',duration_ms INTEGER,http_status INTEGER,input_tokens INTEGER,output_tokens INTEGER,thinking_tokens INTEGER,total_tokens INTEGER,dry TEXT,wash TEXT,label_visible INTEGER);
 CREATE INDEX IF NOT EXISTS calls_browser ON calls(browser,source);
 CREATE INDEX IF NOT EXISTS calls_day ON calls(day,source,ip);
 CREATE TABLE IF NOT EXISTS blocked(id INTEGER PRIMARY KEY,browser TEXT NOT NULL,ip TEXT NOT NULL,day TEXT NOT NULL,reason TEXT NOT NULL,created INTEGER NOT NULL);`);
 db.prepare('INSERT OR IGNORE INTO settings VALUES (?,?)').run('identity_secret',randomBytes(32).toString('hex'));
 const secret=db.prepare('SELECT value FROM settings WHERE key=?').get('identity_secret').value;
 const hash=value=>createHmac('sha256',secret).update(value).digest('hex');
 const sign=id=>hash('browser:'+id);
 function identity(cookie,ip,secure){
  const token=/(?:^|;\s*)care_browser=([^;]+)/.exec(cookie||'')?.[1]||'';
  const [candidate,signature]=token.split('.');let id;
  if(/^[a-f0-9]{32}$/.test(candidate||'')&&/^[a-f0-9]{64}$/.test(signature||'')&&timingSafeEqual(Buffer.from(sign(candidate),'hex'),Buffer.from(signature,'hex')))id=candidate;
  const fresh=!id;if(fresh)id=randomBytes(16).toString('hex');
  const now=clock();db.prepare('INSERT INTO browsers VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen').run(id,now,now);
  return {browser:id,ip:hash('ip:'+ip),cookie:fresh?`care_browser=${id}.${sign(id)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure?'; Secure':''}`:null};
 }
 function usage(ctx){
  const day=dayOf(clock());
  const browser=db.prepare("SELECT count(*) n FROM calls WHERE source='owner' AND outcome!='timeout' AND browser=?").get(ctx.browser).n;
  const ip=db.prepare("SELECT count(*) n FROM calls WHERE source='owner' AND day=? AND ip=?").get(day,ctx.ip).n;
  const site=db.prepare("SELECT count(*) n FROM calls WHERE source='owner' AND day=?").get(day).n;
  const remaining={browser:Math.max(0,limits.browser-browser),ip:Math.max(0,limits.ipDaily-ip),site:Math.max(0,limits.siteDaily-site)};
  const reason=remaining.browser===0?'browser_limit':remaining.ip===0?'ip_limit':remaining.site===0?'site_limit':null;
  return {remaining:Math.min(...Object.values(remaining)),browserRemaining:remaining.browser,reason,resetAt:new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString(),limits};
 }
 function reserve(ctx,source,model,language){
  db.exec('BEGIN IMMEDIATE');
  try{
   if(source==='owner'){
    const quota=usage(ctx);
    if(quota.reason){db.prepare('INSERT INTO blocked(browser,ip,day,reason,created) VALUES(?,?,?,?,?)').run(ctx.browser,ctx.ip,dayOf(clock()),quota.reason,clock());db.exec('COMMIT');return {allowed:false,quota};}
   }
   const now=clock();const row=db.prepare('INSERT INTO calls(browser,ip,source,model,language,started,day) VALUES(?,?,?,?,?,?,?)').run(ctx.browser,ctx.ip,source,model,language,now,dayOf(now));
   db.exec('COMMIT');return {allowed:true,id:Number(row.lastInsertRowid)};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function finish(id,{outcome,duration_ms,http_status,usage:tokens={},result}={}){
  const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
  db.prepare(`UPDATE calls SET outcome=?,duration_ms=?,http_status=?,input_tokens=?,output_tokens=?,thinking_tokens=?,total_tokens=?,dry=?,wash=?,label_visible=? WHERE id=? AND outcome='pending'`).run(outcome,count(duration_ms),count(http_status),count(tokens.promptTokenCount),count(tokens.candidatesTokenCount),count(tokens.thoughtsTokenCount),count(tokens.totalTokenCount),result?.dry?.status??null,result?.wash?.status??null,result?Number(result.label_visible):null,id);
 }
 function summary(){
  const now=clock(),today=dayOf(now),since=dayOf(now-29*86400000);
  const rows=db.prepare('SELECT * FROM calls WHERE day>=? ORDER BY started').all(since);
  const summarize=list=>{
   const durations=list.map(r=>r.duration_ms).filter(Number.isFinite).sort((a,b)=>a-b);
   const outcomes={};for(const r of list)outcomes[r.outcome]=(outcomes[r.outcome]||0)+1;
   return {refunded_trials:list.filter(r=>r.source==='owner'&&r.outcome==='timeout').length,calls:list.length,browsers:new Set(list.map(r=>r.browser)).size,ips:new Set(list.map(r=>r.ip)).size,outcomes,p50_ms:durations.length?durations[Math.ceil(durations.length*.5)-1]:null,p95_ms:durations.length?durations[Math.ceil(durations.length*.95)-1]:null,input_tokens:list.reduce((n,r)=>n+(r.input_tokens||0),0),output_tokens:list.reduce((n,r)=>n+(r.output_tokens||0),0),thinking_tokens:list.reduce((n,r)=>n+(r.thinking_tokens||0),0),metered_calls:list.filter(r=>r.total_tokens!==null).length};
  };
  const bySource=list=>Object.fromEntries(['owner','personal'].map(source=>[source,summarize(list.filter(r=>r.source===source))]));
  const group=(key,list=rows)=>{const groups=new Map();for(const r of list){const id=r[key];if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);}return [...groups].map(([id,items])=>({id,...bySource(items)})).sort((a,b)=>(b.owner.calls+b.personal.calls)-(a.owner.calls+a.personal.calls));};
  const ownerBrowsers=new Set(rows.filter(r=>r.source==='owner').map(r=>r.browser));
  const personalBrowsers=new Set(rows.filter(r=>r.source==='personal').map(r=>r.browser));
  const quotaThenPersonal=db.prepare(`SELECT count(DISTINCT c.browser) n FROM calls c WHERE c.source='personal' AND c.day>=? AND (EXISTS(SELECT 1 FROM blocked b WHERE b.browser=c.browser AND b.created<c.started) OR (SELECT count(*) FROM calls prior WHERE prior.browser=c.browser AND prior.source='owner' AND prior.outcome!='timeout' AND prior.id<c.id)>=10)`).get(since).n;
  const returners=db.prepare('SELECT count(*) n FROM (SELECT browser FROM calls WHERE day>=? GROUP BY browser HAVING count(DISTINCT day)>1)').get(since).n;
  return {generatedAt:new Date(now).toISOString(),timezone:'UTC',limits,today:bySource(rows.filter(r=>r.day===today)),period:bySource(rows),since,
   lifetime:db.prepare('SELECT source,count(*) calls,count(DISTINCT browser) browsers,count(DISTINCT ip) ips FROM calls GROUP BY source').all(),
   funnel:{visited_browsers:db.prepare('SELECT count(*) n FROM browsers WHERE last_seen>=?').get(Date.parse(since+'T00:00:00Z')).n,scanning_browsers:new Set(rows.map(r=>r.browser)).size,both_key_types:[...personalBrowsers].filter(id=>ownerBrowsers.has(id)).length,personal_after_limit:quotaThenPersonal,returning_on_multiple_days:returners},
   blocked:db.prepare('SELECT reason,count(*) requests,count(DISTINCT browser) browsers FROM blocked WHERE day>=? GROUP BY reason').all(),
   daily:group('day').sort((a,b)=>b.id.localeCompare(a.id)),browsers:group('browser').slice(0,30).map(r=>({...r,id:hash('report:'+r.id).slice(0,12)})),ips:group('ip').slice(0,30).map(r=>({...r,id:r.id.slice(0,12)})),languages:group('language'),models:group('model'),
   recent:rows.slice(-50).reverse().map(({browser,ip,...r})=>({...r,browser:hash('report:'+browser).slice(0,12),ip:ip.slice(0,12)}))};
 }
 return {identity,usage,reserve,finish,summary,close:()=>db.close()};
}
