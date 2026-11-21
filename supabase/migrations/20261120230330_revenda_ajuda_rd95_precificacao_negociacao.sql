-- RD-95: ajuda de campo ("?") em duas telas da Revenda que estavam com campos sem o "?"
-- (relatório de cobertura da ajuda): Precificação do veículo e Negociação.
-- Aditiva e idempotente: tabela global de referência (sem company_id), chave é única; re-rodar só atualiza o texto.
-- Rota colapsa o segmento dinâmico [id], mesma convenção dos irmãos /veiculo/custos e /negociacao.

INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  -- Precificação (/dashboard/revenda/veiculo/[id]/precificacao)
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
  ),
  -- Negociação (/dashboard/revenda/negociacao/[id])
  (
    'revenda.negociacao.observacao',
    '/dashboard/revenda/negociacao',
    'Observação',
    'Anote o que foi combinado nesta negociação — condições, pendências ou o que o cliente pediu.',
    'Fica gravada na negociação e acompanha o histórico até o fechamento ou a perda, ajudando quem continuar o atendimento.',
    'Ex.: "Cliente quer entregar o carro atual na troca" ou "aguardando aprovação do banco".',
    'Confiar na memória: o que não for anotado aqui some quando outra pessoa pegar a negociação.',
    'revenda',
    20
  ),
  (
    'revenda.negociacao.motivo_aprovacao',
    '/dashboard/revenda/negociacao',
    'Motivo da aprovação',
    'Quando o desconto/margem passa da alçada, explique por que o gerente está aprovando mesmo assim.',
    'Fica registrado junto com a aprovação, para auditar depois por que um negócio saiu abaixo do piso da loja.',
    'Ex.: "Cliente recorrente" ou "carro parado há 90 dias no pátio".',
    'Aprovar sem justificar: sem o motivo não dá para defender o desconto depois nem analisar o padrão de alçada.',
    'revenda',
    21
  ),
  (
    'revenda.negociacao.motivo_perda',
    '/dashboard/revenda/negociacao',
    'Motivo da perda',
    'Diga por que a negociação não fechou — preço, prazo, foi para o concorrente, desistência do cliente.',
    'Alimenta o relatório de negócios perdidos e ajuda a entender onde a loja perde venda. É obrigatório ao marcar como perdida.',
    'Ex.: "Achou mais barato em outra loja" ou "não conseguiu financiamento".',
    'Marcar só "perdeu" sem o porquê: sem o motivo o relatório de perdas não aponta o que corrigir.',
    'revenda',
    22
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
