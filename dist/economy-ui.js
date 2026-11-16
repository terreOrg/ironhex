// Server-authoritative C-Bills dashboard, supplies and repair orders.
const el=(tag,cls,text)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=String(text);
  return node;
};
const money=n=>Number(n||0).toLocaleString('ru-RU')+' C-Bills';
const messages={
  insufficient_credits:'Недостаточно C-Bills.',
  mech_undamaged:'Этот мех уже полностью исправен.',
  mech_not_found:'Мех не найден в вашем ангаре.',
  invalid_purchase:'Недопустимый заказ.',
  invalid_mech_offer:'Модель отсутствует в каталоге.',
  hangar_full:'В ангаре нет свободных мест.',
  insufficient_ammo:'Недостаточно комплектов боеприпасов на складе.',
  magazine_full:'Этот бункер уже заполнен.',
  invalid_reload:'Недопустимая команда перезарядки.',
  mech_assigned_operation:'Мех участвует в операции.',
  mech_needs_repair:'Сначала отремонтируйте повреждения.',
  prototype_not_licensed:'Учебный прототип нельзя снабжать по контракту.'
};
let root=null,refreshHangar=()=>{},busy=false,catalogPage=1,catalogTimer=null,catalogSerial=0,detailSerial=0;
async function request(path,method='GET',body){
  const res=await fetch(path,{
    method,credentials:'same-origin',cache:'no-store',
    ...(method==='GET'?{}:{
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(messages[data.error]||data.error||'HTTP '+res.status);
  return data;
}
function notice(value){
  const msg=root?.querySelector('#economy-message');
  if(msg)msg.textContent=value;
}
async function mutate(path,body){
  if(busy)return;
  busy=true;
  root.querySelectorAll('#hub-market-panel button').forEach(b=>b.disabled=true);
  try{
    const {item}=await request(path,'POST',body);
    busy=false;
    await refreshEconomy();
    await refreshHangar();
    notice(path.endsWith('/reload')?
      'Боезапас '+item.weapon+' пополнен до '+item.rounds+' выстрелов.':
      body.offerId?
      'Мех приобретён. Списано '+money(item.spent)+'. Откройте его в ангаре.':
      path.endsWith('/purchase')?
        'Заказ выполнен. Куплено единиц: '+body.quantity+'.':
        'Ремонт завершён. Списано '+money(item.spent)+'.');
  }catch(e){notice('Ошибка: '+e.message);}
  finally{busy=false;root.querySelectorAll('#hub-market-panel button').forEach(b=>b.disabled=false);}
}
export function installEconomyUI(hubRoot,onHangarRefresh){
  root=hubRoot;refreshHangar=onHangarRefresh;
  const section=root.querySelector('#hub-market-panel');
  section.classList.remove('hub-coming-panel');
  section.classList.add('op-panel','economy-panel');
  section.replaceChildren();
  const heading=el('div','op-intro');
  heading.append(el('small','op-kicker','MERCENARY LOGISTICS / SUPPLY TERMINAL'),
    el('h3','','ФИНАНСЫ И СНАБЖЕНИЕ'),
    el('p','','Доход начисляется сервером после завершения операции. Заказы и ремонт оплачиваются из средств командира.'));
  const balance=el('div','economy-wallet');
  balance.id='economy-wallet';
  const filter=el('input','economy-filter');
  filter.id='economy-filter';
  filter.type='search';
  filter.placeholder='Найти меха или модификацию…';
  filter.setAttribute('aria-label','Поиск меха на рынке');
  filter.addEventListener('input',()=>{
    requestCatalogRefresh(true);
  });
  const onlyAvailable=el('label','economy-toggle');
  const availableBox=el('input','');availableBox.type='checkbox';availableBox.id='economy-available-only';
  availableBox.onchange=()=>requestCatalogRefresh();
  onlyAvailable.append(availableBox,el('span','','Только доступные для покупки'));
  const filters=el('div','economy-filter-grid');filters.id='economy-filter-grid';
  function selectFilter(id,label,options){
    const field=el('label','economy-filter-field');
    const title=el('span','',label);
    const select=el('select','');select.id=id;
    for(const [value,caption] of options){
      const option=el('option','',caption);
      option.value=value;select.append(option);
    }
    select.onchange=()=>requestCatalogRefresh();
    field.append(title,select);filters.append(field);
    return select;
  }
  function numericFilter(id,label,placeholder){
    const field=el('label','economy-filter-field');
    const input=el('input','');input.id=id;input.type='number';
    input.min='0';input.step='1';input.placeholder=placeholder;
    input.oninput=()=>requestCatalogRefresh(true);
    field.append(el('span','',label),input);filters.append(field);
    return input;
  }
  selectFilter('economy-weight-class','Весовой класс',[
    ['','Все классы'],['light','Лёгкие (20–35 т)'],
    ['medium','Средние (40–55 т)'],['heavy','Тяжёлые (60–75 т)'],
    ['assault','Штурмовые (80–100 т)']
  ]);
  const massOptions=[['','Любой тоннаж']];
  for(let n=20;n<=100;n+=5)massOptions.push([String(n),String(n)+' т']);
  selectFilter('economy-tonnage-min','Масса от',massOptions);
  selectFilter('economy-tonnage-max','Масса до',massOptions);
  numericFilter('economy-era-min','Год выпуска от','Напр. 3025');
  numericFilter('economy-era-max','Год выпуска до','Напр. 3050');
  numericFilter('economy-max-price','Цена до, C-Bills','Максимальная цена');
  const roleField=el('label','economy-filter-field');
  const roleInput=el('input','');roleInput.id='economy-role';roleInput.type='search';
  roleInput.placeholder='Например, Striker';
  roleInput.oninput=()=>requestCatalogRefresh(true);
  roleField.append(el('span','','Роль'),roleInput);filters.append(roleField);
  const weaponField=el('label','economy-filter-field');
  const weaponInput=el('input','');weaponInput.id='economy-weapon';weaponInput.type='search';
  weaponInput.placeholder='Например, PPC';
  weaponInput.oninput=()=>requestCatalogRefresh(true);
  weaponField.append(el('span','','Оружие'),weaponInput);filters.append(weaponField);
  selectFilter('economy-sort','Сортировка',[
    ['name','По названию'],['tonnage','По тоннажу'],
    ['year','По году'],['price','По цене']
  ]);
  const reset=el('button','op-secondary economy-reset','СБРОСИТЬ ФИЛЬТРЫ');
  reset.id='economy-reset-filters';reset.type='button';
  reset.onclick=()=>{
    filter.value='';availableBox.checked=false;
    filters.querySelectorAll('input').forEach(x=>x.value='');
    filters.querySelectorAll('select').forEach(x=>x.selectedIndex=0);
    requestCatalogRefresh();
  };
  const filterHint=el('p','economy-filter-hint',
    'Фильтры тоннажа, года, цены, роли и оружия применяются к моделям с загруженными характеристиками. '+
    'Для остальных архивных записей эти значения пока неизвестны.');
  const detail=el('dialog','economy-detail-dialog');detail.id='economy-detail-dialog';
  detail.setAttribute('aria-label','Характеристики боевого меха');
  detail.addEventListener('click',event=>{
    if(event.target===detail)detail.close();
  });
  detail.addEventListener('close',()=>{detailSerial++;});
  document.querySelector('#economy-detail-dialog')?.remove();
  document.body.append(detail);
  const archiveSummary=el('p','op-message');archiveSummary.id='economy-archive-summary';
  const archive=el('div','economy-mechs');archive.id='economy-archive';
  const pager=el('div','economy-pager');pager.id='economy-pager';
  const mechs=el('div','economy-mechs');mechs.id='economy-mechs';
  const supplies=el('div','economy-supplies');supplies.id='economy-supplies';
  const inventory=el('div','economy-inventory');inventory.id='economy-inventory';
  const magazines=el('div','economy-magazines');magazines.id='economy-magazines';
  const repairs=el('div','economy-repairs');repairs.id='economy-repairs';
  const ledger=el('div','economy-ledger');ledger.id='economy-ledger';
  const status=el('p','op-message');status.id='economy-message';
  status.setAttribute('role','status');
  section.append(heading,balance,el('h3','economy-heading','ДИЛЕР БОЕВЫХ МЕХОВ'),
    el('p','op-warning','Каталог: MegaMek Data, CC BY-NC-SA 4.0. Цены установлены для баланса IronHex, не являются официальными.'),
    el('h4','economy-heading','ГОТОВЫЕ К ПОКУПКЕ'),mechs,
    el('h4','economy-heading','ПОЛНЫЙ КАТАЛОГ MEGAMEK'),filter,onlyAvailable,
    filters,reset,filterHint,archiveSummary,archive,pager,
    el('h3','economy-heading','ВООРУЖЕНИЕ, СИСТЕМЫ, БОЕПРИПАСЫ И РЕМОНТ'),supplies,
    el('h3','economy-heading','ОРУЖЕЙНЫЙ СКЛАД'),inventory,
    el('h3','economy-heading','БОЕПРИПАСЫ И ПЕРЕЗАРЯДКА'),magazines,
    el('h3','economy-heading','РЕМОНТ АНГАРА'),repairs,
    el('h3','economy-heading','ЖУРНАЛ РАСЧЁТОВ'),ledger,status);
  const button=root.querySelector('#hub-market-button');
  button?.classList.remove('hub-soon');
  if(button){
    const title=button.querySelector('strong');
    const label=button.querySelector('small');
    if(title)title.textContent='РЫНОК И РЕМОНТ';
    if(label)label.textContent='C-Bills · снабжение · обслуживание';
  }
}
export async function refreshEconomy(){
  if(!root||busy)return;
  notice('Подключение к службе снабжения…');
  try{
    const data=await request('/api/v1/economy');
    const balance=root.querySelector('#economy-wallet');
    balance.replaceChildren(
      el('small','','СЧЁТ КОМАНДИРА'),
      el('strong','',money(data.balance)),
      el('span','','Начальный капитал: 150 000 C-Bills'));
    const offers=root.querySelector('#economy-mechs');
    offers.replaceChildren();
    for(const offer of data.mechOffers||[]){
      const card=el('article','economy-item economy-mech-offer');
      card.dataset.search=(offer.name+' '+offer.description).toLocaleLowerCase();
      card.dataset.tonnage=String(offer.tonnage??'');
      card.dataset.era=String(offer.era??'');
      card.dataset.price=String(offer.price??'');
      card.dataset.role=String(offer.role||'').toLowerCase();
      card.dataset.weapon=(offer.weapons||[]).join(' ').toLowerCase();
      const content=el('div','');
      const title=el('button','economy-name',offer.name);
      title.type='button';
      title.onclick=()=>void openMechDetails(offer.sourcePath);
      content.append(title,el('small','',offer.description),
        el('small','',offer.era?'Год модели: '+offer.era+' · '+(offer.role||'BattleMech'):'BattleMech'),
        el('small','','Цена со склада дилера: '+money(offer.price)));
      if(offer.sourceUrl){
        const link=el('a','economy-source-link','Данные: MegaMek (CC BY-NC-SA 4.0)');
        link.href=offer.sourceUrl;
        link.target='_blank';
        link.rel='noopener noreferrer';
        content.append(link);
      }
      const buy=el('button','op-primary','ПРИОБРЕСТИ МЕХА');
      buy.type='button';
      buy.onclick=()=>{
        if(confirm('Купить '+offer.name+' за '+money(offer.price)+'?'))
          void mutate('/api/v1/economy/mechs/purchase',{offerId:offer.id});
      };
      card.append(content,buy);
      card.hidden=!featuredMatches(card);
      offers.append(card);
    }
    if(!data.mechOffers?.length)offers.append(el('p','op-empty','Нет доступных предложений.'));
    const stored=root.querySelector('#economy-inventory');
    stored.replaceChildren();
    const weapons=Object.entries(data.equipmentStock||{}).filter(([,qty])=>qty>0);
    for(const [name,qty] of weapons){
      const line=el('div','economy-entry');
      line.append(el('span','',name),el('strong','',qty+' ед.'));
      stored.append(line);
    }
    if(!weapons.length)stored.append(el('p','op-empty','Склад пуст. Приобретите оружие для переоборудования в MechLab.'));
    const stock=root.querySelector('#economy-supplies');
    stock.replaceChildren();
    for(const entry of data.catalog||[]){
      const card=el('div','economy-item');
      const text=el('div','');
      text.append(el('strong','',entry.name),
        el('small','','Цена: '+money(entry.price)+' · На складе: '+
          (entry.kind==='weapon'?(data.equipmentStock?.[entry.name]||0):
            ['ammo','system'].includes(entry.kind)?(data.equipmentStock?.[entry.sku]||0):
            (data.stock?.[entry.sku]||0))));
      const buy=el('button','op-primary','КУПИТЬ');
      buy.type='button';
      buy.onclick=()=>{
        if(confirm('Приобрести '+entry.name+' за '+money(entry.price)+'?'))
          void mutate('/api/v1/economy/purchase',{sku:entry.sku,quantity:1});
      };
      card.append(text,buy);stock.append(card);
    }
    const magazines=root.querySelector('#economy-magazines');
    magazines.replaceChildren();
    for(const bin of data.magazines||[]){
      const card=el('div','economy-item');
      const details=el('div','');
      const stockQty=data.equipmentStock?.[bin.reloadSku]||0;
      details.append(el('strong','',bin.chassis+' · '+bin.weapon),
        el('small','','Бункер '+bin.location+' / слот '+bin.slot+
          ' · '+bin.rounds+' / '+bin.capacity+' выстрелов'+
          ' · комплектов на складе: '+stockQty));
      card.append(details);
      if(bin.rounds<bin.capacity){
        const reload=el('button','op-primary','ПЕРЕЗАРЯДИТЬ');
        reload.type='button';
        reload.disabled=!!bin.damaged||!bin.licensed||stockQty<1;
        reload.title=bin.damaged?'Сначала отремонтируйте меха':
          !bin.licensed?'Перезарядка доступна только боевым мехам':
          stockQty<1?'Купите комплект '+bin.weapon:'Пополнить бункер до полного';
        reload.onclick=()=>{
          if(confirm('Израсходовать 1 комплект '+bin.weapon+' со склада?'))
            void mutate('/api/v1/economy/reload',
              {mechId:bin.mechId,location:bin.location,slot:bin.slot});
        };
        card.append(reload);
      }
      magazines.append(card);
    }
    if(!data.magazines?.length)magazines.append(el('p','op-empty',
      'В ангаре нет мехов с баллистическими или ракетными бункерами.'));
    const repairs=root.querySelector('#economy-repairs');
    repairs.replaceChildren();
    for(const item of data.repairs||[]){
      const card=el('div','economy-item');
      const details=el('div','');
      details.append(el('strong','',item.chassis),
        el('small','',item.needsRepair?
          'Броня −'+item.armorDamage+' · Конструкция −'+item.structureDamage+
          (item.wrecked?' · НЕИСПРАВЕН':'')+
          ' · Полный ремонт: '+money(item.creditCost):
          'Полностью исправен'));
      card.append(details);
      if(item.needsRepair){
        const fix=el('button','op-primary','ПОЧИНИТЬ');
        fix.onclick=()=>{
          if(confirm('Полный ремонт '+item.chassis+' за '+money(item.creditCost)+
            ' (с применением имеющихся комплектов)?'))
            void mutate('/api/v1/economy/repair',{mechId:item.mechId});
        };
        card.append(fix);
      }
      repairs.append(card);
    }
    if(!data.repairs?.length)repairs.append(el('p','op-empty','В ангаре нет мехов.'));
    const log=root.querySelector('#economy-ledger');
    log.replaceChildren();
    for(const entry of data.ledger||[]){
      const line=el('div','economy-entry');
      line.append(el('span','',entry.reason),
        el('strong',entry.amount>0?'economy-plus':'economy-minus',
          (entry.amount>0?'+':'')+money(entry.amount)));
      log.append(line);
    }
    notice('Данные подтверждены сервером.');
    void refreshMtfCatalog();
  }catch(e){notice('Служба снабжения недоступна: '+e.message);}
}

async function refreshMtfCatalog(){
  if(!root)return;
  const serial=++catalogSerial;
  const query=root.querySelector('#economy-filter').value.trim();
  const available=root.querySelector('#economy-available-only').checked;
  const controls=readMarketFilters();
  const summary=root.querySelector('#economy-archive-summary');
  const archive=root.querySelector('#economy-archive');
  const pager=root.querySelector('#economy-pager');
  summary.textContent='Поиск по полному каталогу…';
  try{
    const queryString=new URLSearchParams({query,page:String(catalogPage),
      available:available?'1':'0',...controls});
    const data=await request('/api/v1/economy/mechs?'+queryString.toString());
    if(serial!==catalogSerial)return;
    summary.textContent='В каталоге '+data.total.toLocaleString('ru-RU')+
      ' вариантов · поддерживаются движком '+data.available+
      ' · найдено '+data.matches.toLocaleString('ru-RU');
    archive.replaceChildren();
    for(const item of data.items||[]){
      const card=el('article','economy-item economy-mech-offer');
      const content=el('div','');
      const title=el('button','economy-name',item.name);
      title.type='button';
      title.onclick=()=>void openMechDetails(item.sourcePath);
      content.append(title);
      if(item.available){
        content.append(el('small','',item.description||''),
          el('small','',money(item.price)));
      }else{
        content.append(el('small','',
          'Справочная запись. Эта модификация ещё не поддерживается боевым движком IronHex.'));
      }
      if(item.sourceUrl){
        const link=el('a','economy-source-link','Исходная модель · MegaMek Data');
        link.href=item.sourceUrl;
        link.rel='noopener noreferrer';
        link.target='_blank';
        content.append(link);
      }
      card.append(content);
      if(item.available){
        const buy=el('button','op-primary','КУПИТЬ МЕХА');
        buy.onclick=()=>{
          if(confirm('Приобрести '+item.name+' за '+money(item.price)+'?'))
            void mutate('/api/v1/economy/mechs/purchase',{offerId:item.offerId});
        };
        card.append(buy);
      }
      archive.append(card);
    }
    if(!data.items?.length)archive.append(el('p','op-empty','Ничего не найдено.'));
    pager.replaceChildren();
    const prev=el('button','op-secondary','НАЗАД');
    prev.disabled=data.page<=1;
    prev.onclick=()=>{catalogPage--;void refreshMtfCatalog();};
    const label=el('span','','Страница '+data.page+' из '+Math.max(1,data.pages));
    const next=el('button','op-secondary','ДАЛЕЕ');
    next.disabled=data.page>=data.pages;
    next.onclick=()=>{catalogPage++;void refreshMtfCatalog();};
    pager.append(prev,label,next);
  }catch(e){if(serial===catalogSerial)summary.textContent='Ошибка каталога: '+e.message;}
}

function requestCatalogRefresh(debounce=false){
  catalogPage=1;
  clearTimeout(catalogTimer);
  root?.querySelectorAll('#economy-mechs .economy-mech-offer').forEach(card=>{
    card.hidden=!featuredMatches(card);
  });
  if(debounce)catalogTimer=setTimeout(()=>void refreshMtfCatalog(),240);
  else void refreshMtfCatalog();
}
function readMarketFilters(){
  const value=id=>root?.querySelector(id)?.value?.trim()||'';
  return {
    weightClass:value('#economy-weight-class'),
    tonnageMin:value('#economy-tonnage-min'),
    tonnageMax:value('#economy-tonnage-max'),
    eraMin:value('#economy-era-min'),
    eraMax:value('#economy-era-max'),
    priceMax:value('#economy-max-price'),
    role:value('#economy-role'),
    weapon:value('#economy-weapon'),
    sort:value('#economy-sort')||'name'
  };
}
function featuredMatches(card){
  const f=readMarketFilters();
  const text=root?.querySelector('#economy-filter')?.value?.trim().toLowerCase()||'';
  const mass=Number(card.dataset.tonnage);
  const year=Number(card.dataset.era);
  const price=Number(card.dataset.price);
  const klass=mass<=35?'light':mass<=55?'medium':mass<=75?'heavy':'assault';
  return card.dataset.search.includes(text)&&
    (!f.weightClass||klass===f.weightClass)&&
    (!f.tonnageMin||mass>=Number(f.tonnageMin))&&
    (!f.tonnageMax||mass<=Number(f.tonnageMax))&&
    (!f.eraMin||(year&&year>=Number(f.eraMin)))&&
    (!f.eraMax||(year&&year<=Number(f.eraMax)))&&
    (!f.priceMax||price<=Number(f.priceMax))&&
    (!f.role||card.dataset.role.includes(f.role.toLowerCase()))&&
    (!f.weapon||card.dataset.weapon.includes(f.weapon.toLowerCase()));
}
function detailStat(label,value){
  const row=el('div','economy-detail-stat');
  row.append(el('span','',label),el('strong','',value===null||value===undefined?'—':value));
  return row;
}
function detailSection(parent,title){
  const section=el('section','economy-detail-section');
  section.append(el('h3','',title));parent.append(section);
  return section;
}
function detailTable(parent,headings,rows){
  const scroll=el('div','economy-table-scroll');
  const table=el('table','economy-detail-table');
  const header=el('thead','');
  const tr=el('tr','');
  for(const heading of headings)tr.append(el('th','',heading));
  header.append(tr);table.append(header);
  const body=el('tbody','');
  for(const values of rows){
    const line=el('tr','');
    for(const value of values)line.append(el('td','',value??'—'));
    body.append(line);
  }
  table.append(body);scroll.append(table);parent.append(scroll);
}
async function openMechDetails(path){
  const modal=document.querySelector('#economy-detail-dialog');
  if(!modal)return;
  const serial=++detailSerial;
  const container=el('div','economy-detail-content');
  const dismiss=el('button','economy-detail-close','ЗАКРЫТЬ ×');
  dismiss.type='button';dismiss.onclick=()=>modal.close();
  container.append(dismiss,el('h2','','Загрузка характеристик…'));
  modal.replaceChildren(container);
  if(!modal.open)modal.showModal();
  if(!path){
    container.append(el('p','op-warning','У этой записи не указан путь к источнику.'));
    return;
  }
  try{
    const {item}=await request('/api/v1/economy/mechs/detail?'+new URLSearchParams({path}));
    if(serial!==detailSerial)return;
    container.replaceChildren(dismiss,el('small','op-kicker','IRON HEX / MEGAMEK UNIT DOSSIER'),
      el('h2','',item.name));
    container.append(el('p','economy-detail-license',
      'Источник: MegaMek Data · '+item.sourceLicense+
      (item.available?' · Поддерживается движком':' · Архивная запись')));
    const stats=el('div','economy-detail-stats');
    stats.append(detailStat('Весовой класс',({
      light:'Лёгкий',medium:'Средний',heavy:'Тяжёлый',assault:'Штурмовой'
    })[item.weightClass]||'Не указан'));
    if(item.tonnage!==undefined)stats.append(detailStat('Масса',item.tonnage+' т'));
    if(item.era)stats.append(detailStat('Год модели',item.era));
    if(item.role)stats.append(detailStat('Роль',item.role));
    if(item.available){
      stats.append(detailStat('Цена IronHex',money(item.price)),
        detailStat('Технология',item.techBase),
        detailStat('Двигатель',item.engineRating+' Fusion'),
        detailStat('Ходьба / бег / прыжок',
          item.movement.walk+' / '+item.movement.run+' / '+item.movement.jump+' MP'),
        detailStat('Теплоотводы',item.heatSinks),
        detailStat('Свободная масса',item.remainingTonnage.toFixed(1)+' т'));
    }
    container.append(stats);
    if(item.available){
      const armor=detailSection(container,'БРОНЯ И ВНУТРЕННЯЯ СТРУКТУРА');
      detailTable(armor,['Секция','Передняя броня','Задняя броня','Структура'],
        item.armor.map(a=>[a.location,a.front,a.rear,a.structure]));
      const guns=detailSection(container,'ВООРУЖЕНИЕ И ДАЛЬНОСТЬ');
      detailTable(guns,['Система','Расположение','Урон','Нагрев','Мин.','Короткая / средняя / дальняя','Выстрелы'],
        item.weapons.map(w=>[w.name,(w.locations||[w.location]).join(' / ')+(w.rear?' (назад)':''),
          w.damage,w.heat,w.minimum,w.range.join(' / '),w.ammo===null?'без боезапаса':w.ammo]));
      const supplies=detailSection(container,'ОБОРУДОВАНИЕ И БОЕЗАПАС');
      detailTable(supplies,['Тип','Секция','Слот','Примечание'],
        item.equipment.map(e=>[e.type,e.location,e.slot,e.type==='ammo'?
          (e.weapon||'')+' · '+(e.mass??1)+' т':(e.rear?'Направлено назад':'')]));
      const slots=detailSection(container,'КРИТИЧЕСКИЕ СЛОТЫ');
      const details=el('details','economy-critical');
      details.append(el('summary','','Показать все слоты по секциям'));
      for(const [loc,values] of Object.entries(item.criticalSlots||{}))
        details.append(el('p','',loc+' · '+values.map((v,i)=>String(i+1)+': '+(v||'свободно')).join(' | ')));
      slots.append(details);
    }else{
      container.append(el('p','op-warning',item.note||
        'Полная карточка этой модификации пока не импортирована.'));
    }
    if(item.sourceUrl){
      const link=el('a','economy-source-link','ОТКРЫТЬ ИСХОДНЫЙ MTF · MEGAMEK');
      link.href=item.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';
      container.append(link);
    }
  }catch(error){
    if(serial===detailSerial)container.replaceChildren(dismiss,
      el('h2','','Ошибка загрузки характеристик'),
      el('p','op-warning',error.message));
  }
}
