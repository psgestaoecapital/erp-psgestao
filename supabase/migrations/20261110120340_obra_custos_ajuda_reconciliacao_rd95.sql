-- RD-95: "?" do novo texto de reconciliação na tela de Custos da obra.
-- Aditiva e idempotente: só insere a chave de ajuda nova (projetos.obra_custos.reconciliacao),
-- que explica que o total da lista é só despesas diretas e o custo realizado completo está no Cockpit.
-- Tarefa PDCA Hub /dashboard/projetos/obras/[id]/custos · Code: code-desenvolvedor-3
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.obra_custos.reconciliacao',
   '/dashboard/projetos/obras/[id]/custos',
   'Custo da obra',
   'Despesas diretas × custo realizado',
   'Nada a preencher — é uma explicação de como esta lista se relaciona com o custo total da obra.',
   'Esclarece que o total desta tela soma apenas as despesas diretas lançadas aqui. O custo realizado completo da obra (que aparece no Cockpit) também inclui o material dos pedidos de compra, as viagens e a mão de obra por hora — por isso o número do Cockpit costuma ser maior.',
   'Lista aqui: R$ 2.463,35 · Custo realizado no Cockpit: R$ 188.939,09 (inclui material de pedidos, viagens e mão de obra).',
   'Achar que os dois números deveriam ser iguais: eles medem coisas diferentes (despesas diretas × custo realizado completo).',
   'projetos', 81, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
