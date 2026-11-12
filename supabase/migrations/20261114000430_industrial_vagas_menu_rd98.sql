-- RD-98 (MENU) · Gap do auditor em /dashboard/industrial/vagas: a tela é funcional
-- (abrir/decidir/cancelar vaga via fn_rh_vaga_*, SECURITY DEFINER com guarda de empresa/papel;
-- 12 "?" RD-95 e estado vazio já no banco; system_screens já registrada), mas NÃO estava em
-- module_catalog — o usuário não a alcançava pelo menu. RD-98: tela >= 95 tem de estar no menu ativo.
--
-- ADITIVA e idempotente: só linhas novas de catálogo (1 item de menu) + inclusão nos mesmos planos
-- do módulo irmão de RH "Mão de Obra" (system_screens.modulo = industrial_mao_obra). Nenhuma
-- função/view/policy muda; nenhum dado de cliente é tocado.
-- Prova RD-38 (produção, BEGIN/ROLLBACK): antes module_catalog=0/plan_modules=0; depois=1/5.

INSERT INTO public.module_catalog
  (id, nome, grupo, subgrupo, layer, icone, rota, ordem, ativo, is_shared, vertical_specific, surface_in_groups, descricao)
VALUES
  ('industrial_vagas', 'Vagas e reposição de quadro', 'industrial', 'rh_ponto', '3_specific', 'UserPlus',
   '/dashboard/industrial/vagas', 13, true, false, ARRAY['industrial'], ARRAY['industrial'],
   'Abertura, decisão e cancelamento de vagas para reposição de quadro, com guarda de empresa e papel.')
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo, layer = EXCLUDED.layer,
  icone = EXCLUDED.icone, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true,
  is_shared = EXCLUDED.is_shared, vertical_specific = EXCLUDED.vertical_specific,
  surface_in_groups = EXCLUDED.surface_in_groups, descricao = EXCLUDED.descricao;

-- Mesmos planos do módulo irmão de RH "Mão de Obra" (a tela pertence a esse módulo em system_screens).
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'industrial_vagas'
FROM public.plan_modules pm
WHERE pm.module_id = 'industrial_mao_obra'
  AND NOT EXISTS (
    SELECT 1 FROM public.plan_modules x
    WHERE x.plan_id = pm.plan_id AND x.module_id = 'industrial_vagas'
  );
