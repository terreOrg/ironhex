import {installPilotUI,crewPicker} from './pilot-ui.js';
// Main menu and hangar are only initialized after authentication.
let root, onBattle, onProfile;
const E=(tag,cls,txt)=>{
  const el=document.createElement(tag);
  if(cls) el.className=cls;
  if(txt!==undefined) el.textContent=String(txt);
  return el;
};
async function api(url,options={}) {
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw Error(data.error||'HTTP '+response.status);
  return data;
}
function create() {
  root=E('section','hub-root');
  root.id='commander-hub';
  root.innerHTML="<div class=\"hub-frame\">\n  <header class=\"hub-top\"><div class=\"hub-logo\">⬡ IRON<span>HEX</span><small>TACTICAL COMMAND NETWORK</small></div>\n  <div class=\"hub-profile\"><div>КОМАНДИР <strong id=\"hub-commander\"></strong></div><button id=\"hub-profile-button\" type=\"button\">ПРОФИЛЬ / ВЫХОД</button></div></header>\n  <div class=\"hub-main\"><section class=\"hub-intro\"><small>КОМАНДНЫЙ ТЕРМИНАЛ / БРИФИНГ</small><h1>ПУЛЬТ<br>КОМАНДИРА<span>.</span></h1>\n  <p>Выберите операцию. Сохранённые мехи привязаны к вашему аккаунту.</p><div class=\"hub-signal\">● UPLINK ESTABLISHED / DATABASE ONLINE</div></section>\n  <div class=\"hub-operations\">\n    <button id=\"hub-battle\" class=\"hub-action hub-primary\" type=\"button\"><span>⚔</span><strong>БЫСТРЫЙ БОЙ</strong><small>Развернуть отряд на поле сражения</small></button>\n    <button id=\"hub-hangar-button\" class=\"hub-action\" type=\"button\"><span>⬡</span><strong>АНГАР</strong><small>Ваши сохранённые мехи</small></button>\n    <a href=\"mechlab.html\" class=\"hub-action\"><span>⚙</span><strong>КОНСТРУКТОР</strong><small>Создать или модифицировать меха</small></a>\n    <div class=\"hub-action hub-soon\" aria-disabled=\"true\"><span>◈</span><strong>КАМПАНИИ</strong><small>В разработке</small></div>\n    <div class=\"hub-action hub-soon\" aria-disabled=\"true\"><span>▣</span><strong>РЫНОК</strong><small>В разработке</small></div>\n  </div></div>\n  <section class=\"hub-hangar\" id=\"hub-hangar\" hidden>\n    <div class=\"hub-hangar-head\"><div><small>ЛИЧНЫЙ РЕЕСТР</small><h2>ВАШ АНГАР</h2></div>\n    <div><a href=\"mechlab.html\">+ СОЗДАТЬ МЕХА</a> <button id=\"hub-hangar-close\" type=\"button\">ЗАКРЫТЬ</button></div></div>\n    <p id=\"hub-hangar-status\" role=\"status\"></p><div id=\"hub-hangar-cards\" class=\"hub-hangar-grid\"></div>\n  </section>\n  <footer class=\"hub-footer\">IRONHEX / COMMANDER CONTROL <span>UNOFFICIAL BATTLETECH FAN PROJECT</span></footer>\n</div>";
  document.body.append(root);
  installPilotUI(root);
  root.querySelector('#hub-battle').onclick=()=>onBattle?.();
  root.querySelector('#hub-profile-button').onclick=()=>onProfile?.();
  root.querySelector('#hub-hangar-button').onclick=()=>{
    root.querySelector('#hub-roster').hidden=true;
    root.querySelector('#hub-hangar').hidden=false;
    void refresh();
  };
  root.querySelector('#hub-hangar-close').onclick=()=>{
    root.querySelector('#hub-hangar').hidden=true;
  };
}
async function refresh() {
  const label=root.querySelector('#hub-hangar-status');
  const cards=root.querySelector('#hub-hangar-cards');
  label.textContent='Загрузка ангара…';
  cards.replaceChildren();
  try {
    const [{items},{items:pilots}]=await Promise.all([api('/api/v1/hangar'),api('/api/v1/pilots')]);
    label.textContent=items.length?'Мехов в ангаре: '+items.length:
      'Ангар пуст. Создайте первого меха в конструкторе.';
    for(const item of items) {
      const card=E('article','hub-mech');
      card.append(E('div','hub-mech-icon','⬡'));
      const detail=E('div','hub-mech-detail');
      detail.append(E('small','',item.callsign||'БОЕВОЙ МЕХ'));
      detail.append(E('h3','',item.chassis));
      const config=item.state?.config;
      detail.append(E('p','',String(config?.tonnage||'?')+' т · '+String(config?.walk||'?')+' MP'));
      const actions=E('div','hub-mech-actions');
      const edit=E('a','','ИЗМЕНИТЬ');
      edit.href='mechlab.html?mech='+encodeURIComponent(item.id);
      const fight=E('button','','В БОЙ');
      fight.type='button';
      fight.onclick=()=>{
        if(!config) return;
        const pilot=pilots.find(p=>p.assignedMechId===item.id);
        localStorage.setItem('ironhex-design',JSON.stringify({config,position:0,pilot:pilot?{id:pilot.id,callsign:pilot.callsign,gunnery:pilot.gunnery,piloting:pilot.piloting}:null}));
        location.href='index.html?custom=1';
      };
      const del=E('button','hub-delete','УДАЛИТЬ');
      del.type='button';
      del.onclick=async()=>{
        if(!confirm('Удалить '+item.chassis+' из ангара?')) return;
        del.disabled=true;
        try {
          await api('/api/v1/hangar/'+encodeURIComponent(item.id),{method:'DELETE'});
          await refresh();
        } catch(e) {label.textContent='Ошибка удаления: '+e.message;del.disabled=false;}
      };
      crewPicker(item,detail,pilots,refresh,error=>{label.textContent=error;});
      actions.append(edit,fight,del);
      detail.append(actions);
      card.append(detail);
      cards.append(card);
    }
  }catch(e){label.textContent='Ошибка загрузки ангара: '+e.message;}
}
export function openHub({user,onBattle:launch,onProfile:profile}) {
  if(!root) create();
  onBattle=launch;
  onProfile=profile;
  root.querySelector('#hub-commander').textContent=user.handle;
  root.querySelector('#hub-hangar').hidden=true;
  root.querySelector('#hub-roster').hidden=true;
  document.body.classList.add('hub-open');
}
