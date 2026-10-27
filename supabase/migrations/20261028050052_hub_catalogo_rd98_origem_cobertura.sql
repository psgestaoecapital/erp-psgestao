-- Hub · Catálogo · RD-98 pilar 3 + documentação de cobertura (dev desenvolvedor_4_g, faixa 52)
-- Delta aud8/Max 27/10 15:29 (/dashboard/projetos/catalogo, nota 84 → meta 95). Fase: Saneamento V1.
-- Conferido no dado (RD-38):
--   • p3 (ORIGEM): system_screens de /catalogo estava 0/0. Preenche com o que a lista e o detalhe (CPU) leem de fato:
--       - lista (page.tsx): v_projetos_servicos_catalogo, projetos_servicos, projetos_modulo_config (BDI)
--       - detalhe/CPU ([id]/page.tsx via fn_servico_composicao_detalhe): projetos_servicos_bom, m16_insumos, projetos_mao_obra
--       - RPCs: duplicar/deletar/importar_catalogo_publico (lista) + servico_completo/servico_composicao_detalhe (CPU).
--   • Cobertura (RD-98 p1): DEMO 006 tem 9 serviços seed REAIS, todos com BOM (2–7 linhas) e custo/venda via BDI — o
--     catálogo de ~60 serviços/390 BOM do blueprint é do cliente real (FC/Tryo), não da empresa DEMO. Documentado em
--     observacoes para a auditoria não ler os 9 como "catálogo truncado".
--   • BDI: projetos_modulo_config da DEMO 006 tem UM BDI (31,86%) por empresa; o "dois BDIs no mesmo m²" é achado antigo
--     e não reproduz no dado atual (o custo de mão de obra na CPU vem vivo de projetos_mao_obra.custo_hora).
-- Migration ADITIVA de metadado (só system_screens). Sem alteração de função/tela.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_projetos_servicos_catalogo','projetos_servicos','projetos_servicos_bom','projetos_modulo_config','m16_insumos','projetos_mao_obra']::text[],
       rpcs_chamadas = ARRAY['fn_projetos_duplicar_servico','fn_projetos_deletar_servico','fn_projetos_importar_catalogo_publico','fn_projetos_servico_completo','fn_servico_composicao_detalhe']::text[],
       observacoes = concat_ws(E'\n',
         NULLIF(observacoes, ''),
         'RD-98 p3 (27/10): origem do dado preenchida — lista lê v_projetos_servicos_catalogo + projetos_modulo_config (BDI); a CPU do detalhe lê projetos_servicos_bom + m16_insumos (material) + projetos_mao_obra (mão de obra, custo_hora vivo).',
         'Cobertura DEMO 006: 9 serviços seed reais (todos com BOM e preço de venda via BDI 31,86%). O catálogo ~60 serviços/390 BOM do blueprint é do cliente real (FC/Tryo), não da empresa DEMO.'),
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/catalogo';
