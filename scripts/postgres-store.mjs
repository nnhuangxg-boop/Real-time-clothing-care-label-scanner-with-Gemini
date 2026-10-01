import pg from 'pg';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {createSummary} from './pg-summary.mjs';
pg.types.setTypeParser(20,Number);
export const limits=Object.freeze({browser:10,ipDaily:30,siteDaily:200});
const dayOf=ms=>new Date(ms).toISOString().slice(0,10);
export function createPostgresStore(connectionString,secret,{clock=Date.now}={}){
 if(!connectionString||!secret||secret.length<32)throw new Error('Missing database configuration');
 const databaseUrl=new URL(connectionString);
 databaseUrl.searchParams.set('sslmode','verify-full');
 const pool=new pg.Pool({connectionString:databaseUrl.toString(),max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,query_timeout:5000,allowExitOnIdle:true});
 pool.on('error',()=>console.error('Database connection unavailable'));
 const hash=value=>createHmac('sha256',secret).update(value).digest('hex');
 const query=(sql,args=[],client=pool)=>client.query(sql,args);
 async function identity(cookie,ip,secure=true){
  const token=/(?:^|;\s*)care_browser=([^;]+)/.exec(cookie||'')?.[1]||'';
  const [candidate,signature]=token.split('.');let id;
  if(/^[a-f0-9]{32}$/.test(candidate||'')&&/^[a-f0-9]{64}$/.test(signature||'')&&timingSafeEqual(Buffer.from(hash('browser:'+candidate),'hex'),Buffer.from(signature,'hex')))id=candidate;
  const fresh=!id;if(fresh)id=randomBytes(16).toString('hex');
  const now=clock();await query('INSERT INTO browsers VALUES($1,$2,$2) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen',[id,now]);
  return {browser:id,ip:hash('ip:'+ip),cookie:fresh?`care_browser=${id}.${hash('browser:'+id)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure?'; Secure':''}`:null};
 }
 async function usage(ctx,client=pool){
  const day=dayOf(clock());
  const {rows:[r]}=await query(`SELECT count(*) FILTER(WHERE browser=$1 AND outcome!='timeout') AS browser, count(*) FILTER(WHERE day=$2 AND ip=$3) AS ip,count(*) FILTER(WHERE day=$2) AS site FROM calls WHERE source='owner' AND (browser=$1 OR day=$2)`,[ctx.browser,day,ctx.ip],client);
  const remaining={browser:Math.max(0,10-r.browser),ip:Math.max(0,30-r.ip),site:Math.max(0,200-r.site)};
  return {remaining:Math.min(...Object.values(remaining)),browserRemaining:remaining.browser,reason:remaining.browser===0?'browser_limit':remaining.ip===0?'ip_limit':remaining.site===0?'site_limit':null,resetAt:new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString(),limits};
 }
 async function reserve(ctx,source,model,language){
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   // Serialize the short quota-check/insert transaction across all instances.
   if(source==='owner'){
    await client.query('SELECT pg_advisory_xact_lock(73489102)');
    const quota=await usage(ctx,client);
    if(quota.reason){await query('INSERT INTO blocked(browser,ip,day,reason,created) VALUES($1,$2,$3,$4,$5)',[ctx.browser,ctx.ip,dayOf(clock()),quota.reason,clock()],client);await client.query('COMMIT');return {allowed:false,quota};}
   }
   const now=clock();const {rows:[row]}=await query('INSERT INTO calls(browser,ip,source,model,language,started,day) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[ctx.browser,ctx.ip,source,model,language,now,dayOf(now)],client);
   await client.query('COMMIT');return {allowed:true,id:row.id};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 }
 async function finish(id,{outcome,duration_ms,http_status,usage:tokens={},result}={}){
  const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
  await query(`UPDATE calls SET outcome=$1,duration_ms=$2,http_status=$3,input_tokens=$4,output_tokens=$5,thinking_tokens=$6,total_tokens=$7,dry=$8,wash=$9,label_visible=$10 WHERE id=$11 AND outcome='pending'`,[outcome,count(duration_ms),count(http_status),count(tokens.promptTokenCount),count(tokens.candidatesTokenCount),count(tokens.thoughtsTokenCount),count(tokens.totalTokenCount),result?.dry?.status??null,result?.wash?.status??null,result?Number(result.label_visible):null,id]);
 }
 const all=async(sql,args)=>{let n=0;return (await query(sql.replaceAll('?',()=>'$'+(++n)),args)).rows;};
 const get=async(sql,args)=>(await all(sql,args))[0];
 return {identity,usage,reserve,finish,summary:createSummary({all,get,clock,hash,limits}),close:()=>pool.end(),query};
}
