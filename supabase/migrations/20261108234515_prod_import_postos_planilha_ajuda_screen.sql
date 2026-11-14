-- Indústria/RH · Importar quadro por planilha (CEO 08/11, c1e941c5) — ajuda RD-95 + registro RD-98 da tela nova
-- /dashboard/produtividade/importar. A tela BAIXA um modelo .xlsx pré-preenchido com exemplo FICTÍCIO (DEMO, RD-69)
-- e SOBE para abastecer setor+posto+pessoa+custo de uma vez, toda via a RPC JÁ publicada e guardada
-- fn_rh_importar_postos (RD-26). Esta migration NÃO cria/altera função, tabela, RLS, policy ou grant de dado, e NÃO
-- toca dado de cliente — só acrescenta o texto de ajuda e registra a rota em system_screens.
--
-- RD-38 (produção, só leitura, nesta sessão): fn_rh_importar_postos(p_company_id uuid, p_linhas jsonb, p_registrado_por
-- uuid) existe em pg_proc, com gate de papel (rh_industrial/socio/admin), idempotente por codigo_po e posto+funcionário,
-- e devolve {ok, antes, criados, depois, soma_*}. As 2 chaves de ajuda ainda não existem (ON CONFLICT DO NOTHING).
--
-- ADITIVA e idempotente. RD-52: arquivo + PR, versão 20261108234515 acima da última da main, faixa de segundos :10–:19.
-- Observação (menu): a entrada no catálogo/menu depende de decisão do Eng. Chefe (regra "não tocar menu sem ordem"); a
-- rota já funciona por URL, tem link na própria tela /dashboard/produtividade e fica registrada em system_screens.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('prod.import.modelo', '/dashboard/produtividade/importar', 'Importar quadro', 'Baixar modelo',
   'Não se preenche: é um botão. Baixa a planilha padrão (.xlsx) já com um exemplo fictício para você editar com o seu quadro e subir de volta.',
   'Dá o formato certo das colunas (setor, posto, pessoa, custo) para a importação reconhecer tudo de uma vez, sem digitar no sistema.',
   'Baixe, troque o exemplo pelos seus postos e pessoas e salve.',
   'Mudar os nomes das colunas do cabeçalho: mantenha a 1ª linha do modelo para a importação reconhecer.',
   'industria', 50, 'publicado'),
  ('prod.import.arquivo', '/dashboard/produtividade/importar', 'Importar quadro', 'Escolher planilha',
   'Selecione a planilha preenchida (a partir do modelo). A pessoa é casada pelo NOME com o ponto; deixe “VAGA” no nome para registrar uma vaga aberta.',
   'Lê o arquivo e abastece setor, posto, pessoa e custo de uma vez. A carga é idempotente (não duplica posto com o mesmo código, nem pessoa já alocada); quem não casa com o ponto vira exceção para conciliar.',
   'modelo-quadro-postos.xlsx com as suas linhas.',
   'Subir sem o cabeçalho do modelo, ou com o nome da pessoa diferente do que está no ponto (vira exceção).',
   'industria', 51, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, views_consumidas, rpcs_chamadas, estado_real, prioridade_monitoramento, modulo, auditavel_robo)
VALUES (
  'dashboard.produtividade_importar',
  '/dashboard/produtividade/importar', 'industrial', 'Importar quadro por planilha',
  'Baixa um modelo .xlsx pré-preenchido com exemplo fictício (DEMO) e sobe para abastecer setor+posto+pessoa+custo de uma vez pela RPC guardada fn_rh_importar_postos (gate de papel rh_industrial/socio/admin). Idempotente por codigo_po e posto+funcionário; pessoa casada pelo nome com o ponto, não-casados viram exceção. Dado real só pela tela, nunca pelo repo.',
  ARRAY[]::text[],
  ARRAY['fn_rh_importar_postos','fn_ajuda_campo_listar']::text[],
  'parcial', 'media', 'industrial_mao_obra', true
)
ON CONFLICT (rota) DO NOTHING;
