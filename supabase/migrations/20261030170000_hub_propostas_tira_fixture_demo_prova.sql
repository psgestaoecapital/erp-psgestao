-- Hub/Propostas (auditor 28/10, RD-98 p1): a proposta-fixture "ORC-DEMO-OBRA-PROVA" (R$ 1.000, sem cliente nem itens)
-- polui a lista da empresa DEMO-006. Exclusão rastreável (soft-delete: quem/quando/por quê + audit_log), nunca DELETE.
-- ADITIVA em dado: só uma linha, só da empresa DEMO (id fixo), idempotente.
WITH alvo AS (
  UPDATE public.erp_orcamentos
     SET deleted_at = now(), motivo_exclusao = 'Fixture de prova da DEMO (sem cliente e sem itens) — retirada da lista'
   WHERE id = '02dd1195-15a2-4929-9cc7-a2fcae9c27a0'
     AND company_id = 'b0700000-0000-4000-a000-000000000006'
     AND numero = 'ORC-DEMO-OBRA-PROVA'
     AND deleted_at IS NULL
  RETURNING id, company_id, numero, status, total
)
INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
SELECT company_id, NULL, 'erp_orcamentos', id::text, 'excluir',
       jsonb_build_object('numero', numero, 'status', status, 'total', total),
       jsonb_build_object('motivo', 'Fixture de prova da DEMO retirada da lista (migration)')
  FROM alvo;
