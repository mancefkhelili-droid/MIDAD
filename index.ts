import { createClient } from 'npm:@supabase/supabase-js@2';

// verify_jwt is OFF for this function on purpose: Chargily cannot send a Supabase JWT.
// Authentication = HMAC signature of the raw body, signed with the Chargily secret key.

const enc = new TextEncoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);

  // Verify against the RAW body, before any JSON.parse
  const raw = await req.text();
  const signature = (req.headers.get('signature') ?? req.headers.get('x-chargily-signature') ?? '').toLowerCase();

  const secrets = [
    Deno.env.get('CHARGILY_SECRET_KEY'),
    Deno.env.get('PAYMENT_WEBHOOK_SECRET'),
    Deno.env.get('PAYMENT_PROVIDER_SECRET'),
  ].filter((s): s is string => !!s);

  let valid = false;
  if (signature && secrets.length) {
    for (const s of secrets) {
      if (safeEqual(signature, await hmacHex(s, raw))) { valid = true; break; }
    }
  }
  if (!valid) return reply({ error: 'invalid_signature' }, 401);

  let event: any;
  try { event = JSON.parse(raw); } catch { return reply({ error: 'invalid_json' }, 400); }

  // Chargily puts the event name in `type` (not `event`)
  const type: string = event?.type ?? '';
  const checkout = event?.data;
  const orderId = checkout?.metadata?.order_id;
  if (!checkout || typeof orderId !== 'string' || !UUID_RE.test(orderId)) {
    return reply({ received: true });          // not one of our checkouts
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  if (['checkout.failed', 'checkout.canceled', 'checkout.expired'].includes(type)) {
    await admin.from('orders').update({ status: 'failed' }).eq('id', orderId).eq('status', 'pending');
    return reply({ received: true });
  }

  if (type !== 'checkout.paid') return reply({ received: true });

  if (String(checkout.currency ?? '').toLowerCase() !== 'dzd' || !checkout.id) {
    console.error('unexpected checkout payload', orderId);
    return reply({ received: true });
  }

  // One atomic transaction in the database: validate amount, record payment,
  // mark order paid, issue the license. Safe to receive the same webhook twice.
  const { data: result, error } = await admin.rpc('finalize_paid_order', {
    p_order_id: orderId,
    p_provider_ref: String(checkout.id),
    p_amount: Number(checkout.amount),
    p_event: event,
  });

  if (error) {
    console.error('finalize_paid_order failed', error);
    return reply({ error: 'temporary_failure' }, 500);   // let Chargily retry
  }
  if (result !== 'ok') {
    // permanent problem (mismatch / unknown order): retrying will not help
    console.error('payment rejected', result, orderId, checkout.id);
    await admin.from('audit_logs').insert({
      action: 'PAYMENT_REJECTED',
      details: { reason: result, order_id: orderId, provider_reference: checkout.id },
    });
  }
  return reply({ received: true });
});