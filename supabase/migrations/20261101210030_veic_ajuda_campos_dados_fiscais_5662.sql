-- Chamado #5662 (Alliance): rótulo fixo + dica em cada campo do cadastro do veículo. Aditiva: só os textos do "?" (RD-95).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
SELECT 'revenda.veiculo.' || v.k, '/dashboard/revenda/veiculo', v.g, v.r, v.o, v.p, v.e, v.c, 'revenda_veiculos', 'publicado'
FROM (VALUES
 ('tipo','Dados do veículo','Tipo do veículo','Carro, moto, caminhão ou máquina.','Define a sugestão de NCM da nota fiscal.','carro','Deixar em branco: a sugestão de NCM fica genérica.'),
 ('marca','Dados do veículo','Marca','Fabricante do veículo.','Aparece no anúncio, no contrato e na nota.','Chevrolet','Escrever o modelo no lugar da marca.'),
 ('modelo','Dados do veículo','Modelo','Nome do modelo, sem o ano.','Aparece no anúncio, no contrato e na nota.','Onix','Digitar o ano (ex.: 2021) no campo do modelo.'),
 ('versao','Dados do veículo','Versão','Versão ou acabamento do modelo.','Diferencia o veículo no anúncio e na precificação.','Premier 1.8 AT','Repetir a marca ou o modelo aqui.'),
 ('cor','Dados do veículo','Cor','Cor do veículo como no documento.','Aparece no contrato, no termo de entrega e na nota.','Prata','Usar a cor comercial em vez da do documento.'),
 ('combustivel','Dados do veículo','Combustível','Combustível do veículo.','Aparece no anúncio e nos dados da nota.','flex','Marcar gasolina para veículo flex.'),
 ('km_atual','Dados do veículo','KM atual','Quilometragem atual lida no painel, só números.','Aparece no anúncio e no contrato; é conferida na entrega.','45230','Digitar com ponto de milhar e errar a casa.'),
 ('tem_manual','Dados do veículo','Manual do proprietário','Informe se o veículo tem o manual.','Entra no checklist de entrega.','sim','Deixar "—" achando que significa "não".'),
 ('tem_chave_reserva','Dados do veículo','Chave reserva','Informe se o veículo tem a chave reserva.','Entra no checklist de entrega.','sim','Deixar "—" achando que significa "não".'),
 ('portas','Dados do veículo','Portas','Número de portas.','Aparece no anúncio e nos dados da nota.','4','Contar o porta-malas como porta.'),
 ('cambio','Dados do veículo','Câmbio','Tipo de câmbio.','Aparece no anúncio.','automático','Escrever só "AT" ou "MT" sem explicar.'),
 ('ano_fabricacao','Dados do veículo','Ano de fabricação','Ano em que o veículo foi fabricado, 4 dígitos.','Dado obrigatório da nota de veículo.','2020','Trocar com o ano do modelo.'),
 ('ano_modelo','Dados do veículo','Ano do modelo','Ano do modelo, 4 dígitos.','Dado obrigatório da nota de veículo.','2021','Trocar com o ano de fabricação.'),
 ('renavam','Dados do veículo','RENAVAM','Número do RENAVAM, como no documento (CRLV).','Identifica o veículo na nota e na transferência.','00123456789','Faltar dígitos; confira com o documento.'),
 ('observacao','Dados do veículo','Especificação e observações','Opcionais, estado e detalhes do veículo.','Entra no texto do anúncio.','Único dono, revisões em dia','Colocar aqui dado que tem campo próprio.'),
 ('potencia_cv','Fiscal do veículo','Potência (cv)','Potência do motor em cavalos (cv).','Dado da nota fiscal do veículo.','110','Informar em kW em vez de cv.'),
 ('cilindradas','Fiscal do veículo','Cilindradas (cc)','Cilindradas em cc, não em litros.','Define o NCM sugerido da nota (faixa de cc).','1800','Digitar 1.8 ou 4 em vez de 1800: o NCM sai da faixa errada.'),
 ('valor_fipe','Fiscal do veículo','Valor FIPE (R$)','Valor da tabela FIPE do veículo, em reais.','Referência de preço e base da comissão.','72.956,00','Usar o valor de outro mês ou outra versão.'),
 ('ncm','Fiscal do veículo','NCM','Código NCM de 8 dígitos do veículo.','Vai na nota fiscal; "Sugerir NCM" ajuda, o contador confirma.','87032310','Digitar com pontos ou com menos de 8 dígitos.'),
 ('lugares','Fiscal do veículo','Lugares','Número de lugares (capacidade de passageiros).','Dado da nota e parte da regra do NCM.','5','Contar só os bancos de trás.')
) AS v(k,g,r,o,p,e,c)
ON CONFLICT DO NOTHING;
