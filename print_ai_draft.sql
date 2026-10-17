-- يخصم أوراق مسودة الذكاء الاصطناعي من الباقة (نفس منطق print_document)
create or replace function public.print_ai_draft(p_sheets integer default 1)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r jsonb;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if p_sheets is null or p_sheets < 1 or p_sheets > 50 then return jsonb_build_object('status','bad_copies'); end if;
  r := public._consume_sheets(auth.uid(), p_sheets);
  if r->>'status' <> 'ok' then return jsonb_build_object('status', case when r->>'status' in ('no_sheets','daily_limit') then r->>'status' else 'error' end); end if;
  insert into public.audit_logs(user_id, action, details)
  values (auth.uid(), 'AI_DRAFT_PRINTED', jsonb_build_object('sheets', p_sheets));
  return jsonb_build_object('status','ok','cost',p_sheets,'summary',public._sub_summary(auth.uid()));
end $$;
revoke all on function public.print_ai_draft(integer) from public, anon;
grant execute on function public.print_ai_draft(integer) to authenticated;
