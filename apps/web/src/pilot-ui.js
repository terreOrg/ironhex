// MechWarrior personnel registry: fictional identification cards and crew assignments.
// All user-entered names are inserted with textContent, never HTML.
const $=(selector,scope)=>scope.querySelector(selector);
const el=(tag,cls,content)=>{
  const x=document.createElement(tag);
  if(cls)x.className=cls;
  if(content!==undefined)x.textContent=String(content);
  return x;
};
async function api(url,{method='GET',data}={}) {
  const options={method,credentials:'same-origin',cache:'no-store'};
  if(method!=='GET') {
    options.headers={'Content-Type':'application/json'};
    options.body=JSON.stringify(data||{});
  }
  const r=await fetch(url,options);
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(body.error||'HTTP '+r.status);
  return body;
}
const factionNames={
  mercenary:'Наёмники',independent:'Независимые',
  federated_suns:'Федеративные Солнца',
  draconis_combine:'Синдикат Дракона',
  lyran_commonwealth:'Лиранское Содружество',
  capellan_confederation:'Капелланская Конфедерация',
  free_worlds_league:'Лига Свободных Миров',clan:'Кланы'
};
const rankNames={cadet:'КАДЕТ',regular:'ЛИНЕЙНЫЙ',veteran:'ВЕТЕРАН',elite:'ЭЛИТА'};
const colors=['#4a6564','#756351','#547668','#756878','#6a724a','#626987','#837057','#697d6d'];
const skins=['#d3ae91','#b88c71','#ae8c76','#d4b099','#ac8770','#a9856b','#c6a087','#9e7867'];
function svgPortrait(code) {
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 128 148');
  svg.setAttribute('role','img');
  svg.setAttribute('aria-label','Рисованный портрет мехвоина');
  const i=Math.max(0,Math.min(7,Number(code)-1));
  const add=(tag,attrs)=>{
    const x=document.createElementNS(ns,tag);
    for(const [k,v] of Object.entries(attrs))x.setAttribute(k,String(v));
    svg.append(x);
  };
  add('rect',{x:0,y:0,width:128,height:148,fill:colors[i]});
  add('circle',{cx:64,cy:51,r:45,fill:'#d3e5cd',opacity:.13});
  add('path',{d:'M6 148 Q9 114 46 107 L52 92 L77 92 L84 107 Q117 112 123 148 Z',fill:'#213b34'});
  add('path',{d:'M43 109 L61 122 L69 122 L85 108 L78 98 L49 98 Z',fill:'#81937d'});
  add('path',{d:'M54 87 L54 106 L74 106 L74 87 Z',fill:skins[i]});
  add('path',{d:'M41 49 Q42 25 64 24 Q87 24 87 50 L83 79 Q79 96 64 100 Q49 96 45 79 Z',fill:skins[i],stroke:'#7f665a','stroke-width':1});
  const hair=[
    'M40 54 Q31 22 64 20 Q96 22 88 56 L82 40 L46 43 Z',
    'M41 50 Q38 24 63 24 Q89 25 88 52 L79 38 L46 40 Z',
    'M40 52 Q33 18 62 19 Q91 22 90 66 L82 42 L46 45 Z',
    'M40 55 Q30 20 63 20 Q92 19 89 60 L80 35 L45 39 Z',
    'M42 51 Q44 27 64 26 Q83 27 86 50 L80 41 L46 41 Z',
    'M40 55 Q32 24 62 21 Q94 22 88 56 L79 43 L47 47 Z',
    'M39 51 Q38 22 63 19 Q93 20 89 55 L78 36 L46 42 Z',
    'M40 55 Q35 20 64 23 Q93 22 89 59 L80 43 L46 45 Z'
  ];
  add('path',{d:hair[i],fill:['#302d2b','#443831','#2f3530','#353038','#544537','#282c31','#4d3530','#393631'][i]});
  add('path',{d:'M50 65 L57 64 M71 64 L78 65',stroke:'#4b4036','stroke-width':1.5,'stroke-linecap':'round'});
  add('path',{d:'M64 66 L61 77 L67 78 M58 87 Q64 90 70 87',stroke:'#7f6153','stroke-width':1.1,fill:'none'});
  add('path',{d:'M13 13 L26 13 M13 13 L13 26 M102 13 L115 13 M115 13 L115 26',
    stroke:'#e7f0d6','stroke-width':1,fill:'none'});
  return svg;
}
let roster=[],editing=null,root;
function status(value){$('#pilot-status',root).textContent=value;}
function makeCard(p) {
  const card=el('article','pilot-id-card');
  card.dataset.pilotId=p.id;
  const top=el('div','pilot-id-top');
  top.append(el('strong','','⬡ IRONHEX / MECHWARRIOR'),el('span','',rankNames[p.rank]||'КАДЕТ'));
  const body=el('div','pilot-id-body');
  const photo=el('div','pilot-id-photo');
  photo.append(svgPortrait(p.portrait));
  const details=el('div','pilot-id-details');
  details.append(el('small','','PERSONNEL IDENTIFICATION'),
    el('h3','',p.callsign.toUpperCase()),el('p','',p.fullName),
    el('small','','ФРАКЦИЯ'),el('p','',factionNames[p.faction]||p.faction));
  const skills=el('div','pilot-id-skills');
  for(const [key,value] of [['GUNNERY',p.gunnery],['PILOTING',p.piloting],['XP',p.experience]]) {
    const stat=el('div','');
    stat.append(el('small','',key),el('strong','',value));
    skills.append(stat);
  }
  details.append(skills);
  body.append(photo,details);
  const assignment=el('div','pilot-id-assigned',
    p.assignedChassis?'МЕХ: '+p.assignedChassis:'СТАТУС: НЕ НАЗНАЧЕН');
  const record=el('div','pilot-id-record',
    'БОИ: '+p.battles+' · ПОБЕДЫ: '+p.wins+' · ПОРАЖЕНИЯ: '+p.losses+' · УНИЧТОЖЕНО: '+p.kills);
  const bottom=el('div','pilot-id-bottom');
  bottom.append(el('span','','IX-'+p.id.slice(0,8).toUpperCase()),
    el('span','pilot-id-barcode',''),el('span','','● ACTIVE'));
  const actions=el('div','pilot-id-actions');
  const edit=el('button','','ИЗМЕНИТЬ');
  edit.onclick=()=>editPilot(p);
  const history=el('button','','ПОСЛУЖНОЙ СПИСОК');
  history.onclick=()=>void showHistory(p);
  const remove=el('button','pilot-delete','УДАЛИТЬ');
  remove.onclick=async()=>{
    if(!confirm('Удалить мехвоина '+p.callsign+' из реестра?'))return;
    remove.disabled=true;
    try {
      await api('/api/v1/pilots/'+p.id,{method:'DELETE'});
      await refreshRoster();
    }catch(e){status('Ошибка удаления: '+e.message);}
    finally{remove.disabled=false;}
  };
  actions.append(edit,history,remove);
  card.append(top,body,assignment,record,bottom,actions);
  return card;
}
async function refreshRoster() {
  const cards=$('#pilot-roster-cards',root);
  cards.replaceChildren();
  status('Загрузка личного состава…');
  try {
    const result=await api('/api/v1/pilots');
    roster=result.items||[];
    status(roster.length?'УДОСТОВЕРЕНИЙ В РЕЕСТРЕ: '+roster.length+' / 24':
      'В реестре пока нет мехвоинов. Оформите первое удостоверение.');
    for(const p of roster)cards.append(makeCard(p));
  }catch(e){status('Ошибка загрузки: '+e.message);}
}
function editPilot(p) {
  editing=p.id;
  const f=$('#pilot-editor',root);
  f.elements.fullName.value=p.fullName;
  f.elements.callsign.value=p.callsign;
  f.elements.faction.value=p.faction;
  f.elements.portrait.value=String(p.portrait);
  $('#pilot-save',root).textContent='ОБНОВИТЬ УДОСТОВЕРЕНИЕ';
  $('#pilot-cancel',root).hidden=false;
  f.scrollIntoView({behavior:'smooth',block:'center'});
}
function clearEditor() {
  editing=null;
  $('#pilot-editor',root).reset();
  $('#pilot-save',root).textContent='СОЗДАТЬ УДОСТОВЕРЕНИЕ';
  $('#pilot-cancel',root).hidden=true;
}
async function showHistory(p) {
  const panel=$('#pilot-history',root);
  panel.hidden=false;
  panel.replaceChildren(el('h3','','ПОСЛУЖНОЙ СПИСОК · '+p.callsign));
  try {
    const {items}=await api('/api/v1/pilots/'+p.id+'/history');
    if(!items.length)panel.append(el('p','',
      'Подтверждённых боёв пока нет. Начисление опыта появится с серверным подсчётом результатов.'));
    for(const ev of items)panel.append(el('p','',ev.mechChassis+' · '+ev.result+
      ' · +'+ev.experience+' XP · поражено целей: '+ev.kills));
  }catch(e){panel.append(el('p','','Ошибка: '+e.message));}
}
export function installPilotUI(hubRoot,onNavigate=()=>{}) {
  root=hubRoot;
  const action=el('button','hub-action');
  action.id='hub-pilots-button';
  action.type='button';
  action.append(el('span','','▤'),el('strong','','ЛИЧНЫЙ СОСТАВ'),
    el('small','','Удостоверения, навыки, назначения'));
  const ops=$('.hub-operations',root);
  ops.insertBefore(action,$('.hub-soon',ops));
  const panel=el('section','hub-roster');
  panel.id='hub-roster';
  panel.hidden=true;
  panel.innerHTML=[
    '<div class="hub-hangar-head"><div><small>IRONHEX / PERSONNEL</small>',
    '<h2>ЛИЧНЫЙ СОСТАВ</h2></div>',
    '<button id="pilot-roster-close" type="button">ЗАКРЫТЬ</button></div>',
    '<p id="pilot-status" role="status"></p>',
    '<div id="pilot-roster-cards" class="pilot-roster-grid"></div>',
    '<div id="pilot-history" class="pilot-history" hidden></div>',
    '<form id="pilot-editor" class="pilot-editor"><h3>ВЫДАТЬ УДОСТОВЕРЕНИЕ</h3>',
    '<div class="pilot-editor-grid">',
    '<label>ИМЯ И ФАМИЛИЯ<input name="fullName" required minlength="2" maxlength="60" placeholder="Александр Керн"></label>',
    '<label>ПОЗЫВНОЙ<input name="callsign" required minlength="2" maxlength="28" placeholder="Грифон"></label>',
    '<label>ФРАКЦИЯ<select name="faction">',
    '<option value="mercenary">Наёмники</option><option value="independent">Независимые</option>',
    '<option value="federated_suns">Федеративные Солнца</option>',
    '<option value="draconis_combine">Синдикат Дракона</option>',
    '<option value="lyran_commonwealth">Лиранское Содружество</option>',
    '<option value="capellan_confederation">Капелланская Конфедерация</option>',
    '<option value="free_worlds_league">Лига Свободных Миров</option>',
    '<option value="clan">Кланы</option></select></label>',
    '<label>ПОРТРЕТ<select name="portrait">',
    '<option value="1">Портрет 01</option><option value="2">Портрет 02</option>',
    '<option value="3">Портрет 03</option><option value="4">Портрет 04</option>',
    '<option value="5">Портрет 05</option><option value="6">Портрет 06</option>',
    '<option value="7">Портрет 07</option><option value="8">Портрет 08</option>',
    '</select></label></div>',
    '<div class="pilot-editor-actions">',
    '<button id="pilot-save" type="submit">СОЗДАТЬ УДОСТОВЕРЕНИЕ</button>',
    '<button id="pilot-cancel" type="button" hidden>ОТМЕНА</button></div>',
    '<p>Стартовые навыки Gunnery 4 / Piloting 5. XP и боевой послужной список ',
    'изменяются только подтверждённым сервером результатом боя.</p></form>'
  ].join('');
  $('#hub-hangar',root).after(panel);
  action.onclick=()=>{
    onNavigate('pilots');
    void refreshRoster();
  };
  $('#pilot-roster-close',root).onclick=()=>onNavigate('home');
  $('#pilot-cancel',root).onclick=clearEditor;
  $('#pilot-editor',root).onsubmit=async event=>{
    event.preventDefault();
    const f=event.currentTarget;
    const button=$('#pilot-save',root);
    button.disabled=true;
    try {
      const data={
        fullName:f.elements.fullName.value,
        callsign:f.elements.callsign.value,
        faction:f.elements.faction.value,
        portrait:Number(f.elements.portrait.value)
      };
      await api(editing?'/api/v1/pilots/'+editing:'/api/v1/pilots',{
        method:editing?'PATCH':'POST',data
      });
      clearEditor();
      await refreshRoster();
    }catch(e){status('Ошибка сохранения: '+e.message);}
    finally{button.disabled=false;}
  };
}
export function crewPicker(mech,detail,pilots,refresh,onError) {
  const wrapper=el('label','pilot-crew-picker');
  wrapper.append(el('span','','ПИЛОТ МЕХА'));
  const select=el('select','');
  const none=el('option','','— НЕ НАЗНАЧЕН —');none.value='';select.append(none);
  const current=pilots.find(p=>p.assignedMechId===mech.id);
  for(const p of pilots) {
    if(p.assignedMechId&&p.assignedMechId!==mech.id)continue;
    const option=el('option','',p.callsign+' · '+p.gunnery+'/'+p.piloting);
    option.value=p.id;
    if(current?.id===p.id)option.selected=true;
    select.append(option);
  }
  select.onchange=async()=>{
    select.disabled=true;
    try {
      await api('/api/v1/hangar/'+mech.id+'/pilot',{
        method:'PUT',data:{pilotId:select.value||null}
      });
      await refresh();
    }catch(e){onError('Не удалось назначить пилота: '+e.message);select.disabled=false;}
  };
  wrapper.append(select);
  detail.append(wrapper);
}
