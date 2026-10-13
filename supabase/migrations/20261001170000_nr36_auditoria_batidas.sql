-- Chamado #587 (Frioeste · CEO 01/10): "realize uma auditoria nas planilhas de setembro e verifique quais as reais
-- batidas que os colaboradores não realizaram". Regra combinada com o CEO: o SISTEMA SUGERE, a RESPONSÁVEL CONFIRMA
-- COM JUSTIFICATIVA, NADA GRAVA SOZINHO, e a tela mostra ANTES/DEPOIS antes de gravar.
--  1) fn_nr36_auditoria_batidas_dias: lista (só leitura) as batidas ORIGINAIS do relatório (raw) de cada dia do período
--     que ainda não foi relido. A sugestão é calculada na tela (lib/ponto/pausasMarcas · sugerirPapeis — mesma regra do
--     gate) e só os dias em que ela fecha MAIS pausas plausíveis aparecem para conferir.
--  2) fn_nr36_reler_dia_justificado: a confirmação. Exige justificativa (mín. 10 caracteres), guarda a leitura de antes,
--     as marcações confirmadas, quem confirmou e a origem (sugestão ou edição manual), e chama fn_nr36_reler_dia — que
--     já arquiva a leitura anterior no histórico (RD-30) e permite desfazer.
-- Nada nesta migration altera pausa existente.

CREATE TABLE IF NOT EXISTS public.nr36_releitura_justificativa (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cpf           text NOT NULL,
  data          date NOT NULL,
  lote          uuid,
  origem        text NOT NULL CHECK (origem IN ('sugestao', 'manual')),
  justificativa text NOT NULL CHECK (length(btrim(justificativa)) >= 10),
  marcas        jsonb NOT NULL,
  antes         jsonb,
  autor_id      uuid,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nr36_releitura_justificativa_dia_idx ON public.nr36_releitura_justificativa (company_id, cpf, data);

ALTER TABLE public.nr36_releitura_justificativa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nr36_releitura_justificativa_ler ON public.nr36_releitura_justificativa;
CREATE POLICY nr36_releitura_justificativa_ler ON public.nr36_releitura_justificativa
  FOR SELECT TO authenticated USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
-- grava só pela função de confirmação (autoria pela sessão)
REVOKE ALL ON public.nr36_releitura_justificativa FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nr36_releitura_justificativa TO authenticated;

-- ── 1) batidas originais do relatório, por colaborador e dia (só leitura) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_auditoria_batidas_dias(p_company_id uuid, p_ini date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  IF p_ini IS NULL OR p_fim IS NULL OR p_fim < p_ini OR p_fim - p_ini > 62 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido', 'mensagem', 'Escolha um período de até 2 meses.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'dias', COALESCE((
    SELECT jsonb_agg(d ORDER BY d->>'colaborador', d->>'data')
      FROM (
        SELECT jsonb_build_object(
                 'cpf', p.cpf,
                 'colaborador', COALESCE(max(c.nome), p.cpf),
                 'data', p.data,
                 'linhas', jsonb_agg(jsonb_build_object(
                   'inicio_local', to_char((p.raw->>'inicio')::timestamptz AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
                   'fim_local', to_char((p.raw->>'fim')::timestamptz AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'))
                   ORDER BY (p.raw->>'inicio'))) AS d
          FROM public.ind_ponto_pausa p
          LEFT JOIN public.ind_ponto_colaborador c ON c.company_id = p.company_id AND c.cpf = p.cpf
         WHERE p.company_id = p_company_id AND p.data BETWEEN p_ini AND p_fim
           -- só dias como vieram do relatório: dia já relido (raw.reler) ou com linha sem batida original sai da auditoria
           AND NOT EXISTS (SELECT 1 FROM public.ind_ponto_pausa q
                            WHERE q.company_id = p.company_id AND q.cpf = p.cpf AND q.data = p.data
                              AND (q.raw IS NULL OR q.raw ? 'reler' OR NOT (q.raw ? 'inicio')))
         GROUP BY p.cpf, p.data
      ) x), '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.fn_nr36_auditoria_batidas_dias(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_auditoria_batidas_dias(uuid, date, date) TO authenticated;

-- ── 2) confirmação com justificativa ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_reler_dia_justificado(
  p_company_id uuid, p_cpf text, p_data date, p_marcas jsonb, p_justificativa text, p_origem text DEFAULT 'manual')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_antes jsonb; v_r jsonb;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  IF length(btrim(COALESCE(p_justificativa, ''))) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_justificativa',
      'mensagem', 'Escreva a justificativa (pelo menos 10 caracteres): por que este dia está sendo corrigido.');
  END IF;
  IF COALESCE(p_origem, '') NOT IN ('sugestao', 'manual') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'origem_invalida', 'mensagem', 'Origem da correção inválida.');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'inicio', to_char(p.inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
           'fim', to_char(COALESCE(p.fim_confirmado, p.fim) AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
           'classe', p.classe_evento) ORDER BY p.inicio NULLS FIRST)
    INTO v_antes
    FROM public.ind_ponto_pausa p WHERE p.company_id = p_company_id AND p.cpf = p_cpf AND p.data = p_data;

  v_r := public.fn_nr36_reler_dia(p_company_id, p_cpf, p_data, p_marcas);
  IF COALESCE((v_r->>'ok')::boolean, false) THEN
    INSERT INTO public.nr36_releitura_justificativa (company_id, cpf, data, lote, origem, justificativa, marcas, antes, autor_id)
    VALUES (p_company_id, p_cpf, p_data, (v_r->>'lote')::uuid, p_origem, btrim(p_justificativa), p_marcas, v_antes, auth.uid());
  END IF;
  RETURN v_r;
END $function$;

REVOKE ALL ON FUNCTION public.fn_nr36_reler_dia_justificado(uuid, text, date, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_reler_dia_justificado(uuid, text, date, jsonb, text, text) TO authenticated;
