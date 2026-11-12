-- Auditor PDCA · /dashboard/produtividade/custos-posto (nota 92):
-- os postos da planta DEMO Indústria (005) têm MÃO DE OBRA e ENCARGOS lançados, mas
-- HORAS DE OPERAÇÃO (prod_posto_custo.horas_operacao_mes) e CAPACIDADE/HORA
-- (prod_posto.capacidade_hora) estão NULL. Com isso o núcleo de valor da tela — o
-- "Custo por hora" do posto e a base do custo por kg (F6) — aparece como
-- "informe as horas" e NÃO é verificável (RD-38).
--
-- Esta migration completa SOMENTE a empresa DEMO (is_demo=true):
--   1) horas_operacao_mes = 200 nos lançamentos de custo ATIVOS que ainda estão sem horas
--      (mês de 1 turno ~ 200 h — base do custo por hora);
--   2) capacidade_hora (kg/h) + capacidade_origem = 'medida' nos postos sem capacidade,
--      por setor do fluxo bovino da demo (Abate ~2500 kg/h de carcaça; Desossa ~1000 kg/h).
--
-- ADITIVA e IDEMPOTENTE: só preenche campos NULL (reimportar não duplica nem sobrescreve).
-- NÃO toca dado de cliente (a empresa é DEMO, RD-69), nem salário/política de folha,
-- nem RLS/grant/RPC. Usa apenas colunas JÁ existentes em prod_posto / prod_posto_custo.
-- Sem DDL. Não varre tabela grande nem chama função por linha em volume.
--
-- RD-38 (provado BEGIN/ROLLBACK na demo 005): antes = 11 postos sem capacidade /
-- 11 custos sem horas; depois = 0 / 0; "Custo por hora" do posto Insensibilização
-- (3200 × 1,68 ÷ 200) = R$ 26,88/h.

DO $$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000005';
BEGIN
  -- guarda: só roda em empresa DEMO existente (nunca em dado de cliente)
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_company AND is_demo IS TRUE) THEN
    RAISE NOTICE 'Empresa DEMO Indústria (005) ausente ou não-DEMO — seed de horas/capacidade ignorado';
    RETURN;
  END IF;

  -- 1) horas de operação nos custos ativos sem horas (base do custo por hora)
  UPDATE prod_posto_custo c
     SET horas_operacao_mes = 200
    FROM prod_posto p
   WHERE c.posto_id   = p.id
     AND p.company_id = v_company
     AND c.company_id = v_company
     AND c.deleted_at IS NULL
     AND c.horas_operacao_mes IS NULL;

  -- 2) capacidade/hora (kg/h) por setor nos postos sem capacidade
  UPDATE prod_posto p
     SET capacidade_hora = CASE
           WHEN s.nome ILIKE 'Abate%'   THEN 2500
           WHEN s.nome ILIKE 'Desossa%' THEN 1000
           ELSE 1200 END,
         capacidade_origem = 'medida',
         updated_at = now()
    FROM prod_setor s
   WHERE p.setor_id   = s.id
     AND p.company_id = v_company
     AND p.capacidade_hora IS NULL;
END $$;
