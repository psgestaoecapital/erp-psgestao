-- RD-98 p3 (origem do dado): classifica a tela /dashboard/industrial/conectores, que estava
-- com views_consumidas/rpcs_chamadas vazios em system_screens. Só metadados de desenvolvimento
-- (system_screens) — NÃO toca dado de cliente, RLS, segredo/vault, cálculo nem estado_real; as
-- RPCs apenas são REFERENCIADAS pelo nome, não alteradas. Aditivo e idempotente (valor fixo).
-- Fontes conferidas no dado (RD-38). Code: desenvolvedor_4_g
UPDATE public.system_screens
SET rpcs_chamadas = ARRAY[
      'fn_atak_conexao_listar',
      'fn_atak_conexao_salvar',
      'fn_atak_onboarding_checklist',
      'fn_atak_testar_conexao'
    ]::text[],
    views_consumidas = ARRAY['atak_fonte_mapa','erp_agente_status']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/industrial/conectores';
