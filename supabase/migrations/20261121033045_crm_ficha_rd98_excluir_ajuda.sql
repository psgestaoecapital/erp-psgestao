-- RD-98 (exclusão rastreável visível) + RD-95: ajuda do botão "Excluir negócio" na ficha do negócio
-- (/dashboard/crm/oportunidade/[id]). A exclusão usa fn_crm_oportunidade_excluir (já existe): soft-delete
-- (deleted_at) + trilha em erp_crm_oportunidade_historico e audit_log_global. A UI só expõe o caminho.
-- Rota colapsa o segmento dinâmico [id], mesma convenção dos "?" irmãos desta ficha (crm.ficha.*).
-- Aditiva e idempotente: tabela global de referência (sem company_id), chave única; re-rodar só atualiza o texto.

INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  (
    'crm.ficha.excluir',
    '/dashboard/crm/oportunidade',
    'Excluir negócio',
    'Use quando o negócio foi criado por engano ou é duplicado. Para um negócio que não fechou de verdade, prefira mover para uma etapa de perda com o motivo.',
    'Tira o negócio do funil e dos relatórios. A exclusão fica registrada na trilha de auditoria (quem excluiu e quando) e o registro é recuperável pelo suporte.',
    'Criou "Negócio – Clínica" duas vezes? Exclua o duplicado e mantenha o outro.',
    'Excluir no lugar de marcar como perdido: a perda alimenta o relatório de motivos; a exclusão só some com o negócio.',
    'crm',
    40
  )
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota,
  rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem,
  status = 'publicado',
  atualizado_em = now();
