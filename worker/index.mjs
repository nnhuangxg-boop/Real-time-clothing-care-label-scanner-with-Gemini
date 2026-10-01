import { expandCompact, compactSchema, compactPrompt } from './logic.mjs';
// ASSET_BUNDLE
const security = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Permissions-Policy':'camera=(self), microphone=()', 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'" };
const json = (data,status=200) => Response.json(data,{status,headers:security});
export default {
 async fetch(request, env = {}) {
  const url = new URL(request.url);
  if(request.method==='GET' && url.pathname==='/api/status') return json({configured:!!env.GEMINI_API_KEY,...(env.USAGE?{trial:await env.USAGE.status()}:{} )});
  if(request.method==='GET' && assets[url.pathname]) { const a=assets[url.pathname]; return new Response(a.body,{headers:{...security,'Content-Type':a.type}}); }
  if(url.pathname!=='/api/scan') return json({error:'页面不存在。'},404);
  if(request.method!=='POST') return json({error:'不支持此请求。'},405);
  if(request.headers.get('origin')!==url.origin) return json({error:'请从扫描页面发起请求。'},403);
  const userKey=request.headers.get('x-gemini-api-key');
  if(userKey!==null&&!/^[A-Za-z0-9_.-]{20,256}$/.test(userKey))return json({error:'请在 API 设置中填写完整的 Gemini API Key。',code:'invalid_key'},400);
  const apiKey=userKey??env.GEMINI_API_KEY;
  if(!apiKey) return json({error:'请点击右上角 API，填写 Gemini API Key。',code:'not_configured'},503);
  if(!request.headers.get('content-type')?.startsWith('application/json')) return json({error:'请求格式不正确。'},415);
  // Use 424 for upstream application failures: the quick tunnel replaces 502 bodies with HTML.
  let callId=null,started=null,tokens={},upstreamStatus=null;
  const finish=async(outcome,result)=>{if(callId!==null)await env.USAGE.finish(callId,{outcome,result,duration_ms:Date.now()-started,http_status:upstreamStatus,usage:tokens});};
  try {
   const reader=request.body?.getReader(); if(!reader) return json({error:'缺少图像。'},400);
   const chunks=[];let size=0;while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1800000){await reader.cancel();return json({error:'画面过大，请重新扫描。'},413);}chunks.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
   let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'请求格式不正确。'},400);}
   if(typeof data.image!=='string'||data.image.length<100||!/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(data.image)) return json({error:'需要有效的 JPEG 标签画面。'},400);
   const model=env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
   if(!/^gemini-[a-z0-9.-]+$/.test(model))return json({error:'服务端模型配置有误。'},503);
   if(!env.USAGE)return json({error:'额度服务暂时不可用，请稍后重试。',code:'usage_unavailable'},503);
   const reservation=await env.USAGE.reserve(userKey===null?'owner':'personal',model,data.language==='en'?'en':'zh');
   if(!reservation.allowed){
    const messages={browser_limit:'这个浏览器的 10 次免费体验已用完。',ip_limit:'当前网络今日的 30 次免费调用已用完。',site_limit:'今日全站的 200 次免费调用已用完。'};
    return json({error:messages[reservation.quota.reason],code:reservation.quota.reason,trial:reservation.quota},429);
   }
   callId=reservation.id;
   const selectedPrompt=data.language==='en'?compactPrompt.replace('Simplified Chinese','English').replace('terse Chinese restrictions','terse English restrictions').replace('35 Chinese characters','100 characters'):compactPrompt;
   started=Date.now();
   const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify({systemInstruction:{parts:[{text:selectedPrompt}]},contents:[{role:'user',parts:[{inlineData:{mimeType:'image/jpeg',data:data.image}}]}],generationConfig:{temperature:0,maxOutputTokens:1400,responseMimeType:'application/json',responseSchema:compactSchema}}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(12000)])});
   upstreamStatus=response.status;
   if(response.status===408||response.status===504){await finish('timeout');return json({error:userKey===null?'Gemini 响应超时，本次未扣体验次数。':'Gemini 响应超时，请稍后重试。',code:'upstream_timeout'},424);}
   if(!response.ok){await finish('upstream_error');const code=response.status;return json({error:code===429?'Gemini 配额已用完或请求过多，请稍后重试。':(code===400||code===401||code===403)?'Gemini Key 或接口权限有问题，请检查 API 设置。':code===404?'所选模型不可用，请检查模型配置。':'识别服务暂时不可用，请稍后重试。',code:'upstream'},424);}
   const result=await response.json();tokens=result.usageMetadata||{}; const candidate=result.candidates?.[0];
   if(candidate?.finishReason!=='STOP'){await finish('incomplete');return json({error:'本次未获得完整结果，请重新扫描。',code:'invalid_result'},424);}
   const value=JSON.parse(candidate.content.parts.filter(p=>p.text&&!p.thought).map(p=>p.text).join(''));
   const normalized=expandCompact(value);
   await finish(!normalized.label_visible?'no_label':normalized.dry.status==='unknown'||normalized.wash.status==='unknown'?'uncertain':'success',normalized);
   return json({ ...normalized, duration_ms:Date.now()-started });
  } catch(error) {try{await finish(request.signal.aborted?'cancelled':error.name==='TimeoutError'?'timeout':'invalid_result');}catch{}return json({error:error.name==='TimeoutError'?(userKey===null?'Gemini 响应超时，本次未扣体验次数。':'Gemini 响应超时，请稍后重试。'):'本次无法读取结果，请重新扫描。',code:request.signal.aborted?'cancelled':error.name==='TimeoutError'?'upstream_timeout':'invalid_result'},424);}
 }
};
