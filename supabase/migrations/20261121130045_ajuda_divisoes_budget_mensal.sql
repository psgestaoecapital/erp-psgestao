-- RD-95 (CEO 08/10): "?" em TODO campo editável. Auditoria PDCA (19/11) em
-- /dashboard/cadastros/divisoes: a tela (componente LinhasNegocioList) já tem
-- ajuda em todas as ações, mas o modal "Definir planejado" (LdnBudgetForm) tem
-- dois CAMPOS editáveis sem "?": "Receita por mês" e "Despesa por mês".
-- Esta migração popula o texto de ajuda desses dois campos, no mesmo padrão
-- das demais chaves ge.divisoes.* (vertical gestao_empresarial, grupo
-- "Divisões da empresa"). Aditiva e idempotente (ON CONFLICT (chave) DO UPDATE);
-- só catálogo de ajuda, não toca dado de cliente nem estrutura.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('ge.divisoes.budget_receita',
   '/dashboard/cadastros/divisoes', 'Divisões da empresa', 'Receita por mês (planejado)',
   'Quanto você espera FATURAR por mês nesta divisão. O sistema aplica o mesmo valor aos 12 meses do ano e mostra o total anual.',
   'Define a meta de receita da divisão, usada para comparar o planejado com o realizado no DRE de cada divisão.',
   'Ex.: 50000 se a divisão de Tintas deve faturar R$ 50.000 por mês — o total anual vira R$ 600.000,00.',
   'Digitar o valor do ANO inteiro no campo mensal: aqui é o valor de UM mês; o sistema multiplica por 12.',
   'gestao_empresarial', 6),

  ('ge.divisoes.budget_despesa',
   '/dashboard/cadastros/divisoes', 'Divisões da empresa', 'Despesa por mês (planejado)',
   'Quanto você espera GASTAR por mês nesta divisão (custos e despesas). O sistema aplica aos 12 meses e mostra o total anual.',
   'Define a meta de despesa da divisão; junto com a receita planejada, o sistema calcula a margem esperada (receita − despesa).',
   'Ex.: 35000 se a divisão de Tintas deve gastar R$ 35.000 por mês — margem esperada de R$ 15.000 por mês.',
   'Digitar o valor do ANO inteiro no campo mensal: aqui é o valor de UM mês; o sistema multiplica por 12.',
   'gestao_empresarial', 7)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem,
  versao = public.erp_ajuda_campo.versao + 1, atualizado_em = now();
