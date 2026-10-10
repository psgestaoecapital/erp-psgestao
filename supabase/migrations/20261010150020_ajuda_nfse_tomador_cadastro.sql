-- RD-95: "?" do bloco do tomador na emissão de NFS-e (TomadorEnderecoPendente) — caixa jordana-code 3352399e
-- (OS-2026-0198 da Gean: a emissão pegava o cadastro DUPLICADO da FC Pisos, com o mesmo CNPJ). O bloco agora mostra
-- qual cadastro de cliente a nota usa e, quando há dois ativos com o mesmo documento, pede a escolha.
-- Aditivo: só INSERT de textos (ON CONFLICT DO NOTHING); nenhuma tabela, função ou permissão nova.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Emissão de NFS-e · endereço do tomador', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/fiscal/nfse/tomador-endereco', 'fiscal', 'publicado'
FROM (VALUES
 ('fiscal.nfse.tomador.cadastro_usado', 'Cadastro usado',
  'Nada a preencher: mostra qual cadastro de cliente vai na nota. Na OS ou na venda é sempre o cliente dela.',
  'O endereço e o código IBGE do município do tomador saem deste cadastro. Confira que é o cliente certo antes de emitir.',
  'FC PISOS E REVESTIMENTOS INDUSTRIAIS LTDA · Iporã do Oeste/SC',
  'Ter dois cadastros do mesmo cliente: unifique em Clientes para a nota nunca sair com o cadastro incompleto.', 18),
 ('fiscal.nfse.tomador.escolher', 'Escolher o tomador',
  'Clique no cadastro que é o tomador desta nota. Aparece quando a empresa tem mais de um cliente ativo com o mesmo CNPJ/CPF.',
  'A nota usa o endereço e o código IBGE do cadastro escolhido; o sistema não escolhe sozinho entre cadastros repetidos.',
  'Escolher o que diz "endereço completo"',
  'Escolher o cadastro sem endereço: a emissão pede o CEP de novo. Depois unifique os cadastros em Clientes.', 19)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
