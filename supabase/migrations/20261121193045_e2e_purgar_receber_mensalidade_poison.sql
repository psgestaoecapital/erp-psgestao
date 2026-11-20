-- Purga durável do lixo E2E "Mensalidade E2E *" em erp_receber das DEMO — adiciona marcador faltante.
-- PDCA GE 19/11 (tarefa 9695c0c8, /dashboard/gestao-empresarial/resultado-por-negocio).
--
-- CAUSA RAIZ (provada RD-38 no banco de produção, DEMO Comércio GE b0700000-...-0004): a aceitação
-- e2e/jornadas/aceitacao/ge-comissoes-recorrentes.spec.ts insere recebíveis de teste com
-- descricao = 'Mensalidade E2E <RUN>-<seq>' (criarRecebivel, linha 57) e NÃO os rastreia para limpeza no
-- afterAll (só rastreia fornecedores/contratos). Quando o run é cancelado/estoura timeout — ou mesmo em run
-- normal — esses títulos vazam. Alguns casos usam valor absurdo (9.999.999.999.999,99), e como o resultado
-- por negócio / DRE somam erp_receber, um punhado dessas linhas infla os cards para "R$10 TRI" ("Resultado da
-- empresa", "Receita sem negócio") — o usuário não confia na tela (foto do auditor 19/11 23:28: 185+ linhas).
--
-- O purgador durável fn_e2e_purgar_receber_demo (migration 20261120013245) drena vários marcadores e2e
-- SERVER-SIDE no passo "sempre" do teardown (scripts/e2e-trava-soltar.ts), mas o marcador 'Mensalidade E2E *'
-- NÃO estava na lista — por isso essas linhas nunca drenavam e reapareciam a cada run de comissões recorrentes.
--
-- CORREÇÃO: acrescenta o marcador 'Mensalidade E2E %' à MESMA função (soft-delete set-based em lotes de 5000,
-- sem função-por-linha — não repete o incidente de 03/10). Idempotente (só pega deleted_at IS NULL).
--
-- SEGURANÇA/ESCOPO: SÓ empresas is_demo; marcador DEDICADO e2e, inconfundível ('Mensalidade E2E ' com o literal
-- "E2E" no nome). Prova RD-38 (banco prod, is_demo): os recebíveis legítimos da DEMO usam "Mensalidade " SEM o
-- "E2E" (ex.: "Mensalidade jan/2026") — a verificação `descricao LIKE 'Mensalidade %' AND NOT LIKE
-- 'Mensalidade E2E %' AND valor >= 9999999999999` devolve 0, e todo recebível 'Mensalidade E2E %' é artefato
-- de teste por nome, independente do valor. Falso-positivo = 0. Soft-delete (UPDATE deleted_at) passa pela RLS,
-- NÃO dispara a trava RD-30 BEFORE DELETE nem o trigger de status. SECURITY DEFINER + search_path fixo + REVOKE anon.

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
          OR r.descricao LIKE 'Mensalidade E2E %'        -- ge-comissoes-recorrentes (poison R$10 TRI no resultado-por-negocio)
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
