import {installPilotUI,crewPicker} from './pilot-ui.js';
import {installOperationUI,refreshOperations} from './operation-ui.js';
import {installEconomyUI,refreshEconomy} from './economy-ui.js';
import {installScenarioRoomUI,refreshScenarioRooms} from './scenario-room-ui.js';
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
  installPilotUI(root,openSection);
  initializeWorkspace();
  installOperationUI(root);
  installEconomyUI(root,refresh);
  installScenarioRoomUI(root,()=>openSection('scenarios'));
  root.querySelector('#hub-battle').onclick=()=>openSection('battle');
  window.addEventListener('ironhex:open-3d-operation',event=>{
    const id=event.detail?.id;
    if(typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id))
      openSection('battle',{src:'index.html?battle=1&operation='+encodeURIComponent(id)});
  });
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||
       event.source!==root.querySelector('#hub-battle-frame')?.contentWindow||
       event.data?.type!=='ironhex:operation-report')return;
    const id=event.data.id;
    if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))return;
    openSection('campaigns');
    import('./operation-ui.js').then(mod=>mod.openOperationReport(id)).catch(error=>{
      console.error('Ironhex operation report failed',error);
      const status=root.querySelector('#op-message');
      if(status)status.textContent='Не удалось открыть рапорт. Повторите попытку.';
    });
  });
  root.querySelector('#hub-profile-button').onclick=()=>onProfile?.();
  root.querySelector('#hub-hangar-button').onclick=()=>{
    openSection('hangar');
    void refresh();
  };
  root.querySelector('#hub-hangar-close').onclick=()=>openSection('home');
}
async function refresh() {
  const label=root.querySelector('#hub-hangar-status');
  const cards=root.querySelector('#hub-hangar-cards');
  label.textContent='Загрузка ангара…';
  cards.replaceChildren();
  try {
    const [{items},{items:pilots},economy]=await Promise.all([api('/api/v1/hangar'),api('/api/v1/pilots'),api('/api/v1/economy')]);
    label.textContent=items.length?'Мехов в ангаре: '+items.length:
      'Ангар пуст. Создайте первого меха в конструкторе.';
    for(const item of items) {
      const card=E('article','hub-mech');
      card.append(E('div','hub-mech-icon','⬡'));
      const detail=E('div','hub-mech-detail');
      detail.append(E('small','',item.marketOwned===false?
        'УЧЕБНЫЙ ПРОТОТИП · ТОЛЬКО БЫСТРЫЙ БОЙ':
        (item.callsign||'КОНТРАКТНЫЙ БОЕВОЙ МЕХ')));
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
        openSection('battle',{src:'index.html?custom=1'});
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
      const quote=economy.repairs?.find(x=>x.mechId===item.id);
      if(item.brokenComponents?.length){
        detail.append(E('p','hub-mech-damage',
          'КРИТИЧЕСКИЕ ПОВРЕЖДЕНИЯ · '+item.brokenComponents.length+
          ' компонентов. Замена и обслуживание — в разделе «Рынок и ремонт».'));
      }
      if(quote?.needsRepair){
        detail.append(E('p','hub-mech-damage',
          'ТРЕБУЕТ РЕМОНТА · Броня −'+quote.armorDamage+
          ' · Конструкция −'+quote.structureDamage+
          ' · Стоимость '+Number(quote.creditCost).toLocaleString('ru-RU')+' C-Bills'));
        const repair=E('button','hub-repair','РЕМОНТ КОРПУСА');
        repair.type='button';
        repair.onclick=async()=>{
          if(!confirm('Восстановить '+item.chassis+' за '+quote.creditCost+' C-Bills?'))return;
          repair.disabled=true;
          try{
            await api('/api/v1/economy/repair',{
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({mechId:item.id})
            });
            await refresh();
          }catch(e){label.textContent='Ошибка ремонта: '+e.message;repair.disabled=false;}
        };
        actions.append(repair);
      }
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
  openSection('home');
  document.body.classList.add('hub-open');
}

// The same menu transforms from the welcome grid to a left-hand command rail.
// Content is switched in place so changing sections does not lose the login.
const SECTION_INFO={
  battle:{code:'TACTICAL OPERATIONS / 01',title:'Быстрый бой',
    detail:'Тактическая симуляция. Управление мехами, сектора огня и боевой журнал.'},
  hangar:{code:'MECH REGISTRY / 02',title:'Ангар',
    detail:'Сохранённые конструкции, комплектация и назначение мехвоинов.'},
  mechlab:{code:'ENGINEERING / 03',title:'Конструктор мехов',
    detail:'Проверка массы, брони, вооружения и критических слотов.'},
  pilots:{code:'PERSONNEL / 04',title:'Личный состав',
    detail:'Удостоверения, позывные, квалификация и послужной список.'},
  scenarios:{code:'AGOAC CHAPTER 11 / 07',title:'Сценарии',
    detail:'Серверный вариант Divide and Conquer для трёх командиров.'},
  campaigns:{code:'SERVER OPERATIONS / 05',title:'Боевые операции',
    detail:'Подготовка отряда, серверная симуляция, сохранение раундов и рапорты.'},
  market:{code:'LOGISTICS / 06',title:'Рынок',
    detail:'Контрактные C-Bills, закупка ремкомплектов и восстановление боевых мехов.'}
};
function initializeWorkspace(){
  const operations=root.querySelector('.hub-operations');
  const home=E('button','hub-home-action','');
  home.type='button';
  home.id='hub-home-button';
  home.hidden=true;
  home.textContent='← НА ГЛАВНУЮ';
  home.onclick=()=>openSection('home');
  operations.prepend(home);

  const workarea=E('section','hub-workarea');
  workarea.id='hub-workarea';
  workarea.hidden=true;
  workarea.setAttribute('aria-label','Содержимое выбранного раздела');
  const heading=E('div','hub-work-heading');
  const breadcrumb=E('small','hub-work-code');
  breadcrumb.id='hub-work-code';
  const title=E('h2','hub-work-title');
  title.id='hub-work-title';
  title.tabIndex=-1;
  const desc=E('p','hub-work-description');
  desc.id='hub-work-description';
  heading.append(breadcrumb,title,desc);
  const content=E('div','hub-work-content');
  content.id='hub-work-content';
  workarea.append(heading,content);
  root.querySelector('.hub-main').append(workarea);

  // These existing panels retain their handlers, API requests and form state.
  content.append(root.querySelector('#hub-hangar'),root.querySelector('#hub-roster'));

  for(const [name,src,titleText] of [
    ['battle','index.html?battle=1','Тактический бой'],
    ['mechlab','mechlab.html','Конструктор мехов']]){
    const panel=E('section','hub-embedded-panel');
    panel.id='hub-'+name+'-panel';
    panel.hidden=true;
    const toolbar=E('div','hub-embed-toolbar');
    toolbar.append(E('span','','● КАНАЛ УПРАВЛЕНИЯ / ACTIVE'));
    const fullscreen=E('a','hub-fullscreen-link','↗ ОТКРЫТЬ ОТДЕЛЬНО');
    fullscreen.href=src;
    fullscreen.target='_blank';
    fullscreen.rel='noopener noreferrer';
    toolbar.append(fullscreen);
    const iframe=E('iframe','hub-embed-frame');
    iframe.id='hub-'+name+'-frame';
    iframe.title=titleText;
    iframe.setAttribute('referrerpolicy','same-origin');
    iframe.setAttribute('allow','fullscreen');
    iframe.setAttribute('loading','lazy');
    panel.append(toolbar,iframe);
    content.append(panel);
  }

  for(const [name,text] of [
    ['campaigns','Раздел кампаний находится в разработке. Здесь появятся контракты, развитие подразделения, последствия сражений и экономика наёмников.'],
    ['market','Раздел рынка находится в разработке. Здесь можно будет приобретать мехов, запчасти и вооружение, а также ремонтировать технику.']]){
    const panel=E('section','hub-coming-panel');
    panel.id='hub-'+name+'-panel';
    panel.hidden=true;
    panel.append(E('span','hub-coming-icon',name==='campaigns'?'◈':'▣'),
      E('h3','',name==='campaigns'?'ЖУРНАЛ КАМПАНИЙ':'ЛОГИСТИКА И РЫНОК'),
      E('p','',text),
      E('span','hub-coming-state','МОДУЛЬ В РАЗРАБОТКЕ'));
    content.append(panel);
  }

  const mechlabLink=operations.querySelector('a[href="mechlab.html"]');
  if(mechlabLink){
    mechlabLink.id='hub-mechlab-button';
    mechlabLink.addEventListener('click',event=>{
      event.preventDefault();
      openSection('mechlab');
    });
  }
  // Coming-soon tiles open a real information section, without advertising
  // the unimplemented market/campaign mechanics as playable features.
  [...operations.querySelectorAll('.hub-soon')].forEach((tile,i)=>{
    const name=i===0?'campaigns':'market';
    const button=E('button',tile.className);
    button.id='hub-'+name+'-button';
    button.type='button';
    button.innerHTML=tile.innerHTML;
    button.removeAttribute('aria-disabled');
    button.addEventListener('click',()=>openSection(name));
    tile.replaceWith(button);
  });

  // All links to MechLab from the hangar stay inside the central workspace.
  root.querySelector('#hub-hangar').addEventListener('click',event=>{
    const link=event.target.closest('a[href^="mechlab.html"]');
    if(!link)return;
    event.preventDefault();
    openSection('mechlab',{src:link.getAttribute('href')});
  });
}
export function openSection(section,{src}={}){
  if(!root)return;
  const frame=root.querySelector('.hub-frame');
  const active=section!=='home'&&Object.hasOwn(SECTION_INFO,section);
  frame.classList.toggle('hub-section-active',active);
  root.querySelector('#hub-home-button').hidden=!active;
  root.querySelector('.hub-intro').hidden=active;
  const workarea=root.querySelector('#hub-workarea');
  workarea.hidden=!active;
  const panels=['hangar','roster','battle','mechlab','campaigns','market','scenarios'];
  for(const name of panels) {
    const target=name==='roster'?'hub-roster':'hub-'+name+(name==='hangar'?'':'-panel');
    const panel=root.querySelector('#'+target);
    if(panel)panel.hidden=(name==='roster'?'pilots':name)!==section;
  }
  const activeButtons=['hub-battle','hub-hangar-button','hub-mechlab-button',
    'hub-pilots-button','hub-campaigns-button','hub-market-button','hub-scenarios-button'];
  const sections=['battle','hangar','mechlab','pilots','campaigns','market','scenarios'];
  for(let i=0;i<activeButtons.length;i++){
    const node=root.querySelector('#'+activeButtons[i]);
    if(!node)continue;
    const selected=active&&sections[i]===section;
    node.classList.toggle('hub-action-active',selected);
    if(selected)node.setAttribute('aria-current','page');
    else node.removeAttribute('aria-current');
  }
  if(active){
    const info=SECTION_INFO[section];
    root.querySelector('#hub-work-code').textContent=info.code;
    root.querySelector('#hub-work-title').textContent=info.title;
    root.querySelector('#hub-work-description').textContent=info.detail;
    if(section==='campaigns')void refreshOperations();
    if(section==='market')void refreshEconomy();
    if(section==='scenarios')void refreshScenarioRooms();
    if(section==='battle'||section==='mechlab'){
      const iframe=root.querySelector('#hub-'+section+'-frame');
      const address=src||(section==='battle'?'index.html?battle=1':'mechlab.html');
      if(iframe.getAttribute('src')!==address)iframe.setAttribute('src',address);
      root.querySelector('#hub-'+section+'-panel .hub-fullscreen-link').href=address;
    }
    root.querySelector('#hub-work-title').focus({preventScroll:true});
  }
  if(!active){
    // Restore the original landing grid; sections are preserved for fast return.
    root.querySelector('#hub-work-title').blur();
  }
  window.scrollTo?.({top:0,behavior:'instant'});
}
