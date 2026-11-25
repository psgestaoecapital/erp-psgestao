-- DEMO · GE · "Resultado por negócio" / DRE — purga do lixo de E2E que envenena os totais (RD-38).
-- Code: desenvolvedor_4_g.
--
-- CAUSA RAIZ (provada no banco, DEMO Comércio GE b0700000-...-0004): títulos de teste E2E com
-- descrição 'Mensalidade E2E <rand>-<n>' e valor 9.999.999.999.999,99 ficam vivos em erp_receber
-- (deleted_at IS NULL). Um único título de ~R$10 tri já infla "Resultado da empresa" e "Receita sem
-- negócio" para R$10 TRI, tornando o DRE/Resultado por negócio sem sentido para o usuário.
-- Mesmo marcador do balanço-patrimonial e caixa-grupo. O purgador server-side
-- fn_e2e_purgar_receber_demo (20261120013245) já existe, mas NÃO cobria o marcador 'Mensalidade E2E %'.
--
-- CORREÇÃO (2 partes, aditiva/idempotente):
--   1) Acrescenta o marcador 'Mensalidade E2E %' ao purgador (mesma mecânica set-based em lotes de 5000,
--      só is_demo, só soft-delete — não dispara RD-30 BEFORE DELETE). Assim o teardown do E2E passa a
--      drenar esse lixo também, de forma durável.
--   2) Roda o purgador UMA vez no deploy, limpando o lixo que já está vivo na DEMO de produção.
--
-- SEGURANÇA/ESCOPO (RD-38, prova no PR): o marcador 'Mensalidade E2E %' casa SÓ títulos de teste E2E
-- (nenhum cliente real nomeia "Mensalidade E2E <aleatório>"); zero títulos legítimos ("Mensalidade …"
-- comum, "Recebimento …", "Venda …", "Serviço …") são tocados. SECURITY DEFINER + search_path fixo +
-- REVOKE anon. Não altera dado de cliente (só is_demo), não cria/altera tabela/RLS.

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
          OR r.descricao LIKE 'Mensalidade E2E %'        -- mensalidade de teste E2E (valor sentinela que envenena o DRE)
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

-- Limpeza única no deploy: drena o lixo 'Mensalidade E2E %' (e demais marcadores) já vivo na DEMO.
SELECT public.fn_e2e_purgar_receber_demo();
