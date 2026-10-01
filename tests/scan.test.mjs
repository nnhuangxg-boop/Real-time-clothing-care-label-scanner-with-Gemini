import test from 'node:test';import assert from 'node:assert/strict';
import {sanitizeResult,expandCompact} from '../worker/logic.mjs';
import worker from '../dist/server/index.js';
const field={status:'conditional',title:'低温烘干',detail:'仅低温',evidence:'Tumble dry low',conflict:false};
test('compact output preserves restrictions and fails closed',()=>{const value={label_visible:true,wash:field,dry:{...field,status:'conflict'}};assert.equal(expandCompact(value).dry.status,'unknown');assert.equal(expandCompact(value).wash.detail,'仅低温');assert.equal(expandCompact({...value,dry:{...field,evidence:''}}).dry.status,'unknown');assert.throws(()=>expandCompact({...value,dry:{...field,status:'maybe'}}));});
test('missing, conflicting and absent-label evidence never grants permission',()=>{for(const variant of [{evidence:''},{conflict:true}])assert.equal(sanitizeResult({label_visible:true,wash:field,dry:{...field,...variant}}).dry.status,'unknown');assert.equal(sanitizeResult({label_visible:false,wash:field,dry:field}).dry.status,'unknown');});
test('explicit restrictions and prohibitions survive normalization',()=>{const r=sanitizeResult({label_visible:true,wash:field,dry:{...field,status:'forbidden',title:'禁止烘干'}});assert.equal(r.wash.status,'conditional');assert.equal(r.dry.status,'forbidden');});
test('unknown and invalid provider statuses cannot become allowed',()=>{assert.throws(()=>sanitizeResult({label_visible:true,wash:field,dry:{...field,status:'maybe'}}));});
test('no key is exposed and missing-key scans fail closed',async()=>{const a=await worker.fetch(new Request('https://example.test/api/status'),{GEMINI_API_KEY:'secret-test'});assert.deepEqual(await a.json(),{configured:true});const b=await worker.fetch(new Request('https://example.test/api/scan',{method:'POST',headers:{origin:'https://example.test'}}),{});assert.equal(b.status,503);});
test('cross-origin scan calls are rejected before any provider call',async()=>{const r=await worker.fetch(new Request('https://example.test/api/scan',{method:'POST',headers:{origin:'https://wrong.test'}}),{GEMINI_API_KEY:'secret-test'});assert.equal(r.status,403);});
test('malformed image is rejected locally',async()=>{const r=await worker.fetch(new Request('https://example.test/api/scan',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({image:'not a jpeg'})}),{GEMINI_API_KEY:'secret-test'});assert.equal(r.status,400);});

test('personal keys override server keys, work without a server key, and never silently fall back',async()=>{
 const USAGE={reserve:()=>({allowed:true,id:1}),finish(){}};
 const original=globalThis.fetch;const personal='test.personal_key_123456789';let sent=[];let rejected=false;
 globalThis.fetch=async(url,options)=>{assert.match(url,/^https:\/\/generativelanguage\.googleapis\.com\//);sent.push(options.headers['x-goog-api-key']);if(rejected)return new Response('{}',{status:403});return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({label_visible:true,wash:field,dry:field})}]}}]});};
 try{
  for(const [i,env] of [{GEMINI_API_KEY:'server-secret'},{}].entries()){
   const r=await worker.fetch(new Request('https://example.test/api/scan',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json','cf-connecting-ip':'personal-'+i,'x-gemini-api-key':personal},body:JSON.stringify({image:'/9j/'+ 'A'.repeat(100)})}),{...env,USAGE});
   assert.equal(r.status,200);assert.equal((await r.text()).includes(personal),false);
  }
  rejected=true;
  const r=await worker.fetch(new Request('https://example.test/api/scan',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json','cf-connecting-ip':'rejected-personal','x-gemini-api-key':personal},body:JSON.stringify({image:'/9j/'+ 'A'.repeat(100)})}),{GEMINI_API_KEY:'server-secret',USAGE});
  assert.equal(r.status,424);assert.deepEqual(sent,[personal,personal,personal]);
 }finally{globalThis.fetch=original;}
});

test('Gemini timeout returns a distinct JSON error and records the failed call',async()=>{
 const original=globalThis.fetch;let recorded;
 globalThis.fetch=async()=>{const error=new Error('timeout');error.name='TimeoutError';throw error;};
 try{
  const r=await worker.fetch(new Request('https://example.test/api/scan',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({image:'/9j/'+'A'.repeat(100)})}),{GEMINI_API_KEY:'server-test',USAGE:{reserve:()=>({allowed:true,id:1}),finish:(id,data)=>{recorded=data;}}});
  assert.equal(r.status,424);assert.match(r.headers.get('content-type'),/application\/json/);
  assert.deepEqual(await r.json(),{error:'Gemini 响应超时，本次未扣体验次数。',code:'upstream_timeout'});
  assert.equal(recorded.outcome,'timeout');
 }finally{globalThis.fetch=original;}
});

test('client cancellation aborts the upstream call and records cancellation',async()=>{
 const original=globalThis.fetch;const controller=new AbortController();let recorded,upstreamSignal,entered;
 const ready=new Promise(resolve=>{entered=resolve;});
 globalThis.fetch=async(url,options)=>{upstreamSignal=options.signal;entered();return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});};
 try{
  const pending=worker.fetch(new Request('https://example.test/api/scan',{method:'POST',signal:controller.signal,headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({image:'/9j/'+'A'.repeat(100)})}),{GEMINI_API_KEY:'server-test',USAGE:{reserve:()=>({allowed:true,id:1}),finish:(id,data)=>{recorded=data;}}});
  await ready;controller.abort();const r=await pending;
  assert.equal(upstreamSignal.aborted,true);assert.equal((await r.json()).code,'cancelled');assert.equal(recorded.outcome,'cancelled');
 }finally{globalThis.fetch=original;}
});
