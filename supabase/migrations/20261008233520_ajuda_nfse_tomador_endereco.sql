-- RD-95: "?" do bloco "Falta no cadastro do tomador" da emissão de NFS-e (TomadorEnderecoPendente, caixa jordana-code
-- 25fac6b6 item 4 — carteira Pdois/Gean). O bloco aparece quando o tomador está no cadastro sem o código IBGE do
-- município (ou sem logradouro/número): pede o CEP ou cidade + UF ali mesmo e grava no cliente.
-- Aditivo: só INSERT de textos (ON CONFLICT DO NOTHING); nenhuma tabela, função ou permissão nova.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Emissão de NFS-e · endereço do tomador', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/fiscal/nfse/tomador-endereco', 'fiscal', 'publicado'
FROM (VALUES
 ('fiscal.nfse.tomador.cep', 'CEP do tomador', 'Os 8 números do CEP do cliente. Clique em Buscar: rua, bairro, cidade, UF e o código do município vêm sozinhos.', 'A NFS-e nacional exige o município do tomador pelo código IBGE; o CEP é o jeito mais seguro de achar.', '79950-000', 'Usar o CEP da sua empresa em vez do CEP do cliente.', 10),
 ('fiscal.nfse.tomador.logradouro', 'Logradouro', 'Rua, avenida ou estrada do cliente, sem o número.', 'Vai no endereço do tomador na nota.', 'Rua Bertila Friedrich', 'Colocar o número aqui: use o campo Número.', 11),
 ('fiscal.nfse.tomador.numero', 'Número', 'O número do endereço do cliente. Sem número, escreva S/N.', 'A NFS-e nacional não aceita tomador sem número.', '31', 'Deixar vazio: a emissão para pedindo o número.', 12),
 ('fiscal.nfse.tomador.bairro', 'Bairro', 'O bairro do cliente (vem do CEP quando o CEP é de rua).', 'Completa o endereço do tomador na nota.', 'Centro', 'CEP de cidade inteira não traz bairro: digite à mão.', 13),
 ('fiscal.nfse.tomador.cidade', 'Cidade', 'O nome oficial da cidade do cliente, sem abreviar. Vem do CEP.', 'Com a UF, acha o código IBGE do município quando o CEP não resolve.', 'Naviraí', 'Abreviar ("S. Miguel"): o município não é encontrado.', 14),
 ('fiscal.nfse.tomador.uf', 'UF', 'A sigla do estado do cliente, com 2 letras.', 'Com a cidade, acha o código IBGE do município.', 'MS', 'Trocar a UF da cidade: o município não é encontrado.', 15),
 ('fiscal.nfse.tomador.ibge', 'Código IBGE do município', 'Não digite: ele vem do CEP ou de "Achar pela cidade", conferido na tabela oficial dos municípios.', 'É o código do município do tomador que a NFS-e nacional exige; sem ele a nota não sai.', '5005707 (Naviraí/MS)', 'Emitir sem ele: a emissão para em "Complete o cadastro fiscal do tomador".', 16),
 ('fiscal.nfse.tomador.gravar', 'Gravar no cliente', 'Clique depois de preencher o CEP (ou cidade e UF) e o número.', 'Salva o endereço no cadastro do cliente; esta e as próximas notas já saem com ele.', 'Gravar → "Endereço gravado no cadastro do cliente"', 'Fechar a tela sem gravar: na próxima nota o sistema pede de novo.', 17)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
