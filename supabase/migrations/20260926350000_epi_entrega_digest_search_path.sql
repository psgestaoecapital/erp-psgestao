-- Correção · a entrega de EPI pela tela falha para QUALQUER empresa: "function digest(text, unknown) does not exist".
--
-- Provado como o robô (RD-82), em rollback, na demonstração: fn_epi_registrar_entrega (SECURITY DEFINER,
-- search_path = public, pg_temp) insere em epi_movimentacao; o trigger fn_epi_movimentacao_hash chama digest()
-- SEM schema e herda o search_path de quem o dispara — e digest() mora no schema 'extensions' (pgcrypto).
-- No dado: 2 movimentações de EPI em toda a base, a última em 14/05/2026.
--
-- Mesma raiz em mais 3 funções que chamam digest() sem schema e sem search_path próprio (dependem de quem chama):
--   fn_epi_assinatura_hash (trigger da assinatura da entrega), fn_compliance_epi_confirmar_assinatura (link de
--   assinatura por WhatsApp) e fn_compliance_acidente_registrar (CAT) — as duas últimas são SECURITY DEFINER sem
--   search_path fixo (também é endurecimento de segurança).
-- Correção mínima: fixar search_path = public, extensions, pg_temp nas 4. Nenhuma lógica muda; nenhum dado muda.

ALTER FUNCTION public.fn_epi_movimentacao_hash() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.fn_epi_assinatura_hash() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.fn_compliance_epi_confirmar_assinatura(text, text, inet, text, jsonb, text)
  SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.fn_compliance_acidente_registrar(uuid, uuid, timestamp with time zone, text, text, text, text,
  text[], text, text, text, text, boolean, text, text, text, boolean, date, date, boolean, uuid[], numeric, numeric, inet, text)
  SET search_path = public, extensions, pg_temp;
