import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID,createHash } from 'node:crypto';
import { readFileSync,mkdirSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rule='R1: A claimed incompatibility is eligible if it contradicts the purchase-time USB4 promise and a matching return is received.';
const hash=t=>createHash('sha256').update(t).digest('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const text=(v,n)=>{if(typeof v!=='string'||!v.trim()||v.length>4000)fail(400,n+' required (max 4000)');return v.trim();};
const role=(v,w)=>{if(v!==w)fail(403,w+' role required');};
const inState=(c,values)=>{if(!values.includes(c.status))fail(409,'Wrong case state '+c.status);};

export function createDomain(path=':memory:',options={}) {
  if(path!==':memory:')mkdirSync(dirname(resolve(path)),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE IF NOT EXISTS products(sku TEXT PRIMARY KEY, woo_id INTEGER NOT NULL, features TEXT NOT NULL, stock INTEGER NOT NULL CHECK(stock>=0), price_cents INTEGER NOT NULL, documentation TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS purchases(id TEXT PRIMARY KEY, buyer TEXT NOT NULL, sku TEXT NOT NULL, description_at_purchase TEXT NOT NULL, policy_at_purchase TEXT NOT NULL, state TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES purchases(id), buyer TEXT NOT NULL, claim TEXT NOT NULL, response TEXT, offers TEXT, snapshot TEXT, digest TEXT, status TEXT NOT NULL, decision TEXT, evidence_quote TEXT, rationale TEXT, selected_sku TEXT, updated TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS reservations(case_id TEXT PRIMARY KEY REFERENCES cases(id), sku TEXT NOT NULL REFERENCES products(sku), expires_at INTEGER NOT NULL, active INTEGER NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS replacements(id TEXT PRIMARY KEY, case_id TEXT NOT NULL UNIQUE REFERENCES cases(id), source_order TEXT NOT NULL, sku TEXT NOT NULL, quantity INTEGER NOT NULL, operation_key TEXT NOT NULL UNIQUE, confirmed INTEGER NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL)');
  if(db.prepare('SELECT COUNT(*) n FROM products').get().n===0){
    const p=db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?)');
    p.run('DOCK-OLD',101,'usb4,hdmi',0,5900,'Purchase-time dock advertised USB4 video support');
    p.run('DOCK-LITE',102,'hdmi',2,4900,'Manufacturer says HDMI only, not USB4');
    p.run('DOCK-PRO',103,'usb4,hdmi,power100w',1,6900,'Manufacturer confirms USB4 and power delivery');
    const o=db.prepare('INSERT INTO purchases VALUES(?,?,?,?,?,?)');
    for(const [id,buyer] of [['O100','alice'],['O101','bob']])o.run(id,buyer,'DOCK-OLD','Advertised USB4 display compatibility','Exchange permitted if published compatibility claim is not met','completed');
  }
  const product=sku=>db.prepare('SELECT * FROM products WHERE sku=?').get(sku);
  const purchase=id=>db.prepare('SELECT * FROM purchases WHERE id=?').get(id);
  const one=id=>db.prepare('SELECT * FROM cases WHERE id=?').get(id);
  const set=(id,fields)=>db.prepare('UPDATE cases SET '+Object.keys(fields).map(n=>n+'=?').join(',')+',updated=? WHERE id=?').run(...Object.values(fields),new Date().toISOString(),id);
  const note=(id,action,detail)=>db.prepare('INSERT INTO events(case_id,action,detail,at) VALUES(?,?,?,?)').run(id,action,JSON.stringify(detail),new Date().toISOString());
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  const view=id=>{const c=one(id);if(!c)fail(404,'Case not found');return {...c,source:purchase(c.order_id),reservation:db.prepare('SELECT * FROM reservations WHERE case_id=?').get(id)||null,replacement:db.prepare('SELECT * FROM replacements WHERE case_id=?').get(id)||null,events:db.prepare('SELECT * FROM events WHERE case_id=? ORDER BY id').all(id)};};
  const release=now=>{
    const expired=db.prepare('SELECT * FROM reservations WHERE active=1 AND expires_at<=?').all(now);
    for(const r of expired) {
      db.prepare('UPDATE products SET stock=stock+1 WHERE sku=?').run(r.sku);
      db.prepare('UPDATE reservations SET active=0 WHERE case_id=?').run(r.case_id);
      const c=one(r.case_id);
      if(c&&['RESERVED','RECEIVED'].includes(c.status))set(c.id,{status:'EXPIRED'});
      note(r.case_id,'HOLD_EXPIRED',{sku:r.sku});
    }
  };
  const ttlMs=options.ttlMs??15*60*1000;
  function state() {return transaction(()=>{release(Date.now());return {mode:'LOCAL_FIXTURE_ONLY',rule,products:db.prepare('SELECT * FROM products ORDER BY sku').all(),purchases:db.prepare('SELECT * FROM purchases ORDER BY id').all(),cases:db.prepare('SELECT id,order_id,buyer,status,selected_sku,decision FROM cases ORDER BY updated DESC').all(),replacements:db.prepare('SELECT * FROM replacements ORDER BY id').all()};});}
  function create(actor,buyer,data) {
    role(actor,'buyer');
    const order=purchase(text(data.orderId,'orderId'));
    if(!order)fail(404,'Purchase not found');
    if(order.buyer!==buyer)fail(403,'Authenticated demo buyer does not own order');
    if(order.state!=='completed')fail(409,'Order not eligible');
    const claim=text(data.claim,'claim');
    return transaction(()=>{
      const id=randomUUID();
      db.prepare('INSERT INTO cases(id,order_id,buyer,claim,status,updated) VALUES(?,?,?,?,?,?)').run(id,order.id,buyer,claim,'OPEN',new Date().toISOString());
      note(id,'OPENED',{orderId:order.id,buyer,sourceSKU:order.sku});
      return view(id);
    });
  }
  function act(id,actor,buyer,operation,data={}) {
    return transaction(()=>{
      release(Date.now());
      const c=one(id);if(!c)fail(404,'Case not found');
      if(operation==='respond'){
        role(actor,'warehouse');inState(c,['OPEN']);
        const offers=data.offers;
        if(!Array.isArray(offers)||offers.length===0||offers.length>5||new Set(offers).size!==offers.length)fail(400,'Provide unique candidate SKUs');
        for(const sku of offers)if(!product(sku)||sku===purchase(c.order_id).sku)fail(422,'Unknown or original SKU: '+sku);
        set(id,{response:text(data.response,'response'),offers:JSON.stringify(offers)});
        note(id,'SELLER_RESPONSE',{offers});
      } else if(operation==='freeze'){
        role(actor,'warehouse');inState(c,['OPEN']);
        if(!c.response)fail(409,'Seller must respond first');
        const order=purchase(c.order_id);
        const frozen=JSON.stringify({orderId:order.id,buyer:order.buyer,sku:order.sku,description_at_purchase:order.description_at_purchase,policy_at_purchase:order.policy_at_purchase,requirement:'usb4',claim:c.claim,store_response:c.response,offers:JSON.parse(c.offers).map(sku=>product(sku)),ruleVersion:'pilot-v1',rule});
        set(id,{snapshot:frozen,digest:hash(frozen),status:'FROZEN'});
        note(id,'FROZEN',{sha256:hash(frozen)});
      } else if(operation==='decide'){
        role(actor,'warehouse');inState(c,['FROZEN']);
        const outcome=text(data.outcome,'outcome'),quote=text(data.quote,'quote'),reason=text(data.reason,'reason');
        if(!['ELIGIBLE','DENIED'].includes(outcome))fail(400,'Invalid decision');
        if(!c.snapshot.includes(quote))fail(422,'Quote not in frozen purchase record');
        set(id,{decision:outcome,evidence_quote:quote,rationale:reason,status:outcome==='ELIGIBLE'?'ELIGIBLE':'DENIED'});
        note(id,'MANUAL_FIXTURE_DECISION',{outcome,quote,reason,sha256:c.digest});
      } else if(operation==='choose'){
        role(actor,'buyer');if(c.buyer!==buyer)fail(403,'Not case buyer');
        inState(c,['ELIGIBLE']);
        const sku=text(data.sku,'sku');
        if(!JSON.parse(c.offers).includes(sku))fail(422,'SKU not offered');
        const item=product(sku);
        if(!item.features.split(',').includes('usb4'))fail(422,'Replacement lacks promised USB4 feature');
        const result=db.prepare('UPDATE products SET stock=stock-1 WHERE sku=? AND stock>=1').run(sku);
        if(result.changes!==1)fail(409,'Out of stock; no hold placed');
        const until=Date.now()+ttlMs;
        db.prepare('INSERT INTO reservations(case_id,sku,expires_at,active) VALUES(?,?,?,1)').run(id,sku,until);
        set(id,{status:'RESERVED',selected_sku:sku});
        note(id,'INVENTORY_HELD',{sku,expiresAt:until});
      } else if(operation==='receive'){
        role(actor,'warehouse');inState(c,['RESERVED']);
        const reservation=db.prepare('SELECT * FROM reservations WHERE case_id=? AND active=1').get(id);
        if(!reservation)fail(409,'Reservation expired');
        if(data.matches!==true){
          set(id,{status:'REVIEW'});note(id,'RETURN_MISMATCH',{reason:text(data.reason,'reason')});
        }else{
          set(id,{status:'RECEIVED'});note(id,'WAREHOUSE_VERIFIED',{matchingReturn:true});
        }
      } else if(operation==='fulfill'){
        role(actor,'warehouse');
        if(c.status==='COMPLETED')return view(id);
        inState(c,['RECEIVED']);
        const reservation=db.prepare('SELECT * FROM reservations WHERE case_id=? AND active=1').get(id);
        if(!reservation)fail(409,'Reservation not active');
        const old= db.prepare('SELECT * FROM replacements WHERE case_id=?').get(id);
        if(!old){
          const orderId='REPL-'+randomUUID().slice(0,12).toUpperCase();
          db.prepare('INSERT INTO replacements VALUES(?,?,?,?,?,?,?)').run(orderId,id,c.order_id,c.selected_sku,1,'exchange:'+id,0);
        }
        if(data.simulateFailure===true)fail(503,'Simulated failure: transaction rolled back, retry is safe');
        const created=db.prepare('SELECT * FROM replacements WHERE case_id=?').get(id);
        if(created.sku!==reservation.sku||created.quantity!==1)fail(503,'Replacement readback mismatch');
        db.prepare('UPDATE replacements SET confirmed=1 WHERE case_id=?').run(id);
        db.prepare('UPDATE reservations SET active=0 WHERE case_id=?').run(id);
        set(id,{status:'COMPLETED'});
        note(id,'ORDER_READBACK',{orderId:created.id,sku:created.sku,quantity:1,operationKey:created.operation_key});
      } else fail(404,'Unknown operation');
      return view(id);
    });
  }
  return {db,state,create,act,view};
}
export function createServer(options={}) {
  const domain=createDomain(options.dbPath||':memory:',{ttlMs:options.ttlMs});
  const index=readFileSync(new URL('./ui/index.html',import.meta.url));
  const server=http.createServer(async(req,res)=>{
    const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
    try {
      const path=new URL(req.url,'http://localhost').pathname,actor=req.headers['x-demo-role'],buyer=req.headers['x-demo-buyer'];
      if(req.method==='GET'&&path==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"});return res.end(index);}
      if(req.method==='GET'&&path==='/api/state')return reply(200,domain.state());
      const match=path.match(/^\/api\/cases\/([^/]+)(?:\/(respond|freeze|decide|choose|receive|fulfill))?$/);
      if(req.method==='GET'&&match&&!match[2])return reply(200,domain.view(match[1]));
      if(req.method!=='POST')return reply(404,{error:'Not found'});
      let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>20000)fail(413,'Payload too large');chunks.push(chunk);}
      let data;try{data=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{fail(400,'Invalid JSON');}
      if(path==='/api/cases')return reply(201,domain.create(actor,buyer,data));
      if(match&&match[2])return reply(200,domain.act(match[1],actor,buyer,match[2],data));
      return reply(404,{error:'Not found'});
    }catch(e){return reply(e.status||500,{error:e.message});}
  });
  server.on('close',()=>domain.db.close());
  return {server,domain};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if((process.env.APP_MODE||'demo')!=='demo')throw Error('Live mode disabled without wallet, WooCommerce and GenLayer verification');
  const port=Number(process.env.PORT||4200),{server}=createServer({dbPath:process.env.DB_PATH||'data/swapback.sqlite'});
  server.listen(port,'127.0.0.1',()=>console.log('SWAPBACK LOCAL FIXTURE ONLY: http://127.0.0.1:'+port));
}
