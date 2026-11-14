-- Custeio por kg · fatia F4 — RATEIO ADMINISTRATIVO por posto (CEO 11/11, decisão Eng. Chefe 12/11, contexto 46b4527a, RD-102).
-- Genérico para qualquer planta (bovinos, suínos, aves, serraria): despesa administrativa do mês é distribuída
-- entre os postos por um critério, virando R$/h administrativo por posto — que a F6 (custo por kg) soma ao custo do posto.
--
-- Decisão do Eng. Chefe (12/11):
--   • BASE mensal DIGITADA pelo usuário por padrão (RD-102). A opção "puxar do financeiro" (somar as categorias de
--     despesa administrativa do DRE da GE) fica como ORIGEM gravada para a próxima fatia — V1 não lê o núcleo financeiro.
--   • CRITÉRIO padrão = horas de mão de obra do posto (pessoas alocadas × horas de operação do mês). Alternativas:
--     kg produzido (apontamento do mês) e nº de pessoas. (Área m² fica para quando o posto tiver a metragem cadastrada.)
--   • RESULTADO = R$/mês e R$/h administrativo por posto.
--
-- ADITIVO (RD-97/RD-71): CRIA a tabela prod_rateio_admin (config mensal por planta) e 3 funções novas. NÃO altera
-- tabela, função, RLS nem dado existente. RLS por company_id, REVOKE anon, acesso só por RPC SECURITY DEFINER (padrão
-- das irmãs prod_posto_custo). Prova RD-38 no PR (BEGIN/ROLLBACK). Faixa de segundos do dev7claudeps (:15); versão dentro da janela (agora+2d) e acima do ledger aplicado.

-- =========================================================== 1) Tabela de configuração do rateio (mês × planta)
CREATE TABLE IF NOT EXISTS public.prod_rateio_admin (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  plant_id     uuid NOT NULL,
  competencia  date NOT NULL,                                    -- sempre o 1º dia do mês
  base_valor   numeric(14,2) NOT NULL DEFAULT 0 CHECK (base_valor >= 0),
  base_origem  text NOT NULL DEFAULT 'digitado' CHECK (base_origem IN ('digitado','financeiro')),
  criterio     text NOT NULL DEFAULT 'horas_mo' CHECK (criterio IN ('horas_mo','kg','pessoas')),
  observacao   text,
  criado_por   uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prod_rateio_admin_uq UNIQUE (company_id, plant_id, competencia)
);

-- normaliza competência para o 1º dia do mês, defensivamente
CREATE OR REPLACE FUNCTION public.fn_prod_rateio_admin_norm() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public' AS $norm$
BEGIN
  NEW.competencia := date_trunc('month', NEW.competencia)::date;
  NEW.updated_at := now();
  RETURN NEW;
END $norm$;

DROP TRIGGER IF EXISTS tg_prod_rateio_admin_norm ON public.prod_rateio_admin;
CREATE TRIGGER tg_prod_rateio_admin_norm BEFORE INSERT OR UPDATE ON public.prod_rateio_admin
  FOR EACH ROW EXECUTE FUNCTION public.fn_prod_rateio_admin_norm();

-- RLS por empresa (defesa em profundidade; o acesso de verdade é só pelas RPCs SECURITY DEFINER abaixo)
ALTER TABLE public.prod_rateio_admin ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prod_rateio_admin_rls ON public.prod_rateio_admin;
CREATE POLICY prod_rateio_admin_rls ON public.prod_rateio_admin
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

REVOKE ALL ON public.prod_rateio_admin FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prod_rateio_admin TO service_role;

CREATE INDEX IF NOT EXISTS ix_prod_rateio_admin_comp ON public.prod_rateio_admin (company_id, plant_id, competencia);

-- =========================================================== 2) LER a configuração de um mês (ou os defaults)
CREATE OR REPLACE FUNCTION public.fn_prod_rateio_admin_get(
  p_company_id uuid, p_plant_id uuid, p_competencia date
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp date := date_trunc('month', coalesce(p_competencia, current_date))::date; v jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT jsonb_build_object(
    'id', r.id, 'competencia', v_comp, 'base_valor', r.base_valor,
    'base_origem', r.base_origem, 'criterio', r.criterio, 'observacao', r.observacao
  ) INTO v
  FROM public.prod_rateio_admin r
  WHERE r.company_id = p_company_id AND r.plant_id = p_plant_id AND r.competencia = v_comp;

  RETURN jsonb_build_object('ok', true, 'config',
    coalesce(v, jsonb_build_object('id', NULL, 'competencia', v_comp, 'base_valor', 0,
      'base_origem', 'digitado', 'criterio', 'horas_mo', 'observacao', NULL)));
END $fn$;

REVOKE ALL ON FUNCTION public.fn_prod_rateio_admin_get(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_rateio_admin_get(uuid, uuid, date) TO authenticated, service_role;

-- =========================================================== 3) SALVAR a base/critério do mês (upsert)
CREATE OR REPLACE FUNCTION public.fn_prod_rateio_admin_salvar(
  p_company_id uuid, p_plant_id uuid, p_competencia date,
  p_base_valor numeric, p_base_origem text DEFAULT 'digitado',
  p_criterio text DEFAULT 'horas_mo', p_observacao text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp date := date_trunc('month', coalesce(p_competencia, current_date))::date; v_id uuid;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_base_valor IS NULL OR p_base_valor < 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'base_invalida'); END IF;
  IF coalesce(p_base_origem,'digitado') NOT IN ('digitado','financeiro') THEN RETURN jsonb_build_object('ok', false, 'erro', 'origem_invalida'); END IF;
  IF coalesce(p_criterio,'horas_mo') NOT IN ('horas_mo','kg','pessoas') THEN RETURN jsonb_build_object('ok', false, 'erro', 'criterio_invalido'); END IF;

  INSERT INTO public.prod_rateio_admin (company_id, plant_id, competencia, base_valor, base_origem, criterio, observacao, criado_por)
  VALUES (p_company_id, p_plant_id, v_comp, round(p_base_valor, 2), coalesce(p_base_origem,'digitado'),
          coalesce(p_criterio,'horas_mo'), NULLIF(btrim(p_observacao),''), auth.uid())
  ON CONFLICT (company_id, plant_id, competencia) DO UPDATE SET
    base_valor = EXCLUDED.base_valor, base_origem = EXCLUDED.base_origem,
    criterio = EXCLUDED.criterio, observacao = EXCLUDED.observacao, updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'competencia', v_comp);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_prod_rateio_admin_salvar(uuid, uuid, date, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_rateio_admin_salvar(uuid, uuid, date, numeric, text, text, text) TO authenticated, service_role;

-- =========================================================== 4) DISTRIBUIR a base pelos postos (R$/mês e R$/h)
-- Peso por posto conforme o critério:
--   horas_mo = nº de pessoas alocadas no mês × horas de operação do mês (people-hours)
--   kg       = soma do produzido apontado no mês
--   pessoas  = nº de pessoas alocadas no mês
-- rateio R$/mês = base × peso/Σpeso ; rateio R$/h = rateio R$/mês ÷ horas de operação do mês (null se sem horas).
CREATE OR REPLACE FUNCTION public.fn_prod_rateio_admin_distribuir(
  p_company_id uuid, p_plant_id uuid, p_competencia date
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_comp date := date_trunc('month', coalesce(p_competencia, current_date))::date;
  v_ini date; v_fim date; v_base numeric := 0; v_crit text := 'horas_mo';
  v_den numeric; v_rows jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  v_ini := v_comp; v_fim := (v_comp + interval '1 month')::date;

  SELECT r.base_valor, r.criterio INTO v_base, v_crit
  FROM public.prod_rateio_admin r
  WHERE r.company_id = p_company_id AND r.plant_id = p_plant_id AND r.competencia = v_comp;
  v_base := coalesce(v_base, 0); v_crit := coalesce(v_crit, 'horas_mo');

  WITH posto AS (
    SELECT po.id, po.numero, po.atividade, po.setor_id
    FROM public.prod_posto po
    WHERE po.company_id = p_company_id AND po.plant_id = p_plant_id AND po.ativo
  ),
  horas AS (  -- horas de operação vigentes no mês (custo mais recente até a competência)
    SELECT DISTINCT ON (pc.posto_id) pc.posto_id, pc.horas_operacao_mes
    FROM public.prod_posto_custo pc
    WHERE pc.company_id = p_company_id AND pc.plant_id = p_plant_id AND pc.deleted_at IS NULL
      AND pc.vigencia_inicio <= v_fim
    ORDER BY pc.posto_id, pc.vigencia_inicio DESC, pc.created_at DESC
  ),
  pes AS (  -- pessoas alocadas no posto no mês
    SELECT pp.posto_id, count(*)::numeric AS n
    FROM public.prod_posto_pessoa pp
    WHERE pp.company_id = p_company_id AND pp.plant_id = p_plant_id
      AND pp.vigencia_inicio <= v_fim AND (pp.vigencia_fim IS NULL OR pp.vigencia_fim >= v_ini)
    GROUP BY pp.posto_id
  ),
  kg AS (  -- produzido apontado no mês
    SELECT a.posto_id, sum(a.qtd_produzida)::numeric AS kg
    FROM public.prod_apontamento_hora a
    WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id
      AND a.data >= v_ini AND a.data < v_fim AND a.posto_id IS NOT NULL
    GROUP BY a.posto_id
  ),
  base AS (
    SELECT p.id, p.numero, p.atividade,
           coalesce(h.horas_operacao_mes, 0)::numeric AS horas,
           coalesce(pe.n, 0)::numeric AS pessoas,
           coalesce(k.kg, 0)::numeric AS kg,
           CASE v_crit
             WHEN 'horas_mo' THEN coalesce(pe.n,0) * coalesce(h.horas_operacao_mes,0)
             WHEN 'kg'       THEN coalesce(k.kg,0)
             WHEN 'pessoas'  THEN coalesce(pe.n,0)
             ELSE 0 END AS peso
    FROM posto p
    LEFT JOIN horas h ON h.posto_id = p.id
    LEFT JOIN pes   pe ON pe.posto_id = p.id
    LEFT JOIN kg    k ON k.posto_id = p.id
  ),
  tot AS (SELECT sum(peso) AS den FROM base)
  SELECT (SELECT den FROM tot),
         coalesce(jsonb_agg(jsonb_build_object(
           'posto_id', b.id, 'posto_numero', b.numero, 'posto_atividade', b.atividade,
           'horas_operacao_mes', NULLIF(b.horas,0), 'pessoas', b.pessoas, 'kg', b.kg,
           'peso', b.peso,
           'rateio_rs_mes', CASE WHEN coalesce((SELECT den FROM tot),0) > 0
                                 THEN round(v_base * b.peso / (SELECT den FROM tot), 2) ELSE 0 END,
           'rateio_rs_hora', CASE WHEN coalesce((SELECT den FROM tot),0) > 0 AND b.horas > 0
                                  THEN round((v_base * b.peso / (SELECT den FROM tot)) / b.horas, 4) END
         ) ORDER BY b.numero), '[]'::jsonb)
    INTO v_den, v_rows FROM base b;

  RETURN jsonb_build_object(
    'ok', true, 'competencia', v_comp, 'base_valor', v_base, 'criterio', v_crit,
    'total_peso', coalesce(v_den, 0), 'postos', v_rows,
    'aviso', CASE
      WHEN v_base = 0 THEN 'base_zerada'
      WHEN coalesce(v_den,0) = 0 THEN 'sem_peso'  -- o critério escolhido não tem dado em nenhum posto do mês
      ELSE NULL END);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_prod_rateio_admin_distribuir(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_rateio_admin_distribuir(uuid, uuid, date) TO authenticated, service_role;

-- =========================================================== 5) RD-95 · textos de ajuda ("?") da tela
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/produtividade/rateio', 'industria', 'publicado'
FROM (VALUES
 ('prod.rateio.competencia', 'Rateio', 'Mês de referência',
  'O mês cujas despesas administrativas você vai distribuir pelos postos.',
  'Cada mês tem sua própria base e critério — o rateio é recalculado por competência.',
  'Novembro/2026.',
  'Misturar meses: a base de um mês não vale para outro.', 10),
 ('prod.rateio.base', 'Rateio', 'Despesa administrativa do mês (R$)',
  'O total das despesas administrativas do mês que não são de um posto específico (administração, diretoria, rateios gerais).',
  'É o valor que será distribuído entre os postos pelo critério escolhido, virando R$/h administrativo por posto.',
  'R$ 48.000,00 de despesa administrativa no mês.',
  'Somar aqui custos que já estão no posto (mão de obra, energia): isso dobraria o custo.', 20),
 ('prod.rateio.origem', 'Rateio', 'Origem da base',
  'De onde vem o valor: digitado por você (padrão) ou puxado do financeiro da GE (próxima fatia).',
  'Deixa rastro de como a base foi obtida. Hoje o valor é sempre digitado (RD-102).',
  'Digitado.',
  'Esperar o "puxar do financeiro" já somar o DRE: isso chega na próxima fatia.', 30),
 ('prod.rateio.criterio', 'Rateio', 'Critério de distribuição',
  'Como repartir a despesa entre os postos: por horas de mão de obra (pessoas × horas), por kg produzido ou por nº de pessoas.',
  'Posto com mais peso no critério recebe uma parcela maior do administrativo.',
  'Horas de mão de obra — o posto com mais gente e mais horas absorve mais.',
  'Escolher um critério sem dado no mês (ex.: kg sem apontamento): o rateio fica zerado — troque o critério.', 40),
 ('prod.rateio.observacao', 'Rateio', 'Observação',
  'Nota livre sobre a base do mês (o que entrou, o que ficou de fora).',
  'Ajuda a lembrar por que a base foi aquela quando alguém revisar.',
  'Inclui aluguel da administração; exclui pró-labore.',
  '—', 50),
 ('prod.rateio.resultado', 'Rateio', 'Rateio por posto',
  'A distribuição calculada: a parcela da despesa administrativa que cai em cada posto, em R$/mês e R$/h.',
  'O R$/h administrativo entra no custo do posto e, na F6, no custo por kg do produto final.',
  'Posto 12 recebe R$ 6.400/mês e R$ 32,00/h.',
  'Esperar soma diferente da base: a soma das parcelas é sempre igual à despesa do mês.', 60)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

-- =========================================================== 6) RD-98 p3 · origem do dado (system_screens)
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, modulo, views_consumidas, rpcs_chamadas)
VALUES ('prod_rateio_admin', '/dashboard/produtividade/rateio', 'industria', 'Rateio administrativo',
  'Distribui a despesa administrativa do mês entre os postos por horas de mão de obra, kg produzido ou nº de pessoas, gerando o R$/h administrativo por posto (entra no custo por kg — F6).',
  'produtividade',
  ARRAY['prod_rateio_admin','prod_posto','prod_posto_custo','prod_posto_pessoa','prod_apontamento_hora']::text[],
  ARRAY['fn_prod_rateio_admin_get','fn_prod_rateio_admin_salvar','fn_prod_rateio_admin_distribuir']::text[])
ON CONFLICT (id) DO UPDATE SET
  views_consumidas = EXCLUDED.views_consumidas, rpcs_chamadas = EXCLUDED.rpcs_chamadas, atualizado_em = now();
