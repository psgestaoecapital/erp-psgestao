-- RD-98 p3 (origem do dado) — classificar estado_real e registrar a origem do dado
-- (views/tabelas lidas + RPCs) de 2 telas autocontidas que estavam 'desconhecida' com 0 fontes.
--
-- Fontes PROVADAS no código (RD-38, leitura de src/app/dashboard/<rota>/page.tsx):
--   /dashboard/contador → supabase.from: users, companies, user_companies, omie_imports, business_lines,
--                          v_lancamentos_consolidado
--   /dashboard/cotacoes → supabase.from: users, companies, user_companies, erp_cotacoes, erp_produtos,
--                          erp_fornecedores, erp_cotacoes_itens, erp_cotacoes_fornecedores, erp_cotacoes_propostas
--                          supabase.rpc: next_cotacao_numero, converter_cotacao_compra
--
-- Todo o acesso a dados está no próprio page.tsx.
-- estado_real='parcial' (funcional no código, sem verificação ponta a ponta / "?" RD-95 ainda incompleto).
--
-- Apenas METADADO de system_screens. Não toca RLS, dado de cliente nem comportamento.
-- ADITIVA e IDEMPOTENTE: só classifica quando ainda 'desconhecida' e só preenche a origem quando ainda vazia.

-- /dashboard/contador
UPDATE public.system_screens
SET estado_real = 'parcial'
WHERE rota = '/dashboard/contador' AND estado_real = 'desconhecida';

UPDATE public.system_screens
SET views_consumidas = ARRAY['users','companies','user_companies','omie_imports','business_lines','v_lancamentos_consolidado']::text[]
WHERE rota = '/dashboard/contador'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

-- /dashboard/cotacoes
UPDATE public.system_screens
SET estado_real = 'parcial'
WHERE rota = '/dashboard/cotacoes' AND estado_real = 'desconhecida';

UPDATE public.system_screens
SET views_consumidas = ARRAY['users','companies','user_companies','erp_cotacoes','erp_produtos','erp_fornecedores','erp_cotacoes_itens','erp_cotacoes_fornecedores','erp_cotacoes_propostas']::text[]
WHERE rota = '/dashboard/cotacoes'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['next_cotacao_numero','converter_cotacao_compra']::text[]
WHERE rota = '/dashboard/cotacoes'
  AND (rpcs_chamadas IS NULL OR cardinality(rpcs_chamadas) = 0);
