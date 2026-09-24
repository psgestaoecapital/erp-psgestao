-- Pré-voo fiscal · Fase 1 (SPEC aprovada 24/09). Lista, POR EMPRESA, o que impede emitir ANTES de
-- alguém tentar — e mostra TAMBÉM o que já está certo (pedido do CEO: dar noção de progresso, não só
-- mais uma lista de erros). Princípio: os MESMOS predicados dos validators, em modo diagnóstico — não
-- reescreve a lógica (se fossem duas regras, divergiriam em três meses).
--
-- fn_fiscal_previo(company) → JSON { config[], produtos{}, destinatarios{}, resumo{} }
--   config[]: cada item { chave, rotulo, ok, valor, severidade } — ok=true mostra o que está CERTO.
--   produtos/destinatarios: contagem + amostra do que falta (mesmos predicados de nfe-validator).
-- fn_fiscal_previo_resumo() → contagem de impeditivos POR EMPRESA (visão PS na Central: "quem está pronto").
--
-- SECURITY DEFINER (lê dados da empresa) → gate: REVOKE anon + GRANT + autoria por auth.uid() (checa acesso).

create or replace function public.fn_fiscal_previo(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ok_acesso boolean;
  emp record;
  cfg record;
  v_config jsonb := '[]'::jsonb;
  v_bloq int := 0;
  v_avisos int := 0;
  v_sem_ncm int; v_cst_st int; v_ncm2710 int; v_sem_sped int; v_prod_amostra jsonb;
  v_dest_sem_ie int; v_dest_amostra jsonb;
begin
  -- acesso: membro da empresa OU equipe PS (autoria por auth.uid — gate)
  select exists(select 1 from public.user_companies uc where uc.user_id = v_uid and uc.company_id = p_company_id)
      or exists(select 1 from public.users u where u.id = v_uid and u.system_role in ('PS_ADMIN','PS_ADMIN_CVM'))
    into v_ok_acesso;
  if not coalesce(v_ok_acesso, false) then
    raise exception 'sem acesso a esta empresa';
  end if;

  select cnpj, inscricao_estadual, inscricao_municipal, razao_social into emp
  from public.companies where id = p_company_id;
  select provider, ativo, focus_token_vault_id, api_key_encrypted, gov_nfse_municipio_codigo,
         serie_nfe_padrao, regime_tributario, opcao_simples_nacional
  into cfg from public.erp_fiscal_provider_config
  where company_id = p_company_id and ativo = true limit 1;

  -- ── Config (mostra o que está CERTO e o que falta) ────────────────────────────────
  -- Cada item: bloqueio (impede emitir) ou aviso (recomendado). ok=true = já está certo.
  declare
    ok_provider boolean := cfg.provider is not null;
    ok_token boolean := cfg.focus_token_vault_id is not null or cfg.api_key_encrypted is not null;
    ok_ie boolean := coalesce(btrim(emp.inscricao_estadual), '') <> '';
    ok_mun boolean := coalesce(regexp_replace(coalesce(cfg.gov_nfse_municipio_codigo,''),'\D','','g'), '') ~ '^\d{7}$';
    ok_serie boolean := coalesce(btrim(cfg.serie_nfe_padrao::text), '') <> '';
    ok_regime boolean := coalesce(btrim(cfg.regime_tributario), '') <> ''
        and (lower(coalesce(cfg.regime_tributario,'')) not like '%simples%' or cfg.opcao_simples_nacional is not null);
    ok_im boolean := coalesce(btrim(emp.inscricao_municipal), '') <> '';
  begin
    v_config := jsonb_build_array(
      jsonb_build_object('chave','provider','rotulo','Emissor fiscal ativo (Focus)','ok',ok_provider,'valor',cfg.provider,'severidade','bloqueio'),
      jsonb_build_object('chave','token','rotulo','Token do emissor cadastrado','ok',ok_token,'severidade','bloqueio'),
      jsonb_build_object('chave','ie_emitente','rotulo','Inscrição Estadual da empresa','ok',ok_ie,'valor',emp.inscricao_estadual,'severidade','bloqueio'),
      jsonb_build_object('chave','municipio_ibge','rotulo','Município (código IBGE)','ok',ok_mun,'valor',cfg.gov_nfse_municipio_codigo,'severidade','bloqueio'),
      jsonb_build_object('chave','regime','rotulo','Regime tributário / opção do Simples','ok',ok_regime,'valor',cfg.regime_tributario,'severidade','bloqueio'),
      jsonb_build_object('chave','serie','rotulo','Série da NF-e','ok',ok_serie,'valor',cfg.serie_nfe_padrao,'severidade','aviso'),
      jsonb_build_object('chave','inscricao_municipal','rotulo','Inscrição Municipal (para NFS-e)','ok',ok_im,'valor',emp.inscricao_municipal,'severidade','aviso')
    );
    v_bloq := (case when not ok_provider then 1 else 0 end) + (case when not ok_token then 1 else 0 end)
            + (case when not ok_ie then 1 else 0 end) + (case when not ok_mun then 1 else 0 end)
            + (case when not ok_regime then 1 else 0 end);
    v_avisos := (case when not ok_serie then 1 else 0 end) + (case when not ok_im then 1 else 0 end);
  end;

  -- ── Produtos incompletos (mesmos predicados do nfe-validator) ─────────────────────
  select
    count(*) filter (where regexp_replace(coalesce(ncm,''),'\D','','g') !~ '^\d{8}$'),
    count(*) filter (where cst_icms in ('500','60') and (vbcst_ret is null or pst is null or vicms_substituto is null or vicms_st_ret is null)),
    count(*) filter (where regexp_replace(coalesce(ncm,''),'\D','','g') like '2710%' and (combustivel_codigo_anp is null or coalesce(btrim(combustivel_descricao_anp),'')='')),
    count(*) filter (where coalesce(btrim(tipo_item_sped),'')='')
  into v_sem_ncm, v_cst_st, v_ncm2710, v_sem_sped
  from public.erp_produtos where company_id = p_company_id and coalesce(ativo,true) = true;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_prod_amostra from (
    select jsonb_build_object('codigo', codigo, 'nome', coalesce(nome,''),
      'motivos', (
        (case when regexp_replace(coalesce(ncm,''),'\D','','g') !~ '^\d{8}$' then jsonb_build_array('NCM ausente/inválido') else '[]'::jsonb end)
        || (case when cst_icms in ('500','60') and (vbcst_ret is null or pst is null or vicms_substituto is null or vicms_st_ret is null) then jsonb_build_array('CST '||cst_icms||' sem ST retido') else '[]'::jsonb end)
        || (case when regexp_replace(coalesce(ncm,''),'\D','','g') like '2710%' and (combustivel_codigo_anp is null or coalesce(btrim(combustivel_descricao_anp),'')='') then jsonb_build_array('NCM 2710 sem ANP') else '[]'::jsonb end)
        || (case when coalesce(btrim(tipo_item_sped),'')='' then jsonb_build_array('sem tipo do item (SPED)') else '[]'::jsonb end)
      ))
    from public.erp_produtos
    where company_id = p_company_id and coalesce(ativo,true) = true
      and (regexp_replace(coalesce(ncm,''),'\D','','g') !~ '^\d{8}$'
        or (cst_icms in ('500','60') and (vbcst_ret is null or pst is null or vicms_substituto is null or vicms_st_ret is null))
        or (regexp_replace(coalesce(ncm,''),'\D','','g') like '2710%' and (combustivel_codigo_anp is null or coalesce(btrim(combustivel_descricao_anp),'')=''))
        or coalesce(btrim(tipo_item_sped),'')='')
    order by codigo limit 15
  ) x;

  -- ── Destinatários contribuintes sem IE (232) ──────────────────────────────────────
  select count(*) into v_dest_sem_ie
  from public.erp_clientes
  where company_id = p_company_id
    and lower(coalesce(contribuinte_icms::text,'')) in ('true','t','1','sim','contribuinte')
    and coalesce(btrim(ie),'') = '';
  select coalesce(jsonb_agg(jsonb_build_object('nome', coalesce(razao_social,''))), '[]'::jsonb) into v_dest_amostra
  from (select razao_social from public.erp_clientes
        where company_id = p_company_id
          and lower(coalesce(contribuinte_icms::text,'')) in ('true','t','1','sim','contribuinte')
          and coalesce(btrim(ie),'') = '' order by razao_social limit 15) d;

  return jsonb_build_object(
    'config', v_config,
    'produtos', jsonb_build_object(
      'incompletos', coalesce(v_sem_ncm,0)+coalesce(v_cst_st,0)+coalesce(v_ncm2710,0)+coalesce(v_sem_sped,0),
      'sem_ncm', v_sem_ncm, 'cst_st_incompleto', v_cst_st, 'ncm2710_sem_anp', v_ncm2710, 'sem_tipo_item_sped', v_sem_sped,
      'amostra', v_prod_amostra),
    'destinatarios', jsonb_build_object('contribuinte_sem_ie', v_dest_sem_ie, 'amostra', v_dest_amostra),
    'resumo', jsonb_build_object(
      'config_bloqueios', v_bloq, 'config_avisos', v_avisos,
      'produtos_incompletos', coalesce(v_sem_ncm,0)+coalesce(v_cst_st,0)+coalesce(v_ncm2710,0)+coalesce(v_sem_sped,0),
      'destinatarios_pendentes', v_dest_sem_ie,
      'pronto_para_emitir', (v_bloq = 0))
  );
end;
$fn$;
revoke all on function public.fn_fiscal_previo(uuid) from public;
revoke all on function public.fn_fiscal_previo(uuid) from anon;
grant execute on function public.fn_fiscal_previo(uuid) to authenticated, service_role;

-- Visão PS (Central de Dev): contagem de impeditivos por empresa — "quais empresas estão prontas".
create or replace function public.fn_fiscal_previo_resumo()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ps boolean;
begin
  select exists(select 1 from public.users u where u.id = v_uid and u.system_role in ('PS_ADMIN','PS_ADMIN_CVM'))
    into v_ps;
  if not coalesce(v_ps, false) then
    raise exception 'apenas equipe PS';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'company_id', pc.company_id,
      'empresa', coalesce(c.nome_fantasia, c.razao_social),
      'bloqueios', r.config_bloqueios,
      'produtos_incompletos', r.produtos_incompletos,
      'destinatarios_pendentes', r.destinatarios_pendentes,
      'pronto', r.pronto_para_emitir
    ) order by (r.pronto_para_emitir) asc, coalesce(c.nome_fantasia, c.razao_social)), '[]'::jsonb)
    from public.erp_fiscal_provider_config pc
    join public.companies c on c.id = pc.company_id
    cross join lateral (
      select (public.fn_fiscal_previo(pc.company_id) -> 'resumo') as res
    ) fp
    cross join lateral (
      select (fp.res ->> 'config_bloqueios')::int as config_bloqueios,
             (fp.res ->> 'produtos_incompletos')::int as produtos_incompletos,
             (fp.res ->> 'destinatarios_pendentes')::int as destinatarios_pendentes,
             (fp.res ->> 'pronto_para_emitir')::boolean as pronto_para_emitir
    ) r
    where pc.ativo = true
  );
end;
$fn$;
revoke all on function public.fn_fiscal_previo_resumo() from public;
revoke all on function public.fn_fiscal_previo_resumo() from anon;
grant execute on function public.fn_fiscal_previo_resumo() to authenticated, service_role;
