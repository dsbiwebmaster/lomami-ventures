const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function corsJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function twimlResponse(message) {
  const xml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
}

// ── Twilio HMAC-SHA1 signature validation (Web Crypto — no Node.js crypto needed) ──
async function validateTwilioSignature(request, env) {
  const signature = request.headers.get('X-Twilio-Signature');
  if (!signature) return false;

  const formData = await request.clone().formData();
  const url = new URL(request.url).toString();

  const params = [...formData.entries()].sort(([a], [b]) => a.localeCompare(b));
  const validationStr = url + params.map(([k, v]) => `${k}${v}`).join('');

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.TWILIO_AUTH_TOKEN),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(validationStr));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));

  // Constant-time comparison to prevent timing attacks
  if (computed.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

// ── Twilio REST API — send SMS ──
async function sendTwilioSms(env, to, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const creds = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: env.TWILIO_PHONE_NUMBER, Body: body }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio ${res.status}: ${text}`);
  }
  return res.json();
}

// ── POST /api/sms-signup ──
async function handleSignup(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsJson({ ok: false, error: 'invalid_json' }, 400);
  }

  const { phone, consent } = body;

  if (typeof phone !== 'string' || !/^\+1[2-9]\d{9}$/.test(phone)) {
    return corsJson({ ok: false, error: 'invalid_phone' }, 400);
  }
  if (consent !== true) {
    return corsJson({ ok: false, error: 'consent_required' }, 400);
  }

  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO subscribers (phone, status, opted_in_at, created_at)
       VALUES (?, 'active', ?, ?)`,
    )
      .bind(phone, now, now)
      .run();
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      // Already subscribed — return success silently to avoid phone enumeration
      return corsJson({ ok: true });
    }
    console.error('D1 insert error:', err);
    return corsJson({ ok: false, error: 'db_error' }, 500);
  }

  const welcomeMessage =
    "Lomami Ventures: You're subscribed to text updates. " +
    'Msg & data rates may apply. Reply STOP to opt out, HELP for help.';

  try {
    await sendTwilioSms(env, phone, welcomeMessage);
  } catch (err) {
    // Subscriber is saved — log but don't surface Twilio failures to the client
    console.error('Twilio send failed:', err);
  }

  return corsJson({ ok: true });
}

// ── POST /api/sms-webhook (Twilio inbound) ──
async function handleWebhook(request, env) {
  const valid = await validateTwilioSignature(request, env);
  if (!valid) {
    return new Response('Forbidden', { status: 403 });
  }

  const formData = await request.formData();
  const from = formData.get('From') ?? '';
  const msgBody = (formData.get('Body') ?? '').trim().toUpperCase();

  const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
  const START_WORDS = new Set(['START', 'UNSTOP', 'YES']);

  const now = new Date().toISOString();

  if (STOP_WORDS.has(msgBody)) {
    await env.DB.prepare(
      `INSERT INTO subscribers (phone, status, opted_in_at, opted_out_at, created_at)
       VALUES (?, 'stopped', ?, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET
         status = 'stopped',
         opted_out_at = excluded.opted_out_at`,
    )
      .bind(from, now, now, now)
      .run();
    // Return empty TwiML — Twilio automatically sends the opt-out confirmation
    return twimlResponse(null);
  }

  if (START_WORDS.has(msgBody)) {
    await env.DB.prepare(
      `INSERT INTO subscribers (phone, status, opted_in_at, created_at)
       VALUES (?, 'active', ?, ?)
       ON CONFLICT(phone) DO UPDATE SET
         status = 'active',
         opted_out_at = NULL`,
    )
      .bind(from, now, now)
      .run();
    return twimlResponse(null);
  }

  if (msgBody === 'HELP' || msgBody === 'INFO') {
    return twimlResponse(
      'Lomami Ventures: For help, email accounts@lomamiventures.com. ' +
        'Msg & data rates may apply. Reply STOP to opt out.',
    );
  }

  // All other inbound messages — acknowledge silently
  return twimlResponse(null);
}

// ── Main entry point ──
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (pathname === '/api/sms-signup' && request.method === 'POST') {
      return handleSignup(request, env);
    }

    if (pathname === '/api/sms-webhook' && request.method === 'POST') {
      return handleWebhook(request, env);
    }

    // Fall through to static assets (index.html, privacy.html, etc.)
    return env.ASSETS.fetch(request);
  },
};
