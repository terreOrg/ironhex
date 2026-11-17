import { validEmailAddress } from './email-address.mjs';
// HTTPS-only transactional mail using Brevo API. No SMTP password in the codebase.
export function createBrevoMailer({
  apiKey = '',
  sender = '',
  publicOrigin = '',
  fetchImpl = fetch
} = {}) {
  const enabled = !!apiKey;
  if (enabled && (!validEmailAddress(sender) ||
      !/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(publicOrigin))) {
    throw Error('Email delivery requires a verified sender and an HTTPS public origin');
  }
  return {
    enabled,
    async send({to, purpose, token}) {
      if (!enabled) throw Error('mail_not_configured');
      const fragment = purpose === 'verify' ? 'verify' : 'reset';
      const link = publicOrigin + '/#' + fragment + '=' + encodeURIComponent(token);
      const title = purpose === 'verify' ? 'Подтвердите e-mail Ironhex' : 'Сброс пароля Ironhex';
      const body = purpose === 'verify' ?
        'Подтвердите адрес электронной почты вашего аккаунта Ironhex:' :
        'Для установки нового пароля Ironhex откройте ссылку:';
      const textContent = title + '\n\n' + body + '\n' + link +
        '\n\nЕсли вы не запрашивали это письмо, просто проигнорируйте его.' +
        '\nСрок действия ссылки ограничен. Никому её не пересылайте.';
      const response = await fetchImpl('https://api.brevo.com/v3/smtp/email',{
        method:'POST',
        headers:{
          'api-key':apiKey,
          'accept':'application/json',
          'content-type':'application/json'
        },
        body:JSON.stringify({
          sender:{name:'Ironhex',email:sender},
          to:[{email:to}],
          subject:title,
          textContent
        }),
        signal:AbortSignal.timeout(12000)
      });
      if (!response.ok) throw Error('mail_delivery_failed');
      return true;
    }
  };
}
