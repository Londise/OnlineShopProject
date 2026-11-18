import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

export async function sendVerificationEmail({ email, token, nonce }, { config = env, fetchImpl = fetch } = {}) {
  if (!config.RESEND_API_KEY || !config.EMAIL_FROM)
    throw new AppError(503, 'EMAIL_UNAVAILABLE', 'A verificação por e-mail está indisponível. Tente novamente mais tarde.');
  // Neither the Host header nor a caller-supplied redirect can change this URL.
  // Fragment tokens are not sent to web-server access logs.
  const link = `${config.FRONTEND_ORIGIN}/verify-email#token=${token}`;
  let response;
  try {
    response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8_000),
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `verify/${nonce}` },
      body: JSON.stringify({ from: `Ferchu Modas <${config.EMAIL_FROM}>`, to: [email],
        ...(config.EMAIL_REPLY_TO ? { reply_to: config.EMAIL_REPLY_TO } : {}),
        subject: 'Confirme seu e-mail — Ferchu Modas',
        text: `Sua conta aguarda a confirmação do e-mail. Abra o link abaixo para verificar o endereço — seu nome e sua senha continuam os mesmos:\n\n${link}\n\nO link vale por 30 minutos e só pode ser usado uma vez. Abra no navegador em que criou a conta ou entre com a senha que você já escolheu. Se você não criou essa conta, não confirme e ignore esta mensagem.`,
      }),
    });
    const accepted = response.ok;
    await response.body?.cancel();
    if (accepted) return;
  } catch { /* Never emit provider bodies, credentials or verification URLs. */ }
  throw new AppError(503, 'EMAIL_UNAVAILABLE', 'Não foi possível enviar a verificação. Tente novamente mais tarde.');
}
