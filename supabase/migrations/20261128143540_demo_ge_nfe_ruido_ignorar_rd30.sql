-- SÓ-DEMO · RD-30 safe · redo de #6348 (revertida por #6367)
-- ---------------------------------------------------------------------------
-- A versão anterior (#6348) criava fn_demo_ge_nfe_limpar_ruido fazendo DELETE
-- FÍSICO em erp_nfe_recebidas. Essa tabela tem a guarda RD-30
-- (trg_bloqueia_delete_fisico → "documento financeiro/folha não se apaga"),
-- então a migration abortou de forma atômica e deixou o deploy-migrations
-- vermelho (runs 4912/4913/4914). A guarda RD-30 está CORRETA e fica intacta.
--
-- Correção: NÃO apagar. O ruído de SEED da DEMO GE (eventos NSU/manifestação
-- "resumo" que só têm a chave — sem emitente e sem valor, status
-- 'aguardando_xml') é marcado como 'ignorada' (soft). A aba padrão da tela
-- (/dashboard/compras/documentos-recebidos, alias /dashboard/fiscal/nfe-recebidas)
-- abre em "A concluir" → fn_nfe_recebidas_listar com p_situacao='a_concluir',
-- cujo filtro já exclui status='ignorada' (e o componente também filtra
-- status !== 'ignorada'). Assim a inbox da DEMO deixa de abrir dominada por
-- linhas "—/—" e passa a demonstrar a jornada real (315 notas com resumo + as
-- completas/lançadas), sem violar a RD-30.
--
-- Escopo: SOMENTE a empresa DEMO GE (is_demo=true). NUNCA toca dado de cliente
-- real. UPDATE set-based único (sem função por linha), idempotente.
-- Code: code-desenvolvedor-3
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000004';
  v_n int := 0;
BEGIN
  -- Trava de segurança: só executa se a empresa for de fato DEMO.
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_demo AND is_demo = true) THEN
    RAISE NOTICE 'empresa % nao e DEMO — nada a fazer (RD-30 safe)', v_demo;
    RETURN;
  END IF;

  UPDATE public.erp_nfe_recebidas
     SET status = 'ignorada', updated_at = now()
   WHERE company_id = v_demo
     AND status = 'aguardando_xml'
     AND emitente_razao IS NULL
     AND valor_total  IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RAISE NOTICE 'DEMO GE NF-e ruido marcado como ignorada: % linhas', v_n;

  -- Trilha de auditoria (idempotente: só grava quando houve mudança).
  IF v_n > 0 THEN
    INSERT INTO public.audit_log_global
      (company_id, tabela, registro_id, acao, valor_novo, created_at)
    VALUES
      (v_demo, 'erp_nfe_recebidas', NULL, 'demo_seed_ignorar_ruido',
       jsonb_build_object(
         'linhas', v_n,
         'motivo', 'SO-DEMO: NSU/resumo sem emitente/valor marcadas ignoradas (RD-30 safe, redo #6348)',
         'code', 'code-desenvolvedor-3'),
       now());
  END IF;
END $$;
