import {construct,example,EQUIPMENT,LOCS} from './construction.js';
import {ammoBinsFor} from './equipment.js';
const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let currentHangarId=new URL(location.href).searchParams.get('mech');
let marketOwned=false,installedConfig=null,equipmentStock={};
let c=structuredClone(example);try{const saved=JSON.parse(localStorage.getItem('ironhex-design'));if(saved?.config)c=saved.config;}catch{}
function draw(){
 $('#core').innerHTML=`<label>Название<input id="name" maxlength="30" value="${esc(c.name)}"></label>`+[['tonnage','Масса, т',20,100,5],['walk','Ходьба, MP',1,20,1],['jump','Прыжок, MP',0,20,1],['sinks','Теплоотводы',10,50,1]].map(([k,label,min,max,step])=>`<label>${label}<input id="${k}" type="number" min="${min}" max="${max}" step="${step}" value="${c[k]}"></label>`).join('');
 $('#armor').innerHTML=LOCS.map(l=>`<tr><td>${l}</td><td><input aria-label="Броня ${l}" data-armor="${l}" type="number" min="0" max="100" value="${c.armor[l]}"></td><td>${['CT','LT','RT'].includes(l)?`<input aria-label="Кормовая броня ${l}" data-rear="${l}" type="number" min="0" max="100" value="${c.rear[l]}">`:'—'}</td></tr>`).join('');
 for(const l of ['LA','RA'])$('#remove'+l).checked=!!c.removeActuators?.includes(l);
 let wi=0;$('#equipment').innerHTML=c.equipment.map((e,i)=>`<tr data-row="${i}"><td>${EQUIPMENT.includes(e.type)?'<small>Оружие №'+wi+++'</small><br>':''}<select data-key="type" aria-label="Оборудование ${i+1}">${[...EQUIPMENT,'ammo','jump','sink','hatchet'].map(t=>`<option ${e.type===t?'selected':''} value="${t}">${({ammo:'Боезапас',jump:'Прыжковый двигатель',sink:'Теплоотвод',hatchet:'Топор'})[t]||t}</option>`).join('')}</select></td><td><select data-key="location" aria-label="Секция ${i+1}">${LOCS.map(l=>`<option ${e.location===l?'selected':''}>${l}</option>`).join('')}</select></td><td><input type="number" min="1" max="12" data-key="slot" aria-label="Слот ${i+1}" value="${e.slot}"></td><td>${e.type==='ammo'?`<label>№ оружия<input type="number" min="0" data-key="weapon" value="${e.weapon??0}"></label><label>Тонны<select data-key="mass"><option value="1">1</option><option value="0.5" ${e.mass===.5?'selected':''}>0,5 (MG)</option></select></label>`:EQUIPMENT.includes(e.type)?`<label><input type="checkbox" data-key="rear" ${e.rear?'checked':''}> Назад</label>${e.type==='AC/20'?`<label>Вторая секция<select data-key="splitLocation"><option value="">Без разделения</option>${['CT','LT','RT','LA','RA'].map(l=>`<option ${e.splitLocation===l?'selected':''}>${l}</option>`).join('')}</select></label><label>Слотов в первой<input type="number" min="1" max="9" data-key="splitCount" value="${e.splitCount??5}"></label><label>Слот во второй<input type="number" min="1" max="12" data-key="splitSlot" value="${e.splitSlot??1}"></label>`:''}`:'—'}</td><td><button data-del="${i}" aria-label="Удалить строку ${i+1}">×</button></td></tr>`).join('');
 $('#equipment').onchange=ev=>{read();if(ev.target.dataset.key==='type')draw();else check();};$('#equipment').onclick=ev=>{if(ev.target.dataset.del!==undefined){read();c.equipment.splice(+ev.target.dataset.del,1);draw();}};$('#core').onchange=()=>{read();check();};$('#armor').onchange=()=>{read();check();};for(const l of ['LA','RA'])$('#remove'+l).onchange=()=>{read();check();};
 for(const id of ['tonnage','walk'])
   $('#'+id).disabled=marketOwned;
 for(const element of document.querySelectorAll('#armor input'))
   element.disabled=marketOwned;
 for(const l of ['LA','RA'])$('#remove'+l).disabled=marketOwned;
 check();}
function read(){for(const k of ['tonnage','walk','jump','sinks'])c[k]=+$('#'+k).value;c.name=$('#name').value;for(const el of document.querySelectorAll('[data-armor]'))c.armor[el.dataset.armor]=+el.value;for(const el of document.querySelectorAll('[data-rear]'))c.rear[el.dataset.rear]=+el.value;c.removeActuators=['LA','RA'].filter(l=>$('#remove'+l).checked);for(const row of document.querySelectorAll('[data-row]'))for(const el of row.querySelectorAll('[data-key]')){const key=el.dataset.key;c.equipment[+row.dataset.row][key]=el.type==='checkbox'?el.checked:['slot','weapon','mass','splitCount','splitSlot'].includes(key)?+el.value:el.value;}}
function check(){const r=construct(c);$('#results').innerHTML=`<b>${r.errors.length?'Конструкция требует исправления':'Конструкция допустима'}</b>${r.total!==undefined?`<p>Масса ${r.total.toFixed(1)} / ${c.tonnage} т · запас ${r.remaining.toFixed(1)} т · двигатель ${r.rating}</p><p class="hint">${Object.entries(r.weights).map(([k,v])=>`${({structure:'Каркас',engine:'Двигатель',gyro:'Гироскоп',cockpit:'Кабина',sinks:'Теплоотводы',armor:'Броня',jump:'Прыжок',weapons:'Оружие',ammo:'Боезапас'})[k]}: ${v} т`).join(' · ')}</p>`:''}${r.errors.map(e=>`<p class="error">${esc(e)}</p>`).join('')}`;$('#launch').disabled=!!r.errors.length;$('#slotmap').innerHTML=r.unit?Object.entries(r.unit.slots).map(([l,a])=>`<p><b>${l}</b>: ${a.map((s,i)=>`${i+1} ${s||'свободно'}`).join(' · ')}</p>`).join(''):'';renderWarehouse();return r;}
$('#add').onclick=()=>{read();c.equipment.push({type:'Medium Laser',location:'LT',slot:1});draw();};$('#check').onclick=()=>{read();check();};$('#example').onclick=()=>{c=structuredClone(example);draw();};$('#launch').onclick=()=>{read();if(check().errors.length)return;localStorage.setItem('ironhex-design',JSON.stringify({config:c,position:+$('#position').value}));location.href='index.html?custom=1';};draw();



async function loadFromHangar() {
  if (!currentHangarId) return;
  const feedback=$('#hangar-feedback');
  feedback.textContent='Загрузка конструкции из вашего ангара…';
  try {
    const response=await fetch('/api/v1/hangar',{credentials:'same-origin',cache:'no-store'});
    if (!response.ok) throw Error('Сервер вернул '+response.status);
    const {items}=await response.json();
    const item=items.find(mech=>mech.id===currentHangarId);
    if (!item?.state?.config) throw Error('Мех не найден в вашем ангаре');
    c=structuredClone(item.state.config);
    installedConfig=structuredClone(c);
    marketOwned=item.marketOwned===true;
    draw();
    feedback.textContent='Открыта конструкция: '+item.chassis;
  } catch(error) {
    feedback.textContent='Не удалось открыть меха: '+error.message;
    currentHangarId=null;
  }
}

async function saveToHangar(copy=false) {
  const feedback=$('#hangar-feedback');
  read();
  if (check().errors.length) {
    feedback.textContent='Сначала устраните ошибки конструкции.';
    return;
  }
  const button=copy?$('#save-copy'):$('#save-hangar');
  button.disabled=true;
  feedback.textContent='Сохранение в PostgreSQL…';
  try {
    const id=(!copy && currentHangarId)?currentHangarId:null;
    const response=await fetch('/api/v1/hangar'+(id?'/'+encodeURIComponent(id):''),{
      method:id?'PATCH':'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({config:c})
    });
    const data=await response.json();
    if(!response.ok) throw Error(
      ({invalid_design:'Недопустимая конструкция',hangar_full:'Ангар заполнен',
        unauthorized:'Необходимо войти в аккаунт',
        insufficient_equipment:'Недостаточно оружия или систем на складе. Приобретите оборудование на рынке.',
        insufficient_ammo:'Нужен совместимый комплект боеприпасов на складе.',
        factory_frame_locked:'У купленного меха нельзя менять базовый каркас, двигатель, броню или штатные системы.',
        mech_assigned_operation:'Мех уже назначен на активную операцию.',
        mech_needs_repair:'Перед переоборудованием отремонтируйте меха.',
        mech_needs_component_repair:'Перед переоборудованием замените повреждённые компоненты в ангаре.'})[data.error]||data.error||'HTTP '+response.status
    );
    currentHangarId=data.item.id;
    marketOwned=data.item.marketOwned===true;
    installedConfig=structuredClone(c);
    void refreshWarehouse();
    history.replaceState(null,'','mechlab.html?mech='+encodeURIComponent(currentHangarId));
    feedback.textContent='Мех «'+data.item.chassis+'» сохранён в вашем ангаре.';
  } catch(error) {
    feedback.textContent='Ошибка сохранения: '+error.message;
  } finally {
    button.disabled=false;
  }
}
$('#save-hangar').onclick=()=>void saveToHangar();
$('#save-copy').onclick=()=>void saveToHangar(true);
void loadFromHangar().then(refreshWarehouse);
function countComponents(config){
  const counts={};
  for(const item of config?.equipment||[]){
    const key=EQUIPMENT.includes(item.type)?item.type:
      ['jump','sink','hatchet'].includes(item.type)?'system:'+item.type:null;
    if(key)counts[key]=(counts[key]||0)+1;
  }
  return counts;
}
function renderWarehouse(){
  const info=$('#warehouse-status'),stock=$('#warehouse-stock'),ownership=$('#ownership-status');
  if(!info||!stock||!ownership)return;
  ownership.textContent=marketOwned?
    'БОЕВОЙ МЕХ · Приобретённая машина. Оружие, теплоотводы, прыжковые двигатели и топоры списываются со склада; базовая платформа и броня фиксированы.':
    'УЧЕБНЫЙ ПРОТОТИП · Конструктор и быстрый бой бесплатны; для контрактов нужен купленный мех.';
  const available=Object.entries(equipmentStock).filter(([,n])=>n>0);
  stock.replaceChildren();
  if(!available.length)stock.textContent='На складе нет запасного вооружения.';
  for(const [name,amount] of available){
    const badge=document.createElement('span');
    badge.textContent=name+': '+amount+' шт.  ';
    badge.style.marginRight='8px';
    stock.append(badge);
  }
  if(!marketOwned||!installedConfig){
    info.textContent='Оружейный склад используется только для переоборудования купленных мехов.';
    return;
  }
  const old=countComponents(installedConfig),next=countComponents(c);
  const needed=Object.entries(next).filter(([name,amount])=>
    amount>(old[name]||0)).map(([name,amount])=>({
      name,count:amount-(old[name]||0),stock:equipmentStock[name]||0
    }));
  const oldBins=new Map(ammoBinsFor(installedConfig).map(bin=>[bin.key,bin]));
  const newAmmo=ammoBinsFor(c).filter(bin=>{
    const existing=oldBins.get(bin.key);
    return !existing||existing.weapon!==bin.weapon||existing.capacity!==bin.capacity;
  }).map(bin=>({name:'ammo:'+bin.weapon,count:1,
    stock:equipmentStock['ammo:'+bin.weapon]||0}));
  const newAmmoTotals=new Map();
  for(const bin of newAmmo)newAmmoTotals.set(bin.name,(newAmmoTotals.get(bin.name)||0)+1);
  const magazines=[...newAmmoTotals].map(([name,count])=>({
    name,count,stock:equipmentStock[name]||0
  }));
  const allNeeded=[...needed,...magazines];
  const missing=allNeeded.filter(item=>item.count>item.stock);
  info.textContent=missing.length?
    'НЕДОСТАТОЧНО НА СКЛАДЕ: '+missing.map(x=>x.name+' ×'+(x.count-x.stock)).join(', ')+
      '. Сначала купите вооружение на рынке.':
    allNeeded.length?'Потребуется со склада: '+allNeeded.map(x=>x.name+' ×'+x.count).join(', ')+
      '. Снятое оружие вернётся на склад.':
      'Новое оружие не требуется. Снятые орудия возвращаются на склад. Боезапас пока не оплачивается.';
}
async function refreshWarehouse(){
  try{
    const response=await fetch('/api/v1/economy',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw Error('HTTP '+response.status);
    const data=await response.json();
    equipmentStock=data.equipmentStock||{};
    renderWarehouse();
  }catch(error){
    const info=$('#warehouse-status');
    if(info)info.textContent='Не удалось прочитать склад: '+error.message;
  }
}
