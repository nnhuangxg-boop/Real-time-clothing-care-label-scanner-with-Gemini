import worker from '../dist/server/index.js';
import {createPostgresStore} from '../scripts/postgres-store.mjs';
import {readFileSync} from 'node:fs';
import {createHash,timingSafeEqual} from 'node:crypto';
let store;
const privateHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"};
export function adminAuthorized(request,password){
 if(!password||password.length<32)return false;
 const expected='Basic '+Buffer.from('admin:'+password).toString('base64');
 const digest=s=>createHash('sha256').update(s).digest();
 return timingSafeEqual(digest(expected),digest(request.headers.get('authorization')||''));
}
export async function handle(request,env=process.env,injectedStore){
 const url=new URL(request.url);
 try{
  const isAdmin=['/admin','/admin.js','/admin/usage'].includes(url.pathname);
  if(isAdmin&&!adminAuthorized(request,env.ADMIN_PASSWORD))return new Response('Administrator login required',{status:401,headers:{...privateHeaders,'WWW-Authenticate':'Basic realm="Care Scan Admin", charset="UTF-8"'}});
  if(!isAdmin&&!['/api/status','/api/scan'].includes(url.pathname))return worker.fetch(request,{});
  const db=injectedStore||(store??=createPostgresStore(env.DATABASE_URL,env.IDENTITY_SECRET));
  if(isAdmin){
   if(request.method!=='GET')return new Response(null,{status:405,headers:privateHeaders});
   if(url.pathname==='/admin/usage')return Response.json(await db.summary(),{headers:privateHeaders});
   const js=url.pathname==='/admin.js';
   const body=readFileSync(new URL(js?'../scripts/admin.js':'../scripts/admin.html',import.meta.url),'utf8').replace('仅本机可见','仅管理员可见');
   return new Response(body,{headers:{...privateHeaders,'Content-Type':js?'text/javascript; charset=utf-8':'text/html; charset=utf-8'}});
  }
  // Vercel overwrites x-forwarded-for at its trusted edge; never trust Cloudflare headers here.
  const ip=(request.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();
  const identity=await db.identity(request.headers.get('cookie'),ip,true);
  const usage={status:()=>db.usage(identity),reserve:(...args)=>db.reserve(identity,...args),finish:(...args)=>db.finish(...args)};
  const response=await worker.fetch(request,{GEMINI_API_KEY:env.GEMINI_API_KEY,GEMINI_MODEL:env.GEMINI_MODEL,USAGE:usage});
  const headers=new Headers(response.headers);if(identity.cookie)headers.append('Set-Cookie',identity.cookie);
  const body=await response.json();if(url.pathname==='/api/scan')body.trial=await usage.status();
  return Response.json(body,{status:response.status,headers});
 }catch{return Response.json({error:'额度服务暂时不可用，请稍后重试。',code:'usage_unavailable'},{status:503,headers:privateHeaders});}
}
export default {fetch:request=>handle(request)};
