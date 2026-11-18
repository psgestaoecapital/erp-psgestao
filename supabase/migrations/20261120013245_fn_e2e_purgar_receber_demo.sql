-- Purga durável do lixo de E2E em erp_receber das DEMO — SERVER-SIDE (PDCA GE 18/11, tarefas 0c3345df/26111304).
-- CAUSA RAIZ (provada RD-38 no banco de produção, DEMO Comércio GE b0700000-...-0004): o purgador de títulos de
-- teste existe em e2e/support/api.ts (purgarReceberDemo) e roda no passo "sempre" do e2e (scripts/e2e-trava-soltar.ts),
-- mas faz UM PATCH do PostgREST por marcador cobrindo TODAS as linhas de uma vez. O marcador "Contas500 *" casa ~30 mil
-- títulos vivos (deleted_at IS NULL); o PATCH único dessas 30k linhas estoura o timeout do pooler/PostgREST e o erro é
-- engolido ("[purga-receber] ... falhou (segue)"). Resultado: os marcadores PEQUENOS limpam, mas o grande ("Contas500
-- antigo", 30.160 linhas) NUNCA dreva — fica estacionado em ~30,3k, poluindo /receber e as listas da DEMO.
--
-- CORREÇÃO: esta função faz a MESMA limpeza dos mesmos marcadores, porém SERVER-SIDE, em UMA RPC só, com soft-delete
-- SET-BASED em lotes (LIMIT 5000) — nada de função por linha (não repete o incidente de 03/10) e sem o round-trip de
-- 30k linhas do PostgREST. Set-based é sub-segundo por lote; o laço drena os 30k numa única chamada, terminando mesmo
-- na janela curta do teardown de um run cancelado. Idempotente: só pega deleted_at IS NULL.
--
-- SEGURANÇA/ESCOPO: SÓ empresas is_demo; SÓ os marcadores DEDICADOS e2e (espelham MARCADORES_RECEBER_E2E em
-- e2e/support/api.ts). Prova RD-38 (banco prod, is_demo): 30.218 títulos casam os marcadores e deleted_at IS NULL, e
-- ZERO títulos legítimos ("Recebimento …", "Venda …", "Mensalidade …", "Serviço …", "DEMO-…", "Boleto …",
-- "…demonstração") casam — falso-positivo = 0. Soft-delete (UPDATE deleted_at) passa pela RLS, NÃO dispara a trava
-- RD-30 BEFORE DELETE (não é DELETE físico) nem o trigger de status. SECURITY DEFINER + search_path fixo + REVOKE anon.

CREATE OR REPLACE FUNCTION public.fn_e2e_purgar_receber_demo()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions, pg_temp
  SET statement_timeout = '60s'
AS $$
DECLARE v_total int := 0; v_lote int;
BEGIN
  LOOP
    WITH alvo AS (
      SELECT r.id
      FROM public.erp_receber r
      JOIN public.companies c ON c.id = r.company_id
      WHERE c.is_demo = true
        AND r.deleted_at IS NULL
        AND (
             r.descricao LIKE 'Contas500 %'              -- caminho-contas-mais-de-500-titulos
          OR r.descricao LIKE 'Aceitação #%'             -- aceitações numeradas
          OR r.descricao LIKE 'Aceitação achado %'       -- pdois-juros-reconciliar-achado-a
          OR r.descricao LIKE 'Regressão achado B %'     -- pdois-juros-reconciliar-achado-b
          OR r.descricao LIKE 'Aceitação baixa por banco %' -- kgf/baixa-por-banco
          OR r.descricao LIKE 'Aceitação unificar %'     -- unificar-titulos
          OR r.descricao LIKE 'Caminho receber %'        -- caminho-financeiro-receber
          OR r.descricao LIKE 'Caminho conciliação %'    -- caminho-conciliacao
          OR r.descricao LIKE 'Pedido MED-%'             -- pedido medição/parcelas
        )
      LIMIT 5000
    )
    UPDATE public.erp_receber r
       SET deleted_at = now()
      FROM alvo
     WHERE r.id = alvo.id;
    GET DIAGNOSTICS v_lote = ROW_COUNT;
    v_total := v_total + v_lote;
    EXIT WHEN v_lote = 0;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'receber_soft_deletados', v_total);
END $$;

REVOKE ALL ON FUNCTION public.fn_e2e_purgar_receber_demo() FROM anon;
