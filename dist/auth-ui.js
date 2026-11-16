// The commander login console is separate from the tactical battle engine.
const endpoint = '/api/v1/auth/';
const gameModule = document.querySelector('#viewport') ? './app.js' : './mechlab.js';
document.body.classList.add('auth-locked');
const entry = document.createElement('button');
entry.type = 'button';
entry.id = 'auth-trigger';
entry.className = 'auth-entry';
entry.textContent = '⬡ ВХОД';
entry.setAttribute('aria-haspopup', 'dialog');
entry.setAttribute('aria-label', 'Открыть кабинет командира');
const nav = document.querySelector('body > header nav');
if (nav) nav.prepend(entry);
else {
  entry.classList.add('auth-entry--floating');
  document.body.append(entry);
}
const dialog = document.createElement('dialog');
dialog.id = 'auth-dialog';
dialog.className = 'auth-dialog';
dialog.setAttribute('aria-label', 'Кабинет командира');
dialog.innerHTML = "<div class=\"auth-head\">\n    <div><small>IRON HEX / COMMAND CONSOLE</small><h2>ЛИЧНОЕ ДЕЛО</h2></div>\n    <button type=\"button\" id=\"auth-close\" aria-label=\"Закрыть\">×</button>\n  </div>\n  <section id=\"auth-guest\">\n    <div class=\"auth-tabs\" role=\"tablist\" aria-label=\"Вход или регистрация\">\n      <button id=\"auth-tab-login\" type=\"button\" role=\"tab\" aria-selected=\"true\">ВХОД</button>\n      <button id=\"auth-tab-register\" type=\"button\" role=\"tab\" aria-selected=\"false\">РЕГИСТРАЦИЯ</button>\n    </div>\n    <form id=\"auth-login\" class=\"auth-form\">\n      <label>Позывной или e-mail\n        <input name=\"identity\" autocomplete=\"username\" required maxlength=\"254\" placeholder=\"Например, MechWarrior42\">\n      </label>\n      <label>Пароль\n        <input name=\"password\" type=\"password\" autocomplete=\"current-password\" required>\n      </label>\n      <button type=\"submit\" class=\"auth-primary\">ВОЙТИ В СИСТЕМУ</button>\n    </form>\n    <form id=\"auth-register\" class=\"auth-form\" hidden>\n      <label>Позывной (3–24 символа: латиница, цифры, _ и -)\n        <input name=\"handle\" autocomplete=\"username\" minlength=\"3\" maxlength=\"24\" pattern=\"[a-zA-Z0-9_-]{3,24}\" required>\n      </label>\n      <label>E-mail\n        <input name=\"email\" type=\"email\" autocomplete=\"email\" maxlength=\"254\" required>\n      </label>\n      <label>Пароль (не менее 12 символов)\n        <input name=\"password\" type=\"password\" autocomplete=\"new-password\" minlength=\"12\" maxlength=\"128\" required>\n      </label>\n      <label>Повторите пароль\n        <input name=\"confirm\" type=\"password\" autocomplete=\"new-password\" minlength=\"12\" required>\n      </label>\n      <button type=\"submit\" class=\"auth-primary\">СОЗДАТЬ КОМАНДИРА</button>\n    </form>\n    <p class=\"auth-note\">Пароль хранится на сервере в виде защищённого хеша.\n      Восстановление через почту пока не реализовано.</p>\n  </section>\n  <section id=\"auth-profile\" hidden>\n    <div class=\"auth-id\"><small>КОМАНДИР ЗАРЕГИСТРИРОВАН</small>\n      <h3 id=\"auth-handle\"></h3><p id=\"auth-email\"></p></div>\n    <div class=\"auth-readout\">\n      <span>ЛИЧНЫЙ АНГАР</span><strong id=\"auth-hangar\">ЗАГРУЗКА…</strong>\n    </div>\n    <p class=\"auth-note\">Аккаунт сохраняется на сервере. Сохранение боевых\n      конструкций и кампаний в ангар добавим следующим этапом.</p>\n    <button id=\"auth-logout\" type=\"button\">ВЫЙТИ ИЗ АККАУНТА</button>\n  </section>\n  <p id=\"auth-feedback\" class=\"auth-feedback\" role=\"status\" aria-live=\"polite\"></p>";
document.body.append(dialog);

const accountPanel = document.createElement('section');
accountPanel.id = 'account-flow';
accountPanel.innerHTML = '<form id="auth-forgot" class="auth-form" hidden>' +
  '<h3>ВОССТАНОВЛЕНИЕ ДОСТУПА</h3><p>Отправим ссылку для установки нового пароля.</p>' +
  '<label>E-mail<input name="email" type="email" autocomplete="email" required maxlength="254"></label>' +
  '<button type="submit" class="auth-primary">ОТПРАВИТЬ ССЫЛКУ</button>' +
  '<button id="auth-back" type="button">К ВХОДУ</button></form>' +
  '<form id="auth-new-password" class="auth-form" hidden>' +
  '<h3>НОВЫЙ ПАРОЛЬ</h3>' +
  '<label>Новый пароль<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>' +
  '<label>Повторите пароль<input name="confirm" type="password" autocomplete="new-password" minlength="12" required></label>' +
  '<button type="submit" class="auth-primary">СМЕНИТЬ ПАРОЛЬ</button></form>' +
  '<div id="auth-verify-pending" hidden><h3>ПОДТВЕРДИТЕ ПОЧТУ</h3>' +
  '<p>Для доступа к игре подтвердите адрес, указанный при регистрации. ' +
  'Ссылка действует 24 часа.</p>' +
  '<button type="button" id="auth-resend">ОТПРАВИТЬ ПИСЬМО ЕЩЁ РАЗ</button>' +
  '<button type="button" id="auth-pending-logout">ВЫЙТИ</button></div>';
dialog.insertBefore(accountPanel,dialog.querySelector('#auth-feedback'));
const forgotLink=document.createElement('button');
forgotLink.id='auth-forgot-link';
forgotLink.type='button';
forgotLink.textContent='Забыли пароль?';
qFirst('#auth-login').append(forgotLink);
function qFirst(selector){return dialog.querySelector(selector);}
let resetToken=null;

const emailState=document.createElement('p');
emailState.id='auth-email-state';
emailState.className='auth-note';
qFirst('#auth-profile').append(emailState);
const verifyProfileButton=document.createElement('button');
verifyProfileButton.type='button';
verifyProfileButton.id='auth-profile-verify';
verifyProfileButton.textContent='ПОДТВЕРДИТЬ E-MAIL';
qFirst('#auth-profile').append(verifyProfileButton);

function toggleFlow(flow) {
  for(const id of ['auth-guest','auth-profile','auth-forgot','auth-new-password','auth-verify-pending']) {
    qFirst('#'+id).hidden=true;
  }
  if (flow==='login') {
    qFirst('#auth-guest').hidden=false;
    tab('login');
  } else if (flow==='register') {
    qFirst('#auth-guest').hidden=false;
    tab('register');
  } else qFirst('#'+flow).hidden=false;
  feedback();
}

const hero = document.createElement('div');
hero.id = 'auth-hero';
hero.className = 'auth-hero';
hero.innerHTML = '<div class="auth-hero-brand"><span>⬡</span> IRON<span>HEX</span></div>' +
  '<p class="auth-hero-caption">BATTLETECH · COMMANDER ACCESS TERMINAL</p>' +
  '<div class="auth-hero-graphic" aria-hidden="true">⬡</div>' +
  '<h1>ВАШЕ ЗВЕЗДНОЕ<br>КОМАНДОВАНИЕ</h1>' +
  '<p>Создайте командира или войдите, чтобы открыть тактический симулятор, ангар и конструктор мехов.</p>' +
  '<div class="auth-hero-footer"><span>◉ ЗАЩИЩЁННЫЙ ДОСТУП</span><span>COMSTAR / UPLINK READY</span></div>';
dialog.prepend(hero);

const q = selector => dialog.querySelector(selector);
const errors = {
  invalid_handle:'Позывной должен содержать 3–24 символа: латиницу, цифры, _ или -.',
  invalid_email:'Введите корректный e-mail.',
  invalid_token:'Ссылка недействительна или срок действия истёк.',
  mail_unavailable:'Отправка писем ещё не настроена. Обратитесь к администратору.',
  weak_password:'Пароль должен содержать от 12 до 128 символов.',
  invalid_credentials:'Неверный позывной, e-mail или пароль.',
  account_exists:'Позывной или адрес электронной почты уже занят.',
  rate_limited:'Слишком много попыток. Повторите позже.',
  invalid_origin:'Проверьте адрес игры. Для авторизации используйте локальный сервер.',
  auth_unavailable:'Сервис аккаунтов сейчас недоступен.',
  internal_error:'Ошибка сервера. Попробуйте позже.'
};
let user = null;
let available = true;
let pending = false;
let started = false;

function showLoginGate() {
  document.body.classList.add('auth-locked');
  dialog.classList.add('auth-dialog--gate');
  q('#auth-close').hidden = true;
  q('#auth-guest').hidden = false;
  q('#auth-profile').hidden = true;
  if (!dialog.open) dialog.showModal();
}

async function enterGame() {
  if (!user) return;
  if (user.emailVerificationRequired && !user.emailVerified) {
    showLoginGate();
    toggleFlow('auth-verify-pending');
    feedback('Проверьте электронную почту.',false);
    return;
  }
  document.body.classList.remove('auth-locked');
  dialog.classList.remove('auth-dialog--gate');
  q('#auth-close').hidden = false;
  if (dialog.open) dialog.close();
  const battlefield = !!document.querySelector('#viewport');
  const directBattle = new URL(location.href).searchParams.get('custom') === '1';
  if (battlefield && !directBattle && !started) {
    const {openHub} = await import('./hub.js');
    openHub({
      user,
      onBattle: async () => {
        if (started) return;
        started = true;
        document.body.classList.remove('hub-open');
        await import('./app.js');
      },
      onProfile: () => { if (!dialog.open) dialog.showModal(); }
    });
    return;
  }
  if (!started) {
    started = true;
    await import(gameModule);
  }
}

function feedback(message='',error=false) {
  q('#auth-feedback').textContent = message;
  q('#auth-feedback').classList.toggle('auth-error',error);
}

function tab(mode) {
  q('#auth-login').hidden = mode !== 'login';
  q('#auth-register').hidden = mode !== 'register';
  q('#auth-tab-login').setAttribute('aria-selected',String(mode==='login'));
  q('#auth-tab-register').setAttribute('aria-selected',String(mode==='register'));
  feedback();
}

function display() {
  entry.textContent = user ? '⬡ ' + user.handle.toUpperCase() : '⬡ ВХОД';
  const pending = !!user?.emailVerificationRequired && !user?.emailVerified;
  q('#auth-guest').hidden = !!user;
  q('#auth-profile').hidden = !user || pending;
  q('#auth-verify-pending').hidden = !pending;
  if (user) {
    q('#auth-handle').textContent = user.handle;
    q('#auth-email').textContent = user.email;
    q('#auth-email-state').textContent = user.emailVerified ? 'Почта подтверждена' : 'Почта ещё не подтверждена';
    q('#auth-profile-verify').hidden = !!user.emailVerified;
  }
}

async function request(url, method='GET', payload) {
  const options = { method, credentials:'same-origin',cache:'no-store' };
  if (method !== 'GET') {
    options.headers = {'Content-Type':'application/json'};
    options.body = JSON.stringify(payload || {});
  }
  const response = await fetch(url,options);
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw Error(errors[data.error] || 'Сервер вернул ошибку ' + response.status + '.');
  return data;
}

async function refresh() {
  try {
    const data = await request(endpoint+'me');
    available = true;
    user = data.authenticated ? data.user : null;
    display();
    if (!user) {
      showLoginGate();
      return;
    }
    if (user.emailVerificationRequired && !user.emailVerified) {
      await enterGame();
      return;
    }
    try {
      const hangar = await request('/api/v1/hangar');
      q('#auth-hangar').textContent = (hangar.items?.length ?? 0) + ' ед.';
    } catch {
      q('#auth-hangar').textContent = 'НЕДОСТУПЕН';
    }
    await enterGame();
  } catch (error) {
    console.warn('Commander session unavailable',error?.message ?? error);
    available = false;
    user = null;
    display();
    showLoginGate();
    feedback('Сервер авторизации недоступен. Проверьте подключение к API.',true);
  }
}

entry.addEventListener('click',()=>{
  if (!dialog.open) dialog.showModal();
  if (!available) feedback('Нет соединения с Ironhex API. Проверьте Caddy и /api/health.',true);
  else feedback();
});
q('#auth-close').addEventListener('click',()=>{
  if (!document.body.classList.contains('auth-locked')) dialog.close();
});
dialog.addEventListener('cancel',event=>{
  if (document.body.classList.contains('auth-locked')) event.preventDefault();
});
dialog.addEventListener('click',event=>{
  if (event.target === dialog && !document.body.classList.contains('auth-locked')) dialog.close();
});
dialog.addEventListener('close',()=>{
  q('#auth-login').elements.password.value = '';
  q('#auth-register').elements.password.value = '';
  q('#auth-register').elements.confirm.value = '';
});
q('#auth-tab-login').addEventListener('click',()=>tab('login'));
q('#auth-tab-register').addEventListener('click',()=>tab('register'));

async function submit(form,mode) {
  if (pending) return;
  pending = true;
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  feedback(mode === 'register' ? 'Создание профиля…' : 'Проверка учётных данных…');
  try {
    const data = Object.fromEntries(new FormData(form));
    if (mode === 'register' && data.password !== data.confirm) {
      throw Error('Пароли не совпадают.');
    }
    delete data.confirm;
    const result = await request(endpoint+mode,'POST',data);
    user = result.user;
    available = true;
    display();
    feedback('Командир авторизован.');
    await enterGame();
    void refresh();
  } catch(error) {
    feedback(error.message || 'Не удалось выполнить запрос.',true);
  } finally {
    pending = false;
    button.disabled = false;
  }
}
q('#auth-login').addEventListener('submit',event=>{
  event.preventDefault();
  void submit(event.currentTarget,'login');
});
q('#auth-register').addEventListener('submit',event=>{
  event.preventDefault();
  void submit(event.currentTarget,'register');
});
q('#auth-logout').addEventListener('click',async()=>{
  if (pending) return;
  pending = true;
  const button = q('#auth-logout');
  button.disabled = true;
  try {
    await request(endpoint+'logout','POST',{});
    user = null;
    // Unload the battle/MechLab module instead of leaving it active in the background.
    window.location.reload();
  } catch(error) {
    feedback(error.message,true);
  } finally {
    pending = false;
    button.disabled = false;
  }
});

q('#auth-forgot-link').addEventListener('click',()=>toggleFlow('auth-forgot'));
q('#auth-back').addEventListener('click',()=>toggleFlow('login'));
q('#auth-forgot').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const button=form.querySelector('[type=submit]');
  button.disabled=true;
  try {
    await request(endpoint+'request-reset','POST',{
      email:new FormData(form).get('email')
    });
    feedback('Если этот адрес зарегистрирован, письмо с инструкциями отправлено.');
  } catch(error) {
    feedback(error.message,true);
  } finally {button.disabled=false;}
});
q('#auth-new-password').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const data=Object.fromEntries(new FormData(form));
  if(data.password!==data.confirm) {feedback('Пароли не совпадают.',true);return;}
  const button=form.querySelector('[type=submit]');
  button.disabled=true;
  try {
    await request(endpoint+'reset-password','POST',{token:resetToken,password:data.password});
    resetToken=null;
    user=null;
    display();
    toggleFlow('login');
    feedback('Пароль изменён. Войдите с новым паролем.');
  } catch(error) {
    feedback(error.message,true);
  } finally {button.disabled=false;}
});
q('#auth-profile-verify').addEventListener('click',async()=>{
  const button=q('#auth-profile-verify');
  button.disabled=true;
  try {
    await request(endpoint+'resend-verification','POST',{});
    feedback('Письмо с подтверждением отправлено.');
  } catch(error) {feedback(error.message,true);}
  finally {button.disabled=false;}
});
q('#auth-resend').addEventListener('click',async()=>{
  const button=q('#auth-resend');
  button.disabled=true;
  try {
    await request(endpoint+'resend-verification','POST',{});
    feedback('Письмо отправлено. Проверьте также папку «Спам».');
  } catch(error) {
    feedback(error.message,true);
  } finally {button.disabled=false;}
});
q('#auth-pending-logout').addEventListener('click',async()=>{
  await request(endpoint+'logout','POST',{}).catch(()=>{});
  window.location.reload();
});

async function initializeAccountLink() {
  const hash=location.hash;
  const matched=/^#(verify|reset)=([0-9a-f]{64})$/i.exec(hash);
  if (!matched) return;
  const [,purpose,token]=matched;
  history.replaceState(null,'',location.pathname+location.search);
  if (purpose==='reset') {
    resetToken=token;
    showLoginGate();
    toggleFlow('auth-new-password');
    feedback('Создайте новый пароль — не менее 12 символов.');
    return true;
  }
  try {
    await request(endpoint+'verify-email','POST',{token});
    feedback('Адрес электронной почты подтверждён.');
  } catch(error) {
    feedback(error.message,true);
    return true;
  }
  return false;
}

display();
q('#auth-guest').hidden = true;
q('#auth-profile').hidden = true;
showLoginGate();
q('#auth-guest').hidden = true;
feedback('Проверка авторизации…');
void (async()=>{
  const stay=await initializeAccountLink();
  if(!stay) await refresh();
})();
