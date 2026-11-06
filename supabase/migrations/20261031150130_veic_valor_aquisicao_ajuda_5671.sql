-- Chamado #5671 (Alliance): valor de aquisição editável no cadastro do veículo. Aditiva: só o texto do "?" (RD-95).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('revenda.veiculo.valor_aquisicao', '/dashboard/revenda/veiculo', 'Dados do veículo', 'Valor de aquisição (R$)',
  'Quanto a loja pagou pelo veículo na compra, em reais. Aceita vírgula e ponto.',
  'Entra no custo acumulado e no lucro do veículo. Se foi digitado errado na entrada, corrija aqui.',
  '72.956,00', 'Faltar ou sobrar um zero na digitação; confira com o contrato de compra.',
  'revenda_veiculos', 'publicado')
ON CONFLICT DO NOTHING;
