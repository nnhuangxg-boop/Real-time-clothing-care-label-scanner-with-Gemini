import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createUsageStore} from '../scripts/usage-store.mjs';
import worker from '../dist/server/index.js';
const reserve=(store,ctx,source='owner')=>store.reserve(ctx,source,'gemini-test','en');

test('10 browser, 30 IP, 200 global limits; personal calls bypass all three',()=>{
 const store=createUsageStore(':memory:');
 try{
  const first=store.identity('', '192.0.2.1',true);
  assert.match(first.cookie,/HttpOnly; SameSite=Lax; Secure/);
  for(let i=0;i<10;i++)assert.equal(reserve(store,first).allowed,true);
  assert.equal(reserve(store,first).quota.reason,'browser_limit');
  for(let b=0;b<2;b++){const ctx=store.identity('','192.0.2.1',true);for(let i=0;i<10;i++)assert.equal(reserve(store,ctx).allowed,true);}
  const fresh=store.identity('','192.0.2.1',true);
  assert.equal(reserve(store,fresh).quota.reason,'ip_limit');
  for(let b=0;b<17;b++){const ctx=store.identity('',`192.0.2.${b+2}`,true);for(let i=0;i<10;i++)assert.equal(reserve(store,ctx).allowed,true);}
  const next=store.identity('','192.0.2.100',true);assert.equal(reserve(store,next).quota.reason,'site_limit');
  for(const ctx of [first,fresh,next])for(let i=0;i<40;i++)assert.equal(reserve(store,ctx,'personal').allowed,true);
  assert.equal(store.summary().today.owner.calls,200);assert.equal(store.summary().today.personal.calls,120);
 }finally{store.close();}
});

test('daily limits reset at UTC midnight; browser allowance does not; forged cookies are not accepted',()=>{
 let now=Date.parse('2026-10-01T23:59:59Z');const store=createUsageStore(':memory:',{clock:()=>now});
 try{
  const ctx=store.identity('','203.0.113.1',true);for(let i=0;i<10;i++)reserve(store,ctx);
  const token=ctx.cookie.split(';')[0];assert.equal(store.identity(token,'203.0.113.1',true).browser,ctx.browser);
  assert.notEqual(store.identity(token+'0','203.0.113.1',true).browser,ctx.browser);
  now+=2000;assert.equal(store.usage(ctx).reason,'browser_limit');
  assert.equal(store.usage(store.identity('','203.0.113.1',true)).remaining,10);
  assert.equal(store.summary().today.owner.calls,0);
 }finally{store.close();}
});

test('two server connections share quotas and persisted identity after restart',()=>{
 const path=join(mkdtempSync(join(tmpdir(),'care-usage-')),'usage.sqlite');let a=createUsageStore(path),b=createUsageStore(path);
 const ctx=a.identity('','192.0.2.9',true),cookie=ctx.cookie.split(';')[0];
 for(let i=0;i<10;i++)assert.equal(reserve(i%2?a:b,ctx).allowed,true);
 assert.equal(reserve(a,ctx).allowed,false);a.close();b.close();
 a=createUsageStore(path);assert.equal(a.usage(a.identity(cookie,'192.0.2.9',true)).remaining,0);a.close();
 assert.equal(readFileSync(path).includes(Buffer.from('192.0.2.9')),false);
});

test('parallel worker calls cannot overspend; errors count; own key is unrestricted and usage is recorded',async()=>{
 const store=createUsageStore(':memory:');const ctx=store.identity('','192.0.2.99',true);
 const env={GEMINI_API_KEY:'owner-secret',USAGE:{status:()=>store.usage(ctx),reserve:(...a)=>store.reserve(ctx,...a),finish:(...a)=>store.finish(...a)}};
 const original=globalThis.fetch;let providerCalls=0,fail=false,personalSeen=0;
 globalThis.fetch=async(url,options)=>{providerCalls++;if(options.headers['x-goog-api-key']==='personal_key_1234567890')personalSeen++;if(fail)return new Response('{}',{status:403});return Response.json({usageMetadata:{promptTokenCount:120,candidatesTokenCount:30,thoughtsTokenCount:5,totalTokenCount:155},candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({label_visible:true,dry:{status:'forbidden',detail:'No tumble drying',evidence:'Do not tumble dry'},wash:{status:'unknown',detail:'',evidence:''}})}]}}]});};
 const scan=key=>worker.fetch(new Request('https://example.test/api/scan',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json',...(key?{'x-gemini-api-key':key}:{})},body:JSON.stringify({image:'/9j/'+'A'.repeat(100),language:'en'})}),env);
 try{
  const results=await Promise.all(Array.from({length:20},()=>scan()));
  assert.equal(results.filter(r=>r.status===200).length,10);assert.equal(results.filter(r=>r.status===429).length,10);assert.equal(providerCalls,10);
  fail=true;assert.equal((await scan('personal_key_1234567890')).status,424);assert.equal(personalSeen,1);assert.equal(providerCalls,11);
  const stats=store.summary();assert.equal(stats.period.owner.outcomes.uncertain,10);assert.equal(stats.period.owner.input_tokens,1200);assert.equal(stats.period.personal.outcomes.upstream_error,1);assert.equal(stats.period.personal.metered_calls,0);
  assert.equal(JSON.stringify(stats).includes('personal_key_1234567890'),false);assert.equal(JSON.stringify(stats).includes('No tumble drying'),false);assert.equal(JSON.stringify(stats).includes('192.0.2.99'),false);
 }finally{globalThis.fetch=original;store.close();}
});

test('timeouts return browser credit and duplicate completion cannot change the refund',()=>{
 const store=createUsageStore(':memory:');try{const ctx=store.identity('','192.0.2.1',false);const r=reserve(store,ctx);store.finish(r.id,{outcome:'timeout',duration_ms:18000});store.finish(r.id,{outcome:'success',duration_ms:1});assert.equal(store.usage(ctx).remaining,10);assert.equal(store.summary().period.owner.outcomes.timeout,1);}finally{store.close();}
});


test('last browser credit is reserved until timeout then becomes available; IP and site caps still apply',()=>{
 const store=createUsageStore(':memory:');try{
  const ctx=store.identity('','192.0.2.1',true);
  for(let i=0;i<9;i++){const r=reserve(store,ctx);store.finish(r.id,{outcome:'success',duration_ms:100});}
  const last=reserve(store,ctx);assert.equal(store.usage(ctx).remaining,0);assert.equal(reserve(store,ctx).allowed,false);
  store.finish(last.id,{outcome:'timeout',duration_ms:12000});assert.equal(store.usage(ctx).remaining,1);assert.equal(reserve(store,ctx).allowed,true);
  for(let i=0;i<19;i++){const other=store.identity('','192.0.2.1',true);const r=reserve(store,other);store.finish(r.id,{outcome:'timeout',duration_ms:12000});}
  const fresh=store.identity('','192.0.2.1',true);assert.equal(store.usage(fresh).browserRemaining,10);assert.equal(store.usage(fresh).reason,'ip_limit');
  assert.equal(store.summary().today.owner.calls,30);assert.equal(store.summary().today.owner.refunded_trials,20);
 }finally{store.close();}
});
