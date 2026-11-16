// The commander login console is separate from the tactical battle engine.
const endpoint = '/api/v1/auth/';
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

const q = selector => dialog.querySelector(selector);
const errors = {
  invalid_handle:'Позывной должен содержать 3–24 символа: латиницу, цифры, _ или -.',
  invalid_email:'Введите корректный e-mail.',
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
  q('#auth-guest').hidden = !!user;
  q('#auth-profile').hidden = !user;
  if (user) {
    q('#auth-handle').textContent = user.handle;
    q('#auth-email').textContent = user.email;
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
    if (user) {
      const hangar = await request('/api/v1/hangar');
      const count = hangar.items?.length ?? 0;
      q('#auth-hangar').textContent = count + ' ед.';
    }
  } catch {
    // The published static demo may have no API. The tactical game remains playable.
    available = false;
    user = null;
    display();
    feedback('API аккаунтов недоступен. Откройте игру на собственном сервере Ironhex.',true);
  }
}

entry.addEventListener('click',()=>{
  if (!dialog.open) dialog.showModal();
  if (!available) feedback('Нет соединения с Ironhex API. Проверьте Caddy и /api/health.',true);
  else feedback();
});
q('#auth-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{
  if (event.target === dialog) dialog.close();
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
    await refresh();
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
    display();
    tab('login');
    feedback('Вы вышли из аккаунта.');
  } catch(error) {
    feedback(error.message,true);
  } finally {
    pending = false;
    button.disabled = false;
  }
});
display();
void refresh();
