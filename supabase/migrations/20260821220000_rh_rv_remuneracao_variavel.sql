-- RH Industrial · Remuneração variável (motoristas/ajudantes) · cálculo diário. Vertical industrial.
-- Fronteira GE: RH CALCULA; o pagamento vira evento pra GE ao fechar competência (Fase 2). Não recria
-- janela financeira.
--
-- Decisões do CEO (RD-51 — não chutei):
--   1) Hora extra: FIXO 00:30/dia × dias (he_min_dia=30). Campos jornada_seg_dia + he_modo ficam prontos
--      pra ligar o "excedente real pelo ponto" depois (o CEO topou fixo por ora).
--   2) Diária: conta TODO dia com ponto efetivo (worked_seconds>0) — não só dias úteis.
--   3) INSS: NÃO calcula aqui — vem da folha real (Dominio) pra não divergir (RD-52). calcula_inss=false.
--      (Obs de conflito: no chip a resposta foi "a tela calcula"; no resumo escrito foi "usar a folha real,
--       não calcular". Segui o resumo escrito, que é o mais alinhado ao P1/RD-52. Flag no PR pro CEO bater.)
--   4) Infração: só a REGISTRADA zera o bônus, e 1 já zera (infracoes_zera=1).
--
-- Premissa (RD-38/RD-26): dias e horas vêm do ind_ponto_dia (cpf, data, worked_seconds); entregas e
-- infração são manuais (rh_rv_lancamento_dia). O plano é CADASTRO editável (RD-52 — não hardcode).

-- 1) PLANO (editável). Um por perfil×faixa por empresa.
CREATE TABLE IF NOT EXISTS public.rh_rv_plano (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  perfil text NOT NULL,                          -- ajudante | motorista | motorista_litoral
  faixa text NOT NULL,                           -- inicial | efetivo
  salario_base numeric NOT NULL DEFAULT 0,
  inss_pct numeric NOT NULL DEFAULT 0,
  calcula_inss boolean NOT NULL DEFAULT false,   -- false = INSS vem da folha real (decisão CEO)
  premio_util numeric NOT NULL DEFAULT 0,
  diaria_valor numeric NOT NULL DEFAULT 0,
  he_min_dia int NOT NULL DEFAULT 30,            -- HE fixo (min/dia)
  he_modo text NOT NULL DEFAULT 'fixo',          -- fixo | excedente
  jornada_seg_dia int,                           -- jornada contratual/dia (p/ excedente futuro)
  valor_entrega numeric NOT NULL DEFAULT 0,
  bonus_sem_infracao numeric NOT NULL DEFAULT 0,
  entregas_meta int NOT NULL DEFAULT 0,
  infracoes_zera int NOT NULL DEFAULT 1,         -- nº de infrações REGISTRADAS que zeram o bônus
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rh_rv_plano_uk ON public.rh_rv_plano (company_id, perfil, faixa);

-- 2) PARTICIPANTE: quem entra no plano + qual perfil/faixa (via plano_id).
CREATE TABLE IF NOT EXISTS public.rh_rv_participante (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  funcionario_id uuid NOT NULL REFERENCES public.compliance_funcionarios(id) ON DELETE CASCADE,
  plano_id uuid NOT NULL REFERENCES public.rh_rv_plano(id) ON DELETE RESTRICT,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rh_rv_participante_uk ON public.rh_rv_participante (company_id, funcionario_id);

-- 3) LANÇAMENTO DIÁRIO manual (o que o ponto não dá): entregas + infração.
CREATE TABLE IF NOT EXISTS public.rh_rv_lancamento_dia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  funcionario_id uuid NOT NULL REFERENCES public.compliance_funcionarios(id) ON DELETE CASCADE,
  data date NOT NULL,
  entregas_qtd int NOT NULL DEFAULT 0,
  infracao boolean NOT NULL DEFAULT false,
  infracao_tipo text,                            -- verbal | registrada (só registrada zera)
  infracao_motivo text,
  obs text,
  registrado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rh_rv_lancamento_dia_uk ON public.rh_rv_lancamento_dia (company_id, funcionario_id, data);

-- RLS. Plano carrega salário → gate de papel RH (LGPD). Participante/lançamento = acesso à empresa.
ALTER TABLE public.rh_rv_plano ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_rv_participante ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_rv_lancamento_dia ENABLE ROW LEVEL SECURITY;
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.rh_rv_plano'::regclass AND polname='rh_rv_plano_rls') THEN
    CREATE POLICY rh_rv_plano_rls ON public.rh_rv_plano
      USING (company_id IN (SELECT get_user_company_ids()) AND (is_admin() OR EXISTS (
        SELECT 1 FROM user_companies uc WHERE uc.company_id = rh_rv_plano.company_id
          AND uc.user_id = auth.uid() AND uc.role IN ('rh_industrial','socio'))))
      WITH CHECK (company_id IN (SELECT get_user_company_ids()) AND (is_admin() OR EXISTS (
        SELECT 1 FROM user_companies uc WHERE uc.company_id = rh_rv_plano.company_id
          AND uc.user_id = auth.uid() AND uc.role IN ('rh_industrial','socio'))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.rh_rv_participante'::regclass AND polname='rh_rv_participante_rls') THEN
    CREATE POLICY rh_rv_participante_rls ON public.rh_rv_participante
      USING (company_id IN (SELECT get_user_company_ids()))
      WITH CHECK (company_id IN (SELECT get_user_company_ids()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.rh_rv_lancamento_dia'::regclass AND polname='rh_rv_lancamento_dia_rls') THEN
    CREATE POLICY rh_rv_lancamento_dia_rls ON public.rh_rv_lancamento_dia
      USING (company_id IN (SELECT get_user_company_ids()))
      WITH CHECK (company_id IN (SELECT get_user_company_ids()));
  END IF;
END
$mig$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rh_rv_plano, public.rh_rv_participante, public.rh_rv_lancamento_dia TO authenticated;

-- Lançamento diário (upsert idempotente por funcionário+data). Gated à empresa.
CREATE OR REPLACE FUNCTION public.fn_rh_rv_lancar_dia(
  p_company_id uuid, p_funcionario_id uuid, p_data date,
  p_entregas_qtd int DEFAULT 0, p_infracao boolean DEFAULT false,
  p_infracao_tipo text DEFAULT NULL, p_infracao_motivo text DEFAULT NULL, p_obs text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM compliance_funcionarios WHERE id = p_funcionario_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'funcionario_invalido'); END IF;

  INSERT INTO rh_rv_lancamento_dia (company_id, funcionario_id, data, entregas_qtd, infracao, infracao_tipo, infracao_motivo, obs, registrado_por)
  VALUES (p_company_id, p_funcionario_id, p_data, GREATEST(COALESCE(p_entregas_qtd,0),0), COALESCE(p_infracao,false),
          NULLIF(btrim(p_infracao_tipo),''), NULLIF(btrim(p_infracao_motivo),''), NULLIF(btrim(p_obs),''), auth.uid())
  ON CONFLICT (company_id, funcionario_id, data) DO UPDATE SET
    entregas_qtd = EXCLUDED.entregas_qtd, infracao = EXCLUDED.infracao, infracao_tipo = EXCLUDED.infracao_tipo,
    infracao_motivo = EXCLUDED.infracao_motivo, obs = EXCLUDED.obs, updated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $function$;

-- Cálculo por competência (YYYY-MM). Cruza ponto (dias + HE fixo) × lançamento (entregas + infração) × plano.
-- Salário/valores gateados: sem papel RH, os R$ voltam null (a decomposição estrutural continua visível).
CREATE OR REPLACE FUNCTION public.fn_rh_rv_calcular(p_company_id uuid, p_competencia text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pode_salario boolean; v_lista jsonb; v_kpis jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_competencia !~ '^\d{4}-\d{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'competencia_invalida (use YYYY-MM)'); END IF;

  v_pode_salario := is_admin() OR EXISTS (SELECT 1 FROM user_companies uc
     WHERE uc.company_id = p_company_id AND uc.user_id = auth.uid() AND uc.role IN ('rh_industrial','socio'));

  WITH base AS (
    SELECT
      part.funcionario_id, f.cargo, pl.perfil, pl.faixa,
      pl.salario_base, pl.premio_util, pl.diaria_valor, pl.he_min_dia, pl.valor_entrega,
      pl.bonus_sem_infracao, pl.infracoes_zera, pl.inss_pct, pl.calcula_inss,
      -- ponto: dias com trabalho efetivo no mês
      COALESCE((SELECT count(DISTINCT d.data) FROM ind_ponto_dia d
                WHERE d.company_id = p_company_id
                  AND regexp_replace(COALESCE(d.cpf,''),'\D','','g') = regexp_replace(COALESCE(f.cpf,''),'\D','','g')
                  AND to_char(d.data,'YYYY-MM') = p_competencia AND COALESCE(d.worked_seconds,0) > 0), 0) AS dias,
      -- manual: entregas + infrações registradas no mês
      COALESCE((SELECT sum(l.entregas_qtd) FROM rh_rv_lancamento_dia l
                WHERE l.company_id = p_company_id AND l.funcionario_id = part.funcionario_id
                  AND to_char(l.data,'YYYY-MM') = p_competencia), 0) AS entregas,
      COALESCE((SELECT count(*) FROM rh_rv_lancamento_dia l
                WHERE l.company_id = p_company_id AND l.funcionario_id = part.funcionario_id
                  AND to_char(l.data,'YYYY-MM') = p_competencia
                  AND l.infracao = true AND l.infracao_tipo = 'registrada'), 0) AS infr_reg
    FROM rh_rv_participante part
    JOIN rh_rv_plano pl ON pl.id = part.plano_id
    JOIN compliance_funcionarios f ON f.id = part.funcionario_id
    WHERE part.company_id = p_company_id AND part.ativo AND pl.ativo
  ),
  calc AS (
    SELECT b.*,
      round(b.diaria_valor * b.dias, 2) AS v_diaria,
      round((b.he_min_dia::numeric/60) * b.dias * (b.salario_base/220), 2) AS v_he,
      round(b.valor_entrega * b.entregas, 2) AS v_entregas,
      CASE WHEN b.infr_reg < b.infracoes_zera THEN b.bonus_sem_infracao ELSE 0 END AS v_bonus,
      CASE WHEN b.calcula_inss THEN round(b.salario_base * b.inss_pct/100, 2) ELSE NULL END AS v_inss
    FROM base b
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'funcionario_id', c.funcionario_id, 'cargo', c.cargo, 'perfil', c.perfil, 'faixa', c.faixa,
      'dias', c.dias, 'entregas', c.entregas, 'infracoes_registradas', c.infr_reg,
      'sem_infracao', (c.infr_reg < c.infracoes_zera),
      'salario_base',  CASE WHEN v_pode_salario THEN c.salario_base ELSE NULL END,
      'premio_util',   CASE WHEN v_pode_salario THEN c.premio_util ELSE NULL END,
      'diaria',        CASE WHEN v_pode_salario THEN c.v_diaria ELSE NULL END,
      'hora_extra',    CASE WHEN v_pode_salario THEN c.v_he ELSE NULL END,
      'por_entrega',   CASE WHEN v_pode_salario THEN c.v_entregas ELSE NULL END,
      'bonus',         CASE WHEN v_pode_salario THEN c.v_bonus ELSE NULL END,
      'inss',          CASE WHEN v_pode_salario THEN c.v_inss ELSE NULL END,
      'variavel_total', CASE WHEN v_pode_salario THEN round(c.v_diaria + c.v_he + c.v_entregas + c.v_bonus, 2) ELSE NULL END,
      'bruto_total',    CASE WHEN v_pode_salario THEN round(c.salario_base + c.premio_util + c.v_diaria + c.v_he + c.v_entregas + c.v_bonus, 2) ELSE NULL END
    ) ORDER BY c.cargo, c.funcionario_id), '[]'::jsonb),
    jsonb_build_object(
      'no_plano', count(*),
      'dias_apurados', COALESCE(sum(c.dias), 0),
      'sem_infracao', count(*) FILTER (WHERE c.infr_reg < c.infracoes_zera),
      'variavel_mes', CASE WHEN v_pode_salario THEN COALESCE(round(sum(c.v_diaria + c.v_he + c.v_entregas + c.v_bonus), 2), 0) ELSE NULL END)
  INTO v_lista, v_kpis
  FROM calc c;

  RETURN jsonb_build_object('ok', true, 'competencia', p_competencia, 'pode_salario', v_pode_salario,
    'inss_pela_folha', true, 'kpis', v_kpis, 'lista', v_lista);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_rh_rv_lancar_dia(uuid,uuid,date,int,boolean,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_rh_rv_calcular(uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_rv_lancar_dia(uuid,uuid,date,int,boolean,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rh_rv_calcular(uuid,text) TO authenticated;

-- Seed do PLANO pra Frioeste (scaffold editável — RD-52). Valores fixos confirmados do SPEC; salário base
-- fica 0 pro CEO preencher por faixa (RD-51 — não invento salário). Diária/entrega por perfil em ordem
-- crescente (ajudante<motorista<litoral); o CEO revisa no cadastro. inss_pct 9(inicial)/12(efetivo).
INSERT INTO public.rh_rv_plano (company_id, perfil, faixa, salario_base, inss_pct, premio_util, diaria_valor, valor_entrega, bonus_sem_infracao, he_min_dia, infracoes_zera)
SELECT '975365cc-9e5a-4251-9022-68c6bfde10d8', d.perfil, d.faixa, 0, d.inss, 400, d.diaria, d.entrega, 300, 30, 1
FROM (VALUES
  ('ajudante','inicial',9, 40, 1.50),
  ('ajudante','efetivo',12, 40, 1.50),
  ('motorista','inicial',9, 54, 1.50),
  ('motorista','efetivo',12, 54, 1.50),
  ('motorista_litoral','inicial',9, 100, 2.00),
  ('motorista_litoral','efetivo',12, 100, 2.00)
) AS d(perfil,faixa,inss,diaria,entrega)
ON CONFLICT (company_id, perfil, faixa) DO NOTHING;
