import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function verifySignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const bytes = Uint8Array.from(signature.match(/.{1,2}/g) ?? [], (part) => parseInt(part, 16));
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(rawBody));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const rawBody = await req.text();
  const webhookSecret = Deno.env.get('PAYMENT_WEBHOOK_SECRET') || Deno.env.get('PAYMENT_PROVIDER_SECRET');
  const signatureHeader = req.headers.get('signature') || req.headers.get('x-chargily-signature');

  if (!webhookSecret || !await verifySignature(rawBody, signatureHeader, webhookSecret)) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const event = body.event;
  const checkoutData = body.data;

  if (event !== 'checkout.paid' || !checkoutData) {
    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const order_id = checkoutData.metadata?.order_id;
  const provider_ref = checkoutData.id;
  const paid_amount = checkoutData.amount;
  const currency = checkoutData.currency?.toLowerCase();

  if (!order_id || !provider_ref) {
    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: order } = await supabase.from('orders').select('*').eq('id', order_id).single();
  if (!order || order.calculated_price !== Number(paid_amount) || order.currency?.toLowerCase() !== currency) {
    return new Response(JSON.stringify({ error: 'Order mismatch' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: existingPayment } = await supabase
    .from('payments')
    .select('order_id,amount,currency')
    .eq('provider_reference', provider_ref)
    .maybeSingle();

  if (existingPayment && (existingPayment.order_id !== order_id || existingPayment.amount !== Number(paid_amount) || existingPayment.currency?.toLowerCase() !== currency)) {
    return new Response(JSON.stringify({ error: 'Payment mismatch' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!existingPayment) {
    const { error: paymentError } = await supabase.from('payments').insert({
      order_id,
      provider_reference: provider_ref,
      amount: paid_amount,
      currency,
      status: 'completed',
      raw_event: body
    });

    if (paymentError) {
      const { data: retryPayment } = await supabase.from('payments').select('order_id').eq('provider_reference', provider_ref).maybeSingle();
      if (retryPayment?.order_id !== order_id) {
        return new Response(JSON.stringify({ error: 'Payment could not be recorded' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
  }

  const { error: orderError } = await supabase
    .from('orders')
    .update({ status: 'paid', paid_at: order.paid_at ?? new Date().toISOString() })
    .eq('id', order_id)
    .in('status', ['pending', 'paid']);

  if (orderError) {
    return new Response(JSON.stringify({ error: 'Order could not be updated' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
  if (!internalSecret) {
    return new Response(JSON.stringify({ error: 'Internal function is not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const issueResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/issue-license`, {
    method: 'POST',
    headers: { 'x-internal-secret': internalSecret, 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id })
  });

  if (!issueResponse.ok) {
    return new Response(JSON.stringify({ error: 'License issuance failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});