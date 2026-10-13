-- SPEC SONDA-SALDO · registrador de diagnóstico (sonda TEMPORÁRIA — remover ou promover após o veredito).
-- Objetivo: PROVAR com payload real quais campos de saldo existem (Sicoob v4 e OFX) antes do FIN-2/R1.
-- NÃO implementa saldo. NÃO cria coluna em tabela de domínio. Reusa erp_banco_sync_log (RD-52).
--
-- Por que um RPC: erp_banco_sync_log tem RLS com política só de SELECT — apenas o service role insere.
-- Nem o browser (UploadFaturaExtrato) nem o edge (ofx-upload) conseguiriam gravar direto. Este RPC
-- SECURITY DEFINER é o PONTO ÚNICO de escrita da sonda; a rota /api/banco/extrato/sync (service role),
-- o browser e o edge passam todos por aqui.
--
-- Contrato: o caller entrega o "retrato" JÁ SANITIZADO — só NOMES de chave de 1º nível + campos cujo
-- nome contém saldo/balance (valores escalares, crus, sem normalizar). ZERO descrição de lançamento,
-- ZERO CPF/CNPJ, ZERO nome de favorecido (LGPD). A sonda mostra a verdade crua do saldo, nada mais.

CREATE OR REPLACE FUNCTION public.fn_sonda_saldo_registrar(
  p_company_id uuid,
  p_provider   text,
  p_retrato    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cap  int := 50;   -- teto de linhas da sonda: passou disso, para de gravar (não fica eterna)
  v_qtd  int;
  v_qtx  int;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'company_id_ausente');
  END IF;

  -- gate: usuário autenticado só registra para empresa que enxerga.
  -- contexto de sistema (service role, auth.uid() NULL) passa direto — mesmo padrão do
  -- fn_extrato_importar_sistema, que é chamado pela rota de sync com service role.
  IF auth.uid() IS NOT NULL
     AND p_company_id NOT IN (SELECT get_user_company_ids())
     AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_acesso');
  END IF;

  -- self-cap: sonda é temporária, não grava log para sempre (Entrega 4 da SPEC).
  SELECT count(*) INTO v_qtd FROM erp_banco_sync_log WHERE tipo = 'sonda_saldo';
  IF v_qtd >= v_cap THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'cap_atingido', 'total', v_qtd);
  END IF;

  -- qtd de transações vem do retrato, mas só se for inteiro puro (não confiar cegamente no caller)
  v_qtx := CASE
    WHEN (p_retrato->>'qtd_transacoes') ~ '^\d+$' THEN (p_retrato->>'qtd_transacoes')::int
    ELSE 0
  END;

  INSERT INTO erp_banco_sync_log
    (company_id, banco_codigo, provider, tipo, status, qtd, mensagem, payload_resumo)
  VALUES
    (p_company_id, NULL, COALESCE(p_provider, '?'), 'sonda_saldo', 'ok', v_qtx,
     'sonda de diagnóstico — remover ou promover após o veredito',
     COALESCE(p_retrato, '{}'::jsonb));

  RETURN jsonb_build_object('ok', true, 'registrado', true, 'total_apos', v_qtd + 1);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_sonda_saldo_registrar(uuid, text, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_sonda_saldo_registrar(uuid, text, jsonb) TO authenticated, service_role;
