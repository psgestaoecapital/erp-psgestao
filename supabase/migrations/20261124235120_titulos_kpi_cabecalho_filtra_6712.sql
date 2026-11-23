-- #6712 (Gean Auto) · Tela de Títulos (receitas e despesas): os KPIs do cabeçalho
-- passam a FILTRAR a lista ao clicar (A pagar → tipo=pagar, A receber → tipo=receber,
-- Total vencido → status=vencido). Atualiza o "?" (RD-95) para explicar a ação.
-- Aditivo e idempotente: só acrescenta a frase da ação se ainda não estiver presente.
-- Não toca dado de cliente.

UPDATE public.erp_ajuda_campo
   SET para_que_serve = para_que_serve || ' Clique neste indicador para filtrar a lista pelos títulos a pagar.',
       versao = COALESCE(versao, 1) + 1,
       atualizado_em = now()
 WHERE chave = 'financeiro.titulos.kpi_pagar'
   AND para_que_serve NOT ILIKE '%Clique neste indicador para filtrar%';

UPDATE public.erp_ajuda_campo
   SET para_que_serve = para_que_serve || ' Clique neste indicador para filtrar a lista pelos títulos a receber.',
       versao = COALESCE(versao, 1) + 1,
       atualizado_em = now()
 WHERE chave = 'financeiro.titulos.kpi_receber'
   AND para_que_serve NOT ILIKE '%Clique neste indicador para filtrar%';

UPDATE public.erp_ajuda_campo
   SET para_que_serve = para_que_serve || ' Clique neste indicador para filtrar a lista só pelos títulos vencidos.',
       versao = COALESCE(versao, 1) + 1,
       atualizado_em = now()
 WHERE chave = 'financeiro.titulos.kpi_vencido'
   AND para_que_serve NOT ILIKE '%Clique neste indicador para filtrar%';
