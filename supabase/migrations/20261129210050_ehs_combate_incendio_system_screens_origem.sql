-- PS EHS · PDCA (auditor_pdca_1 28/11) · rota /dashboard/ehs/combate-incendio (NR-23, Extintores e hidrantes)
-- RD-98 pilar 1: estado_real 'desconhecida' -> 'real' (há dado real na DEMO EHS b0700000-…-000b: 4 equipamentos ativos).
-- RD-98 pilar 3: registra a ORIGEM DO DADO da rota em system_screens, provada no código vivo (RD-38):
--   • relações lidas (views_consumidas): a tabela ehs_combate_incendio (leitura/escrita direta com RLS por empresa)
--     + as relações do hook useCompanyIds (users, company_groups, companies, user_companies);
--   • RPCs chamadas (rpcs_chamadas): fn_ajuda_campo_listar / fn_ajuda_campo_uso (componente AjudaCampo, RD-95 "?").
-- Idempotente e aditiva: UPDATE de UMA linha de registro de tela (metadados). Não toca dado de cliente; RLS inalterada.
-- Code: desenvolvedor_5_g

UPDATE public.system_screens
SET estado_real      = 'real',
    views_consumidas = ARRAY['ehs_combate_incendio','user_companies','companies','company_groups','users']::text[],
    rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[]
WHERE rota = '/dashboard/ehs/combate-incendio';
