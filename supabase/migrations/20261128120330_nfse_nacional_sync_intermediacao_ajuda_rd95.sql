-- NFS-e Nacional da Alliance (spec 26/11 · Code: rodrigo-manual) — ajuda RD-95 dos dois botões novos:
--   item 2: "Consultar/atualizar adesão do município" em Configurações › Fiscal
--   item 4: "Emitir NFS-e de intermediação" na ficha do veículo (revenda)
-- Metadado de ajuda — NÃO toca dado de cliente, função, RLS nem regra fiscal/financeira. Aditiva e idempotente
-- (ON CONFLICT (chave)). Faixa de segundos :30 (rodrigo-manual), acima da última versão da main.

-- Item 2 · /dashboard/configuracoes/fiscal
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Configuração Fiscal', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/configuracoes/fiscal', 'fiscal', 'publicado'
FROM (VALUES
 ('fiscal.config.gov_nfse_sincronizar_municipio', 'Adesão do município (NFS-e Nacional)',
  'Nada a preencher — é uma ação. Toque para consultar a lista nacional e marcar, nesta empresa, se o município configurado (código IBGE) já aderiu ao NFS-e Nacional.',
  'Quando o município adere ao NFS-e Nacional, a emissão passa a sair no padrão nacional. Esta ação sincroniza esse estado na configuração da empresa (adesão + data da consulta) sem precisar de ajuste manual. É seguro repetir: cada toque reconsulta e regrava o estado atual.',
  'Município 4217204 (São Miguel do Oeste/SC) aderido em 01/01/2026 → a config passa a mostrar "aderido ao NFSe Nacional".',
  'Município não aparece na lista: sincronize antes a lista de municípios na tela "NFSe Nacional gov.br", ou confira se o código IBGE está correto.', 1)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, vertical = EXCLUDED.vertical, status = EXCLUDED.status;

-- Item 4 · /dashboard/revenda/veiculo (a rota real tem o id do veículo; passada explicitamente no componente)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Notas fiscais', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/revenda/veiculo', 'revenda', 'publicado'
FROM (VALUES
 ('revenda.veiculo.nfse_intermediacao', 'Emitir NFS-e de intermediação',
  'Nada a preencher aqui — toque para abrir o emissor de NFS-e já com o serviço de intermediação do financiamento (código de tributação 10.02.01). No modal, confira/complete o tomador (o banco) e o valor (o retorno do banco).',
  'A garagem presta um serviço de intermediação/agenciamento quando encaminha o financiamento ao banco; o retorno do banco é a receita desse serviço e precisa de NFS-e. A nota sai pelo emissor nacional; a tributação (ISS, PIS, COFINS) vem da parametrização fiscal da empresa (ISS por município + retenções), não é digitada aqui.',
  'Venda financiada pelo Banco X com retorno de R$ 1.000 → NFS-e de intermediação (10.02.01), tomador Banco X, valor R$ 1.000.',
  'Emitir sem o ISS do município cadastrado (empresa de regime normal trava com ISS zerado) ou com a série fora da faixa de integração: ajuste a parametrização fiscal antes. Teste primeiro em homologação.', 1)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, vertical = EXCLUDED.vertical, status = EXCLUDED.status;
