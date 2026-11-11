-- Indústria · RD-98 p3 (origem do dado) para a tela de Ponto (lente industrial),
-- rota /dashboard/industrial/ponto. Code: jordana-code.
--
-- RD-38 (provado no dado): em system_screens esta rota tinha views_consumidas = NULL e
-- rpcs_chamadas = NULL (0 views / 0 rpc). O auditor PDCA aponta esse vazio como RD-98
-- pilar 3 (ORIGEM) não rastreada. Esta migration só DOCUMENTA a origem real do dado,
-- lida do código-fonte da própria página (src/app/dashboard/industrial/ponto/page.tsx →
-- src/components/ponto/PontoView.tsx e src/components/ponto/PontoPainelDia.tsx) — nenhum
-- comportamento muda, nenhuma função é recriada.
--
-- Aditiva/idempotente: apenas UPDATE de uma linha de metadados (system_screens). Sem DDL,
-- sem dado de cliente, sem RLS/grants. estado_real NÃO é tocado — quem promove a tela é o
-- auditor.
--
-- Fontes de leitura (from) em PontoView.tsx: ind_ponto_provider_config (config do provedor),
-- erp_credencial (credencial do banco de horas), erp_banco_sync_log (log de sincronização),
-- ind_ponto_colaborador (colaboradores do ponto) e ind_ponto_horas (horas apuradas).
-- RPCs em PontoView.tsx: fn_compliance_projetar_de_ind_ponto, fn_bi_gente_setores_visiveis.
-- RPCs em PontoPainelDia.tsx (painel do dia renderizado na tela): fn_ponto_bi_dia,
-- fn_ponto_bi_colaborador_dias, fn_ponto_bi_marcacoes.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['ind_ponto_provider_config','erp_credencial',
                                'erp_banco_sync_log','ind_ponto_colaborador',
                                'ind_ponto_horas']::text[],
       rpcs_chamadas     = ARRAY['fn_compliance_projetar_de_ind_ponto',
                                 'fn_bi_gente_setores_visiveis','fn_ponto_bi_dia',
                                 'fn_ponto_bi_colaborador_dias','fn_ponto_bi_marcacoes']::text[]
 WHERE rota = '/dashboard/industrial/ponto';
