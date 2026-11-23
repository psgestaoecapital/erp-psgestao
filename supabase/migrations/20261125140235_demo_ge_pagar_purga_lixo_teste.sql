-- PDCA GE · /dashboard/gestao-empresarial (hub) · /financeiro/fluxo-caixa · /caixa-grupo — lado A PAGAR
-- code-desenvolvedor-3 · RD-38 (provado no dado) · RD-69 (DEMO sem poluição de teste) · RD-97 (UPDATE = destrutivo → SENSÍVEL)
--
-- IRMÃ da #5747 (que purgou o lado /receber). A #5747 só limpa erp_receber; o lado A PAGAR seguia poluído por lixo
-- de TESTE na DEMO "Comércio (GE)" (b0700000-0000-4000-a000-000000000004).
--
-- PROBLEMA (provado no dado, read-only, 22/11/2026): erp_pagar VIVO da DEMO GE = 118 títulos (soma R$ 567.544,15),
-- SEM nenhum valor absurdo (0 títulos >= R$ 1 bi — ou seja, NÃO há o "R$10 tri" do lado /receber aqui). Classificação
-- RD-38 dos 118 vivos:
--   JUNK_teste    =  28  (soma R$ 203.700,25)  → assinatura de TESTE (E2E / aceitação / CIELO-aceite com sufixo aleatório)
--   LEGIT_seed    =  11  (DEMO-GE-FIN% + Retirada de sócio)
--   OUTRO_legit   =  79  (NF-e compra 90000000x, "Compra PC-9009", fornecedores Alfa/Beta/Gama — dado realista de DEMO)
--   → o purge atinge SÓ os 28 JUNK; os 90 títulos legítimos (seed + NF-e/compras realistas) permanecem.
-- Destaque: 7 títulos "E2E fluxo pagar <sufixo>" VENCIDOS somam R$ 172.769,45 e inflam o KPI "A pagar vencido" do hub GE
-- (fn_ge_kpis_dashboard lê erp_pagar vencido); +1 "E2E fluxo pagar" PAGO (R$ 24.681,35 de realizado-fantasma inline).
--
-- Baixa de pagar é INLINE em erp_pagar (fn_pagar_baixar_pagamento atualiza valor_pago/status; NÃO há tabela
-- erp_pagar_baixa). Logo, o soft-delete do título remove o realizado-fantasma de todas as views (filtram deleted_at IS NULL).
--
-- FIX (RD-69): função idempotente de limpeza (soft-delete reversível + cópia de segurança) que remove o lixo de TESTE
-- por assinatura — SÓ na empresa DEMO (guarda is_demo), protegendo explicitamente o seed e as compras realistas.
-- Aditiva/idempotente (guardas deleted_at IS NULL): reexecutar não altera nada. Nenhum dado de cliente real é tocado.
-- Soft-delete é rastreável e REVERSÍVEL (backup + UPDATE ... SET deleted_at = deleted_at_old abaixo, no corpo da PR).
-- Faixa de segundos :40 (code-desenvolvedor-3). PR SENSÍVEL (revisao-eng-chefe) + label so-demo (toda escrita por is_demo).
--
-- AUTO-CURA (durável): a chamada da auto-cura no início de fn_demo_seed_ge_financeiro é um FOLLOW-UP sequenciado
-- APÓS o merge da #5747 (que já reescreve a MESMA função para o purge de /receber). Reescrever fn_demo_seed_ge_financeiro
-- aqui colidiria com a #5747 (dois CREATE OR REPLACE do mesmo objeto, um dropando a linha do outro conforme a ordem).
-- Esta migration é INDEPENDENTE da #5747: só cria objeto novo + limpa o estado atual. O hook de reset entra depois,
-- como superset estável do seed pós-#5747.

-- ── Cópia de segurança (reversível): ids + deleted_at antigo, antes de qualquer alteração ──
CREATE TABLE IF NOT EXISTS public.erp_pagar_lixo_teste_bkp_c3 (
  pagar_id        uuid PRIMARY KEY,
  company_id      uuid NOT NULL,
  fornecedor_nome text,
  descricao       text,
  valor           numeric,
  status          text,
  deleted_at_old  timestamptz,
  capturado_em    timestamptz NOT NULL DEFAULT now()
);
-- Tabela de backup é registro interno de operação: RLS ligada, sem policy permissiva, REVOKE anon (gate RLS).
ALTER TABLE public.erp_pagar_lixo_teste_bkp_c3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_pagar_lixo_teste_bkp_c3 FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.erp_pagar_lixo_teste_bkp_c3 TO service_role;

-- ── Função de limpeza reutilizável: soft-delete do lixo de TESTE de /pagar na DEMO GE ──
-- ci-sem-guarda: fn_demo_ge_pagar_purgar_lixo_teste — função de DEMO: guarda por is_demo (nunca toca empresa real),
--                só service_role (REVOKE anon abaixo); não grava dado de empresa real, só soft-delete de lixo de teste.
CREATE OR REPLACE FUNCTION public.fn_demo_ge_pagar_purgar_lixo_teste(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_tit int := 0;
BEGIN
  -- Só roda se a empresa existir E for DEMO (nunca toca empresa real nem ambiente sem a DEMO).
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company AND c.is_demo = true) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_ausente_ou_nao_demo');
  END IF;

  -- Conjunto-alvo: títulos VIVOS com assinatura de TESTE e que NÃO são seed/compra legítima.
  CREATE TEMP TABLE _lixo_pag_c3 ON COMMIT DROP AS
  SELECT p.id
    FROM public.erp_pagar p
   WHERE p.company_id = p_company
     AND p.deleted_at IS NULL
     -- proteção explícita do legítimo (seed documentado + retirada de sócio): nunca removido.
     AND NOT (
          COALESCE(p.numero_documento LIKE 'DEMO-GE-FIN%', false)
       OR COALESCE(p.categoria = 'Retirada de sócio', false)
     )
     -- assinatura de TESTE (E2E / aceitação / CIELO-aceite com sufixo aleatório):
     AND (
          COALESCE(p.descricao       ILIKE 'E2E %', false)
       OR COALESCE(p.descricao       ILIKE '%E2E %', false)
       OR COALESCE(p.descricao       ILIKE 'Aceitação #%', false)
       OR COALESCE(p.descricao       ILIKE 'Aceitacao #%', false)
       OR COALESCE(p.fornecedor_nome ILIKE 'E2E %', false)
       OR COALESCE(p.fornecedor_nome ILIKE '%E2E%', false)
       OR COALESCE(p.fornecedor_nome ILIKE 'CIELO ACEITE %', false)
       OR COALESCE(p.fornecedor_nome ILIKE 'Fornecedor Aceita%', false)
     );

  -- Backup (idempotente) antes de alterar.
  INSERT INTO public.erp_pagar_lixo_teste_bkp_c3 (pagar_id, company_id, fornecedor_nome, descricao, valor, status, deleted_at_old)
  SELECT p.id, p.company_id, p.fornecedor_nome, p.descricao, p.valor, p.status, p.deleted_at
    FROM public.erp_pagar p JOIN _lixo_pag_c3 l ON l.id = p.id
  ON CONFLICT (pagar_id) DO NOTHING;

  -- Soft-delete dos TÍTULOS de lixo (realizado-fantasma é inline no mesmo registro → sai junto).
  UPDATE public.erp_pagar p
     SET deleted_at = now()
    FROM _lixo_pag_c3 l
   WHERE p.id = l.id
     AND p.deleted_at IS NULL;
  GET DIAGNOSTICS v_tit = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'company', p_company, 'titulos_purgados', v_tit);
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_demo_ge_pagar_purgar_lixo_teste(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_ge_pagar_purgar_lixo_teste(uuid) TO service_role;

-- ── Limpeza ÚNICA do estado atual de produção (DEMO "Comércio (GE)") ──
DO $once$
DECLARE r jsonb;
BEGIN
  SELECT public.fn_demo_ge_pagar_purgar_lixo_teste('b0700000-0000-4000-a000-000000000004') INTO r;
  RAISE NOTICE 'Purga única DEMO GE /pagar: %', r;
END
$once$;
