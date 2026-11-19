-- RD-98 p3 (origem do dado): classifica a tela /dashboard/configuracoes/empresa (Dados da
-- Empresa · cadastral + logo), que estava com views_consumidas/rpcs_chamadas vazios em
-- system_screens. Só metadados de desenvolvimento (system_screens) — NÃO toca dado de cliente,
-- RLS, segredo/vault, cálculo nem estado_real; as funções apenas são REFERENCIADAS pelo nome.
-- Aditivo e idempotente (valor fixo). Fontes conferidas no código (RD-38): a tela chama 8 RPCs
-- (obter/salvar dados, endereço, IE isento, estoque negativo, logo), todas existentes em
-- pg_proc. Não lê tabela/view diretamente (logo vai ao storage bucket company-assets, fora do
-- escopo de views_consumidas).
-- Code: desenvolvedor_4_g
UPDATE public.system_screens
SET views_consumidas = ARRAY[]::text[],
    rpcs_chamadas = ARRAY['fn_empresa_obter_dados','fn_empresa_obter_ie_isento','fn_empresa_obter_estoque_negativo','fn_empresa_salvar_dados','fn_empresa_salvar_endereco','fn_empresa_salvar_ie_isento','fn_empresa_salvar_estoque_negativo','fn_empresa_salvar_logo']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/configuracoes/empresa';
