-- RD-98 p3 (origem do dado): classifica a tela /dashboard/industrial/indicadores/editor (Editor
-- de indicadores da planta), que estava com views_consumidas/rpcs_chamadas vazios em
-- system_screens. Só metadados de desenvolvimento (system_screens) — NÃO toca dado de cliente,
-- RLS, segredo/vault, cálculo nem estado_real; as RPCs apenas são REFERENCIADAS pelo nome, não
-- alteradas. Aditivo e idempotente (valor fixo). Fontes conferidas no dado (RD-38).
-- Code: desenvolvedor_4_g
UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['fn_ind_semear_catalogo','fn_ind_tem_permissao']::text[],
    views_consumidas = ARRAY['ind_indicador_catalogo','ind_indicador_meta','ind_ponto_dia','industrial_plants']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/industrial/indicadores/editor';
