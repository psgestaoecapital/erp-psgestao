-- RD-95: "?" nas AÇÕES da tela Documentos da Empresa (/dashboard/ehs/empresa).
-- As colunas e o filtro já tinham AjudaCampo; faltava o "?" nos botões de ação de cada linha
-- (Upload, Substituir, Baixar). Esta migration é ADITIVA e idempotente: só insere as 3 chaves
-- novas em erp_ajuda_campo (ON CONFLICT (chave) DO NOTHING), sem tocar dado de cliente.
-- Faixa de segundos do agente desenvolvedor_4_g (45–54): timestamp :45.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, status)
VALUES
  (
    'compliance.empresa.upload',
    '/dashboard/ehs/empresa',
    'Documentos da Empresa',
    'compliance',
    'Upload',
    'Clique para anexar, pela primeira vez, o arquivo do documento daquela linha (PDF ou imagem do documento emitido).',
    'Guarda o comprovante no sistema e atualiza o status do documento (de pendente para em dia / vencendo, conforme a validade informada no envio).',
    'Anexar o PDF do Laudo de insalubridade recém-emitido na linha correspondente.',
    'Anexar um arquivo errado ou ilegível: confira se é o documento certo e se abre antes de confirmar.',
    9,
    'publicado'
  ),
  (
    'compliance.empresa.substituir',
    '/dashboard/ehs/empresa',
    'Documentos da Empresa',
    'compliance',
    'Substituir',
    'Clique para trocar o arquivo já anexado por uma versão nova do mesmo documento.',
    'Mantém sempre a versão vigente do documento (ex.: ao renovar um laudo que venceu), preservando o histórico de quem enviou e quando.',
    'Substituir o ASO antigo pelo ASO renovado após o exame periódico.',
    'Usar Substituir para um documento de tipo diferente: cada linha é de um tipo específico; anexe no tipo certo.',
    10,
    'publicado'
  ),
  (
    'compliance.empresa.baixar',
    '/dashboard/ehs/empresa',
    'Documentos da Empresa',
    'compliance',
    'Baixar',
    'Clique para abrir ou salvar o arquivo que já está anexado naquela linha.',
    'Permite conferir, imprimir ou enviar o documento guardado sem sair da tela (ex.: apresentar a um fiscal ou auditor).',
    'Baixar o PPRA vigente para anexar a uma resposta ao cliente.',
    'Esperar baixar quando não há arquivo: o botão Baixar só aparece quando já existe documento anexado na linha.',
    11,
    'publicado'
  )
ON CONFLICT (chave) DO NOTHING;
