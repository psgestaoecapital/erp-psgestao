-- Compras (/dashboard/commerce/compras) — RD-95 "?" nos campos de Pagamento e NF do fornecedor
-- ============================================================================
-- GAP (RD-95): o formulário de compra tinha, nos cartões "Pagamento" e "NF do fornecedor",
--   7 campos SEM "?": Condição, Parcelas, Primeiro vencimento, Número da NF, Data de emissão,
--   Chave (44 dígitos) e Valor NF. O relatório estático de cobertura os apontava sem ajuda.
-- CORREÇÃO (aditiva, idempotente): 7 chaves NOVAS na rota /dashboard/commerce/compras.
--   (Os outros 12 campos da tela seguem como dívida pré-existente, fora desta fatia.)
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.compras.pagamento_condicao', '/dashboard/commerce/compras', 'Pagamento', 'Condição de pagamento',
   'Como esta compra será paga: à vista, 30 dias, 30/60, 30/60/90 ou parcelado personalizado.',
   'Define quantas contas a pagar o sistema gera e em que datas — a condição monta o parcelamento.',
   '30/60', 'Escolher "Parcelado custom" sem informar o nº de parcelas deixa o plano incompleto.', 'gestao_empresarial', 40),

  ('commerce.compras.pagamento_parcelas', '/dashboard/commerce/compras', 'Pagamento', 'Nº de parcelas',
   'Quantidade de parcelas da compra quando a condição é parcelada (1 ou mais).',
   'Divide o total da compra nesse número de contas a pagar, a partir do primeiro vencimento.',
   '3', 'Número de parcelas sem um primeiro vencimento válido impede gerar as contas a pagar.', 'gestao_empresarial', 41),

  ('commerce.compras.pagamento_primeiro_venc', '/dashboard/commerce/compras', 'Pagamento', 'Primeiro vencimento',
   'Data em que vence a 1ª parcela. As demais seguem o intervalo da condição escolhida.',
   'É a data base do contas a pagar desta compra — a partir dela o sistema espaça as parcelas.',
   '15/02/2026', 'Vencimento anterior à data da compra gera parcela já vencida — confira o mês.', 'gestao_empresarial', 42),

  ('commerce.compras.nf_numero', '/dashboard/commerce/compras', 'NF do fornecedor', 'Número da NF',
   'Número da nota fiscal emitida pelo fornecedor para esta compra. Opcional.',
   'Vincula a compra à NF de entrada, facilitando conferência e conciliação com o financeiro.',
   '123456', 'Informe só o número da NF, sem a série nem a chave (a chave tem campo próprio).', 'gestao_empresarial', 43),

  ('commerce.compras.nf_data', '/dashboard/commerce/compras', 'NF do fornecedor', 'Data de emissão da NF',
   'Data em que a nota fiscal do fornecedor foi emitida. Opcional.',
   'Registra a data fiscal da entrada, usada em relatórios e na conferência com o fornecedor.',
   '10/02/2026', 'Data de emissão muito diferente da data da compra pode indicar NF trocada — confira.', 'gestao_empresarial', 44),

  ('commerce.compras.nf_chave', '/dashboard/commerce/compras', 'NF do fornecedor', 'Chave da NF (44 dígitos)',
   'Chave de acesso da NF-e do fornecedor, com 44 dígitos. Opcional.',
   'Identifica a NF-e de forma única e permite conferir a nota na SEFAZ depois.',
   '3526 0112 3456 7890 ... (44 dígitos)', 'A chave tem exatamente 44 dígitos numéricos; faltando ou sobrando dígitos ela fica inválida.', 'gestao_empresarial', 45),

  ('commerce.compras.nf_valor', '/dashboard/commerce/compras', 'NF do fornecedor', 'Valor da NF',
   'Valor total da nota fiscal do fornecedor, em reais. Opcional.',
   'Serve para conferir se o total da compra bate com o valor da NF de entrada.',
   '1.250,00', 'Valor da NF diferente do total dos itens indica divergência — confira antes de pagar.', 'gestao_empresarial', 46)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
