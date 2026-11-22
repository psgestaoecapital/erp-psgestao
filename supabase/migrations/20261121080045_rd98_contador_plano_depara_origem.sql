-- RD-98 p3 (origem do dado): classifica /dashboard/contador/plano-depara
-- ("Plano de contas do contador"), que estava com views_consumidas/rpcs_chamadas
-- vazios (null) e estado_real='desconhecida' em system_screens.
--
-- Só metadado de desenvolvimento (system_screens) — NÃO toca dado de cliente, RLS,
-- segredo/vault, cálculo nem comportamento da tela. As RPCs apenas são REFERENCIADAS
-- pelo nome (não são criadas nem alteradas). Aditivo e idempotente (valor fixo:
-- reaplicar não altera nada).
--
-- Fontes conferidas no código (RD-38), src/app/dashboard/contador/plano-depara/page.tsx:
--   rpc('fn_contabil_depara_listar')   -> lista o de-para contábil (linha 86)
--   rpc('fn_contabil_depara_importar') -> importa linhas do de-para (linha 105)
--   rpc('fn_plano_contas_buscar')      -> busca contas do plano (linha 248)
--   rpc('fn_contabil_depara_vincular') -> vincula linha a conta do plano (linha 256)
-- Sem views diretas (a página só consome via RPC) e sem componente AjudaCampo.
-- As 4 RPCs existem em public (conferido em pg_proc).
UPDATE public.system_screens
SET rpcs_chamadas = ARRAY[
      'fn_contabil_depara_listar',
      'fn_contabil_depara_importar',
      'fn_plano_contas_buscar',
      'fn_contabil_depara_vincular'
    ]::text[],
    estado_real = 'parcial',
    atualizado_em = now()
WHERE rota = '/dashboard/contador/plano-depara'
  AND estado_real = 'desconhecida';
