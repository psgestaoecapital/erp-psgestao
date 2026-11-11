-- RD-95 (CEO 08/10) + RD-98 p2/g: ajuda "?" das ações Desligar / Reativar na LISTA de Funcionários do Compliance
-- (/dashboard/compliance/funcionarios). O auditor PDCA apontou que a lista só tinha "Incluir" (+ Novo) e "Abrir":
-- nenhuma ação de Desligar/Excluir visível na lista, embora o soft-delete já exista (DELETE da API: ativo=false +
-- data_demissao; reativação por PATCH ativo=true). Esta PR traz as ações para a linha e, por RD-95, cada ação ganha "?".
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/compliance/funcionarios', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compliance.funcionarios.acao_desligar', 'Ações', 'Desligar',
  'Clique para desligar o funcionário; confirme no aviso que aparece.',
  'Marca a pessoa como desligada (registra a data de desligamento) e a tira da lista de ativos, sem apagar a ficha nem o histórico de compliance. É reversível em "Reativar".',
  'Funcionário encerrou o contrato → clique em "Desligar", confirme, e ele some da lista (marque "Mostrar desligados" para revê-lo).',
  'Achar que apaga a pessoa: a ficha e os documentos continuam guardados; o desligamento é rastreável e pode ser revertido.',
  11),
 ('compliance.funcionarios.acao_reativar', 'Ações', 'Reativar',
  'Clique para reativar um funcionário desligado; confirme no aviso que aparece.',
  'Devolve a pessoa à lista de ativos e limpa a data de desligamento, reaproveitando a ficha e o histórico que já existiam.',
  'Recontratou alguém que havia sido desligado → marque "Mostrar desligados", clique em "Reativar" e ele volta para a lista ativa.',
  'Só aparece em quem está desligado: para vê-lo, marque o filtro "Mostrar desligados".',
  12)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
