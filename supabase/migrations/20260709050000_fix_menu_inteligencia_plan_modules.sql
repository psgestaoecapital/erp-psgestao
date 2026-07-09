-- FIX menu Inteligência (urgente): a entrada module_catalog 'inteligencia' existia mas NÃO
-- estava em plan_modules. fn_modulos_sidebar_por_area monta o menu a partir dos módulos do
-- PLANO da empresa (plan_modules), então a Inteligência nunca aparecia — em nenhuma área.
-- Vincula 'inteligencia' aos mesmos planos que já concedem o Ponto Eletrônico industrial
-- + coloca na seção ANÁLISES. (Rota /dashboard/inteligencia e código já estavam no main #583/#584.)
INSERT INTO plan_modules (plan_id, module_id)
SELECT DISTINCT plan_id, 'inteligencia' FROM plan_modules WHERE module_id='industrial_ponto_eletronico'
ON CONFLICT DO NOTHING;

UPDATE module_catalog SET subgrupo='analises', ativo=true, nome='Inteligência (BI)', icone='📊'
WHERE id='inteligencia';
