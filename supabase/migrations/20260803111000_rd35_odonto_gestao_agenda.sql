-- RD-41 · RD-35 — registra a tela "Gestão da Agenda" (/dashboard/odonto/gestao-agenda):
-- menu (module_catalog · grupo odonto) + system_screens + não órfã. Idempotente.

INSERT INTO public.module_catalog
  (id, nome, grupo, icone, rota, ordem, ativo, layer, vertical_specific, is_shared, dependencies, subgrupo, surface_in_groups, diferencial)
VALUES ('odonto_gestao_agenda', 'Gestão da Agenda', 'odonto', '🗓️', '/dashboard/odonto/gestao-agenda', 6, true,
        '3_specific', ARRAY['odonto']::text[], false, ARRAY[]::text[], NULL, ARRAY[]::text[], false)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, icone = EXCLUDED.icone, rota = EXCLUDED.rota,
  ordem = EXCLUDED.ordem, ativo = true, layer = EXCLUDED.layer;

INSERT INTO public.system_screens
  (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento,
   rpcs_chamadas, componentes_principais)
VALUES (
  'odonto_gestao_agenda', '/dashboard/odonto/gestao-agenda', 'odonto', 'odonto_gestao_agenda', 'Gestão da Agenda',
  'CRUD premium de cadeiras e profissionais da clínica (nome, cor, ordem, horário; profissional com CRO/especialidade/comissão/avatar/vínculo de login). Soft-delete via ativo (reversível). Guard Owner/Manager (fn_acessos_pode_gerir). Base do painel de estatísticas (PR2).',
  'pronto', 'media',
  ARRAY['fn_odonto_cadeira_salvar','fn_odonto_cadeira_arquivar','fn_odonto_profissional_salvar','fn_odonto_profissional_arquivar']::text[],
  ARRAY['GestaoAgendaPage','ModalCadeira','ModalProf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota, titulo = EXCLUDED.titulo, descricao_funcional = EXCLUDED.descricao_funcional,
  estado_real = EXCLUDED.estado_real, rpcs_chamadas = EXCLUDED.rpcs_chamadas,
  componentes_principais = EXCLUDED.componentes_principais, atualizado_em = now();
