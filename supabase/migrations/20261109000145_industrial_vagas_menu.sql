-- Indústria/RH · Vagas e reposição de quadro — ENTRADA NO MENU (module_catalog + plan_modules).
--
-- Contexto: a tela /dashboard/industrial/vagas (#4099) e a camada rh_vaga (#3691) já estão na main; a rota já está
-- registrada em system_screens e tem ajuda RD-95. Faltava só a entrada de menu, deliberadamente adiada na #4099
-- ("depende de decisão de catálogo/plano do Eng. Chefe"). Esta migration a acrescenta, espelhando EXATAMENTE o módulo
-- irmão industrial_mao_obra (mesmo grupo=industrial, subgrupo=rh_ponto, ao lado de Folha/Mão de Obra/Ponto), que o
-- Eng. Chefe posicionou em 08/11 — o mesmo padrão de catálogo e de planos.
--
-- GATED: enquanto não houver a decisão do Eng. Chefe sobre o catálogo, esta PR fica em RASCUNHO com a label
-- `nao-publicar` — não entra na fila nem toca o menu em produção. É só a preparação pronta para um OK de uma palavra.
--
-- RD-26: REUSA o catálogo e os planos existentes; nenhuma tabela/função/RLS/grant é criada ou alterada; nenhum dado de
-- cliente é tocado. module_catalog e plan_modules são catálogos globais de referência (sem company_id).
--
-- RD-38 (produção, só leitura + BEGIN/ROLLBACK nesta sessão):
--   * module_catalog NÃO tem 'industrial_rh_vagas' (0 antes; 1 depois).
--   * o irmão industrial_mao_obra tem 5 planos (v15_industrial_media/grande/pequena, industrial, v15_gestao_empresarial_pro);
--     o INSERT ... SELECT replica exatamente esses 5 para industrial_rh_vagas (5 depois; re-rodado = 5, idempotente).
--
-- RD-52: arquivo + PR, versão 20261109000145 acima da última da main (20261109000115), faixa de segundos :45–:54.
-- ADITIVA e idempotente: ON CONFLICT (id) / ON CONFLICT (plan_id, module_id) DO NOTHING.

-- 1) Menu: um item "Vagas" no subgrupo rh_ponto do grupo industrial, logo após "Mão de Obra" (ordem 12).
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, ordem, ativo, icone, is_shared, legacy, diferencial, rbac_isento)
VALUES ('industrial_rh_vagas', 'Vagas', 'industrial', 'rh_ponto', '/dashboard/industrial/vagas', 13, true, 'UserPlus', false, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- 2) Planos: libera o módulo nos MESMOS planos em que o irmão industrial_mao_obra está ativo (sem chumbar a lista).
INSERT INTO public.plan_modules (plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT pm.plan_id, 'industrial_rh_vagas', true, 'basic', false
FROM public.plan_modules pm
WHERE pm.module_id = 'industrial_mao_obra'
ON CONFLICT (plan_id, module_id) DO NOTHING;
