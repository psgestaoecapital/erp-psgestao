-- RD-95: ajuda de campo ("?") da tela de Precificação do veículo (Revenda).
-- Cobre os campos Margem e Observação, que estavam sem o "?" (relatório de cobertura da ajuda).
-- Aditiva e idempotente: tabela global de referência (sem company_id), chave é única; re-rodar só atualiza o texto.
-- Rota colapsa o segmento dinâmico [id], mesma convenção do irmão /dashboard/revenda/veiculo/custos.

INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  (
    'revenda.veiculo.precificacao.margem',
    '/dashboard/revenda/veiculo/precificacao',
    'Margem',
    'Digite o percentual de lucro que você quer sobre o custo total do veículo. Só o número — o % já aparece ao lado.',
    'Define o "Preço mínimo" sugerido (custo total + encargos da venda + essa margem) e o "Teto de compra": até quanto você pode pagar na aquisição para ainda vender pelo preço com essa margem.',
    'Custo total R$ 40.000 com margem 12% leva o preço mínimo para perto de R$ 44.800, somados os encargos da venda.',
    'Confundir a margem sobre o custo com um desconto sobre o preço: aqui é o lucro que você quer, calculado sobre o custo.',
    'revenda',
    1
  ),
  (
    'revenda.veiculo.precificacao.observacao',
    '/dashboard/revenda/veiculo/precificacao',
    'Observação (opcional)',
    'Uma nota curta sobre esta precificação — por que chegou a esse valor, condição do carro ou o que foi combinado com o vendedor.',
    'Fica gravada junto com o preço no histórico de precificação do veículo, para você lembrar depois o motivo do valor.',
    'Ex.: "Preço promocional de fim de mês" ou "abaixo do piso por acerto na troca com outro carro".',
    'Deixar o motivo só na memória: quando o preço foge do padrão, registre aqui o porquê.',
    'revenda',
    2
  )
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota,
  rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem,
  status = 'publicado',
  atualizado_em = now();
