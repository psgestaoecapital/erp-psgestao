-- Viagem · ajuda de campo ("?") da tela /dashboard/projetos/viagens (gate check-ajuda-campo) — gilberto-produto (faixa 05).
-- ADITIVA: só insere textos novos em erp_ajuda_campo (ON CONFLICT DO NOTHING); nada existente é alterado.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.colaborador', 'Nova viagem', 'Colaborador', 'O nome de quem viajou, como no cadastro da equipe.', 'Identifica de quem é o adiantamento e o acerto (saldo a devolver ou a reembolsar).', 'João Carlos da Silva', 'Abreviar o nome: o acerto sai com o nome errado.', 1),
  ('projetos.viagem.placa', 'Nova viagem', 'Placa', 'A placa do veículo usado na viagem. Opcional.', 'Junto com o hodômetro, calcula o km rodado e o custo por km.', 'ABC-1D23', 'Placa de outro veículo: o custo por km fica trocado.', 2),
  ('projetos.viagem.obra_principal', 'Nova viagem', 'Obra principal', 'A obra que motivou a viagem.', 'É a obra padrão dos cupons; cada cupom pode ir para outra obra (rateio).', 'Obra 0153 · Galpão', 'Escolher a obra errada: o custo cai na obra errada.', 3),
  ('projetos.viagem.saida', 'Nova viagem', 'Saída', 'O dia em que a viagem começou.', 'Define o período do acerto.', '05/10/2026', 'Data depois da volta: o sistema recusa.', 4),
  ('projetos.viagem.volta', 'Nova viagem', 'Volta', 'O dia em que a viagem terminou.', 'Fecha o período do acerto.', '09/10/2026', 'Data antes da saída: o sistema recusa.', 5),
  ('projetos.viagem.adiantamento', 'Nova viagem', 'Adiantamento (5.01)', 'O valor entregue ao colaborador antes de viajar.', 'Entra no acerto: adiantamento menos gastos dá o saldo.', 'R$ 1.500,00', 'Esquecer o adiantamento: o saldo sai como reembolso a mais.', 6),
  ('projetos.viagem.origem', 'Nova viagem', 'Origem', 'A cidade de onde saiu.', 'Só identifica o trajeto no relatório.', 'Chapecó', 'Deixar em branco não impede de fechar, mas o relatório perde o trajeto.', 7),
  ('projetos.viagem.destino', 'Nova viagem', 'Destino', 'A cidade para onde foi.', 'Só identifica o trajeto no relatório.', 'Curitiba', 'Deixar em branco não impede de fechar, mas o relatório perde o trajeto.', 8),
  ('projetos.viagem.lanc_tipo', 'Lançamento', 'Tipo do lançamento', 'Despesa (cupom comum) ou Abastecimento.', 'Abastecimento pede litros e hodômetro e alimenta o custo por km.', 'Abastecimento', 'Lançar combustível como despesa: some do custo por km.', 9),
  ('projetos.viagem.lanc_data', 'Lançamento', 'Data do cupom', 'O dia que está no cupom ou nota.', 'Ordena os lançamentos e confere se está dentro do período.', '06/10/2026', 'Usar a data de hoje em vez da do cupom.', 10),
  ('projetos.viagem.lanc_fornecedor', 'Lançamento', 'Fornecedor', 'Quem emitiu o cupom: posto, restaurante, hotel.', 'Identifica o gasto na prestação de contas.', 'Posto Ipiranga', 'Deixar genérico (“posto”): dificulta a conferência.', 11),
  ('projetos.viagem.lanc_valor', 'Lançamento', 'Valor', 'O total do cupom, em reais.', 'Soma no gasto da viagem e entra no saldo.', '187,50', 'Digitar o valor sem a vírgula dos centavos.', 12),
  ('projetos.viagem.lanc_categoria', 'Lançamento', 'Categoria', 'O tipo de gasto, conforme o plano de contas da viagem.', 'Define em que conta o gasto cai quando a viagem fecha.', 'Alimentação', 'Categoria errada leva o gasto para a conta errada.', 13),
  ('projetos.viagem.lanc_forma', 'Lançamento', 'Forma de pagamento', 'Como o cupom foi pago: dinheiro, cartão, PIX.', 'Cartão da empresa e prazo viram título no financeiro; dinheiro sai do adiantamento.', 'Cartão corporativo', 'Marcar dinheiro quando foi cartão: o saldo do acerto fica errado.', 14),
  ('projetos.viagem.lanc_obra', 'Lançamento', 'Obra deste cupom', 'A obra que deve arcar com este gasto.', 'Cada cupom tem a sua obra: o custo é rateado entre as obras da viagem.', 'Obra 0153 · Galpão', 'Deixar tudo na obra principal quando o gasto foi de outra.', 15),
  ('projetos.viagem.lanc_pago_colaborador', 'Lançamento', 'Pago pelo colaborador', 'Marque se o colaborador pagou com dinheiro dele.', 'O que foi pago pelo colaborador volta para ele no acerto (reembolso 5.02).', 'Hotel pago no cartão pessoal', 'Esquecer de marcar: a empresa não reembolsa.', 16),
  ('projetos.viagem.lanc_litros', 'Lançamento', 'Litros', 'Quantos litros foram abastecidos.', 'Com o hodômetro, calcula o consumo e o custo por km.', '42,5', 'Digitar o valor em reais no lugar dos litros.', 17),
  ('projetos.viagem.lanc_hodometro', 'Lançamento', 'Hodômetro', 'A quilometragem do painel no momento do abastecimento.', 'A diferença entre abastecimentos dá o km rodado.', '128.450', 'Digitar menos que o abastecimento anterior.', 18)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
