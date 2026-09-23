-- Varredura de menu (decisão do CEO): catalogar SÓ estas três rotas órfãs agora. P&M/BPO/admin
-- ficam para depois (dependem de decisão de RBAC). Espelha o padrão dos módulos de gestao_empresarial.
--   /dashboard/conciliacao               → gestao_empresarial · financeiro
--   /dashboard/contas                    → gestao_empresarial · financeiro
--   /dashboard/dre-divisional/configurar → gestao_empresarial · analises  (uso admin — o guard da rota
--                                          controla o acesso; module_catalog não tem campo de papel)
-- Sem função nova (fora do gate fn-guards). RD-52.

INSERT INTO public.module_catalog
  (id, nome, grupo, subgrupo, rota, ordem, ativo, is_shared, legacy, rbac_isento, descricao)
VALUES
  ('ge_financeiro_conciliacao', 'Conciliação', 'gestao_empresarial', 'financeiro',
   '/dashboard/conciliacao', 45, true, true, false, false,
   'Conciliação bancária — casar lançamentos do extrato com títulos a pagar/receber.'),
  ('ge_financeiro_contas', 'Contas a Pagar e Receber', 'gestao_empresarial', 'financeiro',
   '/dashboard/contas', 5, true, true, false, false,
   'Contas a pagar e a receber — visão unificada dos títulos financeiros.'),
  ('ge_analises_dre_configurar', 'Configurar DRE', 'gestao_empresarial', 'analises',
   '/dashboard/dre-divisional/configurar', 65, true, true, false, false,
   'Configuração do DRE divisional (uso administrativo).')
ON CONFLICT (id) DO UPDATE
  SET ativo=true, grupo=EXCLUDED.grupo, subgrupo=EXCLUDED.subgrupo, rota=EXCLUDED.rota,
      ordem=EXCLUDED.ordem, nome=EXCLUDED.nome, descricao=EXCLUDED.descricao;
