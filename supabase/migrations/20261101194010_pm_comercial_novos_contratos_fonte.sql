-- PDCA P&M VERMELHO · /dashboard/pm/comercial — card "Novos contratos (mês)" morto no DEMO
--
-- CAUSA-RAIZ (RD-38, provado no dado · DEMO Agência b0700000-0000-4000-a000-000000000002):
--   O card lia erp_contratos (tipo='agencia_pm') = 0 no DEMO (e, de fato, o fluxo P&M grava os
--   contratos de agência em public.agency_contratos, não em erp_contratos com esse tipo). Fonte errada
--   => card SEMPRE 0 / R$0 (falso-zero, RD-98 p1). Os 4 contratos recorrentes do DEMO (fee) existem em
--   agency_contratos, mas começaram há 3 meses (seed demo-margem) => "novos no mês" = 0 mesmo após o fix.
--
-- ESTA MIGRATION (ADITIVA · SÓ DEMO is_demo — não toca cliente real nem financeiro de cliente):
--   (1) A tela passa a ler agency_contratos (fonte correta); ver src/app/dashboard/pm/comercial/page.tsx.
--   (2) Semeia 1 contrato recorrente com data_inicio no MÊS CORRENTE (marcador 'demo-novo-mes', idempotente)
--       para o card demonstrar dado real. fn_demo_seed_pm_margem (já chamada por fn_demo_reset) ganha o
--       mesmo bloco + um refresh da data_inicio, para não envelhecer na virada do mês.
--   (3) system_screens.views_consumidas do /dashboard/pm/comercial reflete a fonte real (RD-98 p3).
--   (4) Ajuda "?" (RD-95) do KPI corrigida para a nova fonte.
--
-- PROVA (BEGIN…ROLLBACK, statement_timeout=15s, DEMO): após o seed, a consulta do card devolve
--   novos_mes = 1 · valor = R$ 2.800,00 (transação revertida).

-- ── (A) fn_demo_seed_pm_margem: + bloco (D) "contrato novo no mês" (idempotente e autorrefrescante) ──
CREATE OR REPLACE FUNCTION public.fn_demo_seed_pm_margem(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ci-sem-guarda: fn_demo_seed_pm_margem — só a empresa de demonstração fixa da P&M (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000002';
  v_jobs int := 0; v_fees int := 0; v_lig int := 0; v_novo int := 0; r record;
BEGIN
  IF p_company_id IS DISTINCT FROM v_demo
     OR NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_demo_pm');
  END IF;

  -- (A) serviço + valor + custo estimado nos jobs ativos sem valor (janela da tela: 1000 mais recentes).
  --     catálogo humano (sem [BOT]); valor = base ±20%; custo = 35–70% do valor → margem variada p/ o semáforo.
  WITH svc AS (
    SELECT row_number() OVER (ORDER BY m.nome) - 1 AS idx, s.id, m.base
    FROM (VALUES ('Post feed',180),('Carrossel',350),('Stories',120),('Reels',900),
                 ('Banner para site',250),('Folder',400),('Landing page',1500),('Vídeo institucional',2500)) m(nome,base)
    JOIN agency_servico s ON s.company_id = v_demo AND s.nome = m.nome
  ), n AS (SELECT count(*) c FROM svc),
  alvo AS (
    SELECT j.id, abs(hashtext(j.id::text)) h
    FROM agency_jobs j
    WHERE j.company_id = v_demo AND j.excluido_em IS NULL AND coalesce(j.valor_job, 0) = 0
    ORDER BY j.created_at DESC NULLS LAST
    LIMIT 1000
  ),
  pick AS (SELECT a.id, a.h, s.id svc_id, s.base FROM alvo a CROSS JOIN n JOIN svc s ON s.idx = (a.h % n.c))
  UPDATE agency_jobs j
     SET servico_id     = COALESCE(j.servico_id, p.svc_id),
         valor_job      = round((p.base * (0.80 + (p.h % 41)/100.0))::numeric, 2),
         custo_estimado = round((p.base * (0.80 + (p.h % 41)/100.0) * (0.35 + ((p.h/7) % 36)/100.0))::numeric, 2)
    FROM pick p WHERE j.id = p.id;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  -- (B) fees (agency_contratos) para 4 clientes com job, por NOME (estável entre resets). Idempotente por observacoes.
  FOR r IN
    SELECT cl.id cli, v.fee
    FROM (VALUES ('Pet Amigo',2500),('Café Serra Azul',3200),('Clínica Sorriso Vale',3500),('Academia Pulso',1800)) v(nome, fee)
    JOIN agency_clientes cl ON cl.company_id = v_demo AND cl.nome = v.nome
  LOOP
    IF NOT EXISTS (SELECT 1 FROM agency_contratos WHERE company_id = v_demo AND cliente_id = r.cli AND observacoes = 'demo-margem') THEN
      INSERT INTO agency_contratos (company_id, cliente_id, tipo, fee_mensal, dia_vencimento, data_inicio, status, documentacao_ok, observacoes)
      VALUES (v_demo, r.cli, 'recorrente', r.fee, 10,
              (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '3 months')::date,
              'ativo', true, 'demo-margem');
      v_fees := v_fees + 1;
    END IF;
  END LOOP;

  -- (C) liga os jobs ativos (já irrigados) dos clientes de fee ao respectivo fee; os demais ficam "avulso".
  WITH fee AS (SELECT cliente_id, id FROM agency_contratos WHERE company_id = v_demo AND observacoes = 'demo-margem')
  UPDATE agency_jobs j
     SET fee_id = f.id, contrato_id = COALESCE(j.contrato_id, f.id)
    FROM fee f
   WHERE j.company_id = v_demo AND j.excluido_em IS NULL AND j.fee_id IS NULL
     AND j.cliente_id = f.cliente_id AND coalesce(j.valor_job, 0) > 0;
  GET DIAGNOSTICS v_lig = ROW_COUNT;

  -- (D) 1 contrato recorrente NOVO no mês corrente → o Hub Comercial mostra "Novos contratos (mês)" com dado real.
  --     Idempotente pelo marcador 'demo-novo-mes'; a data_inicio se mantém no mês corrente a cada reset (autorrefresca).
  IF NOT EXISTS (SELECT 1 FROM agency_contratos WHERE company_id = v_demo AND observacoes = 'demo-novo-mes') THEN
    INSERT INTO agency_contratos (company_id, cliente_id, tipo, fee_mensal, dia_vencimento, data_inicio, status, documentacao_ok, observacoes)
    SELECT v_demo, cl.id, 'recorrente', 2800, 10,
           date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date, 'ativo', true, 'demo-novo-mes'
    FROM agency_clientes cl
    WHERE cl.company_id = v_demo
      AND NOT EXISTS (SELECT 1 FROM agency_contratos c WHERE c.company_id = v_demo AND c.cliente_id = cl.id)
    ORDER BY cl.nome NULLS LAST, cl.id
    LIMIT 1;
    GET DIAGNOSTICS v_novo = ROW_COUNT;
  ELSE
    UPDATE agency_contratos
       SET data_inicio = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date
     WHERE company_id = v_demo AND observacoes = 'demo-novo-mes'
       AND data_inicio < date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date;
    GET DIAGNOSTICS v_novo = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'jobs_irrigados', v_jobs, 'fees', v_fees, 'jobs_ligados_fee', v_lig, 'novo_mes', v_novo);
END $function$;

-- Guarda da função (RD-52 regra 1): service-only, chamada pelo fn_demo_reset como service_role. Sem rota pública.
REVOKE ALL ON FUNCTION public.fn_demo_seed_pm_margem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_pm_margem(uuid) TO service_role;

-- ── (B) Aplica o bloco (D) AGORA no DEMO (sem re-rodar a irrigação pesada de jobs) ──
DO $$
DECLARE v_demo uuid := 'b0700000-0000-4000-a000-000000000002';
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE id = v_demo AND is_demo IS TRUE) THEN
    IF NOT EXISTS (SELECT 1 FROM agency_contratos WHERE company_id = v_demo AND observacoes = 'demo-novo-mes') THEN
      INSERT INTO agency_contratos (company_id, cliente_id, tipo, fee_mensal, dia_vencimento, data_inicio, status, documentacao_ok, observacoes)
      SELECT v_demo, cl.id, 'recorrente', 2800, 10,
             date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date, 'ativo', true, 'demo-novo-mes'
      FROM agency_clientes cl
      WHERE cl.company_id = v_demo
        AND NOT EXISTS (SELECT 1 FROM agency_contratos c WHERE c.company_id = v_demo AND c.cliente_id = cl.id)
      ORDER BY cl.nome NULLS LAST, cl.id
      LIMIT 1;
    ELSE
      UPDATE agency_contratos
         SET data_inicio = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date
       WHERE company_id = v_demo AND observacoes = 'demo-novo-mes'
         AND data_inicio < date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date;
    END IF;
  END IF;
END $$;

-- ── (C) Origem do dado (RD-98 p3): a tela lê agency_contratos, não mais erp_contratos ──
UPDATE system_screens
   SET views_consumidas = ARRAY['agency_leads','agency_propostas','agency_comissao','agency_contratos']::text[]
 WHERE rota = '/dashboard/pm/comercial';

-- ── (D) Ajuda "?" (RD-95) do KPI corrigida para a nova fonte ──
UPDATE erp_ajuda_campo
   SET o_que_preencher = 'Nada a preencher: conta os contratos de agência (agency_contratos) com início no mês corrente e soma o valor mensal (fee) — contratos de projeto entram pelo valor do projeto.',
       para_que_serve  = 'Mostra o quanto de receita recorrente nova entrou no mês — o crescimento do MRR da agência.',
       exemplo         = '1 novo contrato · R$ 2.800/mês.',
       erro_comum      = 'Confundir com total de contratos: aqui só entram os que começaram neste mês (data de início).'
 WHERE chave = 'pm.comercial.kpi_contratos';
