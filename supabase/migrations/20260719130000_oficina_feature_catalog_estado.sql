-- OFICINA LOTE B · estado real das telas no badge do menu (RD-51: UI não mente).
-- Tempário estava "Em construção" sendo uma das telas mais polidas (custo-hora validado na tela pelo
-- CEO) → 'pronto'. As 6 telas novas (funcionam, em validação) apareciam "Previsto" (default) → 'parcial'.
-- Régua: 'pronto' só com prova real — Tempário teve (CEO na tela). As 6 ficam 'parcial' até validação completa.

-- Tempário: diferencial exclusivo rodando → pronto
UPDATE public.feature_catalog SET status='pronto', percentual_pronto=100, atualizado_em=now()
  WHERE module_id='oficina_tempario';

-- 6 telas da cadeia: estado real = parcial (não 'previsto', que diz "não construído")
UPDATE public.feature_catalog SET status='parcial', percentual_pronto=60, atualizado_em=now()
  WHERE module_id IN ('oficina_comissao','oficina_veiculos_fipe');

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
SELECT gen_random_uuid(), mc.id, 'oficina', mc.nome, coalesce(nullif(mc.descricao,''), mc.nome), 'parcial', 60
FROM public.module_catalog mc
WHERE mc.id IN ('oficina_recepcao','oficina_diagnostico','oficina_aprovacao_cliente','oficina_apontamento_mecanico')
  AND NOT EXISTS (SELECT 1 FROM public.feature_catalog fc WHERE fc.module_id = mc.id);
