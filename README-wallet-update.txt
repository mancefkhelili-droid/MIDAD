Medad Wallet update (October 2026)

Included frontend files: index.html, app.js, styles.css, i18n.js.

Changes in this update:
- CCP and BaridiMob appear as first-class Medad wallet payment methods with translated labels.
- Wallet and admin wallet interface strings now have French and English translations through Medad's existing i18n dictionary.
- Admin-only wallet review is preserved; database RPC admin_wallet_approve was updated so an authenticated admin can approve their own pending top-up request as well as other users' requests. Non-admin users remain blocked by public.is_admin().
- Cache versions were bumped in index.html.

Deploy all four frontend files to the same Vercel project. The database function change has already been applied to Supabase project epislkcmkneyqmonzias.

Important: the wallet approval operation only credits the submitted amount after an admin clicks Approve. Verify the actual transfer before approval. Telegram delivery and a complete live end-to-end purchase have not been tested in this update.
