-- PDCA GE · RD-98 p3 (origem do dado) · registra a origem da tela de configurar o DRE divisional
-- Code: desenvolvedor_4_g
--
-- Problema (RD-98 p3 / fallback GE): a rota /dashboard/dre-divisional/configurar está em system_screens
-- como 'pronto', mas com rpcs_chamadas NULL — o aud8 não confere de onde a tela lê/grava e a tela não
-- fecha o termômetro.
--
-- Fontes CONFERIDAS no código vivo (main), não supostas (RD-38):
--   src/app/dashboard/dre-divisional/configurar/page.tsx
--     rpcs_chamadas: fn_dre_ordem_personalizada_get (l.81), fn_dre_ordem_personalizada_set (l.123),
--                    fn_dre_ordem_personalizada_reset (l.140)
--     views_consumidas: nenhuma — a tela só acessa dados pelas 3 RPCs (SECURITY DEFINER), sem leitura
--                       direta de tabela; por isso views_consumidas segue NULL (correto).
-- As 3 funções existem em public (conferido em pg_proc).
--
-- Aditivo e idempotente: só UPDATE em system_screens (metadado interno de auditoria). Não toca núcleo,
-- RLS, menu, função, cálculo do DRE nem dado de cliente. Re-run grava o mesmo valor.
--
-- RD-38 (produção): ANTES rpcs_chamadas NULL ; DEPOIS rpcs_chamadas = 3 funções (demais colunas intactas).

UPDATE public.system_screens
SET rpcs_chamadas = ARRAY[
      'fn_dre_ordem_personalizada_get',
      'fn_dre_ordem_personalizada_set',
      'fn_dre_ordem_personalizada_reset'
    ]::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/dre-divisional/configurar';
