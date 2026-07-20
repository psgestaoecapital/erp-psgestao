-- MENU INDUSTRIAL · 2ª leva de intrusos (CEO validou na tela/Frioeste). Só menu, reversível (RD-55).
-- ANTES: os 9 tinham 'industrial' em surface_in_groups; inteligencia subgrupo='analises', badge=previsto.
-- Reverter: array_append('industrial',...) nos 9 + inteligencia.subgrupo='analises' + remover a linha feature_catalog.
-- FICA na área: INÍCIO · OPERAÇÃO(Ponto) · ABASTECIMENTO(Abast+Folha) · INDÚSTRIA · INTELIGÊNCIA(BI) · ADMINISTRAÇÃO.
-- Motivo: Análises/DRE/Score/Consultor IA são financeiros (e várias VAZIAS no tenant → parecem quebradas).

-- 1 · tira da área industrial (continuam nas outras áreas; quem precisar troca p/ Gestão Empresarial):
UPDATE public.module_catalog SET surface_in_groups = array_remove(surface_in_groups, 'industrial')
WHERE 'industrial' = ANY(surface_in_groups)
  AND id IN ('linhas_negocio','painel_geral','visao_diaria',
             'dre_divisional_modulo','analises_financeiras','operacional','resultado_dre',
             'score_inadimplencia',
             'consultor_ia');

-- 2 · Inteligência (BI) — tela de BI do ponto (71 mil marcações): seção própria + badge PRONTO.
UPDATE public.module_catalog SET subgrupo='inteligencia_bi' WHERE id='inteligencia';
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
SELECT gen_random_uuid(), 'inteligencia', 'industrial', 'Inteligência (BI)',
       'BI do ponto/jornada (marcações reais).', 'pronto', 100
WHERE NOT EXISTS (SELECT 1 FROM public.feature_catalog WHERE module_id='inteligencia');
UPDATE public.feature_catalog SET status='pronto', percentual_pronto=100, atualizado_em=now() WHERE module_id='inteligencia';
