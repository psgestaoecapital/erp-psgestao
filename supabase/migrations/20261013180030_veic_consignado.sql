-- Chamado #34 (Alliance): veículo CONSIGNADO (de terceiro, deixado para venda) no cadastro do veículo.
-- Aditiva: 4 colunas novas em veic_veiculo (RLS por empresa já existente: veic_veiculo_rw) + textos do "?" (RD-95).
-- Comissão da loja NÃO entra (definida no acerto da venda — decisão do Rodrigo/Fábio 13/10).
ALTER TABLE public.veic_veiculo
  ADD COLUMN IF NOT EXISTS consignado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consignante_nome text,
  ADD COLUMN IF NOT EXISTS consignante_documento text,
  ADD COLUMN IF NOT EXISTS consignante_valor_combinado numeric(14,2);

COMMENT ON COLUMN public.veic_veiculo.consignado IS 'Veículo de terceiro deixado para venda (consignação).';
COMMENT ON COLUMN public.veic_veiculo.consignante_valor_combinado IS 'Valor que o dono (consignante) quer receber pelo veículo.';

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('revenda.veiculo.consignado', '/dashboard/revenda/veiculo', 'Consignação', 'Veículo consignado',
  'Marque quando o veículo é de um terceiro, deixado na loja para vender.',
  'Identifica o carro como consignado e libera os dados do dono. A parte fiscal da consignação segue o perfil fiscal da empresa.',
  'Cliente deixou o carro para a loja vender: marque e informe o dono.',
  'Marcar como consignado um veículo que a loja comprou: ele deixa de contar como estoque próprio.',
  'revenda_veiculos', 'publicado'),
 ('revenda.veiculo.consignante_nome', '/dashboard/revenda/veiculo', 'Consignação', 'Nome do consignante',
  'Nome completo (ou razão social) do dono do veículo.',
  'Identifica de quem é o carro para o acerto e para os documentos da consignação.',
  'Maria da Silva.', 'Colocar o nome do comprador em vez do dono atual do veículo.',
  'revenda_veiculos', 'publicado'),
 ('revenda.veiculo.consignante_documento', '/dashboard/revenda/veiculo', 'Consignação', 'CPF/CNPJ do consignante',
  'CPF (11 dígitos) ou CNPJ (14 dígitos) do dono do veículo. Pode digitar com ou sem pontuação.',
  'Documento do dono para o contrato de consignação e para o acerto.',
  '123.456.789-09', 'Digitar o documento de outra pessoa ou com dígitos faltando.',
  'revenda_veiculos', 'publicado'),
 ('revenda.veiculo.consignante_valor_combinado', '/dashboard/revenda/veiculo', 'Consignação', 'Valor combinado com o dono (R$)',
  'O valor que o dono quer receber pelo veículo, em reais.',
  'Referência do acerto com o dono: o que passa dele fica com a loja conforme o combinado na venda. Não é o preço de anúncio.',
  '58.000,00', 'Confundir com o preço de venda anunciado ao cliente.',
  'revenda_veiculos', 'publicado')
ON CONFLICT DO NOTHING;
