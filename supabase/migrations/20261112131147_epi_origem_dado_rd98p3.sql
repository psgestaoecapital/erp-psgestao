-- RD-98 p3 · documentar a ORIGEM DO DADO das telas de EPI (Compliance).
-- As colunas system_screens.views_consumidas / rpcs_chamadas estavam NULL em 4 rotas de EPI
-- (catálogo, estoque, fichas, alertas). O auditor (aud8) segura o selo (>=95) enquanto a origem
-- do dado não é documentada no catálogo — os selados têm origem preenchida.
--
-- Aditiva e idempotente: só preenche METADADO de catálogo (system_screens). Nenhum dado de cliente,
-- nenhuma mudança de schema, nenhuma RLS/permissão. Re-rodar resulta no mesmo estado.
-- Valores extraídos do código VIVO de cada page.tsx (RD-38): `.rpc('fn_...')` e `.from('tabela/view')`.
-- Objetos conferidos no banco (existem): epi_catalogo, epi_categoria, epi_estoque, epi_alerta,
-- v_epi_funcionarios_consolidado, fn_epi_excluir, fn_epi_candidatos_estoque, fn_epi_importar_estoque,
-- fn_ajuda_campo_listar, fn_ajuda_campo_uso.
-- Code: desenvolvedor_4_g

-- /dashboard/compliance/epi/catalogo
--   page.tsx: .from('epi_catalogo') / .from('epi_categoria');
--   .rpc('fn_epi_excluir'/'fn_epi_candidatos_estoque'/'fn_epi_importar_estoque'); AjudaCampo (fn_ajuda_campo_*).
UPDATE public.system_screens SET
  views_consumidas = ARRAY['epi_catalogo','epi_categoria']::text[],
  rpcs_chamadas = ARRAY[
    'fn_epi_excluir','fn_epi_candidatos_estoque','fn_epi_importar_estoque',
    'fn_ajuda_campo_listar','fn_ajuda_campo_uso'
  ]::text[]
WHERE rota = '/dashboard/compliance/epi/catalogo';

-- /dashboard/compliance/epi/estoque
--   page.tsx: .from('epi_estoque') / .from('epi_catalogo'). Sem RPC.
UPDATE public.system_screens SET
  views_consumidas = ARRAY['epi_estoque','epi_catalogo']::text[],
  rpcs_chamadas = ARRAY[]::text[]
WHERE rota = '/dashboard/compliance/epi/estoque';

-- /dashboard/compliance/epi/fichas
--   page.tsx: .from('v_epi_funcionarios_consolidado'). Sem RPC.
UPDATE public.system_screens SET
  views_consumidas = ARRAY['v_epi_funcionarios_consolidado']::text[],
  rpcs_chamadas = ARRAY[]::text[]
WHERE rota = '/dashboard/compliance/epi/fichas';

-- /dashboard/compliance/epi/alertas
--   page.tsx: .from('epi_alerta'). Sem RPC.
UPDATE public.system_screens SET
  views_consumidas = ARRAY['epi_alerta']::text[],
  rpcs_chamadas = ARRAY[]::text[]
WHERE rota = '/dashboard/compliance/epi/alertas';
