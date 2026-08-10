-- FIX perf · Timeout na grade "Análise de dados" (BI industrial).
-- Causa: a grade varria ind_atak_fato (438 MB / 274k linhas, jsonb pesado) por card p/ decidir quais
-- "acendem" — com 1 tenant o company_id não é seletivo, o planner faz seq scan do heap inteiro (×N cards)
-- → "canceling statement due to statement timeout" intermitente.
-- Fix: resumo pré-calculado por domínio (a grade lê ~11 linhas); cards canônicos leem o canônico (pequeno).
-- A grade NUNCA mais toca a fato. RD-38/RD-51/RD-56.

-- 3. HIGIENE: dropar índice duplicado (idêntico a idx_ind_atak_fato_comp_dom)
drop index if exists ix_atak_fato_cd;

-- 1. RESUMO por domínio
create table if not exists ind_atak_dominio_resumo (
  company_id uuid not null,
  dominio text not null,
  linhas bigint not null default 0,
  tem_dado boolean not null default false,
  ultimo_import timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (company_id, dominio)
);
alter table ind_atak_dominio_resumo enable row level security;
drop policy if exists ind_atak_dominio_resumo_sel on ind_atak_dominio_resumo;
create policy ind_atak_dominio_resumo_sel on ind_atak_dominio_resumo
  for select using (company_id in (select get_user_company_ids()) or is_admin());

-- refresh sob demanda / fim de sync: 1 GROUP BY -> upsert (não roda a cada load da grade)
create or replace function fn_ind_atak_resumo_refresh(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  if not (p_company_id in (select get_user_company_ids()) or is_admin()) then
    return jsonb_build_object('ok', false, 'erro', 'sem acesso');
  end if;
  delete from ind_atak_dominio_resumo where company_id = p_company_id;
  insert into ind_atak_dominio_resumo (company_id, dominio, linhas, tem_dado, ultimo_import)
  select company_id, dominio, count(*), count(*) > 0, max(imported_at)
    from ind_atak_fato where company_id = p_company_id group by company_id, dominio;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'dominios', v_n);
end $$;

-- popular já (migração roda como owner, sem auth) — 1 GROUP BY para todas as empresas
insert into ind_atak_dominio_resumo (company_id, dominio, linhas, tem_dado, ultimo_import)
select company_id, dominio, count(*), count(*) > 0, max(imported_at)
  from ind_atak_fato group by company_id, dominio
on conflict (company_id, dominio) do update
  set linhas = excluded.linhas, tem_dado = excluded.tem_dado,
      ultimo_import = excluded.ultimo_import, atualizado_em = now();

-- 4. sync passa a atualizar o resumo no fim
create or replace function fn_ind_venda_sync(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  if not (p_company_id in (select get_user_company_ids()) or is_admin()) then return jsonb_build_object('ok', false, 'erro', 'sem acesso'); end if;
  delete from ind_venda where company_id = p_company_id and fonte = 'atak_comercial';
  insert into ind_venda (company_id, data, filial, vendedor_cod, vendedor_nome, supervisor_cod, supervisor_nome, cliente_cod, produto_cod, peso_kg, valor, lucro, mix, divisao, fonte, chave_natural)
  select p_company_id, (f.raw->>'DATA_ESTOQUE')::date, f.raw->>'COD_FILIAL', f.raw->>'COD_VEND_COMP', f.raw->>'NOME_VENDEDOR',
         f.raw->>'COD_SUPERVISOR', f.raw->>'NOME_SUPERVISOR', f.raw->>'COD_CLI_FOR', NULL,
         coalesce((f.raw->>'PESO')::numeric,0), coalesce((f.raw->>'VALOR')::numeric,0), coalesce((f.raw->>'LUCRO')::numeric,0), coalesce((f.raw->>'MIX_VENDAS')::numeric,0),
         f.raw->>'NOME_PARTICIPANTE', 'atak_comercial', f.id::text
  from ind_atak_fato f where f.company_id = p_company_id and f.dominio = 'comercial_vendas' and (f.raw->>'DATA_ESTOQUE') is not null;
  get diagnostics v_n = row_count;
  perform fn_ind_atak_resumo_refresh(p_company_id);
  return jsonb_build_object('ok', true, 'linhas', v_n);
end $$;

-- 1+2. a grade lê o resumo + canônicos (nunca a fato)
create or replace function fn_bi_temas_industrial(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_acesso boolean := (p_company_id in (select get_user_company_ids()) or is_admin());
  v_emb bigint := 0; v_est bigint := 0; v_emb_td boolean := false; v_est_td boolean := false;
  v_ponto int := 0; v_venda int := 0; v_abate_cab numeric := 0;
  v_emb_fmt text; v_est_fmt text; v_pt_fmt text; v_vd_fmt text; v_ab_fmt text;
  v_out jsonb;
begin
  if v_acesso then
    select coalesce(max(linhas) filter (where dominio='embalagem'),0),
           coalesce(max(linhas) filter (where dominio='estoque'),0),
           coalesce(bool_or(dominio='embalagem' and tem_dado), false),
           coalesce(bool_or(dominio='estoque' and tem_dado), false)
      into v_emb, v_est, v_emb_td, v_est_td
      from ind_atak_dominio_resumo where company_id = p_company_id;
    select count(*) into v_ponto from ind_ponto_dia where company_id = p_company_id;
    select count(*) into v_venda from ind_venda where company_id = p_company_id;
    select coalesce(sum(cabecas),0) into v_abate_cab from ind_abate_evento where company_id = p_company_id;
  end if;
  v_emb_fmt := regexp_replace(v_emb::text,'(\d)(?=(\d{3})+$)','\1.','g');
  v_est_fmt := regexp_replace(v_est::text,'(\d)(?=(\d{3})+$)','\1.','g');
  v_pt_fmt  := regexp_replace(v_ponto::text,'(\d)(?=(\d{3})+$)','\1.','g');
  v_vd_fmt  := regexp_replace(v_venda::text,'(\d)(?=(\d{3})+$)','\1.','g');
  v_ab_fmt  := regexp_replace(round(v_abate_cab)::text,'(\d)(?=(\d{3})+$)','\1.','g');

  select jsonb_agg(jsonb_build_object(
    'codigo', t.codigo, 'nome', t.nome, 'subtitulo', t.subtitulo, 'icone', t.icone,
    'secao', t.secao, 'ordem', t.ordem, 'rota_detalhe', t.rota_detalhe, 'destaque', t.destaque,
    'previsto', t.previsto,
    'tem_dado', case
      when t.codigo in ('producao','tipificacao','rendimentos') then (v_abate_cab > 0)
      when t.codigo = 'rh' then (v_ponto > 0)
      when t.codigo = 'embalagens' then v_emb_td
      when t.codigo = 'camaras' then v_est_td
      when t.codigo = 'comercial' then (v_venda > 0)
      else false end,
    'metrica', case
      when t.codigo in ('producao','tipificacao','rendimentos') and v_abate_cab > 0 then v_ab_fmt || ' cabeças'
      when t.codigo = 'rh' and v_ponto > 0 then v_pt_fmt || ' registros de ponto'
      when t.codigo = 'embalagens' and v_emb_td then v_emb_fmt || ' SKUs'
      when t.codigo = 'camaras' and v_est_td then v_est_fmt || ' posições de estoque'
      when t.codigo = 'comercial' and v_venda > 0 then v_vd_fmt || ' vendas'
      else null end
  ) order by case t.secao when 'entrada' then 1 when 'abate' then 2 when 'frio_desossa' then 3 when 'saida' then 4 when 'transversais' then 5 else 9 end, t.ordem)
  into v_out from ind_bi_tema t where t.ativo;

  return coalesce(v_out, '[]'::jsonb);
end $$;
