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
  hangar_full:'В ангаре нет свободных мест.'
};
let root=null,refreshHangar=()=>{},busy=false,catalogPage=1,catalogTimer=null,catalogSerial=0;
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
    notice(body.offerId?
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
    catalogPage=1;
    clearTimeout(catalogTimer);
    catalogTimer=setTimeout(()=>void refreshMtfCatalog(),230);
    const query=filter.value.trim().toLocaleLowerCase();
    root.querySelectorAll('#economy-mechs .economy-mech-offer').forEach(card=>{
      card.hidden=!card.dataset.search.includes(query);
    });
  });
  const onlyAvailable=el('label','economy-toggle');
  const availableBox=el('input','');availableBox.type='checkbox';availableBox.id='economy-available-only';
  availableBox.onchange=()=>{catalogPage=1;void refreshMtfCatalog();};
  onlyAvailable.append(availableBox,el('span','','Только доступные для покупки'));
  const archiveSummary=el('p','op-message');archiveSummary.id='economy-archive-summary';
  const archive=el('div','economy-mechs');archive.id='economy-archive';
  const pager=el('div','economy-pager');pager.id='economy-pager';
  const mechs=el('div','economy-mechs');mechs.id='economy-mechs';
  const supplies=el('div','economy-supplies');supplies.id='economy-supplies';
  const inventory=el('div','economy-inventory');inventory.id='economy-inventory';
  const repairs=el('div','economy-repairs');repairs.id='economy-repairs';
  const ledger=el('div','economy-ledger');ledger.id='economy-ledger';
  const status=el('p','op-message');status.id='economy-message';
  status.setAttribute('role','status');
  section.append(heading,balance,el('h3','economy-heading','ДИЛЕР БОЕВЫХ МЕХОВ'),
    el('p','op-warning','Каталог: MegaMek Data, CC BY-NC-SA 4.0. Цены установлены для баланса IronHex, не являются официальными.'),
    el('h4','economy-heading','ГОТОВЫЕ К ПОКУПКЕ'),mechs,
    el('h4','economy-heading','ПОЛНЫЙ КАТАЛОГ MEGAMEK'),filter,onlyAvailable,
    archiveSummary,archive,pager,
    el('h3','economy-heading','ВООРУЖЕНИЕ И РЕМОНТНЫЕ КОМПЛЕКТЫ'),supplies,
    el('h3','economy-heading','ОРУЖЕЙНЫЙ СКЛАД'),inventory,
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
      const content=el('div','');
      content.append(el('strong','',offer.name),
        el('small','',offer.description),
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
      card.hidden=!card.dataset.search.includes(root.querySelector('#economy-filter').value.trim().toLocaleLowerCase());
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
            (data.stock?.[entry.sku]||0))));
      const buy=el('button','op-primary','КУПИТЬ');
      buy.type='button';
      buy.onclick=()=>{
        if(confirm('Приобрести '+entry.name+' за '+money(entry.price)+'?'))
          void mutate('/api/v1/economy/purchase',{sku:entry.sku,quantity:1});
      };
      card.append(text,buy);stock.append(card);
    }
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
  const summary=root.querySelector('#economy-archive-summary');
  const archive=root.querySelector('#economy-archive');
  const pager=root.querySelector('#economy-pager');
  summary.textContent='Поиск по полному каталогу…';
  try{
    const queryString=new URLSearchParams({query,page:String(catalogPage),
      available:available?'1':'0'});
    const data=await request('/api/v1/economy/mechs?'+queryString.toString());
    if(serial!==catalogSerial)return;
    summary.textContent='В каталоге '+data.total.toLocaleString('ru-RU')+
      ' вариантов · поддерживаются движком '+data.available+
      ' · найдено '+data.matches.toLocaleString('ru-RU');
    archive.replaceChildren();
    for(const item of data.items||[]){
      const card=el('article','economy-item economy-mech-offer');
      const content=el('div','');
      content.append(el('strong','',item.name));
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
