// Persistent, server-simulated battle operations and after-action reports.
// This is a distinct mode from the existing browser-only 3D training battle.
const $=(scope,q)=>scope.querySelector(q);
const E=(tag,cls,content)=>{
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(content!==undefined)n.textContent=String(content);
  return n;
};
const errors={
  invalid_roster:'Выберите один или два существующих меха из своего ангара.',
  operation_limit:'Достигнут лимит открытых операций.',
  invalid_operation:'Проверьте название операции и состав отряда.',
  operation_not_draft:'Эта операция уже началась.',
  operation_not_active:'Эта операция не активна.',
  operation_closed:'Операция уже закрыта.',
  unauthorized:'Необходимо войти в аккаунт.',
  email_unverified:'Сначала подтвердите адрес электронной почты.',
  invalid_contract:'Выберите доступный контракт.',
  mech_needs_repair:'Мех повреждён. Сначала отремонтируйте его на рынке.',
  mech_assigned_operation:'Мех уже участвует в незакрытой операции.',
  prototype_not_licensed:'Это учебный прототип. Для контракта купите мех на рынке.'
};
async function request(url,method='GET',body){
  const options={method,credentials:'same-origin',cache:'no-store'};
  if(method!=='GET'){
    options.headers={'Content-Type':'application/json'};
    options.body=JSON.stringify(body||{});
  }
  const response=await fetch(url,options);
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(errors[data.error]||data.error||'HTTP '+response.status);
  return data;
}
function launch3D(id){window.dispatchEvent(new CustomEvent('ironhex:open-3d-operation',{detail:{id}}));}
const outcomeLabels={victory:'ПОБЕДА',defeat:'ПОРАЖЕНИЕ',draw:'НИЧЬЯ'};
const stateLabels={draft:'ПОДГОТОВКА',active:'В БОЮ',completed:'ЗАВЕРШЕНА',abandoned:'ПРЕРВАНА'};
let root,opened=null,busy=false;
let contracts=[];

function message(text){
  const line=$(root,'#op-message');
  if(line)line.textContent=text;
}
function setBusy(value){
  busy=value;
  for(const node of root.querySelectorAll('#hub-campaigns-panel button'))
    node.disabled=value;
}
function renderRoster(items,pilots){
  const box=$(root,'#op-mech-list');
  box.replaceChildren();
  if(!items.length){
    box.append(E('p','op-empty','В ангаре пока нет мехов. Создайте конструкцию в MechLab.'));
    return;
  }
  for(const mech of items){
    const label=E('label','op-select-mech');
    const checkbox=E('input');
    checkbox.type='checkbox';
    checkbox.name='mechId';
    checkbox.value=mech.id;
    checkbox.disabled=mech.marketOwned===false||!!(mech.armorDamage||mech.structureDamage||mech.wrecked);
    checkbox.addEventListener('change',()=>{
      const selected=[...box.querySelectorAll('input:checked')];
      if(selected.length>2) checkbox.checked=false;
    });
    const body=E('span');
    const pilot=pilots.find(p=>p.assignedMechId===mech.id);
    body.append(E('strong','',mech.chassis),
      E('small','',pilot?
        'Пилот: '+pilot.callsign+' · G'+pilot.gunnery+'/P'+pilot.piloting:
        'Без назначенного пилота · XP не начисляется'),
      ...(checkbox.disabled?[E('small','op-warning','Неисправен — ремонт на рынке')]:[]));
    label.append(checkbox,body);
    box.append(label);
  }
}
function renderList(ops){
  const list=$(root,'#op-history-list');
  list.replaceChildren();
  if(!ops.length){
    list.append(E('p','op-empty','Операций пока нет. Сформируйте первый отряд.'));
    return;
  }
  for(const op of ops){
    const b=E('button','op-history-entry');
    b.type='button';
    b.append(E('strong','',op.title),
      E('small','',stateLabels[op.status]||op.status),
      E('span','',op.roster.map(r=>r.chassis).join(' · ')));
    if(op.id===opened)b.classList.add('op-history-selected');
    b.onclick=()=>void viewOperation(op.id);
    list.append(b);
  }
}
function renderOperation(op){
  const panel=$(root,'#op-current');
  panel.replaceChildren();
  if(!op)return;
  panel.append(E('small','op-overline','ОПЕРАЦИЯ / '+(stateLabels[op.status]||op.status)),
    E('h3','',op.title),
    E('small','', 'КОНТРАКТ: '+(contracts.find(c=>c.id===op.contractId)?.name||'Приграничный патруль')));
  const roster=E('div','op-unit-roster');
  for(const entry of op.roster){
    const cell=E('div','op-unit-card');
    cell.append(E('span','op-unit-icon','⬡'),E('strong','',entry.chassis),
      E('small','',entry.tonnage+' т'),
      E('small','',entry.pilot?
        entry.pilot.callsign+' · G'+entry.pilot.gunnery+'/P'+entry.pilot.piloting:
        'Пилот не назначен'));
    roster.append(cell);
  }
  panel.append(roster);
  if(op.status==='draft'){
    panel.append(E('p','op-info',op.controlMode==='interactive'?
      'После запуска откроется 3D-поле боя. Все команды проверяет сервер.':
      'Состав зафиксирован. После запуска можно выполнять серверную симуляцию раунд за раундом.'));
    const begin=E('button','op-primary','НАЧАТЬ ОПЕРАЦИЮ');
    begin.onclick=()=>void command(op.id,'launch');
    panel.append(begin);
  }
  if(op.status==='active'){
    const state=op.state;
    panel.append(E('p','op-phase',
      'РАУНД '+(state?.round||1)+' · '+(state?.phase||'ИНИЦИАТИВА')));
    if(state?.units){
      const units=E('div','op-status-grid');
      for(const u of state.units){
        const cell=E('div','op-status-unit');
        cell.append(E('small','',u.team===0?'НАШ ОТРЯД':'ПРОТИВНИК'),
          E('strong','',u.name),
          E('span','',u.dead?'УНИЧТОЖЕН':
            'НАГРЕВ '+u.heat+' · БРОНЯ −'+u.armorLost+
            ' · КОНСТРУКЦИЯ −'+u.structureLost));
        units.append(cell);
      }
      panel.append(units);
    }
    if(op.controlMode==='interactive'){
      const open=E('button','op-primary','ПРОДОЛЖИТЬ В 3D');
      open.type='button';
      open.onclick=()=>launch3D(op.id);
      panel.append(open);
    }else{
      const advance=E('button','op-primary','ПРОВЕСТИ СЛЕДУЮЩИЙ РАУНД');
      advance.onclick=()=>void command(op.id,'advance');
      panel.append(advance);
    }
    panel.append(E('p','op-info',
      'Сервер определяет движение, стрельбу, броски кубиков и урон. Состояние раунда сохраняется.'));
    if(state?.log?.length){
      const log=E('div','op-battle-log');
      log.append(E('h4','','БОЕВОЙ ЖУРНАЛ'));
      for(const line of state.log.slice(-18))log.append(E('p','',line));
      panel.append(log);
    }
  }
  if(op.status==='completed' && op.report){
    const rep=op.report;
    panel.append(E('div','op-outcome '+rep.result,
      outcomeLabels[rep.result]||rep.result),
      E('p','op-phase','Боевое завершение · '+rep.rounds+' раундов'));
    const rewards=E('div','op-rewards');
    rewards.append(E('h4','','ПОСЛЕБОЕВОЙ РАПОРТ'));
    if(Number.isInteger(rep.creditReward))rewards.append(E('p','op-credit-reward','ВЫПЛАТА: +'+rep.creditReward.toLocaleString('ru-RU')+' C-Bills'));

    for(const item of rep.rewards){
      const row=E('div','op-reward');
      row.append(E('strong','',item.chassis+
        (item.callsign?' · '+item.callsign:'')),
        E('span','', (item.destroyed?'МЕХ УНИЧТОЖЕН · ':'')+
          'Броня −'+item.armorLost+' · Структура −'+item.structureLost+
          ' · Ранения '+item.wounds+' · +'+item.experience+' XP'));
      const spent=(item.ammoUsed||[]).filter(bin=>bin.used>0);
      if(spent.length)row.append(E('small','op-info',
        'РАСХОД БОЕПРИПАСОВ: '+spent.map(bin=>
          bin.weapon+' '+bin.location+':'+bin.slot+' — '+bin.used+
          ' ('+bin.remaining+'/'+bin.capacity+' осталось)').join(' · ')));
      rewards.append(row);
    }
    rewards.append(E('p','op-info',rep.equipmentNote||''));
    panel.append(rewards);
    const log=E('details','op-battle-log');
    log.append(E('summary','','ПОЛНЫЙ ЖУРНАЛ ОПЕРАЦИИ'));
    for(const entry of rep.log||[])log.append(E('p','',entry));
    panel.append(log);
  }
  if(op.status==='abandoned')
    panel.append(E('p','op-info','Операция прервана. Награды и статистика не начислены.'));
  if(['active','draft'].includes(op.status)){
    const leave=E('button','op-abandon','ПРЕРВАТЬ ОПЕРАЦИЮ');
    leave.onclick=()=>{
      if(confirm('Прервать операцию? Боевой опыт начислен не будет.'))
        void command(op.id,'abandon');
    };
    panel.append(leave);
  }
}
async function viewOperation(id){
  if(busy)return;
  opened=id;
  try{
    const {item}=await request('/api/v1/operations/'+encodeURIComponent(id));
    renderOperation(item);
    message('Операция загружена из PostgreSQL.');
  }catch(e){message('Ошибка загрузки: '+e.message);}
}
async function command(id,action){
  if(busy)return;
  setBusy(true);
  message(action==='advance'?'Сервер рассчитывает раунд…':'Запрос отправлен…');
  try{
    const {item}=await request(
      '/api/v1/operations/'+encodeURIComponent(id)+'/'+action,'POST',{});
    opened=item.id;
    renderOperation(item);
    await loadHistory();
    if(item.status==='completed'){
      message('Итог подтверждён сервером. Послужные списки мехвоинов обновлены.');
    }else{
      message('Состояние операции сохранено.');
      if(action==='launch'&&item.controlMode==='interactive')launch3D(item.id);
    }
  }catch(e){message('Ошибка операции: '+e.message);}
  finally{setBusy(false);}
}
async function loadHistory(){
  const {items}=await request('/api/v1/operations');
  renderList(items);
}
export async function refreshOperations(){
  if(!root||busy)return;
  message('Связь с оперативным архивом…');
  try{
    const [hangar,pilots,history,economy]=await Promise.all([
      request('/api/v1/hangar'),request('/api/v1/pilots'),
      request('/api/v1/operations'),request('/api/v1/economy')
    ]);
    contracts=economy.contracts||[];
    const selector=$(root,'#op-contract');
    const existing=selector.value;
    selector.replaceChildren();
    for(const contract of contracts){
      const option=E('option','',contract.name+' · '+contract.victory.toLocaleString('ru-RU')+' C-Bills');
      option.value=contract.id;selector.append(option);
    }
    if(contracts.some(c=>c.id===existing))selector.value=existing;
    renderRoster(hangar.items,pilots.items);
    renderList(history.items);
    message('Архив доступен. Выберите мехов для новой операции или откройте сохранённую.');
    if(opened){
      const selected=history.items.find(o=>o.id===opened);
      if(selected) await viewOperation(opened);
    }
  }catch(e){message('Ошибка связи с сервером: '+e.message);}
}
export function installOperationUI(hubRoot){
  root=hubRoot;
  const heading=root.querySelector('#hub-campaigns-panel');
  heading.classList.remove('hub-coming-panel');
  heading.classList.add('op-panel');
  heading.replaceChildren();
  heading.innerHTML=[
    '<div class="op-intro"><div class="op-kicker">COMSTAR OPERATIONS NETWORK / SECURE</div>',
    '<h3>ПОДГОТОВКА ОПЕРАЦИИ</h3>',
    '<p>Сформируйте отряд из одного или двух сохранённых мехов. Сервер проводит бой',
    'по раундам, сохраняет состояние и выдаёт подтверждённый рапорт.</p>',
    '<p class="op-warning">В интерактивном режиме сервер проверяет приказы, кубики, повреждения и награды. ',
    'Автоматический режим сохраняется отдельно для быстрых операций.</p></div>',
    '<div class="op-layout"><div class="op-main">',
    '<form id="op-create-form" class="op-create-form">',
    '<label>НАЗВАНИЕ ОПЕРАЦИИ<input name="title" minlength="3" maxlength="80" required',
    'value="Патруль приграничного сектора"></label>',
    '<label>КОНТРАКТ<select id="op-contract" name="contractId" aria-label="Контракт">',
    '<option value="patrol">Приграничный патруль</option></select></label>',
    '<p class="op-label">ВЫБЕРИТЕ ДО ДВУХ МЕХОВ ИЗ АНГАРА</p>',
    '<label class="op-control-choice"><input type="checkbox" name="interactive" checked>',
    ' ИНТЕРАКТИВНЫЙ 3D-БОЙ (СЕРВЕРНЫЙ РЕЖИМ)</label>',
    '<div id="op-mech-list" class="op-mech-list"></div>',
    '<button id="op-create" type="submit" class="op-primary">СОЗДАТЬ ОПЕРАЦИЮ</button>',
    '</form><section id="op-current" class="op-current" aria-label="Операция"></section></div>',
    '<aside class="op-history"><h3>АРХИВ ОПЕРАЦИЙ</h3>',
    '<div id="op-history-list"></div></aside></div>',
    '<p id="op-message" class="op-message" role="status" aria-live="polite"></p>'
  ].join('');
  const button=root.querySelector('#hub-campaigns-button');
  if(button){
    const title=button.querySelector('strong');
    const caption=button.querySelector('small');
    if(title)title.textContent='ОПЕРАЦИИ';
    if(caption)caption.textContent='Отряд · рапорты · карьера';
    button.classList.remove('hub-soon');
  }
  const form=$(root,'#op-create-form');
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy)return;
    const mechIds=[...form.querySelectorAll('input[name="mechId"]:checked')].map(el=>el.value);
    if(!mechIds.length||mechIds.length>2){
      message('Необходимо выбрать один или два меха.');return;
    }
    setBusy(true);
    try{
      const {item}=await request('/api/v1/operations','POST',{
        title:form.elements.title.value,mechIds,contractId:form.elements.contractId.value,
        mode:form.elements.interactive.checked?'interactive':'auto'
      });
      opened=item.id;
      renderOperation(item);
      await loadHistory();
      message('Операция сформирована. Нажмите «Начать операцию».');
    }catch(e){message('Не удалось создать операцию: '+e.message);}
    finally{setBusy(false);}
  });
}

export function openOperationReport(id){opened=id;void viewOperation(id);}
