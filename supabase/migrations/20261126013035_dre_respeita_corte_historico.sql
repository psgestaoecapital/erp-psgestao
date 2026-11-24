-- conserto-main (RD-52) · gilberto-esteira · 24/11/2026
-- ============================================================================
-- Reconciliação de ÓRFÃO do ledger: a migration `dre_respeita_corte_historico`
-- foi APLICADA direto em produção (carimbo de HORÁRIO 20261124132334, fora do
-- padrão de faixa) SEM arquivo no repo. O `supabase db push --include-all`
-- abortava com "Remote migration versions not found in local migrations
-- directory" (versão 20261124132334), deixando o deploy-migrations VERMELHO e
-- travando TODAS as migrations.
--
-- RD-38 (provado no dado antes da reconciliação):
--   • coluna erp_empresa_corte_historico.ocultar_dre EXISTE;
--   • fn_psgc_recalcular_dre_mes JÁ contém o corte por ocultar_dre;
--   • 2 empresas com ocultar_dre = true.
-- Ou seja, o conteúdo abaixo JÁ RODOU em produção. Este arquivo é IDEMPOTENTE:
-- re-rodar não altera dado (ADD COLUMN IF NOT EXISTS; UPDATE só em linha ainda
-- não marcada; patch de função com early-return; DELETE guardado por corte).
-- Governança: aplicação direta de migration de NÚCLEO FINANCEIRO sem PR/arquivo
-- é violação de RD-52 — alertado ao Eng. Chefe/CEO no handoff.
-- ============================================================================

ALTER TABLE public.erp_empresa_corte_historico ADD COLUMN IF NOT EXISTS ocultar_dre boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.erp_empresa_corte_historico.ocultar_dre IS 'Quando true, a DRE (psgc_dre) não é calculada para meses anteriores a data_corte.';

-- idempotente: só toca linha ainda NÃO marcada (não re-apênda motivo nem re-bumpa atualizado_em)
UPDATE public.erp_empresa_corte_historico SET ocultar_dre = true, atualizado_em = now(), motivo = motivo || ' | DRE também a partir do corte'
WHERE company_id IN ('b26c19c0-bf6d-495b-b8d1-9fa8d6896725','25305b15-09e1-4abe-944f-9bff31743350')
  AND ocultar_dre IS DISTINCT FROM true;

DO $mig$
DECLARE d text; alvo text;
BEGIN
  d := pg_get_functiondef('public.fn_psgc_recalcular_dre_mes'::regproc);
  IF position('ocultar_dre' in d) > 0 THEN RETURN; END IF;
  alvo := $a$v_data_fim := (v_data_inicio + interval '1 month - 1 day')::date;$a$;
  IF position(alvo in d) = 0 THEN RAISE EXCEPTION 'ponto de inserção não encontrado'; END IF;
  d := replace(d, alvo, alvo || $g$

  -- corte do histórico: empresa que recomeçou o financeiro não tem DRE antes da data de corte
  IF EXISTS (SELECT 1 FROM erp_empresa_corte_historico ch
             WHERE ch.company_id = p_company_id AND ch.ocultar_dre AND v_data_fim < ch.data_corte) THEN
    DELETE FROM psgc_dre WHERE company_id = p_company_id AND ano = p_ano AND mes = p_mes;
    RETURN;
  END IF;$g$);
  EXECUTE d;
END
$mig$;

DELETE FROM public.psgc_dre d
USING public.erp_empresa_corte_historico ch
WHERE ch.company_id = d.company_id AND ch.ocultar_dre
  AND make_date(d.ano, d.mes, 1) < ch.data_corte;
