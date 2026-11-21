-- RD-98 p3 · origem do dado da nova rota do Hub /dashboard/projetos/agenda (criada na PR da
-- agenda comercial do Hub, §311). A rota monta o MESMO componente compartilhado da agenda do
-- P&M (AgendaComercialView), então a fonte de dado é idêntica à de /dashboard/pm/agenda.
--
-- Fontes reais (prova no código, RD-38):
--   src/components/agenda/AgendaComercialView.tsx
--     * LEITURA: tabela erp_agendamento (supabase.from, origem_modulo='comercial') — eventos da agenda.
--     * LEITURA: tabela agency_leads   (supabase.from) — leads vinculáveis ao evento (dados.lead_id).
--     * LEITURA: tabela users / agency_equipe — nome do responsável / opções de responsável.
--     * RPCs: fn_agendamento_criar, fn_agendamento_mudar_status, fn_agendamento_excluir.
--
-- Só metadado de registro da tela (espelha a linha já auditada de /dashboard/pm/agenda):
-- NÃO toca RLS, grants, dado de cliente, nem comportamento. Aditiva e idempotente
-- (ON CONFLICT (rota) — rota é UNIQUE). Prova BEGIN..ROLLBACK: 1 linha com os valores acima.

INSERT INTO public.system_screens
  (id, rota, area, titulo, views_consumidas, rpcs_chamadas, estado_real, prioridade_monitoramento, auditavel_robo)
VALUES (
  gen_random_uuid(),
  '/dashboard/projetos/agenda',
  'hub',
  'Hub de Projetos · Agenda comercial',
  ARRAY['erp_agendamento','agency_leads','users']::text[],
  ARRAY['fn_agendamento_criar','fn_agendamento_excluir','fn_agendamento_mudar_status']::text[],
  'pronto',
  'media',
  true
)
ON CONFLICT (rota) DO UPDATE SET
  area             = EXCLUDED.area,
  titulo           = EXCLUDED.titulo,
  views_consumidas = EXCLUDED.views_consumidas,
  rpcs_chamadas    = EXCLUDED.rpcs_chamadas,
  estado_real      = EXCLUDED.estado_real,
  atualizado_em    = now();
