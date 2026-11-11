-- PDCA GE · /dashboard/gestao-empresarial/bens (aud8 58/95) — item 1 RD-99
-- RD-95: chaves de ajuda ("?") dos campos do novo modal premium de baixa/venda/sinistro
-- (substitui os 3 window.prompt nativos por um modal com dropdown, máscara e data editável).
-- Aditiva e idempotente. Não toca função/núcleo nem dado de cliente.
-- Obs.: fn_bem_listar já devolve valor_residual na main (migration 20261113110030, item 3).
-- Code: code-desenvolvedor-3

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('ge.bens.baixa_tipo', '/dashboard/gestao-empresarial/bens', 'Baixar / vender',
   'Tipo da operação',
   'Escolha o que está acontecendo com o bem: Venda (saiu com recebimento), Baixa (descarte/sucata, sem venda) ou Sinistro (perda/dano, ex.: acidente, roubo).',
   'Define como o resultado é apurado: na venda compara-se o valor recebido com o valor contábil; na baixa/sinistro o bem sai pelo valor contábil.',
   'Venda de um veículo antigo; Baixa de uma máquina sucateada; Sinistro de equipamento danificado.',
   'Marcar "Venda" sem informar o valor recebido: o resultado da operação sai errado.',
   'gestao_empresarial', 30),
  ('ge.bens.baixa_valor', '/dashboard/gestao-empresarial/bens', 'Baixar / vender',
   'Valor da venda (R$)',
   'Só na Venda: o valor efetivamente recebido pelo bem.',
   'É comparado com o valor contábil (aquisição menos depreciação) para apurar o ganho ou a perda na venda.',
   'Vendeu por R$ 50.000 um bem com valor contábil de R$ 45.000: resultado de R$ 5.000 de ganho.',
   'Deixar zerado numa venda: o sistema entende saída sem recebimento e apura perda indevida.',
   'gestao_empresarial', 31),
  ('ge.bens.baixa_data', '/dashboard/gestao-empresarial/bens', 'Baixar / vender',
   'Data da operação',
   'A data em que a venda, baixa ou sinistro aconteceu.',
   'Marca o momento em que o bem sai do imobilizado ativo e entra no resultado do período.',
   '15/03/2026.',
   'Usar uma data futura ou de outro exercício: o resultado cai no período errado.',
   'gestao_empresarial', 32),
  ('ge.bens.baixa_justificativa', '/dashboard/gestao-empresarial/bens', 'Baixar / vender',
   'Justificativa',
   'Opcional: uma observação sobre o motivo da baixa/venda (comprador, nº da nota, laudo do sinistro).',
   'Fica no histórico da operação para auditoria e consulta futura.',
   '"Vendido para a Transportes XYZ — NF 1234".',
   'Deixar sem contexto numa baixa relevante dificulta a auditoria depois.',
   'gestao_empresarial', 33)
ON CONFLICT (chave) DO NOTHING;
