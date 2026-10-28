-- Indústria · Logística (pedido CEO 28/10): Frota e Viagens no menu lateral da Indústria.
-- Reusa as telas e RPCs do Hub de Projetos (sem tabela nova). A seção "Logística" aparece para as empresas com o plano
-- industrial (v15_industrial_grande), como as demais telas industriais. Nada é apagado; é cadastro (ON CONFLICT DO UPDATE).

-- 0) subgrupo 'logistica' (FK module_catalog_subgrupo_fkey exige a linha em module_subgrupos; o deploy falhou sem ela)
INSERT INTO public.module_subgrupos (id, label, ordem, ativo)
VALUES ('logistica', 'Logística', 99, true)
ON CONFLICT (id) DO NOTHING;

-- 1) menu: duas entradas na área industrial, subgrupo 'logistica' (seção "Logística", rótulo no front)
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, legacy, descricao)
VALUES
  ('industrial_logistica_frota', 'Frota', 'industrial', 'logistica', '/dashboard/industrial/logistica/frota', 'Truck', 20, true, false,
   'Controle de frota: veículos, manutenção preventiva por km, custos, documentos e relatórios (mesma tela do Hub de Projetos).'),
  ('industrial_logistica_viagens', 'Viagens', 'industrial', 'logistica', '/dashboard/industrial/logistica/viagens', 'Route', 21, true, false,
   'Viagens e relatório de viagem: lançamentos, consumo e fechamento (mesma tela do Hub de Projetos).')
ON CONFLICT (id) DO UPDATE
  SET nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo,
      rota = EXCLUDED.rota, icone = EXCLUDED.icone, ativo = true, legacy = false, descricao = EXCLUDED.descricao;

-- 2) liga as duas entradas ao plano industrial (quem tem a Indústria vê a Logística)
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT 'v15_industrial_grande', m FROM (VALUES ('industrial_logistica_frota'), ('industrial_logistica_viagens')) AS x(m)
ON CONFLICT DO NOTHING;

-- 3) telas vivas (RD-98): origem do dado e RPCs; prioridade só critica/alta/media/baixa (nunca 'normal')
INSERT INTO public.system_screens (id, area, rota, titulo, descricao_funcional, estado_real, prioridade_monitoramento, auditavel_robo,
                                   views_consumidas, rpcs_chamadas)
SELECT 'dashboard.industrial_logistica_frota', 'industrial', '/dashboard/industrial/logistica/frota', 'Logística · Frota',
       'Controle de frota da Indústria: veículos, plano de manutenção preventiva por km, custos, documentos e relatórios. Km e consumo vêm das viagens lançadas.',
       'pronto', 'media', true,
       ARRAY['erp_viagem', 'erp_viagem_lancamento', 'erp_hub_frota_veiculo', 'erp_hub_frota_manutencao_plano', 'erp_hub_frota_manutencao_registro',
             'erp_hub_frota_custo', 'erp_hub_frota_documento'],
       ARRAY['fn_hub_frota_indicadores', 'fn_hub_frota_relatorio_consumo', 'fn_hub_frota_relatorio_rodagem', 'fn_hub_frota_relatorio_multas',
             'fn_hub_frota_relatorio_manutencao', 'fn_hub_frota_veiculo_salvar', 'fn_hub_frota_manutencao_registrar', 'fn_hub_frota_custo_salvar',
             'fn_hub_frota_documento_salvar']
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE id = 'dashboard.industrial_logistica_frota');

INSERT INTO public.system_screens (id, area, rota, titulo, descricao_funcional, estado_real, prioridade_monitoramento, auditavel_robo,
                                   views_consumidas, rpcs_chamadas)
SELECT 'dashboard.industrial_logistica_viagens', 'industrial', '/dashboard/industrial/logistica/viagens', 'Logística · Viagens',
       'Viagens e relatório de viagem da Indústria: lançamentos, consumo por veículo e fechamento administrativo.',
       'pronto', 'media', true,
       ARRAY['erp_viagem', 'erp_viagem_lancamento', 'erp_viagem_ge_titulo', 'projetos_obras'],
       ARRAY['fn_viagem_salvar', 'fn_viagem_lancamento_salvar', 'fn_viagem_fechar', 'fn_viagem_relatorio', 'fn_viagem_indicadores', 'fn_viagem_consumo']
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE id = 'dashboard.industrial_logistica_viagens');
