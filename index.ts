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
  const rawBody = await req.text();
  if (!await verifySignature(rawBody, req.headers.get('x-webhook-signature'), Deno.env.get('PAYMENT_WEBHOOK_SECRET')!)) return json({ error: 'Invalid signature' }, 401);
  const body = JSON.parse(rawBody);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { order_id, provider_ref, paid_amount, currency, status } = body;
  if (status !== 'success' || !order_id || !provider_ref) return json({ received: true });

  const { data: order } = await supabase.from('orders').select('*').eq('id', order_id).single();
  if (!order || order.status === 'paid' || order.calculated_price !== Number(paid_amount) || order.currency !== currency) return json({ error: 'Order mismatch' }, 400);
  const { error: paymentError } = await supabase.from('payments').insert({ order_id, provider_reference: provider_ref, amount: paid_amount, currency, status: 'completed', raw_event: body });
  if (paymentError) return json({ received: true });
  await supabase.from('orders').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', order_id).eq('status', 'pending');
  const issueResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/issue-license`, { method: 'POST', headers: { 'x-internal-secret': Deno.env.get('INTERNAL_FUNCTION_SECRET')!, 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id }) });
  if (!issueResponse.ok) return json({ error: 'License issuance failed' }, 500);
  return json({ received: true });
});
