import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';

async function pilot(t,ttlMs=900000) {
  const {server}=createServer({ttlMs});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;
  return async(path,actor='buyer',buyer='alice',data)=>{
    const r=await fetch(base+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{'content-type':'application/json','x-demo-role':actor,'x-demo-buyer':buyer},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:r.status,data:await r.json()};
  };
}
async function ready(api,order,buyer) {
  const c=(await api('cases','buyer',buyer,{orderId:order,claim:'The claimed USB4 function did not work'})).data;
  await api('cases/'+c.id+'/respond','warehouse',buyer,{response:'Alternative offers after vendor review',offers:['DOCK-LITE','DOCK-PRO']});
  await api('cases/'+c.id+'/freeze','warehouse',buyer,{});
  await api('cases/'+c.id+'/decide','warehouse',buyer,{outcome:'ELIGIBLE',quote:'USB4',reason:'Matches purchase-time description'});
  return c.id;
}
test('buyer identity and evidence validation',async t=>{
  const api=await pilot(t);
  assert.equal((await api('cases','buyer','bob',{orderId:'O100',claim:'mismatch'})).status,403);
  const id=await ready(api,'O100','alice');
  assert.equal((await api('cases/'+id+'/choose','buyer','alice',{sku:'DOCK-LITE'})).status,422);
  assert.equal((await api('cases/'+id+'/choose','buyer','bob',{sku:'DOCK-PRO'})).status,403);
});
test('two buyers race for final compatible unit and only one wins',async t=>{
  const api=await pilot(t);
  const a=await ready(api,'O100','alice'),b=await ready(api,'O101','bob');
  const attempts=await Promise.all([api('cases/'+a+'/choose','buyer','alice',{sku:'DOCK-PRO'}),api('cases/'+b+'/choose','buyer','bob',{sku:'DOCK-PRO'})]);
  assert.deepEqual(attempts.map(x=>x.status).sort(),[200,409]);
  const state=(await api('state')).data;
  assert.equal(state.products.find(x=>x.sku==='DOCK-PRO').stock,0);
});
test('warehouse receipt, failure rollback, replay-safe replacement order',async t=>{
  const api=await pilot(t);const id=await ready(api,'O100','alice');
  assert.equal((await api('cases/'+id+'/fulfill','warehouse','alice',{})).status,409);
  assert.equal((await api('cases/'+id+'/choose','buyer','alice',{sku:'DOCK-PRO'})).status,200);
  assert.equal((await api('cases/'+id+'/receive','warehouse','alice',{matches:true})).status,200);
  assert.equal((await api('cases/'+id+'/fulfill','warehouse','alice',{simulateFailure:true})).status,503);
  assert.equal((await api('state')).data.replacements.length,0);
  const result=(await api('cases/'+id+'/fulfill','warehouse','alice',{})).data;
  assert.equal(result.status,'COMPLETED');assert.equal(result.replacement.confirmed,1);
  const again=(await api('cases/'+id+'/fulfill','warehouse','alice',{})).data;
  assert.equal(again.replacement.id,result.replacement.id);
  assert.equal((await api('state')).data.replacements.length,1);
});
test('mismatched return is sent for review and cannot fulfill',async t=>{
  const api=await pilot(t);const id=await ready(api,'O100','alice');
  await api('cases/'+id+'/choose','buyer','alice',{sku:'DOCK-PRO'});
  const mismatch=(await api('cases/'+id+'/receive','warehouse','alice',{matches:false,reason:'Wrong model returned'})).data;
  assert.equal(mismatch.status,'REVIEW');
  assert.equal((await api('cases/'+id+'/fulfill','warehouse','alice',{})).status,409);
});
