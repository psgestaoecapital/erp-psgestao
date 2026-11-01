-- Acervo do Takeoff (/dashboard/projetos/takeoff/acervo): ajuda "?" da ação "Excluir planta" (RD-95).
-- ADITIVA: apenas insere a chave de ajuda da nova ação. A exclusão em si REUSA a RPC já existente
-- public.fn_takeoff_planta_excluir(p_planta_id, p_motivo), que faz soft-delete rastreável
-- (deleted_at + deleted_by + motivo_exclusao + audit_log_global), com guarda de empresa
-- (fn__guarda_empresa) e bloqueio de planta já confirmada (que virou itens de orçamento).
-- Idempotente (WHERE NOT EXISTS): rodar 2x não duplica.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT
  'hub.takeoff.acervo.excluir',
  '/dashboard/projetos/takeoff/acervo',
  'Acervo · Ação',
  'Excluir planta',
  'Ação: manda a planta analisada para a lixeira. É exclusão rastreável — guarda quem excluiu, quando e o motivo; o registro não some do banco.',
  'Tirar do acervo uma planta enviada por engano ou duplicada, sem perder o histórico de auditoria.',
  'Planta "Pavimento Tipo" subida duas vezes → Excluir na duplicada → informe o motivo; ela sai da lista mas fica auditável.',
  'Tentar excluir planta que já virou itens de orçamento (confirmada): não é permitido — primeiro desfaça o orçamento.',
  'hub', 5, 1, 'publicado'
WHERE NOT EXISTS (SELECT 1 FROM erp_ajuda_campo WHERE chave = 'hub.takeoff.acervo.excluir');
