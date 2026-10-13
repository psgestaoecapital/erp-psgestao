-- Jordana #5: ligar parcelas por grupo p/ replicar edição pras demais. Coluna parcela_grupo_id
-- (aditivo/nullable, RD-55); criação estampa o mesmo grupo; helper das irmãs p/ o prompt; backfill c/ backup.
alter table public.erp_pagar   add column if not exists parcela_grupo_id uuid;
alter table public.erp_receber add column if not exists parcela_grupo_id uuid;
create index if not exists ix_erp_pagar_parcela_grupo   on public.erp_pagar(parcela_grupo_id)   where parcela_grupo_id is not null;
create index if not exists ix_erp_receber_parcela_grupo on public.erp_receber(parcela_grupo_id) where parcela_grupo_id is not null;

create or replace function public.fn_pagar_criar_com_parcelas_v2(p_company_id uuid, p_fornecedor_id uuid, p_fornecedor_nome text, p_descricao text, p_data_emissao date, p_categoria text DEFAULT NULL::text, p_numero_documento text DEFAULT NULL::text, p_forma_pagamento text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_conta_bancaria text DEFAULT NULL::text, p_parcelas jsonb DEFAULT '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
DECLARE
  v_total int; v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid;
  v_soma numeric := 0; r jsonb; i int := 0; v_grupo uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active')
  THEN RETURN jsonb_build_object('sem_plano', true); END IF;
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  v_total := COALESCE(jsonb_array_length(p_parcelas), 0);
  IF v_total < 1 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_parcelas', 'campo', 'parcelas'); END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    i := i + 1;
    IF NULLIF(r->>'valor','') IS NULL OR NULLIF(r->>'data_vencimento','') IS NULL THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'parcela_incompleta', 'indice', i, 'campo', 'parcelas');
    END IF;
    INSERT INTO erp_pagar (
      company_id, fornecedor_id, fornecedor_nome, data_emissao, data_vencimento,
      valor, status, categoria, numero_documento, descricao, parcela,
      forma_pagamento, observacoes, conta_bancaria, data_competencia, created_at, parcela_grupo_id
    ) VALUES (
      p_company_id, p_fornecedor_id, p_fornecedor_nome, p_data_emissao,
      (r->>'data_vencimento')::date,
      (r->>'valor')::numeric, 'aberto', p_categoria, p_numero_documento, p_descricao,
      COALESCE(NULLIF(r->>'n',''), i::text) || '/' || v_total,
      p_forma_pagamento, p_observacao, p_conta_bancaria,
      NULLIF(r->>'data_competencia','')::date, NOW(),
      CASE WHEN v_total > 1 THEN v_grupo ELSE NULL END
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
    v_soma := v_soma + (r->>'valor')::numeric;
  END LOOP;
  RETURN jsonb_build_object('sucesso', true, 'qtd_parcelas_criadas', v_total,
    'valor_total', v_soma, 'ids', to_jsonb(v_ids));
END; $function$;

create or replace function public.fn_pagar_criar_com_parcelas(p_company_id uuid, p_fornecedor_id uuid, p_fornecedor_nome text, p_descricao text, p_valor_total numeric, p_data_emissao date, p_data_primeiro_vencimento date, p_total_parcelas integer DEFAULT 1, p_categoria text DEFAULT NULL::text, p_numero_documento text DEFAULT NULL::text, p_forma_pagamento text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_intervalo_dias integer DEFAULT 30, p_conta_bancaria text DEFAULT NULL::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
DECLARE
  v_valor_parcela numeric; v_valor_atual numeric; v_data_venc date; i int;
  v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid; v_grupo uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active')
  THEN RETURN jsonb_build_object('sem_plano', true); END IF;
  IF p_total_parcelas < 1 THEN p_total_parcelas := 1; END IF;
  v_valor_parcela := ROUND(p_valor_total / p_total_parcelas, 2);
  FOR i IN 1..p_total_parcelas LOOP
    v_data_venc := p_data_primeiro_vencimento + ((i - 1) * p_intervalo_dias);
    v_valor_atual := CASE WHEN i = p_total_parcelas
      THEN p_valor_total - (v_valor_parcela * (p_total_parcelas - 1))
      ELSE v_valor_parcela END;
    INSERT INTO erp_pagar (
      company_id, fornecedor_id, fornecedor_nome, data_emissao, data_vencimento,
      valor, status, categoria, numero_documento, descricao,
      forma_pagamento, observacoes, conta_bancaria, created_at, parcela_grupo_id
    ) VALUES (
      p_company_id, p_fornecedor_id, p_fornecedor_nome, p_data_emissao, v_data_venc,
      v_valor_atual, 'aberto', p_categoria,
      CASE WHEN p_total_parcelas > 1
        THEN COALESCE(p_numero_documento,'') || ' ' || i || '/' || p_total_parcelas
        ELSE p_numero_documento END,
      p_descricao || CASE WHEN p_total_parcelas > 1 THEN ' ('||i||'/'||p_total_parcelas||')' ELSE '' END,
      p_forma_pagamento, p_observacao, p_conta_bancaria, NOW(),
      CASE WHEN p_total_parcelas > 1 THEN v_grupo ELSE NULL END
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
  END LOOP;
  RETURN jsonb_build_object('success', true, 'qtd_parcelas_criadas', p_total_parcelas,
    'valor_por_parcela', v_valor_parcela, 'ids', to_jsonb(v_ids));
END; $function$;

create or replace function public.fn_receber_criar_com_parcelas_v2(p_company_id uuid, p_cliente_id uuid, p_cliente_nome text, p_descricao text, p_data_emissao date, p_categoria text DEFAULT NULL::text, p_numero_documento text DEFAULT NULL::text, p_forma_recebimento text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_conta_bancaria text DEFAULT NULL::text, p_status_inicial text DEFAULT 'aberto'::text, p_parcelas jsonb DEFAULT '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
DECLARE v_total int; v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid; v_soma numeric := 0; r jsonb; i int := 0; v_grupo uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active')
  THEN RETURN jsonb_build_object('sem_plano', true); END IF;
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  v_total := COALESCE(jsonb_array_length(p_parcelas), 0);
  IF v_total < 1 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_parcelas', 'campo', 'parcelas'); END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    i := i + 1;
    IF NULLIF(r->>'valor','') IS NULL OR NULLIF(r->>'data_vencimento','') IS NULL THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'parcela_incompleta', 'indice', i, 'campo', 'parcelas');
    END IF;
    INSERT INTO erp_receber (
      company_id, cliente_id, cliente_nome, data_emissao, data_vencimento,
      valor, status, categoria, numero_documento, descricao, parcela,
      forma_pagamento, observacoes, conta_bancaria, data_competencia, created_at, parcela_grupo_id
    ) VALUES (
      p_company_id, p_cliente_id, p_cliente_nome, p_data_emissao, (r->>'data_vencimento')::date,
      (r->>'valor')::numeric, COALESCE(p_status_inicial,'aberto'), p_categoria, p_numero_documento, p_descricao,
      COALESCE(NULLIF(r->>'n',''), i::text) || '/' || v_total,
      p_forma_recebimento, p_observacao, p_conta_bancaria, NULLIF(r->>'data_competencia','')::date, NOW(),
      CASE WHEN v_total > 1 THEN v_grupo ELSE NULL END
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
    v_soma := v_soma + (r->>'valor')::numeric;
  END LOOP;
  RETURN jsonb_build_object('sucesso', true, 'qtd_parcelas_criadas', v_total,
    'valor_total', v_soma, 'ids', to_jsonb(v_ids));
END; $function$;

create or replace function public.fn_receber_criar_com_parcelas(p_company_id uuid, p_cliente_id uuid, p_cliente_nome text, p_descricao text, p_valor_total numeric, p_data_emissao date, p_data_primeiro_recebimento date, p_total_parcelas integer DEFAULT 1, p_categoria text DEFAULT NULL::text, p_numero_documento text DEFAULT NULL::text, p_forma_recebimento text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_intervalo_dias integer DEFAULT 30, p_status_inicial text DEFAULT 'aberto'::text, p_conta_bancaria text DEFAULT NULL::text, p_forcar_dup boolean DEFAULT false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
DECLARE
  v_valor_parcela numeric; v_valor_atual numeric; v_data_venc date; i int;
  v_status text; v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid; v_grupo uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active')
  THEN RETURN jsonb_build_object('sem_plano', true); END IF;
  IF p_forcar_dup THEN PERFORM set_config('app.forcar_titulo_dup','1', true); END IF;
  IF p_total_parcelas < 1 THEN p_total_parcelas := 1; END IF;
  v_status := CASE WHEN COALESCE(p_status_inicial,'') IN ('aberto','pago','parcial','vencido','cancelado')
    THEN p_status_inicial ELSE 'aberto' END;
  v_valor_parcela := ROUND(p_valor_total / p_total_parcelas, 2);
  FOR i IN 1..p_total_parcelas LOOP
    v_data_venc := p_data_primeiro_recebimento + ((i - 1) * p_intervalo_dias);
    v_valor_atual := CASE WHEN i = p_total_parcelas
      THEN p_valor_total - (v_valor_parcela * (p_total_parcelas - 1)) ELSE v_valor_parcela END;
    INSERT INTO erp_receber (
      company_id, cliente_id, cliente_nome, data_emissao, data_vencimento,
      valor, status, categoria, numero_documento, descricao,
      forma_pagamento, observacoes, conta_bancaria, created_at, parcela_grupo_id
    ) VALUES (
      p_company_id, p_cliente_id, p_cliente_nome, p_data_emissao, v_data_venc,
      v_valor_atual, v_status, p_categoria,
      CASE WHEN p_total_parcelas > 1 THEN COALESCE(p_numero_documento,'') || ' ' || i || '/' || p_total_parcelas ELSE p_numero_documento END,
      p_descricao || CASE WHEN p_total_parcelas > 1 THEN ' ('||i||'/'||p_total_parcelas||')' ELSE '' END,
      p_forma_recebimento, p_observacao, p_conta_bancaria, NOW(),
      CASE WHEN p_total_parcelas > 1 THEN v_grupo ELSE NULL END
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
  END LOOP;
  RETURN jsonb_build_object('success', true, 'qtd_parcelas_criadas', p_total_parcelas,
    'valor_por_parcela', v_valor_parcela, 'status_inicial', v_status, 'ids', to_jsonb(v_ids));
END; $function$;

-- irmãs do grupo de uma parcela (p/ o prompt de réplica) — casts p/ text (colunas são varchar).
create or replace function public.fn_parcela_grupo_irmas(p_tipo text, p_id uuid)
returns table(id uuid, parcela text, parcela_num int, status text, valor numeric, data_vencimento date, pago boolean, atual boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare v_grupo uuid; v_company uuid;
begin
  if p_tipo = 'pagar' then
    select e.parcela_grupo_id, e.company_id into v_grupo, v_company from erp_pagar e where e.id = p_id;
  else
    select e.parcela_grupo_id, e.company_id into v_grupo, v_company from erp_receber e where e.id = p_id;
  end if;
  if v_grupo is null then return; end if;
  if not (v_company in (select get_user_company_ids()) or is_admin()) then return; end if;
  if p_tipo = 'pagar' then
    return query select e.id, e.parcela::text,
      nullif(regexp_replace(split_part(coalesce(e.parcela,''),'/',1),'\D','','g'),'')::int,
      e.status::text, e.valor, e.data_vencimento,
      (lower(coalesce(e.status,'')) = 'pago'), (e.id = p_id)
      from erp_pagar e where e.parcela_grupo_id = v_grupo order by 3 nulls last;
  else
    return query select e.id, e.parcela::text,
      nullif(regexp_replace(split_part(coalesce(e.parcela,''),'/',1),'\D','','g'),'')::int,
      e.status::text, e.valor, e.data_vencimento,
      (lower(coalesce(e.status,'')) = 'pago'), (e.id = p_id)
      from erp_receber e where e.parcela_grupo_id = v_grupo order by 3 nulls last;
  end if;
end $function$;

-- BACKFILL (RD-55: aditivo, backup, só grupos com ≥2 parcelas do mesmo conjunto/dia)
create table if not exists public.bkp_parcela_grupo_backfill_20260810 (tabela text, id uuid, grupo_id uuid, criado_em timestamptz default now());

with base as (
  select id, (company_id::text||'|'||coalesce(fornecedor_id::text,'')||'|'||coalesce(fornecedor_nome,'')||'|'||descricao||'|'||coalesce(numero_documento,'')||'|'||split_part(parcela,'/',2)||'|'||created_at::date::text) k
  from erp_pagar where parcela_grupo_id is null and parcela ~ '^[0-9]+/[0-9]+$' and split_part(parcela,'/',2)::int > 1
),
keys as (select k, gen_random_uuid() g from base group by k having count(*) > 1),
upd as (
  update erp_pagar p set parcela_grupo_id = keys.g from base join keys using(k) where p.id = base.id returning p.id, keys.g
)
insert into public.bkp_parcela_grupo_backfill_20260810(tabela, id, grupo_id) select 'pagar', id, g from upd;

with base as (
  select id, (company_id::text||'|'||coalesce(cliente_id::text,'')||'|'||coalesce(cliente_nome,'')||'|'||descricao||'|'||coalesce(numero_documento,'')||'|'||split_part(parcela,'/',2)||'|'||created_at::date::text) k
  from erp_receber where parcela_grupo_id is null and parcela ~ '^[0-9]+/[0-9]+$' and split_part(parcela,'/',2)::int > 1
),
keys as (select k, gen_random_uuid() g from base group by k having count(*) > 1),
upd as (
  update erp_receber p set parcela_grupo_id = keys.g from base join keys using(k) where p.id = base.id returning p.id, keys.g
)
insert into public.bkp_parcela_grupo_backfill_20260810(tabela, id, grupo_id) select 'receber', id, g from upd;
