-- RD-95: "?" em todo campo. Falta a ajuda do campo "Observação" na tela de Partes da obra
-- (/dashboard/projetos/obras/[id]/partes). Todos os irmãos (Papel, Nome, CPF/CNPJ, Contato,
-- Adicionar, Excluir) já têm; só "Observação" ficou sem. Aditiva e idempotente (RD-52).
-- Code: desenvolvedor_4_g
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('projetos.obra_parte.observacao',
  '/dashboard/projetos/obras/[id]/partes', 'Partes da obra', 'Observação',
  'Uma anotação livre sobre esta parte: função específica, condição contratual ou lembrete que ajude a identificá-la.',
  'Guarda o contexto que não cabe nos demais campos, para quem abrir a obra depois entender o papel da parte.',
  'Responsável técnico da obra; contratante só da fase de fundação; contato fora do horário comercial.',
  'Escrever dado que tem campo próprio (nome, documento, contato) aqui em vez de no campo certo.',
  'hub_projetos', 7, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota            = EXCLUDED.rota,
  grupo           = EXCLUDED.grupo,
  rotulo          = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve  = EXCLUDED.para_que_serve,
  exemplo         = EXCLUDED.exemplo,
  erro_comum      = EXCLUDED.erro_comum,
  vertical        = EXCLUDED.vertical,
  status          = EXCLUDED.status,
  atualizado_em   = now();
