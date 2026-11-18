-- RD-98 p3 (origem do dado): classifica 6 telas de EHS/Compliance que estavam
-- system_screens.estado_real='desconhecida', embora rpcs_chamadas e views_consumidas
-- JÁ estivessem completas e conferidas no código (telas autocontidas, só leitura via
-- supabase.from(...), sem RPC de escrita e sem fetch a /api). Falta só a classificação.
--
-- Fontes provadas no código (RD-38) — todo acesso a dados está no próprio page.tsx:
--   /dashboard/ehs/cockpit            -> v_ehs_cockpit_resumo, v_ehs_cockpit_setor
--   /dashboard/ehs/matriz/epi-posto   -> epi_catalogo, prod_posto, prod_posto_epi, prod_posto_pessoa, prod_setor
--   /dashboard/ehs/matriz/heranca-pessoa -> v_ehs_heranca_pessoa
--   /dashboard/ehs/matriz/risco-setor -> prod_posto, prod_posto_pessoa, prod_setor, prod_setor_risco
--   /dashboard/ehs/matriz/treinamento-posto -> nr_treinamento_tipo, prod_posto, prod_posto_pessoa, prod_posto_treinamento, prod_setor
--   /dashboard/ehs/setores            -> compliance_setores
-- (rpcs_chamadas = as 2 do componente AjudaCampo: fn_ajuda_campo_listar, fn_ajuda_campo_uso)
--
-- Migration ADITIVA e IDEMPOTENTE de metadado: muda estado_real para 'parcial' SÓ
-- enquanto ainda estiver 'desconhecida'. Não toca RLS, dado de cliente, rpcs_chamadas,
-- views_consumidas nem comportamento. Reaplicar não altera nada.
UPDATE public.system_screens
SET estado_real = 'parcial'
WHERE rota IN (
  '/dashboard/ehs/cockpit',
  '/dashboard/ehs/matriz/epi-posto',
  '/dashboard/ehs/matriz/heranca-pessoa',
  '/dashboard/ehs/matriz/risco-setor',
  '/dashboard/ehs/matriz/treinamento-posto',
  '/dashboard/ehs/setores'
)
AND estado_real = 'desconhecida';
