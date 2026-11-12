-- Inteligência (BI) · Análise de Dados (/dashboard/inteligencia) · RD-98 pilar 3 (ORIGEM do dado).
-- Code: desenvolvedor_4_g.
--
-- RD-38 (provado no dado): em system_screens a rota '/dashboard/inteligencia' tinha
-- views_consumidas = NULL e rpcs_chamadas = NULL. O auditor PDCA (aud8claudeps, 11/11, nota 82/95)
-- aponta esse vazio como RD-98 pilar 3 (ORIGEM) incompleto.
--
-- Origem real lida do código-fonte da própria página (src/app/dashboard/inteligencia/page.tsx,
-- linhas 39 e 50): o hub de BI é uma tela de CONSULTA que chama por área:
--   area=industrial -> fn_bi_temas_industrial
--   area=agro       -> fn_bi_temas_agro
-- Nenhum from(table) direto no hub; por isso só rpcs_chamadas (tela de consulta pode ter só RPCs).
--
-- Aditiva/idempotente: apenas UPDATE de 1 linha de metadados (system_screens). Sem DDL, sem dado
-- de cliente, sem RLS/grants, nenhuma função recriada. estado_real NÃO é tocado — quem promove a
-- tela é o auditor.

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_bi_temas_industrial','fn_bi_temas_agro']::text[]
 WHERE rota = '/dashboard/inteligencia';
