-- Chamado #5452 (Pdois/P&M) · Modelos de contrato — item2: ajuda da lista de "Campos variáveis"
-- (/dashboard/contratos → ContratosModelosPanel). A tela passou a mostrar os campos variáveis
-- disponíveis (fn_contrato_modelo_variaveis) como chips clicáveis que inserem {{chave}} no texto;
-- esta chave de ajuda explica o recurso ao usuário (RD-95).
--
-- ADITIVA (RD-94.1-c): só 1 texto de ajuda novo; NÃO altera tabela/função nem dado de cliente.
-- Idempotente (ON CONFLICT DO NOTHING). Versão acima da main, faixa de segundos :45–:54.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/contratos', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.contrato.modelo.variaveis', 'Modelos de contrato', 'Campos variáveis',
  'Nada a preencher: clique num campo da lista para inserir a marca {{campo}} na posição do cursor do texto.',
  'A marca é trocada pelo dado real (cliente, valor, datas…) quando o contrato é gerado a partir do modelo — você escreve uma vez e reaproveita.',
  'Clicar em "Nome do cliente" insere {{cliente_nome}}; ao gerar o contrato, vira o nome real do cliente.',
  'Digitar o nome de um campo que não existe na lista: só as marcas da lista são substituídas; as demais ficam como estão.', 7)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
