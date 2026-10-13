-- Pré-voo fiscal · Fase 2 (NFS-e). Estende fn_fiscal_previo com um bloco 'nfse' que lista, ANTES de
-- alguém tentar, tudo que impede a emissão de NFS-e — o que teria mostrado de uma vez os 5 erros da
-- FC Pisos (série E0010, IM E0116, município E0037, regime E0162, IBS/CBS) em vez de um por rejeição.
-- Autoria: sessão Claude (pedido do CEO 24/09). Checklist do CEO:
--   IM real preenchida · município emissor + aderido ao Nacional · série na faixa de integração
--   (00001–49999) · regime coerente com opção do Simples · código de serviço LC116 nos serviços ·
--   IBS/CBS (CST + cClassTrib) · certificado A1 válido (não vencido).
--
-- ADITIVO: o corpo de fn_fiscal_previo é reproduzido VERBATIM (mesma versão viva) e o retorno original
-- (config/produtos/destinatarios/resumo) é preservado BYTE A BYTE — só se concatena a chave nova 'nfse'
-- (|| jsonb_build_object). resumo.pronto_para_emitir continua sendo o veredito de NF-e; o veredito de
-- NFS-e vive em nfse.resumo.pronto_para_nfse (não altera chave existente).
-- SECURITY DEFINER (lê dados da empresa) → gate: REVOKE anon + GRANT + acesso por auth.uid().

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
  v_nfse jsonb := '{}'::jsonb;   -- Fase 2: bloco NFS-e (aditivo)
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
         serie_nfe_padrao, regime_tributario, opcao_simples_nacional,
         gov_nfse_municipio_aderido, serie_nfse_padrao, regime_apuracao_sn,
         reforma_ibs_cbs_cst, reforma_ibs_cbs_classif_trib
  into cfg from public.erp_fiscal_provider_config
  where company_id = p_company_id and ativo = true limit 1;

  -- ── Config (mostra o que está CERTO e o que falta) ────────────────────────────────
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

  -- ── Pré-voo NFS-e (Fase 2 · bloco novo, aditivo) ──────────────────────────────────
  declare
    ok_provider_n boolean := cfg.provider is not null;
    ok_token_n boolean := cfg.focus_token_vault_id is not null or cfg.api_key_encrypted is not null;
    ok_im_n boolean := coalesce(btrim(emp.inscricao_municipal),'') <> '';
    ok_mun_n boolean := coalesce(regexp_replace(coalesce(cfg.gov_nfse_municipio_codigo,''),'\D','','g'),'') ~ '^\d{7}$';
    v_aderido boolean := coalesce(cfg.gov_nfse_municipio_aderido, false);
    v_serie_n text := coalesce(btrim(cfg.serie_nfse_padrao::text),'');
    v_serie_num int := case when coalesce(btrim(cfg.serie_nfse_padrao::text),'') ~ '^\d+$' then cfg.serie_nfse_padrao::int else null end;
    ok_serie_n boolean := v_serie_num is not null and v_serie_num between 1 and 49999;
    ok_regime_n boolean := coalesce(btrim(cfg.regime_tributario),'') <> ''
        and (lower(coalesce(cfg.regime_tributario,'')) not like '%simples%' or cfg.opcao_simples_nacional is not null);
    ok_ibscbs boolean := coalesce(btrim(cfg.reforma_ibs_cbs_cst),'') <> '' and coalesce(btrim(cfg.reforma_ibs_cbs_classif_trib),'') <> '';
    v_cert_fim date;
    ok_cert boolean;
    v_serv_sem int; v_serv_amostra jsonb; v_nfse_bloq int;
  begin
    select validade_fim into v_cert_fim from public.erp_certificados_a1
      where company_id = p_company_id and removido_em is null order by validade_fim desc limit 1;
    ok_cert := v_cert_fim is not null and v_cert_fim >= current_date;

    select count(*) into v_serv_sem from public.erp_produtos
      where company_id = p_company_id and coalesce(ativo,true) = true
        and lower(coalesce(tipo,'')) like '%servi%' and coalesce(btrim(cod_lista_servico),'') = '';
    select coalesce(jsonb_agg(jsonb_build_object('codigo',codigo,'nome',coalesce(nome,''))),'[]'::jsonb) into v_serv_amostra
      from (select codigo, nome from public.erp_produtos
            where company_id = p_company_id and coalesce(ativo,true) = true
              and lower(coalesce(tipo,'')) like '%servi%' and coalesce(btrim(cod_lista_servico),'') = ''
            order by codigo limit 15) s;

    v_nfse_bloq := (case when not ok_provider_n then 1 else 0 end) + (case when not ok_token_n then 1 else 0 end)
      + (case when not ok_im_n then 1 else 0 end) + (case when not ok_mun_n then 1 else 0 end)
      + (case when not ok_serie_n then 1 else 0 end) + (case when not ok_regime_n then 1 else 0 end)
      + (case when not ok_cert then 1 else 0 end) + (case when v_serv_sem > 0 then 1 else 0 end);

    v_nfse := jsonb_build_object(
      'config', jsonb_build_array(
        jsonb_build_object('chave','provider','rotulo','Emissor NFS-e ativo','ok',ok_provider_n,'valor',cfg.provider,'severidade','bloqueio'),
        jsonb_build_object('chave','token','rotulo','Token do emissor cadastrado','ok',ok_token_n,'severidade','bloqueio'),
        jsonb_build_object('chave','inscricao_municipal','rotulo','Inscrição Municipal preenchida (a real, não o indicador)','ok',ok_im_n,'valor',emp.inscricao_municipal,'severidade','bloqueio'),
        jsonb_build_object('chave','municipio_ibge','rotulo','Município emissor (código IBGE, 7 dígitos)','ok',ok_mun_n,'valor',cfg.gov_nfse_municipio_codigo,'severidade','bloqueio'),
        jsonb_build_object('chave','municipio_aderido','rotulo','Município aderido ao Nacional','ok',v_aderido,'valor',v_aderido,'severidade','aviso'),
        jsonb_build_object('chave','serie_nfse','rotulo','Série NFS-e na faixa de INTEGRAÇÃO (00001–49999, não a do portal)','ok',ok_serie_n,'valor',v_serie_n,'severidade','bloqueio'),
        jsonb_build_object('chave','regime','rotulo','Regime tributário coerente com a opção do Simples','ok',ok_regime_n,'valor',cfg.regime_tributario,'severidade','bloqueio'),
        jsonb_build_object('chave','ibs_cbs','rotulo','IBS/CBS: CST e cClassTrib configurados','ok',ok_ibscbs,'valor',coalesce(cfg.reforma_ibs_cbs_cst,'')||' / '||coalesce(cfg.reforma_ibs_cbs_classif_trib,''),'severidade','aviso'),
        jsonb_build_object('chave','certificado','rotulo','Certificado A1 válido (não vencido)','ok',ok_cert,'valor',v_cert_fim,'severidade','bloqueio')
      ),
      'servicos', jsonb_build_object(
        'sem_codigo_servico', v_serv_sem,
        'amostra', v_serv_amostra,
        'obs_iss', 'Código de serviço (LC 116) é obrigatório por serviço; a alíquota de ISS é resolvida pelo município/Focus na emissão.'
      ),
      'resumo', jsonb_build_object('bloqueios', v_nfse_bloq, 'pronto_para_nfse', (v_nfse_bloq = 0))
    );
  end;

  -- Retorno original PRESERVADO byte a byte; só concatena a chave nova 'nfse' (aditivo).
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
  ) || jsonb_build_object('nfse', v_nfse);
end;
$fn$;
revoke all on function public.fn_fiscal_previo(uuid) from public;
revoke all on function public.fn_fiscal_previo(uuid) from anon;
grant execute on function public.fn_fiscal_previo(uuid) to authenticated, service_role;
