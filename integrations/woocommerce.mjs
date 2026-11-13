// WooCommerce REST v3 boundary. Must be called only after authenticated buyer,
// verified finalized GenLayer verdict and warehouse return acceptance.
const problem=(code,message)=>Object.assign(new Error(message),{code});
export function createWooAdapter({origin,consumerKey,consumerSecret,fetchImpl=fetch}) {
  const base=new URL(origin);
  if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)
    throw problem('CONFIG','Clean HTTPS WooCommerce origin required');
  if(!consumerKey||!consumerSecret)throw problem('CONFIG','WooCommerce API keys required');
  const number=value=>{
    if(!Number.isSafeInteger(Number(value))||Number(value)<1)throw problem('INVALID_ID','Positive numeric ID required');
    return Number(value);
  };
  const authorization='Basic '+Buffer.from(consumerKey+':'+consumerSecret).toString('base64');
  async function request(method,path,payload) {
    const response=await fetchImpl(base.origin+'/wp-json/wc/v3'+path,{
      method,headers:{Authorization:authorization,Accept:'application/json',...(payload?{'Content-Type':'application/json'}:{})},
      body:payload?JSON.stringify(payload):undefined,redirect:'error'
    });
    if(!response.ok)throw problem('WOO_HTTP_'+response.status,'WooCommerce '+method+' '+path+' returned '+response.status);
    const value=await response.text();
    if(!value)throw problem('INCOMPLETE_RESPONSE','WooCommerce response empty');
    return JSON.parse(value);
  }
  const getOrder=id=>request('GET','/orders/'+number(id));
  const getProduct=id=>request('GET','/products/'+number(id));
  async function createReplacement({sourceOrderId,replacementProductId,operationKey}) {
    const key=String(operationKey||'');
    if(!/^[a-zA-Z0-9:_-]{12,100}$/.test(key))throw problem('OPERATION_KEY','Stable non-PII operation key required');
    const source=await getOrder(sourceOrderId),product=await getProduct(replacementProductId);
    if(!['processing','completed'].includes(source.status))throw problem('SOURCE_ORDER','Source order is not fulfilled');
    if(!product.manage_stock||!product.in_stock||!Number.isInteger(product.stock_quantity)||product.stock_quantity<1)
      throw problem('STOCK','Product requires available managed stock');
    if(product.purchasable!==true)throw problem('PRODUCT','Replacement is not purchasable');
    // One WooCommerce order is allowed per operationKey; remote API does not
    // guarantee atomic de-duplication. Never auto-retry POST after timeout.
    const orderBody={
      status:'on-hold',set_paid:false,customer_id:number(source.customer_id),
      line_items:[{product_id:number(replacementProductId),quantity:1}],
      meta_data:[{key:'_swapback_operation',value:key},{key:'_swapback_source_order',value:String(sourceOrderId)}]
    };
    let created;
    try{created=await request('POST','/orders',orderBody);}
    catch(e){throw problem('UNCERTAIN_REMOTE_WRITE','Order POST outcome uncertain: reconcile WooCommerce orders by operation key '+key+' before any retry. Cause: '+e.message);}
    if(!created||!Number.isSafeInteger(created.id))throw problem('UNCERTAIN_REMOTE_WRITE','Order creation response has no valid ID; manual reconciliation required');
    let actual;
    try{actual=await getOrder(created.id);}catch(e){throw problem('UNCERTAIN_REMOTE_WRITE','Order '+created.id+' created but readback failed; reconcile before retry');}
    const correctLine=actual.line_items?.some(line=>Number(line.product_id)===Number(replacementProductId)&&line.quantity===1);
    const correctKey=actual.meta_data?.some(m=>m.key==='_swapback_operation'&&m.value===key);
    const correctSource=actual.meta_data?.some(m=>m.key==='_swapback_source_order'&&m.value===String(sourceOrderId));
    if(!correctLine||!correctKey||!correctSource)throw problem('READBACK_MISMATCH','Order readback differs, do not duplicate the order');
    return {confirmed:true,orderId:actual.id,operationKey:key,productId:Number(replacementProductId)};
  }
  return {getOrder,getProduct,createReplacement};
}
