-- RD-95: "?" na busca da tela Vender e Faturar (OTC, GE).
-- O auditor (PDCA GE, /dashboard/commerce/otc) apontou que o campo de busca do quadro
-- (orçamentos/pedidos/faturados) abria SEM o "?" de ajuda, enquanto as demais ações já tinham.
-- Aditiva/idempotente: só insere/atualiza chave de ajuda; nenhuma mudança em RLS/cálculo/dado.
-- Faixa desenvolvedor_4_g (segundos :45).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('otc.busca', '/dashboard/commerce/otc', 'Vender e Faturar', 'Busca',
   'Digite o número do orçamento/pedido ou parte do nome do cliente para filtrar os cartões do quadro.',
   'Acha rápido um orçamento, pedido ou faturado específico sem procurar coluna por coluna.',
   'Ex.: digitar "Silva" para ver só os cartões do cliente Silva.',
   '—',
   'gestao_empresarial', 20, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
