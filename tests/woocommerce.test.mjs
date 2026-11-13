import test from 'node:test';
import assert from 'node:assert/strict';
import {createWooAdapter} from '../integrations/woocommerce.mjs';

const source={id:100,status:'completed',customer_id:7};
const product={id:103,manage_stock:true,in_stock:true,stock_quantity:1,purchasable:true};
const key='swapback-case-123';
test('preflight then create one on-hold order and verify remote readback',async()=>{
  const methods=[],created={id:900,line_items:[{product_id:103,quantity:1}],meta_data:[{key:'_swapback_operation',value:key},{key:'_swapback_source_order',value:'100'}]};
  const api=createWooAdapter({origin:'https://shop.example/',consumerKey:'ck',consumerSecret:'cs',fetchImpl:async(url,opts)=>{
    methods.push(opts.method+' '+new URL(url).pathname);
    const path=new URL(url).pathname;
    const obj=path.endsWith('/orders/100')?source:path.endsWith('/products/103')?product:created;
    if(opts.method==='POST'){const body=JSON.parse(opts.body);assert.equal(body.status,'on-hold');assert.equal(body.set_paid,false);assert.equal(body.line_items[0].quantity,1);}
    return new Response(JSON.stringify(obj),{status:200});
  }});
  const result=await api.createReplacement({sourceOrderId:100,replacementProductId:103,operationKey:key});
  assert.equal(result.orderId,900);assert.equal(result.confirmed,true);
  assert.deepEqual(methods,['GET /wp-json/wc/v3/orders/100','GET /wp-json/wc/v3/products/103','POST /wp-json/wc/v3/orders','GET /wp-json/wc/v3/orders/900']);
});
test('preflight out of stock refuses remote order creation',async()=>{
  let posted=0;
  const api=createWooAdapter({origin:'https://shop.example/',consumerKey:'ck',consumerSecret:'cs',fetchImpl:async(url,opts)=>{
    if(opts.method==='POST')posted++;
    return new Response(JSON.stringify(new URL(url).pathname.includes('products')?{...product,stock_quantity:0}:source),{status:200});
  }});
  await assert.rejects(api.createReplacement({sourceOrderId:100,replacementProductId:103,operationKey:key}),{code:'STOCK'});
  assert.equal(posted,0);
});
test('uncertain POST response never triggers an automatic retry',async()=>{
  let posts=0;
  const api=createWooAdapter({origin:'https://shop.example/',consumerKey:'ck',consumerSecret:'cs',fetchImpl:async(url,opts)=>{
    if(opts.method==='POST'){posts++;throw Error('connection reset after send');}
    return new Response(JSON.stringify(new URL(url).pathname.includes('products')?product:source),{status:200});
  }});
  await assert.rejects(api.createReplacement({sourceOrderId:100,replacementProductId:103,operationKey:key}),{code:'UNCERTAIN_REMOTE_WRITE'});
  assert.equal(posts,1);
});
