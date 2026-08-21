-- Agenda/Comercial · Reunião do lead: local + link da reunião no agendamento. Reusa erp_agendamento
-- (RD-26). Colunas próprias (buscáveis/exibíveis) em vez de só jsonb.
--
-- fn_agendamento_criar mantém a MESMA assinatura (retrocompatível): passa a extrair local/link do p_dados
-- e gravar nas colunas. Callers (Agenda, botão Reunião do card) mandam em p_dados.local / p_dados.link_reuniao.

ALTER TABLE public.erp_agendamento ADD COLUMN IF NOT EXISTS local text;
ALTER TABLE public.erp_agendamento ADD COLUMN IF NOT EXISTS link_reuniao text;

CREATE OR REPLACE FUNCTION public.fn_agendamento_criar(
  p_company_id uuid, p_origem text, p_titulo text, p_cliente_id uuid, p_cliente_nome text,
  p_responsavel_id uuid, p_responsavel_nome text, p_data date, p_hora_inicio time without time zone,
  p_hora_fim time without time zone, p_dados jsonb DEFAULT '{}'::jsonb, p_observacao text DEFAULT NULL::text,
  p_orcamento_id uuid DEFAULT NULL::uuid)
RETURNS erp_agendamento
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v public.erp_agendamento%ROWTYPE;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'Sem permissão para esta empresa'; END IF;
  INSERT INTO public.erp_agendamento(
    company_id, origem_modulo, titulo, cliente_id, cliente_nome, responsavel_id, responsavel_nome,
    data, hora_inicio, hora_fim, dados, observacao, orcamento_id, local, link_reuniao, created_by
  ) VALUES (
    p_company_id, COALESCE(NULLIF(p_origem,''),'oficina'), p_titulo, p_cliente_id, p_cliente_nome,
    p_responsavel_id, p_responsavel_nome, p_data, p_hora_inicio, p_hora_fim,
    COALESCE(p_dados,'{}'::jsonb), p_observacao, p_orcamento_id,
    NULLIF(btrim(p_dados->>'local'), ''), NULLIF(btrim(p_dados->>'link_reuniao'), ''),
    auth.uid()
  ) RETURNING * INTO v;
  RETURN v;
END $function$;
