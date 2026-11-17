import {AuthError} from './auth.mjs';
const fields={
  move:['id','q','r','mode','lateral'],rotate:['id','delta'],
  stand:['id','facing','minimum','mode'],drop:['id'],hold:['id'],twist:['id','twist'],turret:['id','mount','facing'],
  fire:['id','shots'],physical:['id','target','attack','limb'],
  club:['id'],charge:['id','target','attack'],minimum:['id'],
  shutdown:['id'],dump:['id','bin'],flip:['id','enabled'],brace:['id','limb'],
  next:['choice'],weather:['night','gale','standingStill','evading','floatingCriticals']
};
const int=(x,a,b)=>Number.isInteger(x)&&x>=a&&x<=b;
const shot=x=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).every(k=>['index','target','aim','bin','heatMode'].includes(k))&&
 int(x.index,0,31)&&int(x.target,0,3)&&
 (x.aim==null||['HD','CT','LT','RT','LA','RA','LL','RL'].includes(x.aim))&&
 (x.bin==null||int(x.bin,0,79))&&
 (x.heatMode===undefined||typeof x.heatMode==='boolean');
export function validateTacticalOrder(b){
  if(!b||typeof b!=='object'||Array.isArray(b)||
     !Object.hasOwn(fields,b.type)||!int(b.version,1,1000000)||
     Object.keys(b).some(k=>!['type','version',...fields[b.type]].includes(k)))
    throw new AuthError(422,'invalid_command');
  const ok={
    next:()=>b.choice===undefined||(
      b.choice!==null&&typeof b.choice==='object'&&!Array.isArray(b.choice)&&
      Object.keys(b.choice).length===2&&Object.hasOwn(b.choice,'key')&&Object.hasOwn(b.choice,'option')&&
      typeof b.choice.key==='string'&&b.choice.key.length>0&&b.choice.key.length<=80&&
      typeof b.choice.option==='string'&&b.choice.option.length>0&&b.choice.option.length<=32),
    weather:()=>typeof b.night==='boolean'&&typeof b.gale==='boolean'&&
      (b.standingStill===undefined||typeof b.standingStill==='boolean')&&
      (b.evading===undefined||typeof b.evading==='boolean')&&
      (b.floatingCriticals===undefined||typeof b.floatingCriticals==='boolean'),
    move:()=>int(b.q,-6,6)&&int(b.r,-6,6)&&['walk','run','jump','evade'].includes(b.mode)&&
      (b.lateral===undefined||['shift-left-forward','shift-right-forward',
        'shift-left-backward','shift-right-backward'].includes(b.lateral)),
    rotate:()=>[-1,1].includes(b.delta),stand:()=> (b.facing===undefined||int(b.facing,0,5))&&
      (b.minimum===undefined||typeof b.minimum==='boolean')&&
      (b.mode===undefined||['walk','run'].includes(b.mode)),drop:()=>true,hold:()=>true,
    twist:()=>int(b.twist,-2,2),
    turret:()=>int(b.mount,0,2)&&int(b.facing,0,5),
    fire:()=>Array.isArray(b.shots)&&b.shots.length<=32&&
      b.shots.every(shot)&&new Set(b.shots.map(x=>x.index)).size===b.shots.length,
    physical:()=>int(b.target,0,3)&&
      ['kick','punch','push','club','hatchet'].includes(b.attack)&&
      ['LA','RA','LL','RL','both'].includes(b.limb),
    club:()=>true,
    charge:()=>int(b.target,0,3)&&['charge','dfa'].includes(b.attack),
    minimum:()=>true,shutdown:()=>true,dump:()=>int(b.bin,0,79),
    flip:()=>typeof b.enabled==='boolean',
    brace:()=>['LA','RA'].includes(b.limb)
  };
  if((b.type!=='next'&&b.type!=='weather'&&!int(b.id,0,1))||!ok[b.type]())
    throw new AuthError(422,'invalid_command');
  return b;
}
export function autoOpponent(game){
  const actions=[];
  let turns=0;
  while(game.winner===null&&game.activeTeam===1&&
    ['move','fire','physical'].includes(game.phase)){
    if(++turns>20)throw Error('opponent_action_limit');
    const unit=game.units.find(u=>game.canAct(u));
    if(!unit){
      game.queue.shift();game.activeTeam=game.queue[0]??null;game.actingId=null;
      continue;
    }
    game.phaseRolls=[];
    const phase=game.phase;
    const r=phase==='move'?game.aiMove(unit.id):
      phase==='fire'?game.aiAttack(unit.id):game.aiPhysical(unit.id);
    if(!r?.ok&&!game.hold(unit.id)?.ok)throw Error('opponent_stalled');
    actions.push({id:unit.id,phase,
      ...(phase==='move'&&r?.path?.length?{
        path:r.path,mode:r.mode,to:r.to,from:r.from}:{}),
      rolls:[...game.phaseRolls]});
  }
  return actions;
}
export function runTacticalOrder(game,body){
  const b=validateTacticalOrder(body);
  const {type,id}=b;
  let r;
  if(game.pendingChoice&&type!=='next')throw new AuthError(409,'resolution_choice_pending');
  if(type==='next'){
    if(game.queue.length)throw new AuthError(409,'phase_pending_orders');
    r=game.nextPhaseWithChoices({humanTeams:[0],choice:b.choice});
  }else if(type==='weather'){
    if(game.phase!=='initiative'||game.round!==1)throw new AuthError(409,'weather_locked');
    game.weather={night:b.night,gale:b.gale};
    game.tacticalOptions={standingStill:!!b.standingStill,evading:!!b.evading,
      floatingCriticals:!!b.floatingCriticals};
    r={ok:true};
  }else{
    if(!game.units[id]||game.units[id].team!==0||!game.canAct(game.units[id]))
      throw new AuthError(409,'not_your_turn');
    switch(type){
      case 'move':r=game.move(id,b.q,b.r,b.mode,{lateral:b.lateral});break;
      case 'rotate':r=game.rotate(id,b.delta);break;
      case 'stand':r=game.stand(id,b.facing??null,{minimum:b.minimum,mode:b.mode});break;
      case 'drop':r=game.drop(id);break;
      case 'hold':r=game.hold(id);break;
      case 'twist':r=game.twist(id,b.twist);break;
      case 'turret':r=game.setDirectionalTorsoMount(id,b.mount,b.facing);break;
      case 'fire':r=game.declareFire(id,b.shots);break;
      case 'physical':r=game.declarePhysical(id,b.target,b.attack,b.limb);break;
      case 'club':r=game.takeClub(id);break;
      case 'charge':r=game.declareCharge(id,b.target,b.attack);break;
      case 'minimum':r=game.minimumMove(id);break;
      case 'shutdown':r=game.orderShutdown(id);break;
      case 'dump':r=game.orderDump(id,b.bin);break;
      case 'flip':r=game.flipArms(id,b.enabled);break;
      case 'brace':r=game.setBrace(id,b.limb);break;
    }
  }
  if(!r?.ok)throw new AuthError(422,'illegal_tactical_order');
  if(r.pending)return {type,result:structuredClone(r),rolls:[],resolution:[],afterRolls:[],ai:[]};
  const rolls=structuredClone(game.phaseRolls||[]);
  const resolution=type==='next'?structuredClone(game.resolution||[]):[];
  const afterRolls=type==='next'?structuredClone(game.afterRolls||[]):[];
  if(game.winner===null&&game.phase==='move'&&id!==undefined){
    const unit=game.units[id];
    if(unit?.dead&&game.actingId===id)game.hold(id);
  }
  const ai=autoOpponent(game);
  return {type,result:structuredClone(r),rolls,resolution,afterRolls,ai};
}
export function publicSnapshot(saved){
  if(!saved?.game)return null;
  const snapshot=structuredClone(saved.game);
  delete snapshot._resolutionReplay;
  snapshot.pendingChoice??=null;
  return snapshot;
}
