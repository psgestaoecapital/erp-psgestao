-- Chamado #6855 — anexar PDF no chamado (registro de dificuldades).
-- O picker de anexos (FotosChamado) passa a aceitar imagem OU PDF. RD-95: o "?" do campo de anexo.
-- Aditivo e idempotente (ON CONFLICT DO NOTHING); nenhum dado de cliente é tocado.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('melhorias.anexo','/dashboard/melhorias','Registro de dificuldade','Anexar arquivo',
  'Prints da tela (cole com Ctrl+V, arraste ou use a câmera) ou arquivos PDF (relatório, nota, documento) que mostrem o problema — até 10 por chamado.',
  'A equipe entende a dificuldade mais rápido vendo a tela e os documentos; em imagem você ainda aponta onde está o erro.',
  'Um print da mensagem de erro + o PDF do boleto que não bateu.',
  'Anexar um PDF e esperar marcar o ponto nele — PDF não tem marcação; para apontar, mande também um print.',
  'gestao_empresarial',10,'publicado')
ON CONFLICT (chave) DO NOTHING;
