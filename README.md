# Supabase deployment

1. Run `schema.sql` in the Supabase SQL editor.
2. Configure Auth and require users to sign in before checkout/printing. Enable Email, Google, and GitHub providers. Use this callback URL in Google and GitHub:

```text
https://epislkcmkneyqmonzias.supabase.co/auth/v1/callback
```

Add the deployed site URL and the local development URL to Supabase Auth redirect URLs.
3. Set function secrets:

```text
APP_ORIGIN=https://your-domain.example
INTERNAL_FUNCTION_SECRET=<random-long-secret>
PAYMENT_WEBHOOK_SECRET=<provider-webhook-secret>
PAYMENT_PROVIDER_CHECKOUT_URL=<official-provider-endpoint>
PAYMENT_PROVIDER_SECRET=<provider-secret>
```

4. Deploy:

```text
supabase functions deploy create-checkout
supabase functions deploy payment-webhook
supabase functions deploy issue-license
supabase functions deploy decrement-print-counter
```

`SUPABASE_SERVICE_ROLE_KEY` must remain a Supabase function secret and must never be placed in browser code. The payment provider must call `payment-webhook` and send the exact HMAC format documented by that provider.
