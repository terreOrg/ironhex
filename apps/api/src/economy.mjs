import {randomUUID} from 'node:crypto';
import {AuthError} from './auth.mjs';

export const CONTRACTS=[
  {id:'patrol',name:'Приграничный патруль',victory:32000,enemyGunnery:4},
  {id:'intercept',name:'Перехват рейдеров',victory:56000,enemyGunnery:3},
  {id:'assault',name:'Штурм укреплений',victory:92000,enemyGunnery:2}
];
export const CATALOG=[
  {sku:'armor_patch',name:'Комплект бронепластин',price:900,restore:10},
  {sku:'structure_kit',name:'Ремкомплект конструкции',price:2500,restore:5}
];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const contractById=id=>CONTRACTS.find(c=>c.id===id);
export function contractPayout(id,result){
  const victory=(contractById(id)||CONTRACTS[0]).victory;
  return result==='victory'?victory:result==='draw'?Math.floor(victory/2):Math.floor(victory/5);
}
export function repairQuote(mech,stock={}){
  const armor=Number(mech.armor_damage||0),structure=Number(mech.structure_damage||0);
  const armorPatches=Math.min(Math.ceil(armor/10),stock.armor_patch||0);
  const structureKits=Math.min(Math.ceil(structure/5),stock.structure_kit||0);
  return {mechId:mech.id,chassis:mech.chassis,armorDamage:armor,
    structureDamage:structure,wrecked:!!mech.wrecked,
    armorPatches,structureKits,
    needsRepair:!!mech.wrecked||armor>0||structure>0,
    creditCost:Math.max(0,armor-10*armorPatches)*125+
      Math.max(0,structure-5*structureKits)*650+(mech.wrecked?8000:0)};
}
async function inTransaction(pool,action){
  const c=await pool.connect();
  try{await c.query('BEGIN');const result=await action(c);await c.query('COMMIT');return result;}
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
// Wallet row serializes all purchases and payouts for one commander.
export async function ensureWallet(client,owner){
  const added=await client.query('INSERT INTO commander_wallets(commander_id,balance) '+
    'VALUES($1,150000) ON CONFLICT DO NOTHING RETURNING commander_id',[owner]);
  if(added.rows.length)
    await client.query('INSERT INTO credit_ledger(commander_id,change_amount,reason,reference_key) '+
      'VALUES($1,150000,$2,$3)',[owner,'Стартовый капитал','opening:'+owner]);
  const r=await client.query('SELECT balance FROM commander_wallets WHERE commander_id=$1 FOR UPDATE',[owner]);
  return Number(r.rows[0].balance);
}
export async function changeCredits(client,owner,amount,reason,reference){
  if(!Number.isSafeInteger(amount)||amount===0||Math.abs(amount)>100000000)
    throw Error('invalid_credit_change');
  await ensureWallet(client,owner);
  const inserted=await client.query('INSERT INTO credit_ledger '+
    '(commander_id,change_amount,reason,reference_key) '+
    'VALUES($1,$2,$3,$4) ON CONFLICT(reference_key) DO NOTHING RETURNING id',
    [owner,amount,reason,reference]);
  if(!inserted.rows.length)return false;
  const updated=await client.query('UPDATE commander_wallets SET balance=balance+$2 '+
    'WHERE commander_id=$1 AND balance+$2>=0 RETURNING balance',[owner,amount]);
  if(!updated.rows.length)throw new AuthError(409,'insufficient_credits');
  return true;
}
async function stockFor(client,owner){
  const r=await client.query('SELECT sku,quantity FROM commander_supplies WHERE commander_id=$1',[owner]);
  return Object.fromEntries(r.rows.map(row=>[row.sku,row.quantity]));
}
export function createEconomyStore(pool){
  return {
    summary(owner){
      return inTransaction(pool,async c=>{
        const balance=await ensureWallet(c,owner);
        const stock=await stockFor(c,owner);
        const mechs=await c.query('SELECT id,chassis,armor_damage,structure_damage,wrecked '+
          'FROM hangar_mechs WHERE commander_id=$1 ORDER BY created_at DESC',[owner]);
        const ledger=await c.query('SELECT change_amount,reason,created_at FROM credit_ledger '+
          'WHERE commander_id=$1 ORDER BY id DESC LIMIT 20',[owner]);
        return {balance,stock,contracts:CONTRACTS,catalog:CATALOG,
          repairs:mechs.rows.map(m=>repairQuote(m,stock)),
          ledger:ledger.rows.map(e=>({amount:Number(e.change_amount),
            reason:e.reason,createdAt:e.created_at}))};
      });
    },
    purchase(owner,body){
      if(!body||typeof body!=='object'||Array.isArray(body)||
         Object.keys(body).some(k=>!['sku','quantity'].includes(k))||
         !Number.isInteger(body.quantity)||body.quantity<1||body.quantity>10)
        throw new AuthError(422,'invalid_purchase');
      const item=CATALOG.find(c=>c.sku===body.sku);
      if(!item)throw new AuthError(422,'invalid_purchase');
      return inTransaction(pool,async c=>{
        await changeCredits(c,owner,-item.price*body.quantity,
          'Закупка: '+item.name,'supply:'+randomUUID());
        const result=await c.query('INSERT INTO commander_supplies(commander_id,sku,quantity) '+
          'VALUES($1,$2,$3) ON CONFLICT(commander_id,sku) DO UPDATE SET '+
          'quantity=commander_supplies.quantity+EXCLUDED.quantity RETURNING quantity',
          [owner,item.sku,body.quantity]);
        return {sku:item.sku,quantity:result.rows[0].quantity,spent:item.price*body.quantity};
      });
    },
    repair(owner,body){
      if(!body||typeof body!=='object'||Array.isArray(body)||
         Object.keys(body).length!==1||typeof body.mechId!=='string'||!UUID.test(body.mechId))
        throw new AuthError(422,'invalid_repair');
      return inTransaction(pool,async c=>{
        await ensureWallet(c,owner);
        const rows=await c.query('SELECT id,chassis,armor_damage,structure_damage,wrecked '+
          'FROM hangar_mechs WHERE id=$1 AND commander_id=$2 FOR UPDATE',[body.mechId,owner]);
        if(!rows.rows.length)throw new AuthError(404,'mech_not_found');
        const quote=repairQuote(rows.rows[0],await stockFor(c,owner));
        if(!quote.needsRepair)throw new AuthError(409,'mech_undamaged');
        if(quote.creditCost)
          await changeCredits(c,owner,-quote.creditCost,'Ремонт: '+rows.rows[0].chassis,
            'repair:'+randomUUID());
        for(const [sku,used] of [['armor_patch',quote.armorPatches],
                                  ['structure_kit',quote.structureKits]]){
          if(used)await c.query('UPDATE commander_supplies SET quantity=quantity-$3 '+
            'WHERE commander_id=$1 AND sku=$2 AND quantity>=$3',[owner,sku,used]);
        }
        await c.query('UPDATE hangar_mechs SET armor_damage=0,structure_damage=0,wrecked=false '+
          'WHERE id=$1 AND commander_id=$2',[body.mechId,owner]);
        return {mechId:body.mechId,spent:quote.creditCost,
          armorPatches:quote.armorPatches,structureKits:quote.structureKits};
      });
    }
  };
}
