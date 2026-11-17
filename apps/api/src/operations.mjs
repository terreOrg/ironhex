import {randomBytes} from 'node:crypto';
import {Game,defaultMechWarriorSkills} from '../../../packages/engine/engine.js';
import {construct} from '../../../packages/engine/construction.js';
import {ammoBinsFor,normalizedAmmoState} from '../../../packages/engine/equipment.js';
import {captureCriticalDamage,applyCriticalDamage,damagedComponents,normalizedCriticalDamage} from
  '../../../packages/engine/component-damage.js';
import {validateDesign} from './hangar.mjs';
import {AuthError} from './auth.mjs';
import {runTacticalOrder,publicSnapshot} from './server-combat.mjs';
import {contractById,contractPayout,changeCredits} from './economy.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROUNDS=12;
const MAX_OPERATIONS=200;

export function validateOperation(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).some(k=>!['mechIds','title','mode','contractId'].includes(k))||
     !Array.isArray(input.mechIds)||input.mechIds.length<1||input.mechIds.length>2||
     input.mechIds.some(id=>typeof id!=='string'||!UUID.test(id))||
     new Set(input.mechIds).size!==input.mechIds.length)
    throw new AuthError(422,'invalid_operation');
  const title=input.title===undefined?'Боевая операция':input.title;
  if(typeof title!=='string'||title.trim().length<3||title.trim().length>80||
     /[\u0000-\u001f\u007f<>]/.test(title))
    throw new AuthError(422,'invalid_operation');
  const mode=input.mode??'auto';
  if(!['auto','interactive'].includes(mode))throw new AuthError(422,'invalid_operation');
  const contractId=input.contractId??'patrol';
  if(!contractById(contractId))throw new AuthError(422,'invalid_contract');
  return {title:title.trim(),mechIds:input.mechIds,mode,contractId};
}

function sourceRng(seed) {
  let current=seed>>>0 || 1;
  return {
    next(){
      current^=current<<13;
      current^=current>>>17;
      current^=current<<5;
      current>>>=0;
      return current/4294967296;
    },
    state:()=>current>>>0
  };
}

function makeRuntime(roster,saved=null,contractId='patrol') {
  const rng=sourceRng(saved?.rngState??(randomBytes(4).readUInt32LE(0)||1));
  const game=new Game({rng:()=>rng.next()});
  if(saved?.game){
    const {map,rng:ignored,...state}=saved.game;
    Object.assign(game,structuredClone(state));
    // A Map cannot be serialized as JSON. Rebuild it from the stored tile array.
    game.map=new Map(game.tiles.map(t=>[t.q+','+t.r,t]));
    game.rng=()=>rng.next();
    // Old saved battles may predate the Warrior Data name field.
    for(const u of game.units.filter(u=>u.team===0)){
      const pilot=roster[u.id]?.pilot;
      u.pilotName??=pilot?.fullName||pilot?.callsign||null;
    }
  } else {
    for(let i=0;i<2;i++){
      const unit=game.units[i];
      const entry=roster[i];
      if(!entry){unit.dead=true;continue;}
      const result=construct(entry.config);
      if(result.errors?.length||!result.unit)throw new AuthError(422,'invalid_design');
      Object.assign(unit,result.unit);
      // A roster snapshots the owner's ammo reserves at contract creation.
      // 0 rounds is meaningful: the engine must never silently refill it.
      const stored=normalizedAmmoState(entry.config,entry.ammoState);
      for(const bin of unit.bins)bin.shots=stored[bin.location+':'+(bin.slot+1)]??bin.shots;
      game.syncAmmo(unit);
      const defaults=defaultMechWarriorSkills(unit.techBase);
      unit.gunnery=entry.pilot?.gunnery??defaults.gunnery;
      unit.piloting=entry.pilot?.piloting??defaults.piloting;
      unit.pilotName=entry.pilot?.fullName||entry.pilot?.callsign||null;
      unit.pilotWounds=0;
      unit.dead=false;
      unit.id=i;
      unit.team=0;
      applyCriticalDamage(unit,entry.criticalDamage);
      // Destroyed magazines and previously damaged weapons remain inoperable.
      game.syncAmmo(unit);
    }
    for(const enemy of game.units.filter(u=>u.team===1))
      enemy.gunnery=contractById(contractId)?.enemyGunnery??4;
    game.note('Сервер открыл операцию. Состав и навыки пилотов зафиксированы.');
  }
  return {game,rng};
}

function capture(runtime) {
  // Never expose the internal random generator or mutable engine state to the browser.
  const state=JSON.parse(JSON.stringify(runtime.game,(k,v)=>
    k==='map'||k==='rng'?undefined:v));
  return {rngState:runtime.rng.state(),game:state};
}

function summary(game) {
  return {
    round:game.round,
    phase:game.phase,
    winner:game.winner,
    units:game.units.map(u=>({
      id:u.id,name:u.name,team:u.team,dead:!!u.dead,
      heat:u.heat,pilotWounds:u.pilotWounds||0,
      armorLost:Object.keys(u.maxArmor||{}).reduce((n,k)=>
        n+Math.max(0,(u.maxArmor[k]||0)-(u.armor?.[k]||0)),0),
      structureLost:Object.keys(u.maxStructure||{}).reduce((n,k)=>
        n+Math.max(0,(u.maxStructure[k]||0)-(u.structure?.[k]||0)),0)
    })),
    log:(game.log||[]).slice(-35).map(v=>String(v).slice(0,300))
  };
}

function performRound(game) {
  const round=game.round;
  let steps=0;
  while(game.round===round && game.winner===null && steps++<20){
    if(['move','fire','physical'].includes(game.phase)){
      let orders=0;
      while(game.queue.length && game.winner===null && orders++<20){
        const active=game.units.find(u=>game.canAct(u));
        if(!active){
          // A mech destroyed after initiative cannot keep a dead team in the queue.
          game.queue.shift();
          game.activeTeam=game.queue[0]??null;
          game.actingId=null;
          continue;
        }
        const result=game.phase==='move'?game.aiMove(active.id):
          game.phase==='fire'?game.aiAttack(active.id):game.aiPhysical(active.id);
        if(!result?.ok){
          const skip=game.hold(active.id);
          if(!skip?.ok)throw Error('simulation_stalled');
        }
      }
      if(game.queue.length)throw Error('simulation_order_limit');
    }
    const next=game.nextPhase();
    if(!next?.ok)throw Error('simulation_phase_invalid');
  }
  if(steps>=20 && game.round===round && game.winner===null)
    throw Error('simulation_round_limit');
  if(game.winner===null && game.round>MAX_ROUNDS){
    game.winner='draw';
    game.note('Лимит операции достигнут: ничья после '+MAX_ROUNDS+' раундов.');
  }
}

function buildReport(game,roster,contractId) {
  const result=game.winner===0?'victory':game.winner===1?'defeat':'draw';
  const units=summary(game).units;
  const rewards=roster.map((r,i)=>{
    const unit=game.units[i];
    const experience=(result==='victory'?120:result==='defeat'?35:65)+
      (unit.dead?0:15);
    const initial=normalizedAmmoState(r.config,r.ammoState);
    const remaining=Object.fromEntries((unit.bins||[])
      .map(bin=>[bin.location+':'+(bin.slot+1),Math.max(0,bin.shots)]));
    const ammoState={};
    const ammoUsed=ammoBinsFor(r.config).map(bin=>{
      const rounds=Math.min(bin.capacity,remaining[bin.key]??0);
      const starting=initial[bin.key];
      ammoState[bin.key]=rounds;
      return {weapon:bin.weapon,location:bin.location,slot:bin.slot+1,
        starting,remaining:rounds,used:Math.max(0,starting-rounds),capacity:bin.capacity};
    });
    return {
      mechId:r.mechId,chassis:r.chassis,
      pilotId:r.pilot?.id||null,callsign:r.pilot?.callsign||null,
      experience:r.pilot?experience:0,
      wounds:unit.pilotWounds||0,
      destroyed:!!unit.dead,
      armorLost:units[i].armorLost,
      structureLost:units[i].structureLost,ammoUsed,ammoState,
      criticalDamage:captureCriticalDamage(unit),
      brokenComponents:damagedComponents(r.config,captureCriticalDamage(unit))
        .map(part=>({id:part.id,name:part.name,location:part.location,
          slot:part.slot,kind:part.kind}))
    };
  });
  return {
    result,contractId,creditReward:contractPayout(contractId,result),
    rounds:Math.min(MAX_ROUNDS,game.round),
    units,rewards,
    log:(game.log||[]).slice(-90).map(v=>String(v).slice(0,300)),
    equipmentNote:'Боеприпасы списаны по фактическим выстрелам и повреждениям бункеров. Перезарядка требует комплекта со склада; ремонт оплачивается отдельно.'
  };
}

function publicItem(row,{detail=false}={}){
  const roster=(row.roster||[]).map(r=>({
    mechId:r.mechId,chassis:r.chassis,
    tonnage:r.config?.tonnage??null,
    pilot:r.pilot?{id:r.pilot.id,callsign:r.pilot.callsign,fullName:r.pilot.fullName??null,
      gunnery:r.pilot.gunnery,piloting:r.pilot.piloting}:null
  }));
  return {
    id:row.id,title:row.title,status:row.status,version:row.version,
    controlMode:row.control_mode||'auto',contractId:row.contract_id||'patrol',
    roster,createdAt:row.created_at,
    startedAt:row.started_at,completedAt:row.completed_at,
    state:detail&&row.battle_state?summary(row.battle_state.game):null,
    report:detail?row.report:null,
    result:row.report?.result||null
  };
}

export function createOperationStore(pool){
  async function persistStep(client,owner,id,row,runtime){
        const completed=runtime.game.winner!==null;
        let report=null;
        if(completed){
          report=buildReport(runtime.game,row.roster,row.contract_id);
          await changeCredits(client,owner,report.creditReward,
            'Контракт: '+row.title,'operation:'+id);
          for(const reward of report.rewards){
            await client.query(
              'UPDATE hangar_mechs SET armor_damage=armor_damage+$3, '+
              'structure_damage=structure_damage+$4,wrecked=wrecked OR $5, '+
              'ammo_state=$6::jsonb,critical_damage=$7::jsonb '+
              'WHERE id=$1 AND commander_id=$2',
              [reward.mechId,owner,reward.armorLost,reward.structureLost,
                reward.destroyed,JSON.stringify(reward.ammoState),
                JSON.stringify(reward.criticalDamage)]);
          }
          for(const reward of report.rewards){
            if(!reward.pilotId)continue;
            const result=await client.query(
              'UPDATE mechwarrior_pilots SET experience=experience+$3, '+
              'battles=battles+1,wins=wins+$4,losses=losses+$5, '+
              'wounds=LEAST(6,wounds+$6), '+
              'rank=CASE WHEN experience+$3>=600 THEN \'elite\' '+
              'WHEN experience+$3>=250 THEN \'veteran\' '+
              'WHEN experience+$3>=75 THEN \'regular\' ELSE rank END '+
              'WHERE id=$1 AND commander_id=$2 RETURNING id',
              [reward.pilotId,owner,reward.experience,
                Number(report.result==='victory'),Number(report.result==='defeat'),
                reward.wounds]);
            // A pilot may have been deleted while the operation was active.
            if(result.rows.length){
              await client.query(
                'INSERT INTO pilot_battle_history '+
                '(pilot_id,commander_id,mech_chassis,result,xp_awarded,kills,operation_id) '+
                'VALUES($1,$2,$3,$4,$5,0,$6)',
                [reward.pilotId,owner,reward.chassis,report.result,
                  reward.experience,id]);
            }
          }
        }
        const updated=await client.query(
          'UPDATE combat_operations SET status=$3,battle_state=$4::jsonb, '+
          'report=$5::jsonb,version=version+1, '+
          'completed_at=CASE WHEN $6 THEN now() ELSE completed_at END '+
          'WHERE id=$1 AND commander_id=$2 RETURNING *',
          [id,owner,completed?'completed':'active',
            JSON.stringify(capture(runtime)),report?JSON.stringify(report):null,completed]);
        return publicItem(updated.rows[0],{detail:true});
  }

  async function locked(id,owner,action){
    if(typeof id!=='string'||!UUID.test(id))throw new AuthError(404,'operation_not_found');
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const found=await client.query(
        'SELECT * FROM combat_operations WHERE id=$1 AND commander_id=$2 FOR UPDATE',
        [id,owner]);
      if(!found.rows.length)throw new AuthError(404,'operation_not_found');
      const result=await action(client,found.rows[0]);
      await client.query('COMMIT');
      return result;
    }catch(error){
      await client.query('ROLLBACK');
      throw error;
    }finally{client.release();}
  }

  return {
    async list(owner){
      const result=await pool.query(
        'SELECT * FROM combat_operations WHERE commander_id=$1 '+
        'ORDER BY created_at DESC,id DESC LIMIT 100',[owner]);
      return result.rows.map(row=>publicItem(row));
    },
    async get(owner,id){
      if(typeof id!=='string'||!UUID.test(id))throw new AuthError(404,'operation_not_found');
      const result=await pool.query(
        'SELECT * FROM combat_operations WHERE id=$1 AND commander_id=$2',[id,owner]);
      if(!result.rows.length)throw new AuthError(404,'operation_not_found');
      return publicItem(result.rows[0],{detail:true});
    },
    async create(owner,input){
      const {title,mechIds,mode,contractId}=validateOperation(input);
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        await client.query('SELECT id FROM commanders WHERE id=$1 FOR UPDATE',[owner]);
        const current=await client.query(
          'SELECT status,roster FROM combat_operations WHERE commander_id=$1',[owner]);
        if(current.rows.length>=MAX_OPERATIONS||
           current.rows.filter(r=>['draft','active'].includes(r.status)).length>=5)
          throw new AuthError(409,'operation_limit');
        const result=await client.query(
          'SELECT m.id,m.chassis,m.state,m.ammo_state,m.critical_damage,m.armor_damage,m.structure_damage,m.wrecked,m.market_owned, ' +
          'm.pilot_id,p.callsign,p.full_name,p.gunnery,p.piloting '+
          'FROM hangar_mechs m LEFT JOIN mechwarrior_pilots p '+
          'ON p.id=m.pilot_id AND p.commander_id=m.commander_id '+
          'WHERE m.commander_id=$1 AND m.id=ANY($2::uuid[])',
          [owner,mechIds]);
        if(result.rows.length!==mechIds.length)
          throw new AuthError(422,'invalid_roster');
        if(result.rows.some(r=>!r.market_owned))
          throw new AuthError(409,'prototype_not_licensed');
        if(result.rows.some(r=>r.armor_damage>0||r.structure_damage>0||r.wrecked))
          throw new AuthError(409,'mech_needs_repair');
        for(const row of result.rows){
          if(!row.state?.config)continue;
          const damage=normalizedCriticalDamage(row.state.config,row.critical_damage);
          const parts=damagedComponents(row.state.config,damage);
          if(parts.some(p=>p.name==='Кабина')||
            parts.filter(p=>p.name==='Двигатель').reduce((n,p)=>n+p.damagedSlots,0)>=3)
            throw new AuthError(409,'mech_critical_shutdown');
        }
        if(current.rows.some(r=>['draft','active'].includes(r.status)&&
          r.roster.some(entry=>mechIds.includes(entry.mechId))))
          throw new AuthError(409,'mech_assigned_operation');
        const found=new Map(result.rows.map(r=>[r.id,r]));
        const roster=mechIds.map(id=>{
          const mech=found.get(id);
          if(!mech?.state?.config)throw new AuthError(422,'invalid_roster');
          const config=mech.state.config;
          const checked=validateDesign({config});
          return {
            mechId:mech.id,chassis:checked.chassis,config:checked.state.config,
            ammoState:normalizedAmmoState(checked.state.config,mech.ammo_state),
            criticalDamage:normalizedCriticalDamage(checked.state.config,mech.critical_damage),
            pilot:mech.pilot_id?{
              id:mech.pilot_id,callsign:mech.callsign,fullName:mech.full_name,
              gunnery:mech.gunnery,piloting:mech.piloting
            }:null
          };
        });
        const inserted=await client.query(
          'INSERT INTO combat_operations(commander_id,title,roster,control_mode,contract_id) '+
          'VALUES($1,$2,$3::jsonb,$4,$5) RETURNING *',
          [owner,title,JSON.stringify(roster),mode,contractId]);
        await client.query('COMMIT');
        return publicItem(inserted.rows[0],{detail:true});
      }catch(error){await client.query('ROLLBACK');throw error;}
      finally{client.release();}
    },
    launch(owner,id){
      return locked(id,owner,async(client,row)=>{
        if(row.status!=='draft')throw new AuthError(409,'operation_not_draft');
        const runtime=makeRuntime(row.roster,null,row.contract_id);
        const state=capture(runtime);
        const updated=await client.query(
          'UPDATE combat_operations SET status=$3,battle_state=$4::jsonb, '+
          'started_at=now(),version=version+1 WHERE id=$1 AND commander_id=$2 RETURNING *',
          [id,owner,'active',JSON.stringify(state)]);
        return publicItem(updated.rows[0],{detail:true});
      });
    },
    advance(owner,id){
      return locked(id,owner,async(client,row)=>{
        if(row.status!=='active'||!row.battle_state)
          throw new AuthError(409,'operation_not_active');
        if(row.control_mode==='interactive')throw new AuthError(409,'interactive_only_commands');
        const runtime=makeRuntime(row.roster,row.battle_state);
        performRound(runtime.game);
        return persistStep(client,owner,id,row,runtime);
      });
    },
    async snapshot(owner,id){
      if(typeof id!=='string'||!UUID.test(id))
        throw new AuthError(404,'operation_not_found');
      const result=await pool.query(
        'SELECT * FROM combat_operations WHERE id=$1 AND commander_id=$2',[id,owner]);
      if(!result.rows.length)throw new AuthError(404,'operation_not_found');
      const row=result.rows[0];
      if(row.control_mode!=='interactive')
        throw new AuthError(409,'not_interactive_operation');
      return {...publicItem(row,{detail:true}),
        game:publicSnapshot(row.battle_state)};
    },
    command(owner,id,input){
      return locked(id,owner,async(client,row)=>{
        if(row.control_mode!=='interactive')
          throw new AuthError(409,'not_interactive_operation');
        if(row.status!=='active'||!row.battle_state)
          throw new AuthError(409,'operation_not_active');
        if(!input||input.version!==row.version)
          throw new AuthError(409,'stale_operation_version');
        const runtime=makeRuntime(row.roster,row.battle_state);
        const effect=runTacticalOrder(runtime.game,input);
        if(runtime.game.winner===null&&runtime.game.round>MAX_ROUNDS){
          runtime.game.winner='draw';
          runtime.game.note('Лимит раундов достигнут. Операция завершена вничью.');
        }
        const item=await persistStep(client,owner,id,row,runtime);
        return {...item,game:publicSnapshot(capture(runtime)),effect};
      });
    },
    abandon(owner,id){
      return locked(id,owner,async(client,row)=>{
        if(!['draft','active'].includes(row.status))
          throw new AuthError(409,'operation_closed');
        const changed=await client.query(
          'UPDATE combat_operations SET status=$3,completed_at=now(),version=version+1 '+
          'WHERE id=$1 AND commander_id=$2 RETURNING *',
          [id,owner,'abandoned']);
        return publicItem(changed.rows[0],{detail:true});
      });
    }
  };
}
