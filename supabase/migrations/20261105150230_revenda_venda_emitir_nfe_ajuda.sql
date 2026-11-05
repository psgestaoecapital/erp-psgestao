-- #5684 · Revenda › Vendas e entrega: botão "Emitir NF-e" (ajuda "?" do botão, RD-95). Aditiva e idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES ('revenda.vendas.emitir_nfe', '/dashboard/revenda/vendas', 'Venda e entrega', 'Emitir NF-e',
  'Nada a preencher: clique para emitir a nota fiscal desta venda. Antes, confira o cliente (com CPF/CNPJ e endereço), o NCM do veículo e o perfil fiscal aprovado.',
  'Emite a NF-e pelo mesmo emissor do módulo de gestão, com CFOP, ICMS, benefício fiscal e IBS/CBS do perfil fiscal aprovado, e liga a nota ao título já lançado no contas a receber. Não cria título novo nem mexe no estoque. Com a nota autorizada, o botão Entregar é liberado.',
  'Venda de R$ 100.000 com redução de base de 95% e ICMS de 12%: base de R$ 5.000 e ICMS de R$ 600.',
  'Emitir sem o cliente cadastrado ou sem NCM no veículo: a nota é recusada e a tela mostra o motivo. Corrija o cadastro e clique de novo para reenviar.',
  'revenda_veiculos', 'publicado')
ON CONFLICT DO NOTHING;
