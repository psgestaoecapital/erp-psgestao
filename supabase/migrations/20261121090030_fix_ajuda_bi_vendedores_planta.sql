-- Destrava o main (CEO 19/11): semeia as chaves de ajuda (RD-95) que as telas do RD-98 p3 passaram a usar
-- e cujo seed existente não casava com o gate (o literal '('chave',' esperado pelo check-bi-comercial-meu-painel) —
-- vendedores (col_codigo/col_nome/col_cargo) e BI da Planta (cidade + tabela de produtores).
-- Idempotente (ON CONFLICT). Leva as chaves para produção; a migration 20261030230000 já rodou e não é reaplicada.

-- Comercial › Admin › Vendedores (colunas novas da tabela)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Vendedores', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/admin/vendedores', 'comercial', 'publicado'
FROM (VALUES
 ('com.vendedores.col_codigo', 'Código', 'Nada a preencher.', 'Código do vendedor no ERP de origem — é por ele que a venda é ligada à pessoa.', '80006.', 'Confundir o código com o CPF ou o usuário do PS.', 2),
 ('com.vendedores.col_nome', 'Nome', 'Nada a preencher.', 'Nome do vendedor, supervisor ou gerente como vem do ERP de origem.', 'João da Silva.', 'Esperar editar o nome aqui: ele vem do cadastro de origem.', 3),
 ('com.vendedores.col_cargo', 'Cargo', 'Nada a preencher.', 'Função na equipe (vendedor, supervisor, gerente) — define até onde a pessoa enxerga a venda no Meu painel.', 'Supervisor.', 'Achar que o cargo libera acesso sozinho: o vínculo do usuário é que manda.', 4)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

-- Indústria › BI da Planta (cidade + colunas da tabela de produtores)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'BI da Planta', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/industrial/bi-planta', 'industria', 'publicado'
FROM (VALUES
 ('planta.cidade', 'Cidade de origem', 'Escolha uma cidade para recortar a compra do gado.', 'Filtra só a compra por município de origem do produtor; o abate não guarda a origem, então as cabeças abatidas não mudam.', 'Dionísio Cerqueira.', 'Esperar que a cidade altere o número de cabeças abatidas.', 11),
 ('planta.prod_produtor', 'Produtor', 'Nada a preencher.', 'Nome do produtor com contra-nota no período, na tabela de produtores.', 'João da Silva.', 'Confundir o produtor com a cidade dele.', 12),
 ('planta.prod_cidade', 'Cidade do produtor', 'Nada a preencher.', 'Município de origem do produtor naquela linha da tabela.', 'Guaraciaba.', 'Somar cidades diferentes do mesmo produtor como se fosse uma só.', 13),
 ('planta.prod_cabecas', 'Cabeças do produtor', 'Indicador calculado.', 'Cabeças compradas daquele produtor no período.', '48 cabeças.', 'Comparar com as cabeças abatidas: compra e abate não batem no mesmo dia.', 14),
 ('planta.prod_carcaca', 'Carcaça média do produtor', 'Indicador calculado.', 'Peso médio da carcaça dos animais daquele produtor.', '236 kg.', 'Comparar produtor de boi com produtor de vaca sem olhar a categoria.', 15),
 ('planta.prod_valor', 'Valor pago ao produtor', 'Indicador calculado.', 'Total pago ao produtor pelo gado de abate no período.', 'R$ 262 mil.', 'Incluir reposição: aqui só entra gado para abate.', 16),
 ('planta.prod_arroba', 'Arroba do produtor', 'Indicador calculado.', 'Preço da arroba pago àquele produtor (valor ÷ kg de carcaça × 15).', 'R$ 352 por arroba.', 'Comparar Nota 10 com sem Nota 10: o Nota 10 recebe prêmio.', 17)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
