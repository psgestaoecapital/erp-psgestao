-- RD-98 p3 (origem do dado): classifica a tela /dashboard/rateio (Rateio de custos de sede por
-- linha de negócio do grupo), que estava com views_consumidas/rpcs_chamadas vazios em
-- system_screens. Só metadados de desenvolvimento (system_screens) — NÃO toca dado de cliente,
-- RLS, segredo/vault, cálculo nem estado_real; as tabelas apenas são REFERENCIADAS pelo nome.
-- Aditivo e idempotente (valor fixo). Fontes conferidas no código (RD-38): a tela lê/escreve via
-- supabase.from(...) nas 6 tabelas abaixo; não chama nenhuma RPC.
-- Code: desenvolvedor_4_g
UPDATE public.system_screens
SET views_consumidas = ARRAY['business_line_config','business_line_custos','business_line_receitas','companies','company_groups','custos_sede']::text[],
    rpcs_chamadas = ARRAY[]::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/rateio';
