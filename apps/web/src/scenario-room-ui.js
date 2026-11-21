// AGoAC Chapter 11 only: signed three-player server scenario rooms.
// Authentic API lobby and preparation; completed setup opens the signed 3D cockpit.
const $=(node,selector)=>node.querySelector(selector);
const E=(tag,cls,text)=>{
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(text!==undefined)node.textContent=String(text);
 return node;
};
const DIRS=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
const messages={
 unauthorized:'Войдите в аккаунт командира.',
 email_unverified:'Подтвердите адрес электронной почты.',
 invalid_scenario_room:'Проверьте позывные всех трёх командиров.',
 scenario_player_not_found:'Один из позывных не найден.',
 scenario_players_must_be_distinct:'Нужны три разные учётные записи.',
 scenario_owner_must_participate:'Создатель комнаты должен занимать одну из трёх ролей.',
 scenario_room_not_ready:'Сначала все трое должны подтвердить участие.',
 scenario_room_not_found:'Комната недоступна или у вас нет доступа.',
 stale_scenario_version:'Комната изменилась. Данные обновлены.',
 scenario_role_reassignment_required:'Потребуется новая комната и согласие участников на изменение ролей.',
 scenario_lance_not_owned:'Этот мех или элемент сейчас управляется другим игроком.',
 wrong_side_choice_controller:'Только победитель предварительного броска выбирает сторону.',
 wrong_initiative_controller:'В этом раунде инициативу бросает второй защитник.',
 printed_scenario_not_ready:'Сначала завершите исходную расстановку по книге.',
 scenario_dispute_pending:'Ожидается решение второго защитника.',
 scenario_already_proposed:'Предложение уже отправлено.',
 invalid_scenario_command:'Проверьте параметры приказа.'
};
async function request(path,method='GET',body){
 const options={method,credentials:'same-origin',cache:'no-store'};
 if(method!=='GET'){
  options.headers={'Content-Type':'application/json'};
  options.body=JSON.stringify(body??{});
 }
 const response=await fetch(path,options);
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(messages[result.error]||result.error||'HTTP '+response.status);
 return result;
}
const label=(caption,field)=>{
 const el=E('label','op-select-mech',caption);el.append(field);return el;
};
const button=(caption,action,cls='op-history-entry')=>{
 const b=E('button',cls,caption);b.type='button';b.onclick=action;return b;
};
const input=(name,placeholder,value='')=>{
 const el=E('input');el.name=name;el.placeholder=placeholder;
 el.value=value;el.autocomplete='off';return el;
};
const select=(values,selected)=>{
 const s=E('select');for(const item of values){
  const [value,name]=Array.isArray(item)?item:[item,item];
  s.append(new Option(name,String(value)));
 }
 if(selected!==undefined)s.value=String(selected);
 return s;
};
let root,panel,opened=null,busy=false,rooms=[];
function message(value=''){
 const el=$(panel,'#scenario-room-message');
 if(el)el.textContent=value;
}
async function execute(fn){
 if(busy)return;
 busy=true;
 for(const b of panel.querySelectorAll('button'))b.disabled=true;
 try{await fn();await refreshScenarioRooms();}
 catch(error){message(error.message);}
 finally{
  busy=false;
  for(const b of panel.querySelectorAll('button'))b.disabled=false;
 }
}
const apiRoom=(id,tail='')=>'/api/v1/scenario-rooms/'+encodeURIComponent(id)+tail;
async function sendAction(room,kind,action){
 return request(apiRoom(room.id,'/'+kind),'POST',{version:room.version,action});
}
function section(parent,title){
 const box=E('section','op-current');
 box.append(E('h3','',title));parent.append(box);return box;
}
function terrainCandidates(game,sheet){
 const tiles=game.tiles||[],w=game.setupMap?.width||32,h=game.setupMap?.height||17;
 return tiles.filter(t=>{
  if(t.sheet!==sheet)return false;
  const col=t.q+Math.floor(t.r/2)+Math.floor(w/2);
  const row=t.r+Math.floor(h/2);
  const x=((col%16)+16)%16,y=((row%17)+17)%17;
  return x>=3&&x<=12&&y>=3&&y<=13;
 }).sort((a,b)=>a.r-b.r||a.q-b.q);
}
function tileList(tiles){
 return tiles.map(t=>[t.q+','+t.r,
  (t.printedSheet||'Лист '+(t.sheet+1))+' / '+(t.printedHex||'')+
  ' · ('+t.q+', '+t.r+')']);
}

const S='http://www.w3.org/2000/svg';
const axialDistance=(a,b)=>Math.max(Math.abs(a.q-b.q),
 Math.abs(a.r-b.r),Math.abs(a.q+a.r-b.q-b.r));
// Preview filters are only a convenience: PostgreSQL / Game remains
// authoritative and must revalidate the full footprint and turn owner.
function legalTerrainOrigins(game,sheet,footprint){
 if(!Array.isArray(footprint)||![2,3].includes(footprint.length)||
  !footprint.some(x=>x.q===0&&x.r===0)||
  !footprint.every(x=>Number.isInteger(x.q)&&Number.isInteger(x.r))||
  new Set(footprint.map(x=>x.q+','+x.r)).size!==footprint.length)return [];
 if(footprint.length===3&&footprint.some((p,i)=>footprint.some((q,j)=>
  i!==j&&axialDistance(p,q)!==1)))return [];
 const byHex=new Map(game.tiles.map(x=>[x.q+','+x.r,x]));
 const occupied=(game.scenario?.looseTerrain?.pieces||[])
  .flatMap(piece=>piece.hexes||[]);
 return terrainCandidates(game,sheet).filter(origin=>footprint.every(offset=>{
  const q=origin.q+offset.q,r=origin.r+offset.r,tile=byHex.get(q+','+r);
  if(!tile||tile.sheet!==sheet||tile.depth>0||tile.bridge||
   tile.overlayTerrain!=null)return false;
  const col=q+Math.floor(r/2)+Math.floor(game.setupMap.width/2);
  const row=r+Math.floor(game.setupMap.height/2);
  const localCol=((col%16)+16)%16,localRow=((row%17)+17)%17;
  return localCol>=3&&localCol<=12&&localRow>=3&&localRow<=13&&
   occupied.every(previous=>axialDistance({q,r},previous)>=4);
 }));
}
function printedTerrainDiagram(game,{choices=[],chosen=null,onPick=null}={}){
 const wrap=E('div','scenario-terrain-map');
 wrap.id='scenario-terrain-map';
 wrap.append(E('p','',
  'Цифровая схема 32×17: запад — Desert #2; восток — Grassland #3. '+
  'Для сверки с книжной иллюстрацией, не её воспроизведение.'));
 const svg=document.createElementNS(S,'svg');
 svg.setAttribute('viewBox','0 0 605 290');
 svg.setAttribute('role','group');
 svg.setAttribute('aria-label','Схема 544 гексов и размещённых элементов');
 svg.style.width='100%';svg.style.height='auto';svg.style.maxWidth='750px';
 const picks=new Set(choices.map(v=>v.q+','+v.r));
 const applied=new Map();
 (game.scenario?.looseTerrain?.pieces||[]).forEach((piece,i)=>
  (piece.hexes||[]).forEach(hex=>applied.set(hex.q+','+hex.r,{
   index:i,kind:piece.terrainType})));
 const make=(tag,attrs={},value)=>{
  const node=document.createElementNS(S,tag);
  for(const [key,val]of Object.entries(attrs))node.setAttribute(key,String(val));
  if(value!==undefined)node.textContent=String(value);
  return node;
 };
 for(const tile of game.tiles||[]){
  const col=tile.q+Math.floor(tile.r/2)+Math.floor(game.setupMap.width/2);
  const row=tile.r+Math.floor(game.setupMap.height/2);
  if(col<0||col>=32||row<0||row>=17)continue;
  const cx=18+17.32*(col+(tile.r%2)/2),cy=18+15*row;
  const key=tile.q+','+tile.r,piece=applied.get(key);
  const eligible=picks.has(key);
  const chosenTile=key===chosen;
  const fill=piece?
   (String(piece.kind).startsWith('depth')?'#277a95':'#a85b4b'):
   chosenTile?'#ffe18b':eligible?'#9fa674':
   tile.depth>0?'#477d89':tile.height>0?'#788b65':'#485e4d';
  const points=Array.from({length:6},(_,i)=>{
   const angle=(i*60-90)*Math.PI/180;
   return (cx+9.7*Math.cos(angle)).toFixed(2)+','+
    (cy+9.7*Math.sin(angle)).toFixed(2);
  }).join(' ');
  const poly=make('polygon',{points,fill,stroke:
   chosenTile?'#fff6c9':piece?'#ecd7b3':'#202e2a',
   'stroke-width':chosenTile?'2.2':'.75',
   'data-hex':key,'data-sheet':tile.sheet});
  const title=make('title',{},(tile.printedSheet||'')+' '+
   (tile.printedHex||'')+' · '+key+
   (piece?' · элемент '+(piece.index+1)+' '+piece.kind:''));
  poly.append(title);
  if(eligible&&onPick){
   poly.setAttribute('data-choice',key);
   poly.setAttribute('tabindex','0');
   poly.setAttribute('role','button');
   poly.setAttribute('aria-label','Выбрать гекс '+key);
   poly.style.cursor='pointer';
   poly.addEventListener('click',()=>onPick(key));
   poly.addEventListener('keydown',event=>{
    if(event.key==='Enter'||event.key===' '){
     event.preventDefault();onPick(key);
    }
   });
  }
  svg.append(poly);
 }
 svg.append(make('line',{x1:18+17.32*16,y1:5,
  x2:18+17.32*16,y2:280,stroke:'#f3d49b','stroke-width':2,
  'stroke-dasharray':'5 4'}));
 wrap.append(svg);
 const legend=E('p','',
  'Синий — вода (Depth); красный — сухое понижение (Sublevel); '+
  'оливковый — допустимое начало элемента; жёлтый — выбранный гекс.');
 wrap.append(legend);
 const pieces=game.scenario?.looseTerrain?.pieces||[];
 if(pieces.length)wrap.append(E('p','',
  'Размещено '+pieces.length+'/4: '+pieces.map((piece,i)=>
   (i+1)+'. '+piece.terrainType+' ['+
   (piece.hexes||[]).map(h=>h.q+','+h.r).join(' · ')+']').join(' | ')));
 return wrap;
}
function wireSubmit(box,handler){
 const form=box.tagName==='FORM'?box:box.querySelector('form');
 if(form)form.onsubmit=e=>{e.preventDefault();void execute(()=>handler(form));};
}
function renderSetup(body,room,game){
 const s=game.scenario||{},frame=section(body,'ПОДГОТОВКА ПО КНИГЕ');
 if(s.attackerTeam===null){
  frame.append(E('p','', 'Итог броска 2D6: '+(s.sideRollWinner===0?
   'зелёная сторона':'красная сторона')+' выбирает роль. '+
   'Комната создана с заранее согласованными ролями. Для их обмена требуется новый состав участников.'));
  const chooser=s.sideRollWinner===0?'attacker':'command';
  if(room.yourRole===chooser)
   frame.append(button('ПОДТВЕРДИТЬ СОГЛАСОВАННЫЕ СТОРОНЫ',
    ()=>execute(()=>sendAction(room,'setup',{
     type:'select-side',role:chooser==='attacker'?'attacker':'defender'}))));
  return;
 }
 const terrain=s.looseTerrain;
 if(terrain&&!terrain.complete){
  const index=terrain.pieces?.length||0,sheet=Math.floor(index/2);
  const pieceTeam=terrain.nextTeam,required=pieceTeam===s.attackerTeam?'attacker':
   sheet===0?'command':'recon',pair=index%2===0;
  frame.append(E('p','',
   'Элемент '+(index+1)+'/4: '+(pair?'двухгексовая вода Depth':'трёхгексовый сухой Sublevel')+
   ', лист '+(sheet+1)+'. Ход стороны '+pieceTeam+'.'));
  if(room.yourRole!==required){
   frame.append(E('p','','Ожидается размещение игроком '+required+'.'));return;
  }
  const form=E('form','op-form'),t=select([]);
  t.name='hex';
  const type=select(pair?[
   ['depth1','Вода, глубина 1'],['depth2','Вода, глубина 2']]:
   [['sublevel1','Сухой субуровень −1'],['sublevel2','Сухой субуровень −2']]);
  type.name='terrainType';
  form.append(label('Гекс по исходному листу',t),label('Лицевая сторона элемента',type));
  const orientation=select(DIRS.map(([q,r],i)=>[i,(i*60)+'° ('+q+','+r+')']));
  if(pair){orientation.name='orientation';form.append(label('Разворот двойного элемента',orientation));}
  const shape=input('offsets','q,r; q,r; q,r','0,0;1,0;1,-1');
  if(!pair)form.append(label('Три смещения треугольника по печатной схеме',shape));
  const submit=E('button','op-primary','ПОСТАВИТЬ ЭЛЕМЕНТ');submit.type='submit';
  form.append(submit);frame.append(form);
  const preview=E('div');frame.append(preview);
  const footprint=()=>{
   if(pair){
    const [q,r]=DIRS[Number(orientation.value)]||[];
    return Number.isInteger(q)?[{q:0,r:0},{q,r}]:[];
   }
   const values=shape.value.split(';').map(v=>v.trim());
   if(values.length!==3||values.some(v=>!/^[-]?\\d+\\s*,\\s*[-]?\\d+$/.test(v)))return [];
   return values.map(v=>{
    const [q,r]=v.split(',').map(Number);return {q,r};
   });
  };
  const redraw=()=>{
   const valid=legalTerrainOrigins(game,sheet,footprint()),prior=t.value;
   t.replaceChildren(...tileList(valid).map(([value,text])=>new Option(text,value)));
   if(valid.some(v=>v.q+','+v.r===prior))t.value=prior;
   const selected=t.value||null;
   submit.disabled=!valid.length;
   preview.replaceChildren(printedTerrainDiagram(game,{
    choices:valid,chosen:selected,onPick:key=>{
     t.value=key;redraw();
    }
   }));
  };
  orientation.onchange=redraw;
  shape.oninput=redraw;
  t.onchange=redraw;
  redraw();
  wireSubmit(form,async data=>{
   const [q,r]=data.elements.hex.value.split(',').map(Number);
   const footprint=pair?[{q:0,r:0},
    {q:DIRS[Number(data.elements.orientation.value)][0],
     r:DIRS[Number(data.elements.orientation.value)][1]}]:
    data.elements.offsets.value.split(';').map(x=>{
     const [q,r]=x.trim().split(',').map(Number);return {q,r};
    });
   await sendAction(room,'setup',{type:'place-terrain',
    q,r,terrainType:data.elements.terrainType.value,footprint});
  });
  return;
 }
 if(terrain?.complete&&!s.picturedTerrain?.confirmed){
  const signed=s.picturedTerrain?.approvals||{};
  frame.append(E('p','',
   'Четыре обязательных элемента поставлены. Сверьте КАЖДЫЙ их гекс '+
   'и поворот треугольников с диаграммой печатной книги, стр. 47. '+
   'Эта подпись означает ручную проверку, а не автоматическую сертификацию координат.'));
  frame.append(printedTerrainDiagram(game));
  frame.append(E('p','',Object.entries(signed).map(([r,v])=>r+': '+(v?'сверено':'ожидание')).join(' · ')));
  if(!signed[room.yourRole])frame.append(button('ЛИЧНО СВЕРИЛ СО СХЕМОЙ',
   ()=>execute(()=>sendAction(room,'setup',{type:'confirm-figure'}))));
  return;
 }
 const deployment=s.placement;
 if(!deployment||deployment.complete)return;
 const step=deployment.steps[deployment.placed.length];
 if(!step)return;
 if(step.lance==='printed-row'&&!deployment.attackerRow){
  frame.append(E('p','','Защита размещена. Атакующий выбирает только одну '+
   'опубликованную строку 1510–1517.'));
  if(room.yourRole==='attacker')for(const side of ['west','east'])
   frame.append(button(side==='west'?'ЮГО-ЗАПАД':'СЕВЕРО-ВОСТОК',
    ()=>execute(()=>sendAction(room,'setup',{type:'choose-row',side}))));
  return;
 }
 const expected=step.team===s.attackerTeam?'attacker':step.lance;
 frame.append(E('p','', 'Мех '+(deployment.placed.length+1)+' / '+
  deployment.steps.length+' · '+(expected||'защита')));
 if(room.yourRole!==expected)return;
 const units=game.units.filter(u=>!u.dead&&!u.notFielded&&
  u.deployed===false&&u.team===step.team&&
  (step.lance==='printed-row'||u.lance===step.lance));
 const coords=game.tiles.filter(t=>{
  if(step.lance==='printed-row')
   return deployment.attackerRow?.hexes?.some(h=>h.q===t.q&&h.r===t.r);
  const all=game.tiles,col=v=>v.q+Math.floor(v.r/2),
   minCol=Math.min(...all.map(col)),maxCol=Math.max(...all.map(col)),
   minR=Math.min(...all.map(v=>v.r)),maxR=Math.max(...all.map(v=>v.r));
  return step.lance==='command'?col(t)-minCol<=6&&t.r-minR<=6:
   step.lance==='recon'?maxCol-col(t)<=6&&maxR-t.r<=6:false;
 }).filter(t=>!deployment.placed.some(p=>p.q===t.q&&p.r===t.r));
 const form=E('form','op-form');
 const mechs=select(units.map(u=>[u.id,(u.pilot||u.name)+' · '+u.variant]));
 mechs.name='id';
 const tiles=select(tileList(coords));tiles.name='hex';
 const facing=select(Array.from({length:6},(_,i)=>[i,(i*60)+'°']));facing.name='facing';
 form.append(label('Мех',mechs),label('Гекс',tiles),label('Курс',facing));
 const submit=E('button','op-primary','РАЗМЕСТИТЬ МЕХ');submit.type='submit';
 submit.disabled=!units.length||!coords.length;form.append(submit);frame.append(form);
 wireSubmit(form,async data=>{
  const [q,r]=data.elements.hex.value.split(',').map(Number);
  await sendAction(room,'setup',{type:'place-mech',
   id:Number(data.elements.id.value),q,r,facing:Number(data.elements.facing.value)});
 });
}
function available(game,role,u){
 if(!u||u.dead||u.notFielded||u.deployed===false||
  u.team!==game.activeTeam||
  game.actingId!==null&&game.actingId!==u.id)return false;
 const done=game.phase==='move'?u.moved:game.phase==='fire'?u.fired:u.physicalDone;
 if(done)return false;
 const s=game.scenario;
 if(role==='attacker')return u.team===s.attackerTeam;
 if(u.team!==s.defenderTeam)return false;
 const state=s.sharedLances||{},ruling=state.decided;
 const won=ruling?.round===game.round&&ruling.phase===game.phase;
 return won?role===ruling.controller:u.lance===role;
}
function renderBattle(body,room,game){
 const frame=section(body,'БИТВА · РАУНД '+game.round+' / '+game.phase.toUpperCase());
 const s=game.scenario;
 frame.append(E('p','', 'Активная сторона: '+(game.activeTeam===null?'—':game.activeTeam)+
  ' · Ожидают ходов: '+(game.queue?.length||0)));
 if(game.winner!==null){
  frame.append(E('p','','Бой завершён. Победитель: '+game.winner));return;
 }
 const pending=game.pendingChoice;
 if(pending?.options){
  const pick=select(pending.options.map(o=>[o.id,o.label||o.id]));
  frame.append(label('Разрешение '+pending.scope,pick),
   button('ПОДТВЕРДИТЬ РЕШЕНИЕ',()=>execute(()=>sendAction(room,'command',{
    type:'next',choice:{key:pending.key,option:pick.value}}))));
  return;
 }
 if(!game.queue?.length){
  const state=s.sharedLances||{},first=state.firstInitiativeController||'command';
  const expected=game.round%2===1?first:first==='command'?'recon':'command';
  if(game.phase!=='initiative'||room.yourRole===expected)
   frame.append(button('ПЕРЕЙТИ К СЛЕДУЮЩЕЙ ФАЗЕ',
    ()=>execute(()=>sendAction(room,'command',{type:'next'}))));
  else frame.append(E('p','','В этом раунде инициативу бросает '+expected+'.'));
  return;
 }
 const actionable=game.units.filter(u=>available(game,room.yourRole,u));
 const disputed=s.sharedLances?.pendingServerDispute;
 if(disputed?.phase===game.phase&&disputed?.round===game.round)
  frame.append(E('p','', 'Спорное решение: ожидается предложение второго защитника.'));
 if(!actionable.length){
  frame.append(E('p','','Ожидается приказ другого игрока.'));return;
 }
 for(const u of actionable){
  const card=E('div','op-unit-card');
  card.append(E('strong','',(u.pilot||u.name)+' · '+u.variant));
  card.append(button('ПРОПУСТИТЬ ДЕЙСТВИЕ',
   ()=>execute(()=>sendAction(room,'command',{type:'hold',id:u.id}))));
  if(game.phase==='move'){
   const form=E('form','op-form'),q=input('q','q',String(u.q)),r=input('r','r',String(u.r)),
    mode=select(['walk','run','jump','minimum']);q.type='number';r.type='number';
   form.append(label('Координата q',q),label('Координата r',r),
    label('Режим',mode));
   const go=E('button','op-primary','ДВИЖЕНИЕ');go.type='submit';
   form.append(go);card.append(form);
   wireSubmit(form,async el=>sendAction(room,'command',{
    type:'move',id:u.id,q:Number(el.elements.q.value),
    r:Number(el.elements.r.value),mode:mode.value}));
  }
  if(game.phase==='fire'){
   const enemies=game.units.filter(t=>t.team!==u.team&&!t.dead&&t.deployed!==false);
   if(enemies.length&&u.weapons?.length){
    const form=E('form','op-form'),
     target=select(enemies.map(e=>[e.id,(e.pilot||e.name)+' · '+e.variant])),
     weapon=select(u.weapons.map((w,i)=>[i,w.name]));
    target.name='target';weapon.name='weapon';
    form.append(label('Цель',target),label('Оружие',weapon));
    const go=E('button','op-primary','ОБЪЯВИТЬ СТРЕЛЬБУ');go.type='submit';
    form.append(go);card.append(form);
    wireSubmit(form,async el=>sendAction(room,'command',{
     type:'fire',id:u.id,shots:[{index:Number(el.elements.weapon.value),
      target:Number(el.elements.target.value)}]}));
   }
  }
  if(['move','fire'].includes(game.phase)&&
   ['command','recon'].includes(room.yourRole)&&
   u.lance===room.yourRole&&
   !(s.sharedLances?.decided?.round===game.round&&
    s.sharedLances?.decided?.phase===game.phase)&&
   !disputed?.[room.yourRole])
   card.append(button('ПРЕДЛОЖИТЬ МЕХ ДЛЯ СПОРА 2D6',
    ()=>execute(()=>sendAction(room,'command',{type:'propose-dispute',id:u.id}))));
  frame.append(card);
 }
}
async function renderRoomDetails(room,host){
 host.replaceChildren();
 const frame=section(host,'КОМНАТА · '+room.scenarioId.toUpperCase());
 frame.append(E('p','', 'Роль: '+room.yourRole+' · Состояние: '+room.status+
  ' · Версия: '+room.version));
 for(const [role,member]of Object.entries(room.roles))
  frame.append(E('p','',role+' · '+member.handle+
   (member.accepted?' · ПОДТВЕРЖДЕНО':' · ОЖИДАНИЕ')));
 if(room.status==='inviting'){
  if(!room.roles[room.yourRole]?.accepted){
   frame.append(button('ПРИНЯТЬ ПРИГЛАШЕНИЕ',
    ()=>execute(()=>request(apiRoom(room.id,'/accept'),'POST',{}))));
   frame.append(button('ОТКЛОНИТЬ',
    ()=>execute(()=>request(apiRoom(room.id,'/decline'),'POST',{}))));
  }
  if(room.isHost)frame.append(button('ОТМЕНИТЬ КОМНАТУ',
   ()=>execute(()=>request(apiRoom(room.id,'/cancel'),'POST',{}))));
  return;
 }
 if(room.status==='ready'){
  frame.append(E('p','','Все три игрока подтвердили роли.'));
  if(room.isHost)for(const [shortened,txt] of [[false,'НАЧАТЬ · ПОЛНЫЙ СОСТАВ'],
   [true,'НАЧАТЬ · СОКРАЩЁННЫЙ СОСТАВ']])
   frame.append(button(txt,()=>execute(()=>request(apiRoom(room.id,'/start'),
    'POST',{version:room.version,shortened}))));
  return;
 }
 if(!['active','finished'].includes(room.status))return;
 const {game}=await request(apiRoom(room.id,'/snapshot'));
 if(!game)return;
 if(game.scenario?.placement?.complete){
  const link=E('a','hub-fullscreen-link','↗ ОТКРЫТЬ ИЗОМЕТРИЧЕСКОЕ ПОЛЕ');
  link.href='index.html?battle=1&room='+encodeURIComponent(room.id);
  link.target='_blank';link.rel='noopener noreferrer';
  frame.append(link);
 }
 if(room.status==='active'&&!game.scenario?.placement?.complete)renderSetup(host,room,game);
 else renderBattle(host,room,game);
 frame.append(E('p','',
  'Серверная комната: приказы, фазы и решения 2D6 проверяются и сохраняются в PostgreSQL.'));
}
export function installScenarioRoomUI(hub,openSection){
 root=hub;
 const tile=button('⬡  СЦЕНАРИИ · ТРИ ИГРОКА',()=>openSection(),'hub-action');
 tile.id='hub-scenarios-button';
 const operations=$(root,'.hub-operations');
 operations.insertBefore(tile,$(root,'#hub-campaigns-button')||operations.lastElementChild);
 panel=E('section','hub-coming-panel');panel.id='hub-scenarios-panel';panel.hidden=true;
 const top=section(panel,'DIVIDE AND CONQUER · СЕТЕВАЯ КОМНАТА');
 top.append(E('p','',
  'Три зарегистрированных командира: атакующий, командный лэнс и разведывательный лэнс.'));
 const form=E('form','op-form');form.id='scenario-room-create';
 for(const [name,caption] of [
  ['attacker','Атакующий'],['command','Командный лэнс'],['recon','Разведывательный лэнс']]){
  const i=input(name,'Позывной командира');
  i.required=true;i.maxLength=24;i.pattern='[A-Za-z0-9_-]{3,24}';
  form.append(label(caption,i));
 }
 const submit=E('button','op-primary','СОЗДАТЬ КОМНАТУ');submit.type='submit';
 form.append(submit);top.append(form);
 wireSubmit(form,async data=>{
  const roles=Object.fromEntries(['attacker','command','recon']
   .map(key=>[key,data.elements[key].value]));
  const created=await request('/api/v1/scenario-rooms','POST',{roles});
  opened=created.item.id;
 });
 const refresh=button('ОБНОВИТЬ КОМНАТЫ',()=>void refreshScenarioRooms());
 refresh.id='scenario-room-refresh';top.append(refresh);
 const status=E('p','op-message');status.id='scenario-room-message';status.setAttribute('role','status');
 top.append(status);
 const list=E('div','op-history-list');list.id='scenario-room-list';panel.append(list);
 const details=E('div');details.id='scenario-room-details';panel.append(details);
 $(root,'#hub-work-content').append(panel);
}
export async function refreshScenarioRooms(){
 if(!panel||panel.hidden)return;
 try{
  const loaded=await request('/api/v1/scenario-rooms');
  rooms=loaded.items||[];
  const list=$(panel,'#scenario-room-list');list.replaceChildren();
  for(const room of rooms){
   const b=button(room.scenarioId+' · '+room.yourRole+' · '+room.status+
    ' · v'+room.version,()=>{
     opened=room.id;void refreshScenarioRooms();
   });
   if(room.id===opened)b.classList.add('op-history-selected');
   list.append(b);
  }
  if(!rooms.length)list.append(E('p','', 'Комнат нет. Пригласите двух других командиров.'));
  const selected=rooms.find(r=>r.id===opened)||null;
  const details=$(panel,'#scenario-room-details');
  if(selected)await renderRoomDetails(selected,details);
  else details.replaceChildren();
  message();
 }catch(error){message(error.message);}
}
