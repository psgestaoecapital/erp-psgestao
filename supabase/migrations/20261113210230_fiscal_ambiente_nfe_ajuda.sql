-- #5666 · RD-95: ajuda ("?") do seletor "Ambiente da NF-e (modelo 55)" na Configuração Fiscal.
-- Aditivo e idempotente (ON CONFLICT DO NOTHING). Só insere texto de ajuda; não toca config, numeração nem tokens.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('fiscal.ambiente_nfe',
  '/dashboard/configuracoes/fiscal',
  'Configuração fiscal',
  'Ambiente da NF-e (modelo 55)',
  'Escolha Homologação (teste) ou Produção para a NF-e. Vale só para a NF-e — a NFS-e e a NFC-e seguem o campo "Ambiente" acima.',
  'Permite testar a NF-e em homologação sem tirar a NFS-e (notas reais de serviço) de produção. A emissão de NF-e usa o token do ambiente escolhido.',
  'NF-e em Homologação enquanto a NFS-e continua em Produção.',
  'Deixar a NF-e em Homologação e tentar emitir uma nota real de venda — ela não tem valor fiscal. Volte para Produção quando terminar os testes.',
  'fiscal', 25, 'publicado')
ON CONFLICT (chave) DO NOTHING;
