-- Auditoria RD-95 · Relatório de OS (/dashboard/os/relatorio).
-- O auditor apontou que a tabela "Ordens do período" (lista detalhada Nº/Data/Cliente/
-- Placa/Situação/Serviços/Peças/Total) não tinha o "?" (RD-95). Esta migration é ADITIVA e
-- idempotente: cadastra apenas 1 chave de ajuda explicando as colunas dessa lista. Nenhuma
-- função, RLS, tabela ou dado de cliente é tocado — só uma linha de catálogo (erp_ajuda_campo).
--
-- Code: jordana-code

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'os.relatorio.ordens_periodo',
  '/dashboard/os/relatorio',
  'Relatório de OS',
  'Ordens do período',
  'Não preenche: é a lista detalhada de cada ordem do período filtrado. As colunas são — Nº (número da OS), Data (a data usada no filtro, abertura ou fechamento), Cliente, Placa do veículo, Situação (status da OS), Serviços (soma dos serviços), Peças (soma das peças) e Total (serviços + peças).',
  'Permite conferir ordem por ordem o que compõe os totais do período — útil para achar uma OS específica, conferir a placa/cliente e ver quanto cada ordem somou em serviços e peças.',
  'Uma linha "OS-2026-0249 · 14/10/2026 · João · ABC1D23 · Concluída · R$ 560,90 · R$ 39,10 · R$ 600,00" mostra que essa ordem somou R$ 600,00 entre serviços e peças.',
  'Estranhar uma ordem com Total R$ 0,00: ordens abertas ou em orçamento, sem valor lançado, aparecem zeradas; o valor só entra quando os itens são preenchidos.',
  'oficina',
  13,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
