-- RD-41 · Odonto O2 — registrar a tela clínica (/dashboard/odonto/clinica) no catálogo (RD-35):
-- module_catalog (menu odonto) + system_screens. Idempotente.

INSERT INTO public.module_catalog
  (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, layer, vertical_specific, is_shared, dependencies, surface_in_groups, diferencial)
VALUES ('odonto_clinica', 'Clínica (Odontograma)', 'odonto', NULL, '🦷', '/dashboard/odonto/clinica', 2, true,
        '3_specific', ARRAY['odonto']::text[], false, ARRAY[]::text[], ARRAY[]::text[], true)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, icone = EXCLUDED.icone, rota = EXCLUDED.rota,
  ordem = EXCLUDED.ordem, ativo = true, layer = EXCLUDED.layer, diferencial = EXCLUDED.diferencial;

INSERT INTO public.system_screens
  (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento,
   rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES (
  'odonto_clinica', '/dashboard/odonto/clinica', 'odonto', 'odonto_clinica', 'Clínica (Odontograma + Plano)',
  'Tela clínica diária da odonto (O2 PR1): odontograma SVG FDI com 5 faces por dente + seleção em massa (lê fn_odonto_odontograma_estado); adicionar tratamento com VALOR + sugestão/salvar preço padrão (fn_odonto_procedimento_preco_definir — resolve a O0 preço=0); lista do plano + total (fn_odonto_plano_salvar); aprovar com parcelamento → erp_receber real em GE (fn_odonto_plano_aprovar_financeiro — prova a O0); concluir item (fn_odonto_item_concluir → verde). Voz/explicador IA no PR2.',
  'pronto', 'alta',
  ARRAY['fn_odonto_odontograma_estado','fn_odonto_plano_salvar','fn_odonto_plano_obter','fn_odonto_plano_aprovar_financeiro','fn_odonto_item_concluir','fn_odonto_procedimento_preco_definir']::text[],
  ARRAY['ClinicaOdontoPage','Odontograma','AprovarModal']::text[],
  ARRAY[]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota, area = EXCLUDED.area, modulo = EXCLUDED.modulo, titulo = EXCLUDED.titulo,
  descricao_funcional = EXCLUDED.descricao_funcional, estado_real = EXCLUDED.estado_real,
  prioridade_monitoramento = EXCLUDED.prioridade_monitoramento, rpcs_chamadas = EXCLUDED.rpcs_chamadas,
  componentes_principais = EXCLUDED.componentes_principais, atualizado_em = now();
