-- Log de relatórios emitidos na tela (export PDF/Excel de Despesas/Receitas) — auditoria + escopo.
create or replace function public.fn_relatorio_registrar(p_company_id uuid, p_tipo text, p_periodo text)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid;
begin
  if not (p_company_id in (select get_user_company_ids()) or is_admin()) then
    raise exception 'sem acesso';
  end if;
  insert into relatorios_gerados (company_id, tipo, periodo, solicitante, created_at)
    values (p_company_id, p_tipo, left(coalesce(p_periodo,''), 500), auth.uid(), now())
    returning id into v_id;
  return v_id;
end $function$;
