-- RD-98 pilar 3 (ORIGEM DO DADO) — P&M: system_screens.views_consumidas / rpcs_chamadas estavam NULL
-- (veredito PDCA auditor_pdca_2, 30/10). Migration ADITIVA, só metadado de catálogo: nenhuma tabela, RLS, policy ou dado de cliente.
-- Listas extraídas do código real de cada page.tsx (grep .from + .rpc). health-score e ia-preditiva são
-- ModuloPreview (sem consulta a dados) e ficam de fora de propósito — não se inventa origem que não existe.
-- Idempotente: UPDATE por rota, só onde ainda está vazio.

UPDATE public.system_screens s
   SET views_consumidas = v.views, rpcs_chamadas = v.rpcs
  FROM (VALUES
    ('/dashboard/pm/apontamento-horas',
      ARRAY['agency_equipe','agency_jobs','agency_timesheet'],
      ARRAY['fn_pm_timesheet_apontar','fn_pm_timesheet_custos']),
    ('/dashboard/pm/pauta',
      ARRAY['agency_aprovacoes','agency_campanhas','agency_clientes','agency_contratos','agency_grupos_clientes','agency_job_visto','agency_jobs','agency_pauta_preferencia','agency_servico','agency_visoes_pauta'],
      ARRAY['fn_acessos_pode_gerir','fn_pauta_contadores','fn_pauta_desfazer','fn_pauta_listar','fn_pauta_opcoes','fn_usuarios_da_empresa']),
    ('/dashboard/pm/margem-job',
      ARRAY['agency_clientes','agency_contratos','agency_equipe','agency_jobs','agency_servico'],
      ARRAY['fn_pm_job_custos']),
    ('/dashboard/pm/painel-gestor',
      ARRAY['agency_jobs','agency_timesheet'],
      ARRAY['fn_usuarios_da_empresa']),
    ('/dashboard/pm/planejamento',
      ARRAY['agency_jobs','agency_planejamentos','agency_posts','agency_servico','erp_clientes'],
      ARRAY['fn_agency_config_listar','fn_usuarios_da_empresa']),
    ('/dashboard/pm/configuracoes',
      ARRAY['agency_comissao','agency_proposta_config','crm_alerta_config'],
      ARRAY['fn_agency_config_excluir','fn_agency_config_listar','fn_agency_config_salvar','fn_funil_etapa_salvar','fn_funil_etapas_listar']),
    ('/dashboard/pm/contratos',
      ARRAY['agency_briefings','agency_contratos','agency_jobs','agency_planejamentos','agency_servico','erp_contratos'],
      ARRAY['fn_agency_contrato_item_excluir','fn_agency_contrato_item_salvar','fn_agency_contrato_listar','fn_agency_contrato_realizado','fn_agency_contrato_vincular_erp','fn_pm_planejamento_do_fee']),
    ('/dashboard/pm/cobranca',
      ARRAY['agency_clientes','agency_contratos'],
      ARRAY[]::text[]),
    ('/dashboard/producao',
      ARRAY['agency_clientes','agency_jobs','agency_tarefas','agency_timesheet','companies','erp_contratos','user_companies','users'],
      ARRAY['fn_agency_servico_listar_proposta','fn_pm_job_mover_status','fn_usuarios_da_empresa'])
  ) AS v(rota, views, rpcs)
 WHERE s.rota = v.rota
   AND (s.views_consumidas IS NULL OR cardinality(s.views_consumidas) = 0);
