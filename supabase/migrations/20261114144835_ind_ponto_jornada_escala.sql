-- PRIORIDADE FRIOESTE (CEO 11/11) — contexto 4c8ebf21
-- Fundação: trazer ESCALA e JORNADA/carga horária por colaborador vindas do ponto,
-- para o RH validar no Quadro de pessoal, e refletir mudanças do ponto aqui.
-- Hoje ind_ponto_colaborador.raw só traz cadastro — nada de escala/jornada.
--
-- Esta migration (aditiva, RD-94.1 c) cria a tabela GENÉRICA por provider
-- (RD-102 — sem nome de fornecedor em objeto; a coluna `fonte` guarda 'sync'/'manual'),
-- com RLS por empresa (mesmo padrão do módulo de ponto: SELECT por company), REVOKE anon,
-- e duas RPCs guardadas: listar (leitura) e salvar (upsert do sync/edição do RH).
-- Próximas fatias: (1) endpoints de escala do provider no sync existente (RD-101: sem cron novo);
-- (2) tela do RH que lê/edita esta jornada.
-- Code: code-desenvolvedor-3

-- 1) Tabela genérica ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ind_ponto_jornada (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cpf text,
  registration_number text,                 -- matrícula
  escala_nome text,                         -- ex.: "12x36 noturno", "5x2 44h"
  tipo_escala text,                         -- ex.: "12x36", "5x2", "6x1"
  horas_semana numeric(6,2),
  horas_mes numeric(7,2),
  hora_entrada time,
  hora_saida time,
  intervalo_min integer,                    -- minutos de intervalo/descanso
  vigencia_inicio date,
  vigencia_fim date,
  fonte text NOT NULL DEFAULT 'manual',     -- 'sync' (veio do ponto) | 'manual' (RH editou)
  sincronizado_em timestamptz,
  editado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ind_ponto_jornada_identidade CHECK (cpf IS NOT NULL OR registration_number IS NOT NULL)
);

-- Uma jornada por pessoa por vigência (idempotência do upsert do sync).
CREATE UNIQUE INDEX IF NOT EXISTS ind_ponto_jornada_uk
  ON public.ind_ponto_jornada (
    company_id,
    lower(COALESCE(cpf,'')),
    lower(COALESCE(registration_number,'')),
    COALESCE(vigencia_inicio, DATE '0001-01-01')
  );
CREATE INDEX IF NOT EXISTS ind_ponto_jornada_company_idx ON public.ind_ponto_jornada (company_id);

COMMENT ON TABLE public.ind_ponto_jornada IS 'Escala/jornada por colaborador vinda do ponto (genérico por provider, RD-102) ou editada pelo RH. Fonte: sync|manual.';

-- 2) RLS: leitura por empresa (mesmo padrão de ind_ponto_dia/colaborador). Escrita só
--    por canal de serviço (sync) e pelas RPCs SECURITY DEFINER guardadas. REVOKE anon.
ALTER TABLE public.ind_ponto_jornada ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ind_ponto_jornada_select_company ON public.ind_ponto_jornada;
CREATE POLICY ind_ponto_jornada_select_company ON public.ind_ponto_jornada
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON TABLE public.ind_ponto_jornada FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.ind_ponto_jornada TO authenticated;
GRANT ALL ON TABLE public.ind_ponto_jornada TO service_role;

-- 3) RPC de leitura — jornada vigente por pessoa, com nome/depto do colaborador ---------
CREATE OR REPLACE FUNCTION public.fn_ind_ponto_jornada_listar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_hoje date := CURRENT_DATE; v_rows jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  WITH vig AS (
    SELECT j.*,
           row_number() OVER (
             PARTITION BY lower(COALESCE(j.cpf,'')), lower(COALESCE(j.registration_number,''))
             ORDER BY (j.vigencia_fim IS NULL OR j.vigencia_fim >= v_hoje) DESC,
                      COALESCE(j.vigencia_inicio, DATE '0001-01-01') DESC,
                      j.atualizado_em DESC
           ) AS rn
    FROM ind_ponto_jornada j
    WHERE j.company_id = p_company_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', v.id, 'cpf', v.cpf, 'matricula', v.registration_number, 'nome', c.nome,
    'departamento', c.departamento,
    'escala_nome', v.escala_nome, 'tipo_escala', v.tipo_escala,
    'horas_semana', v.horas_semana, 'horas_mes', v.horas_mes,
    'hora_entrada', v.hora_entrada, 'hora_saida', v.hora_saida, 'intervalo_min', v.intervalo_min,
    'vigencia_inicio', v.vigencia_inicio, 'vigencia_fim', v.vigencia_fim,
    'fonte', v.fonte, 'sincronizado_em', v.sincronizado_em, 'atualizado_em', v.atualizado_em
  ) ORDER BY c.nome NULLS LAST, v.registration_number), '[]'::jsonb)
  INTO v_rows
  FROM vig v
  LEFT JOIN ind_ponto_colaborador c
    ON c.company_id = v.company_id AND c.cpf IS NOT NULL AND c.cpf = v.cpf
  WHERE v.rn = 1;
  RETURN jsonb_build_object('ok', true, 'company_id', p_company_id, 'jornadas', v_rows);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_ind_ponto_jornada_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ind_ponto_jornada_listar(uuid) TO authenticated, service_role;

-- 4) RPC de upsert — edição do RH (sem integração) e gravação pelo sync -----------------
--    Guarda de empresa; idempotente pela chave (empresa, pessoa, vigência).
CREATE OR REPLACE FUNCTION public.fn_ind_ponto_jornada_salvar(
  p_company_id uuid, p_cpf text, p_registration_number text,
  p_escala_nome text, p_tipo_escala text, p_horas_semana numeric, p_horas_mes numeric,
  p_hora_entrada time, p_hora_saida time, p_intervalo_min integer,
  p_vigencia_inicio date, p_vigencia_fim date, p_fonte text DEFAULT 'manual')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_fonte text := COALESCE(NULLIF(btrim(p_fonte),''),'manual');
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF p_cpf IS NULL AND p_registration_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe CPF ou matrícula do colaborador.');
  END IF;
  IF v_fonte NOT IN ('manual','sync') THEN v_fonte := 'manual'; END IF;

  INSERT INTO ind_ponto_jornada AS j (
    company_id, cpf, registration_number, escala_nome, tipo_escala, horas_semana, horas_mes,
    hora_entrada, hora_saida, intervalo_min, vigencia_inicio, vigencia_fim, fonte,
    sincronizado_em, editado_por, atualizado_em)
  VALUES (
    p_company_id, p_cpf, p_registration_number, p_escala_nome, p_tipo_escala, p_horas_semana, p_horas_mes,
    p_hora_entrada, p_hora_saida, p_intervalo_min, p_vigencia_inicio, p_vigencia_fim, v_fonte,
    CASE WHEN v_fonte='sync' THEN now() ELSE NULL END,
    CASE WHEN v_fonte='manual' THEN auth.uid() ELSE NULL END, now())
  ON CONFLICT (company_id, lower(COALESCE(cpf,'')), lower(COALESCE(registration_number,'')), COALESCE(vigencia_inicio, DATE '0001-01-01'))
  DO UPDATE SET
    escala_nome = EXCLUDED.escala_nome, tipo_escala = EXCLUDED.tipo_escala,
    horas_semana = EXCLUDED.horas_semana, horas_mes = EXCLUDED.horas_mes,
    hora_entrada = EXCLUDED.hora_entrada, hora_saida = EXCLUDED.hora_saida,
    intervalo_min = EXCLUDED.intervalo_min, vigencia_fim = EXCLUDED.vigencia_fim,
    fonte = EXCLUDED.fonte,
    sincronizado_em = CASE WHEN EXCLUDED.fonte='sync' THEN now() ELSE j.sincronizado_em END,
    editado_por = CASE WHEN EXCLUDED.fonte='manual' THEN auth.uid() ELSE j.editado_por END,
    atualizado_em = now()
  RETURNING j.id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_ind_ponto_jornada_salvar(uuid,text,text,text,text,numeric,numeric,time,time,integer,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ind_ponto_jornada_salvar(uuid,text,text,text,text,numeric,numeric,time,time,integer,date,date,text) TO authenticated, service_role;
