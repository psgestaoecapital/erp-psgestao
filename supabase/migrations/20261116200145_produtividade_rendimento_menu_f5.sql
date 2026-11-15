-- CUSTEIO POR KG · F5 (Indústria · CEO 11/11, contexto 46b4527a, RD-102): a tela "Rendimentos" (padrão × real)
-- JÁ EXISTE em /dashboard/produtividade/rendimento (em system_screens, consome a RPC fn_prod_rendimento_comparativo,
-- RD-95 "?" completo) e hoje só é alcançável pelo link do hub /dashboard/produtividade. Esta migration fecha o elo
-- pedido pela diretriz ("menu Rendimentos"): registra a rota no module_catalog como 6º item do módulo
-- produtividade/industrial, ao lado de Mapa do fluxo, Produtos, Tarefas e Apontamento.
--
-- RD-26 (reuso, nada recriado): a tela, a RPC e o registro em system_screens já existem; aqui só entra a linha de menu.
-- Espelha o irmão `produtividade_mapa` (mesmo grupo/subgrupo/is_shared/ramos) — o padrão de rendimento "vive no Mapa",
-- então a entrada fica logo após o Mapa (ordem 205, entre Mapa=204 e Produtos=206).
-- Aditiva e idempotente: upsert pelo PK (id). Re-rodar só reafirma a linha (ativo=true). Sem DROP/DELETE, sem tocar
-- dado de cliente. Agente: desenvolvedor_4_g (faixa de segundos :45–:54).

INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, is_shared, so_ps, so_demo, legacy, diferencial,
   rbac_isento, dependencies, ramos_aplicaveis, surface_in_groups)
VALUES
  ('produtividade_rendimento', 'Rendimentos', '/dashboard/produtividade/rendimento', true, 'industrial', 'Percent',
   205, 'produtividade', true, false, false, false, false, false, '{}'::text[], ARRAY['bovinos']::text[], '{}'::text[])
ON CONFLICT (id) DO UPDATE SET
  nome   = EXCLUDED.nome,
  rota   = EXCLUDED.rota,
  ativo  = true,
  grupo  = EXCLUDED.grupo,
  icone  = EXCLUDED.icone,
  ordem  = EXCLUDED.ordem,
  subgrupo  = EXCLUDED.subgrupo,
  is_shared = EXCLUDED.is_shared;
