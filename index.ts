import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, options } from '../_shared/cors.ts';

async function verifySignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(signature.match(/.{1,2}/g) ?? [], (part) => parseInt(part, 16));
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(rawBody));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const rawBody = await req.text();
  const webhookSecret = Deno.env.get('PAYMENT_WEBHOOK_SECRET');
  if (!webhookSecret || !await verifySignature(rawBody, req.headers.get('x-webhook-signature'), webhookSecret)) return json({ error: 'Invalid signature' }, 401);
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { order_id, provider_ref, paid_amount, currency, status } = body;
  if (status !== 'success' || !order_id || !provider_ref) return json({ received: true });

  const { data: order } = await supabase.from('orders').select('*').eq('id', order_id).single();
  if (!order || order.calculated_price !== Number(paid_amount) || order.currency !== currency) return json({ error: 'Order mismatch' }, 400);

  const { data: existingPayment } = await supabase.from('payments').select('order_id,amount,currency').eq('provider_reference', provider_ref).maybeSingle();
  if (existingPayment && (existingPayment.order_id !== order_id || existingPayment.amount !== Number(paid_amount) || existingPayment.currency !== currency)) return json({ error: 'Payment mismatch' }, 400);
  if (!existingPayment) {
    const { error: paymentError } = await supabase.from('payments').insert({ order_id, provider_reference: provider_ref, amount: paid_amount, currency, status: 'completed', raw_event: body });
    if (paymentError) {
      const { data: retryPayment } = await supabase.from('payments').select('order_id').eq('provider_reference', provider_ref).maybeSingle();
      if (retryPayment?.order_id !== order_id) return json({ error: 'Payment could not be recorded' }, 409);
    }
  }

  const { error: orderError } = await supabase.from('orders').update({ status: 'paid', paid_at: order.paid_at ?? new Date().toISOString() }).eq('id', order_id).in('status', ['pending', 'paid']);
  if (orderError) return json({ error: 'Order could not be updated' }, 500);
  const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
  if (!internalSecret) return json({ error: 'Internal function is not configured' }, 500);
  const issueResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/issue-license`, { method: 'POST', headers: { 'x-internal-secret': internalSecret, 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id }) });
  if (!issueResponse.ok) return json({ error: 'License issuance failed' }, 500);
  return json({ received: true });
});
