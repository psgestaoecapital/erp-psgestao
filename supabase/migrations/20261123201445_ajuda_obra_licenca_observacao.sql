-- RD-95: "?" do campo "Observação" do form de documento da tela de Regularização da obra.
-- Cadastra a chave de ajuda consumida pelo <AjudaCampo chave="projetos.obra_licenca.observacao">.
-- Aditiva e idempotente (ON CONFLICT (chave)); nenhuma tabela/RLS nova, sem dado de cliente.
-- Code: desenvolvedor_4_g

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'projetos.obra_licenca.observacao',
  '/dashboard/projetos/obras/[id]/regularizacao',
  'Regularização da obra',
  'Observação',
  'Anotação livre sobre o documento: condicionantes, pendências de renovação, nº de protocolo ou qualquer detalhe que ajude a acompanhar.',
  'Guarda o contexto do documento que não cabe nos demais campos, para consulta e prestação de contas.',
  'Renovação protocolada em 10/02; aguardando vistoria do órgão.',
  'Usar a observação para o número do documento — este tem campo próprio (Número).',
  'hub_projetos',
  7,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
