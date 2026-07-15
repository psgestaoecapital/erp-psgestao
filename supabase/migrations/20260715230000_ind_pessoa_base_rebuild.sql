-- INDUSTRIAL FASE 1 · PARTE A · ind_pessoa (dimensão de gente) + rebuild + fila RD-49
-- ============================================================================
-- Base do Industrial (Frioeste). Dois sinais ORTOGONAIS derivados, nunca fundidos:
--   • apura_ponto     = COBERTURA (dias com batida). Corrige headcount/turnover/custo.
--   • jornada_externa = ESCALA (turno cadastrado). Corrige HE / além-escala / card do Gabriel.
-- Gabriel (993) = apura_ponto=TRUE (bate ponto) E jornada_externa=TRUE (motorista) — os dois.
--
-- RD-38: os números do spec (16 fantasma / 84 admit-demit / 32→16 escala-zero) eram ESTIMATIVA.
-- O rebuild abaixo é a reconciliação DEFINITIVA — encoda a REGRA, não persegue a meta.
-- Definições cravadas (janela 03-06, overlap folha×ponto):
--   cobertura   = dias DISTINTOS de ponto na janela. ALTA = >=11 dias.
--   jornada_ext = shift '00:00-00:00' em >=50% dos dias de ponto na janela (opção (a) do CEO = 16).
--   demissão    = competência com verba folha_verba.descricao='FGTS Rescisório'.
--   matrícula   = folha.matricula(int) ↔ ind_ponto_dia.registration_number(text) (99,9% numérico).
--
-- RD-49: rebuild NUNCA sobrescreve linha origem='manual'. O que o RH decidiu é intocável.
-- RD-54: DELETE físico travado + auditoria (dimensão de gente = dado real TIER 1).
-- ============================================================================

-- ─────────────────────────── BLOCO 1 · TABELA ───────────────────────────
CREATE TABLE IF NOT EXISTS public.ind_pessoa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  matricula  int  NOT NULL,
  cpf text,
  nome text,
  vinculo text NOT NULL DEFAULT 'clt' CHECK (vinculo IN ('clt','prolabore','estagio')),
  -- OS DOIS FLAGS
  apura_ponto     boolean NOT NULL DEFAULT true,   -- COBERTURA
  jornada_externa boolean NOT NULL DEFAULT false,  -- ESCALA (art.62 — só o SINAL, RH decide)
  -- SETOR
  setor text,
  setor_origem text CHECK (setor_origem IN ('ponto_modo_mes','ultimo_mes_ponto','manual','sem_setor')),
  -- CICLO DE VIDA (soft, RD-30)
  ativo boolean NOT NULL DEFAULT true,
  admissao date,
  demissao date,
  cobertura_dias int,          -- dias distintos de ponto na janela (transparência do apura_ponto)
  -- PROCEDÊNCIA (RD-49)
  origem text NOT NULL DEFAULT 'derivado' CHECK (origem IN ('derivado','manual')),
  observacao text,
  atualizado_em timestamptz DEFAULT now(),
  atualizado_por uuid,
  UNIQUE (company_id, matricula)
);

COMMENT ON TABLE public.ind_pessoa IS
  'Industrial Fase 1: dimensão de gente derivada (folha+ponto). apura_ponto=cobertura, jornada_externa=escala — ortogonais. RD-49: origem=manual nunca é sobrescrito pelo rebuild.';

-- RLS por empresa
ALTER TABLE public.ind_pessoa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ind_pessoa_select ON public.ind_pessoa;
CREATE POLICY p_ind_pessoa_select ON public.ind_pessoa
  FOR SELECT USING (company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.ind_pessoa TO authenticated;
GRANT ALL    ON public.ind_pessoa TO service_role;

-- RD-54: trava DELETE físico (reusa fn_bloqueia_delete_fisico) + auditoria (fn_audit_log_trigger)
DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON public.ind_pessoa;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON public.ind_pessoa
  FOR EACH ROW EXECUTE FUNCTION public.fn_bloqueia_delete_fisico();
DROP TRIGGER IF EXISTS trg_audit_ind_pessoa ON public.ind_pessoa;
CREATE TRIGGER trg_audit_ind_pessoa AFTER INSERT OR UPDATE OR DELETE ON public.ind_pessoa
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_trigger();

-- ─────────────────────── BLOCO 2 · fn_ind_pessoa_rebuild ───────────────────────
CREATE OR REPLACE FUNCTION public.fn_ind_pessoa_rebuild(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ini date := '2026-03-01'; v_fim date := '2026-07-01';  -- janela overlap folha×ponto
  v_res jsonb;
BEGIN
  WITH
  -- ponto na janela (dedup matrícula+data), só matrícula numérica
  p AS (
    SELECT DISTINCT registration_number::int AS matricula, data, shift, department
    FROM ind_ponto_dia
    WHERE company_id = p_company_id AND registration_number ~ '^[0-9]+$'
      AND data >= v_ini AND data < v_fim
  ),
  cob AS (
    SELECT matricula,
      count(DISTINCT data) AS dias,
      count(*) FILTER (WHERE shift='00:00-00:00') AS dias_zero,
      count(*) AS dias_ponto
    FROM p GROUP BY 1
  ),
  setor AS (  -- MODO do department na janela
    SELECT matricula, mode() WITHIN GROUP (ORDER BY department) AS setor_modo
    FROM p WHERE department IS NOT NULL AND btrim(department) <> '' GROUP BY 1
  ),
  cpf_ponto AS (
    SELECT registration_number::int AS matricula, max(cpf) AS cpf
    FROM ind_ponto_dia WHERE company_id=p_company_id AND registration_number ~ '^[0-9]+$'
    GROUP BY 1
  ),
  folha AS (
    SELECT matricula,
      count(DISTINCT competencia) AS n_comp,
      min(competencia) AS prim, max(competencia) AS ult,
      max(nome) AS nome, max(cpf) AS cpf_folha
    FROM folha_competencia WHERE company_id=p_company_id GROUP BY 1
  ),
  resc AS (  -- demissão: competência com FGTS Rescisório
    SELECT matricula, max(competencia) AS comp_resc
    FROM folha_verba WHERE company_id=p_company_id AND descricao='FGTS Rescisório'
    GROUP BY 1
  ),
  derivado AS (
    SELECT
      f.matricula,
      coalesce(cp.cpf, f.cpf_folha) AS cpf,
      f.nome,
      CASE WHEN f.matricula BETWEEN 965 AND 971 THEN 'prolabore' ELSE 'clt' END AS vinculo,
      f.n_comp, coalesce(cob.dias,0) AS dias,
      coalesce(cob.dias_zero,0) AS dias_zero, coalesce(cob.dias_ponto,0) AS dias_ponto,
      (f.prim > v_ini) AS admitido_meio,
      (r.matricula IS NOT NULL OR f.ult < (v_fim - interval '1 month')) AS demitido,
      f.prim, f.ult, r.comp_resc,
      s.setor_modo, sl.setor_ult
    FROM folha f
    LEFT JOIN cob      ON cob.matricula = f.matricula
    LEFT JOIN cpf_ponto cp ON cp.matricula = f.matricula
    LEFT JOIN resc r   ON r.matricula = f.matricula
    LEFT JOIN setor s  ON s.matricula = f.matricula
    LEFT JOIN LATERAL (  -- fallback setor: último mês com ponto (fora da janela também)
      SELECT mode() WITHIN GROUP (ORDER BY d.department) AS setor_ult
      FROM ind_ponto_dia d
      WHERE d.company_id=p_company_id AND d.registration_number ~ '^[0-9]+$'
        AND d.registration_number::int = f.matricula
        AND d.department IS NOT NULL AND btrim(d.department) <> ''
    ) sl ON true
  ),
  final AS (
    SELECT d.*,
      -- apura_ponto (COBERTURA)
      CASE
        WHEN vinculo='prolabore' THEN false                              -- definicional
        WHEN n_comp = 1          THEN true                               -- único mês → parcial, benefício
        WHEN dias >= 11          THEN true                               -- cobertura ALTA
        WHEN admitido_meio OR demitido THEN true                        -- baixa legítima (admit/demit)
        ELSE false                                                       -- baixa + presente sempre = FANTASMA
      END AS apura_ponto,
      -- jornada_externa (ESCALA) — >=50% dos dias em 00:00-00:00 (opção a)
      (dias_ponto > 0 AND dias_zero >= 0.5 * dias_ponto) AS jornada_externa,
      -- setor + origem
      coalesce(setor_modo, setor_ult) AS setor_final,
      CASE WHEN setor_modo IS NOT NULL THEN 'ponto_modo_mes'
           WHEN setor_ult  IS NOT NULL THEN 'ultimo_mes_ponto'
           ELSE 'sem_setor' END AS setor_origem_final,
      -- ciclo de vida
      d.prim AS admissao,
      d.comp_resc AS demissao,
      (d.comp_resc IS NULL AND d.ult >= (v_fim - interval '1 month')) AS ativo
    FROM derivado d
  )
  INSERT INTO public.ind_pessoa
    (company_id, matricula, cpf, nome, vinculo, apura_ponto, jornada_externa,
     setor, setor_origem, ativo, admissao, demissao, cobertura_dias, origem, observacao, atualizado_em)
  SELECT
    p_company_id, matricula, cpf, nome, vinculo, apura_ponto, jornada_externa,
    coalesce(setor_final, '⚠️ SEM SETOR'),
    setor_origem_final, ativo, admissao, demissao, dias, 'derivado',
    CASE WHEN n_comp=1 THEN 'parcial (único mês de folha)'
         WHEN NOT apura_ponto AND vinculo='clt' THEN 'fantasma contínuo (baixa cobertura, presente em competências adjacentes)'
         ELSE NULL END,
    now()
  FROM final
  ON CONFLICT (company_id, matricula) DO UPDATE SET
    cpf=EXCLUDED.cpf, nome=EXCLUDED.nome, vinculo=EXCLUDED.vinculo,
    apura_ponto=EXCLUDED.apura_ponto, jornada_externa=EXCLUDED.jornada_externa,
    setor=EXCLUDED.setor, setor_origem=EXCLUDED.setor_origem,
    ativo=EXCLUDED.ativo, admissao=EXCLUDED.admissao, demissao=EXCLUDED.demissao,
    cobertura_dias=EXCLUDED.cobertura_dias, observacao=EXCLUDED.observacao, atualizado_em=now()
  WHERE public.ind_pessoa.origem = 'derivado';   -- RD-49: manual NUNCA sobrescrito

  SELECT jsonb_build_object(
    'total', count(*),
    'prolabore', count(*) FILTER (WHERE vinculo='prolabore'),
    'apura_false_fantasma', count(*) FILTER (WHERE NOT apura_ponto AND vinculo='clt'),
    'apura_true', count(*) FILTER (WHERE apura_ponto),
    'jornada_externa', count(*) FILTER (WHERE jornada_externa),
    'sem_setor', count(*) FILTER (WHERE setor='⚠️ SEM SETOR'),
    'ativos', count(*) FILTER (WHERE ativo)
  ) INTO v_res FROM public.ind_pessoa WHERE company_id=p_company_id;
  RETURN v_res;
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_ind_pessoa_rebuild(uuid) TO authenticated, service_role;

-- ─────────────────────── BLOCO 3 · FILA DE DIVERGÊNCIA (RD-49) ───────────────────────
-- Fila = linhas derivadas com sinal a confirmar pelo RH. Mensagem varia por SETOR:
-- Expedição/Transporte → provável art.62; escala fixa (Abate/Desossa/TI…) → erro de cadastro.
CREATE OR REPLACE VIEW public.v_ind_pessoa_divergencia AS
SELECT
  pe.company_id, pe.matricula, pe.nome, pe.setor, pe.cobertura_dias,
  pe.apura_ponto, pe.jornada_externa,
  CASE
    WHEN pe.jornada_externa AND (pe.setor ILIKE '%EXPED%' OR pe.setor ILIKE '%TRANSP%' OR pe.setor ILIKE '%ENTREGA%')
      THEN 'jornada_externa'
    WHEN pe.jornada_externa
      THEN 'jornada_externa_suspeita_cadastro'
    WHEN NOT pe.apura_ponto AND pe.vinculo='clt'
      THEN 'fantasma_continuo'
  END AS tipo,
  CASE
    WHEN pe.jornada_externa AND (pe.setor ILIKE '%EXPED%' OR pe.setor ILIKE '%TRANSP%' OR pe.setor ILIKE '%ENTREGA%')
      THEN 'Provável jornada externa (art.62 CLT)? Turno 00:00-00:00 num setor de rua. Confirmar com RH — não afirmamos art.62 automaticamente.'
    WHEN pe.jornada_externa
      THEN '⚠️ Turno 00:00-00:00 num setor de escala fixa (' || coalesce(pe.setor,'?') || '). Provável ERRO DE CADASTRO, não art.62. Corrigir o turno ou confirmar exceção.'
    WHEN NOT pe.apura_ponto AND pe.vinculo='clt'
      THEN 'Fantasma contínuo: baixa cobertura de ponto (' || coalesce(pe.cobertura_dias,0) || ' dias) presente em competências adjacentes. Investigar antes de contar em indicadores.'
  END AS mensagem
FROM public.ind_pessoa pe
WHERE pe.origem = 'derivado'
  AND (pe.jornada_externa OR (NOT pe.apura_ponto AND pe.vinculo='clt'));

GRANT SELECT ON public.v_ind_pessoa_divergencia TO authenticated, service_role;
