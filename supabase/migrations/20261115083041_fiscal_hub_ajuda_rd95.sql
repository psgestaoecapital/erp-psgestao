-- Hub Fiscal (/dashboard/fiscal) — RD-95: "?" em todos os indicadores do Hub (NFSes/NFes emitidas,
-- pendências, configuração, numeração, armazenamento SINIEF). O Hub lê a RPC viva fn_hub_fiscal_resumo,
-- que consome a view v_hub_fiscal_cards. Tudo ADITIVO e idempotente: só linhas novas de ajuda +
-- registro da view em system_screens.views_consumidas (RD-98 p3). Nenhuma função/view/policy é alterada.
-- Code: code-desenvolvedor-3

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical) VALUES
 ('ge.fiscal.hub.nfse_emitidas', '/dashboard/fiscal', 'Emissão', 'NFSes Emitidas',
  'Indicador — não se preenche.', 'Quantas NFS-e (serviço) foram autorizadas no mês, com o valor total no mês logo abaixo. Clique no card para ver a lista completa.',
  '12 no mês · R$ 8.400,00.', 'Nota ainda "processando" não entra na conta de autorizadas: ela aparece na etiqueta de processando até a prefeitura responder.', 'ge'),
 ('ge.fiscal.hub.nfe_emitidas', '/dashboard/fiscal', 'Emissão', 'NFes Emitidas',
  'Indicador — não se preenche.', 'Quantas NF-e (produto/mercadoria) foram autorizadas no mês, com o valor total no mês abaixo. Clique no card para ver a lista.',
  '30 no mês · R$ 165.071,14.', 'Se o número está zerado mas você emitiu, confira se a nota foi autorizada pela SEFAZ — rejeitada/processando não conta aqui.', 'ge'),
 ('ge.fiscal.hub.pendencias', '/dashboard/fiscal', 'Pendências', 'Pendências',
  'Indicador — não se preenche.', 'Soma das notas que ainda não fecharam: as que estão processando (aguardando a SEFAZ/prefeitura) mais as que deram erro e precisam de ação.',
  '2 pendências · 1 processando · 1 com erro.', 'Nota "com erro" não se resolve sozinha: abra a NF-e/NFS-e correspondente e corrija o motivo da rejeição.', 'ge'),
 ('ge.fiscal.hub.config', '/dashboard/fiscal', 'Configuração', 'Configuração fiscal',
  'Indicador — não se preenche aqui (clique em EDITAR para configurar).', 'Mostra se a emissão está pronta: "Ativa" quando o certificado A1 e a integração de NF-e estão configurados; "Pendente" quando falta configurar.',
  'Ativa.', 'Enquanto estiver "Pendente" a empresa não emite nota: conclua a configuração em Configurações › Fiscal.', 'ge'),
 ('ge.fiscal.hub.config_ambiente', '/dashboard/fiscal', 'Configuração', 'Ambiente',
  'Indicador — não se preenche.', 'Em qual ambiente a empresa emite: Produção (nota com valor fiscal real) ou Homologação (testes, sem validade fiscal).',
  'Ambiente: Produção.', 'Emitir em Homologação achando que é Produção gera nota sem validade fiscal — confira o ambiente antes de faturar.', 'ge'),
 ('ge.fiscal.hub.config_prox_nfse', '/dashboard/fiscal', 'Configuração', 'Próxima numeração NFS-e',
  'Indicador — não se preenche.', 'O número que a próxima NFS-e vai receber. A numeração é sequencial e controlada pela prefeitura.',
  'Próx NFSe nº 1245.', 'Mudar a numeração à mão pode gerar nota com número duplicado ou pulado: só ajuste junto com a prefeitura.', 'ge'),
 ('ge.fiscal.hub.config_prox_nfe', '/dashboard/fiscal', 'Configuração', 'Próxima numeração NF-e',
  'Indicador — não se preenche.', 'O número que a próxima NF-e vai receber, dentro da série em uso. A numeração é sequencial e controlada pela SEFAZ.',
  'Próx NFe nº 3078.', 'Número fora de sequência causa rejeição da SEFAZ: deixe o sistema controlar a numeração.', 'ge'),
 ('ge.fiscal.hub.storage_nfse', '/dashboard/fiscal', 'Armazenamento', 'NFSes armazenadas',
  'Indicador — não se preenche.', 'Quantos XML/PDF de NFS-e estão guardados no arquivo seguro da empresa (compliance SINIEF — guarda por 11 anos).',
  '320 NFSes armazenadas.', 'Diferença grande entre emitidas e armazenadas pode indicar arquivo na fila: veja "Fila pendente".', 'ge'),
 ('ge.fiscal.hub.storage_nfe', '/dashboard/fiscal', 'Armazenamento', 'NFes armazenadas',
  'Indicador — não se preenche.', 'Quantos XML/PDF de NF-e estão guardados no arquivo seguro da empresa (compliance SINIEF — guarda por 11 anos).',
  '410 NFes armazenadas.', 'O armazenamento é automático após a autorização; você não precisa subir arquivo manualmente.', 'ge'),
 ('ge.fiscal.hub.storage_fila', '/dashboard/fiscal', 'Armazenamento', 'Fila pendente de arquivo',
  'Indicador — não se preenche.', 'Quantos arquivos ainda estão na fila para serem guardados no arquivo seguro. O normal é zero; um número acima de zero some sozinho quando a fila processa.',
  'Fila pendente: 0.', 'Se a fila fica alta por muito tempo, avise o suporte — pode haver falha no armazenamento.', 'ge')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: o Hub Fiscal consome a view v_hub_fiscal_cards (via fn_hub_fiscal_resumo). Append idempotente.
UPDATE public.system_screens
SET views_consumidas = (
  SELECT array_agg(DISTINCT e ORDER BY e)
  FROM unnest(COALESCE(views_consumidas, '{}') || ARRAY['v_hub_fiscal_cards']) AS e)
WHERE rota = '/dashboard/fiscal';
