-- HB2 · Tabela de preço por cliente: fecha deltas do auditor (nota 68), tudo ADITIVO (dado/texto), sem tocar schema.
--  #1 (CRÍTICO) Vínculo com o catálogo "Sem vínculo" em TODOS os serviços da DEMO Construtora → semeia o vínculo de
--     cada serviço do contrato ao serviço do catálogo que tem o MESMO código (DEMO-FC-S01..S05). Assim o custo da CPU
--     e a margem saem do catálogo real (resolve a dívida recorrente BOM/catálogo na demonstração). Idempotente.
--  #3 (RD-95) "?" das colunas das tabelas de faixa/medição/saldo → cadastra as chaves de ajuda novas.
--  #5 (RD-98 p3) views_consumidas/rpcs_chamadas da tela em system_screens.
-- Observação: o vínculo mora em erp_tabela_preco_vinculo (UNIQUE (tabela_id, servico_ref)); a semente só cria onde o
-- código do serviço do contrato bate com um serviço ATIVO do catálogo da MESMA empresa. "DEMO-FC-MOB" (mobilização,
-- verba) não tem serviço de catálogo e segue sem vínculo — correto.

-- #1 — Semente do vínculo contrato→catálogo da Construtora Modelo DEMO (b0700000…0006)
INSERT INTO public.erp_tabela_preco_vinculo (tabela_id, servico_ref, catalogo_servico_id, company_id)
SELECT DISTINCT i.tabela_id, i.servico_ref, ps.id, i.company_id
FROM public.erp_tabela_preco_item i
JOIN public.erp_tabela_preco_cliente t ON t.id = i.tabela_id
JOIN public.projetos_servicos ps
  ON ps.company_id = i.company_id AND lower(ps.codigo) = lower(i.servico_ref) AND ps.ativo = true
WHERE t.company_id = 'b0700000-0000-4000-a000-000000000006' AND t.ativo = true
ON CONFLICT (tabela_id, servico_ref) DO NOTHING;

-- #3 — "?" (RD-95) das colunas das tabelas (grade do contrato, extrato da medição, saldo contratado)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.contrato_col_faixa', 'Contrato', 'Coluna "Faixa"',
  'Não se preenche. Cada linha é uma faixa de quantidade (de–até) do serviço.',
  'A faixa certa define o preço por unidade: quanto maior a quantidade, normalmente menor o preço unitário.',
  'Faixa 0–500 a R$ 245,00/m²; faixa 500–2000 a R$ 228,00/m².',
  'Confundir a faixa pela quantidade total da obra: a faixa é por medição/contrato, conforme o combinado.',
  610, '/dashboard/projetos/tabelas-preco'),
 ('hub.tabela_preco.contrato_col_condicao', 'Contrato', 'Colunas de condição (Normal, Sábado, Noturno…)',
  'Não se preenche. Cada coluna é uma condição/turno; o preço é o da faixa com o adicional da condição.',
  'Mostra, lado a lado, o preço por unidade em cada turno — e o código do cliente para aquela condição, quando houver.',
  'Faixa 0–500: Normal R$ 245,00; Sábado (+50%) R$ 367,50.',
  'Ler a coluna errada ao medir: confira o turno realmente trabalhado antes de levar o preço à medição.',
  611, '/dashboard/projetos/tabelas-preco'),
 ('hub.tabela_preco.medicao_colunas', 'Medição', 'Colunas do extrato da medição',
  'Não se preenche. São o resultado: serviço, quantidade, regime, código do cliente, preço unitário e total.',
  'É o extrato que vai ao cliente — cada linha sai pela mesma regra do contrato, então o total bate com o combinado.',
  'Piso uretano · 350 m² · Normal · cód. 4501 · R$ 245,00 · R$ 85.750,00.',
  'Comparar o total com uma tabela antiga: o extrato usa o contrato vigente; confira a vigência no topo da tela.',
  612, '/dashboard/projetos/tabelas-preco'),
 ('hub.tabela_preco.saldo_colunas', 'Saldo', 'Colunas do saldo contratado',
  'Não se preenche. Contratado = quanto foi fechado; Medido = soma das medições salvas; Saldo = o que resta.',
  'Acompanha quanto do contrato já foi executado e quanto ainda falta medir, por serviço.',
  'Contratado 5.000 m² · Medido 1.200 m² · Saldo 3.800 m².',
  'Saldo negativo (em vermelho) quer dizer que o medido passou do contratado — revise a quantidade contratada.',
  613, '/dashboard/projetos/tabelas-preco')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- #5 — RD-98 p3: relações e RPCs consumidas pela tela (rastreabilidade em system_screens)
UPDATE public.system_screens SET
  views_consumidas = ARRAY[
    'erp_tabela_preco_cliente','erp_tabela_preco_item','erp_tabela_preco_condicao','erp_tabela_preco_codigo',
    'erp_tabela_preco_vinculo','erp_medicao_cliente','erp_medicao_cliente_item'
  ]::text[],
  rpcs_chamadas = ARRAY[
    'fn_tabela_preco_pode_gravar','fn_tabela_preco_salvar','fn_tabela_preco_arquivar',
    'fn_tabela_preco_faixa_salvar','fn_tabela_preco_faixa_excluir','fn_tabela_preco_condicao_salvar',
    'fn_tabela_preco_codigo_salvar','fn_tabela_preco_vinculos','fn_tabela_preco_vinculo_gravar',
    'fn_tabela_preco_medir','fn_tabela_preco_saldo','fn_tabela_preco_saldo_gravar',
    'fn_medicao_cliente_salvar','fn_medicao_cliente_excluir','fn_ajuda_campo_listar'
  ]::text[]
WHERE rota = '/dashboard/projetos/tabelas-preco';
