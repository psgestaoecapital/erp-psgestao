-- ============================================================
-- PS EHS · EHS-F (Financeiro acoplado) · slice-c2 (fatia 1 — lado EHS)
-- Livro de custos de SST (EPI, treinamento, exame, acidente, SST geral).
-- Fronteira F.2 [→GE]: o PS EHS SÓ DISPARA/REGISTRA eventos de custo; quando o
-- adicional financeiro (Gestão Empresarial) está acoplado, a fatia seguinte os
-- leva à DRE / fluxo de caixa por centro de custo do setor. Sem o adicional, a
-- tela funciona standalone (registra o custo) e mostra o que o adicional entrega.
-- Code: code-desenvolvedor-3
-- ============================================================
-- ADITIVA (RD-94.1 c): tabela/RPCs/menu NOVOS, RLS por empresa, REVOKE anon,
-- sem UPDATE/DELETE em dado de cliente. Idempotente. Seed SÓ nas DEMOs EHS
-- (…00b não-acoplado e …00c acoplado, guardado por companies.is_demo=true).
-- Nenhum nome de terceiro (RD-100). RD-95: "?" em todo campo (erp_ajuda_campo).
-- RD-98 p4: exclusão rastreável (quem/quando) + trilha em audit_log_global.

-- ------------------------------------------------------------
-- 1) Tabela: livro de custos de SST (evento de custo EHS)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ehs_evento_custo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  setor_id       uuid REFERENCES public.compliance_setores(id) ON DELETE SET NULL,
  tipo           text NOT NULL DEFAULT 'sst_geral'
                   CHECK (tipo IN ('epi','treinamento','exame','acidente','sst_geral')),
  descricao      text NOT NULL,
  valor          numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor >= 0),
  competencia    date NOT NULL,                 -- 1º dia do mês de competência
  origem_tipo    text NOT NULL DEFAULT 'manual' -- de onde veio (manual, epi_entrega, exame_aso, incidente…)
                   CHECK (origem_tipo IN ('manual','epi_entrega','treinamento','exame_aso','incidente','outro')),
  origem_id      uuid,                           -- link opcional ao registro EHS de origem
  status         text NOT NULL DEFAULT 'registrado'
                   CHECK (status IN ('registrado','lancado','cancelado')),
  lancamento_ref uuid,                           -- preenchido pela fatia GE quando lançado (futuro)
  observacoes    text,
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_por   uuid,
  excluido_em    timestamptz,
  ativo          boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS ix_ehs_evento_custo_company ON public.ehs_evento_custo (company_id, ativo, competencia);
CREATE INDEX IF NOT EXISTS ix_ehs_evento_custo_setor   ON public.ehs_evento_custo (setor_id);

ALTER TABLE public.ehs_evento_custo ENABLE ROW LEVEL SECURITY;
DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ehs_evento_custo' AND policyname='p_ehs_evento_custo_tenant') THEN
    CREATE POLICY p_ehs_evento_custo_tenant ON public.ehs_evento_custo FOR ALL TO authenticated
      USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
      WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  END IF;
END $mig$;
REVOKE ALL ON public.ehs_evento_custo FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_evento_custo TO authenticated;

-- ------------------------------------------------------------
-- 2) RPCs (SECURITY DEFINER, guarda por empresa via fn_compliance_assert)
-- ------------------------------------------------------------
-- Lista + totais + estado do adicional financeiro (F.2: a tela nunca quebra sem o adicional)
CREATE OR REPLACE FUNCTION public.fn_ehs_evento_custo_listar(
  p_company_id uuid, p_comp_ini date DEFAULT NULL, p_comp_fim date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_fin jsonb; v_itens jsonb; v_total numeric; v_por_tipo jsonb;
  v_ini date := COALESCE(p_comp_ini, DATE '0001-01-01');
  v_fim date := COALESCE(p_comp_fim, DATE '9999-12-31');
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  v_fin := public.fn_ehs_financeiro_status(p_company_id);

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'competencia') DESC, (x->>'descricao')), '[]'::jsonb),
         COALESCE(SUM((x->>'valor')::numeric), 0)
    INTO v_itens, v_total
  FROM (
    SELECT jsonb_build_object(
      'id', e.id, 'tipo', e.tipo, 'descricao', e.descricao, 'valor', e.valor,
      'competencia', e.competencia, 'origem_tipo', e.origem_tipo, 'status', e.status,
      'setor_id', e.setor_id, 'setor_nome', s.nome, 'observacoes', e.observacoes,
      'lancado', (e.status = 'lancado')
    ) AS x
    FROM public.ehs_evento_custo e
    LEFT JOIN public.compliance_setores s ON s.id = e.setor_id
    WHERE e.company_id = p_company_id AND e.ativo
      AND e.competencia BETWEEN v_ini AND v_fim
  ) q;

  SELECT COALESCE(jsonb_object_agg(tipo, soma), '{}'::jsonb) INTO v_por_tipo
  FROM (
    SELECT e.tipo, SUM(e.valor) AS soma
    FROM public.ehs_evento_custo e
    WHERE e.company_id = p_company_id AND e.ativo
      AND e.competencia BETWEEN v_ini AND v_fim
    GROUP BY e.tipo
  ) t;

  RETURN jsonb_build_object(
    'acoplado', COALESCE((v_fin->>'acoplado')::boolean, false),
    'total', v_total, 'por_tipo', v_por_tipo, 'itens', v_itens
  );
END $fn$;

-- Incluir/editar um evento de custo
CREATE OR REPLACE FUNCTION public.fn_ehs_evento_custo_salvar(
  p_company_id uuid, p_id uuid, p_tipo text, p_descricao text, p_valor numeric,
  p_competencia date, p_setor_id uuid DEFAULT NULL,
  p_origem_tipo text DEFAULT 'manual', p_observacoes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid; v_comp date;
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  IF COALESCE(btrim(p_descricao),'') = '' THEN RAISE EXCEPTION 'descricao_obrigatoria'; END IF;
  IF COALESCE(p_tipo,'') NOT IN ('epi','treinamento','exame','acidente','sst_geral') THEN
    RAISE EXCEPTION 'tipo_invalido'; END IF;
  IF COALESCE(p_origem_tipo,'manual') NOT IN ('manual','epi_entrega','treinamento','exame_aso','incidente','outro') THEN
    RAISE EXCEPTION 'origem_invalida'; END IF;
  IF p_valor IS NULL OR p_valor < 0 THEN RAISE EXCEPTION 'valor_invalido'; END IF;
  IF p_competencia IS NULL THEN RAISE EXCEPTION 'competencia_obrigatoria'; END IF;
  v_comp := date_trunc('month', p_competencia)::date;
  -- setor (se informado) tem de ser da mesma empresa
  IF p_setor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.compliance_setores s WHERE s.id = p_setor_id AND s.company_id = p_company_id
  ) THEN RAISE EXCEPTION 'setor_invalido'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.ehs_evento_custo(
      company_id, setor_id, tipo, descricao, valor, competencia, origem_tipo, observacoes, criado_por)
    VALUES (p_company_id, p_setor_id, p_tipo, btrim(p_descricao), p_valor, v_comp,
      COALESCE(p_origem_tipo,'manual'), NULLIF(btrim(p_observacoes),''), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.ehs_evento_custo SET
      setor_id = p_setor_id, tipo = p_tipo, descricao = btrim(p_descricao), valor = p_valor,
      competencia = v_comp, origem_tipo = COALESCE(p_origem_tipo,'manual'),
      observacoes = NULLIF(btrim(p_observacoes),''), atualizado_em = now()
    WHERE id = p_id AND company_id = p_company_id AND ativo AND status <> 'lancado'
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'evento_invalido_ou_lancado'; END IF;
  END IF;
  RETURN v_id;
END $fn$;

-- Excluir (soft-delete rastreável · RD-98 p4) + trilha em audit_log_global
CREATE OR REPLACE FUNCTION public.fn_ehs_evento_custo_excluir(p_company_id uuid, p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_old public.ehs_evento_custo;
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  SELECT * INTO v_old FROM public.ehs_evento_custo
   WHERE id = p_id AND company_id = p_company_id AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'evento_invalido'; END IF;
  IF v_old.status = 'lancado' THEN RAISE EXCEPTION 'evento_lancado_nao_exclui'; END IF;

  UPDATE public.ehs_evento_custo
     SET ativo = false, status = 'cancelado',
         excluido_por = auth.uid(), excluido_em = now(), atualizado_em = now()
   WHERE id = p_id AND company_id = p_company_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, created_at)
  VALUES (p_company_id, auth.uid(), 'ehs_evento_custo', p_id::text, 'excluir',
          to_jsonb(v_old), now());
END $fn$;

REVOKE ALL ON FUNCTION public.fn_ehs_evento_custo_listar(uuid,date,date) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_ehs_evento_custo_salvar(uuid,uuid,text,text,numeric,date,uuid,text,text) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_ehs_evento_custo_excluir(uuid,uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_ehs_evento_custo_listar(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_evento_custo_salvar(uuid,uuid,text,text,numeric,date,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_evento_custo_excluir(uuid,uuid) TO authenticated;

-- ------------------------------------------------------------
-- 3) Menu (module_catalog) — dentro do SST
-- ------------------------------------------------------------
INSERT INTO public.module_catalog
  (id, nome, rota, grupo, subgrupo, icone, ordem, ativo, is_shared, ehs_modulo,
   so_ps, so_demo, rbac_isento, legacy, diferencial, descricao)
VALUES
  ('ehs_sst_custos', 'Custos de SST', '/dashboard/ehs/sst/custos', 'compliance',
   'docs_regulatorios', 'Receipt', 93, true, true, 'completo',
   false, false, false, false, false,
   'Livro de custos de Saúde e Segurança do Trabalho (EPI, treinamento, exame, acidente). Com o adicional financeiro, os custos entram na DRE e no fluxo de caixa por centro de custo do setor.')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 4) system_screens (RD-98 p3)
-- ------------------------------------------------------------
INSERT INTO public.system_screens
  (id, area, rota, titulo, estado_real, auditavel_robo, prioridade_monitoramento,
   descricao_funcional, views_consumidas, rpcs_chamadas)
VALUES
  ('dashboard.ehs_sst_custos', 'compliance', '/dashboard/ehs/sst/custos',
   'Custos de SST', 'pronto', true, 'alta',
   'Livro de custos de SST (EPI, treinamento, exame, acidente); base para a DRE de SST por centro de custo quando o adicional financeiro está acoplado.',
   ARRAY['ehs_evento_custo','compliance_setores']::text[],
   ARRAY['fn_ehs_evento_custo_listar','fn_ehs_evento_custo_salvar','fn_ehs_evento_custo_excluir','fn_ehs_financeiro_status','fn_ajuda_campo_listar']::text[])
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 5) Ajuda de campo (RD-95) — "?" em todo campo
-- ------------------------------------------------------------
INSERT INTO public.erp_ajuda_campo
  (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.sst_custos.empresa_alvo', '/dashboard/ehs/sst/custos', 'Empresa',
   'Quando você administra um grupo, escolha a empresa cujos custos de SST quer ver e lançar.',
   'Garante que os custos ficam na empresa certa (e, com o adicional, no centro de custo dela).',
   'EHS Modelo', 'Lançar o custo na empresa errada do grupo.',
   'ehs', 0, 1, 'publicado'),
  ('ehs.sst_custos.competencia', '/dashboard/ehs/sst/custos', 'Competência (mês)',
   'O mês a que o custo se refere — o sistema guarda sempre o 1º dia do mês.',
   'Organiza os custos por mês para o acompanhamento e, com o adicional, para a DRE.',
   '11/2026', 'Usar a data do pagamento quando a competência é de outro mês.',
   'ehs', 1, 1, 'publicado'),
  ('ehs.sst_custos.tipo', '/dashboard/ehs/sst/custos', 'Tipo de custo',
   'A natureza do custo: EPI, treinamento, exame ocupacional, acidente ou SST em geral.',
   'Permite ver quanto cada frente de SST custa e priorizar as ações.',
   'EPI', 'Classificar tudo como "SST geral" e perder a visão por frente.',
   'ehs', 2, 1, 'publicado'),
  ('ehs.sst_custos.descricao', '/dashboard/ehs/sst/custos', 'Descrição',
   'O que gerou o custo, em poucas palavras.',
   'Identifica o lançamento na lista e na trilha.',
   'Compra de protetores auriculares para a produção', 'Deixar genérico demais ("gasto") e não reconhecer depois.',
   'ehs', 3, 1, 'publicado'),
  ('ehs.sst_custos.valor', '/dashboard/ehs/sst/custos', 'Valor (R$)',
   'O valor do custo, em reais.',
   'Soma no total de SST e, com o adicional, vira lançamento na Gestão Empresarial.',
   '1.250,00', 'Digitar centavos como reais (ex.: 125000 em vez de 1.250,00).',
   'ehs', 4, 1, 'publicado'),
  ('ehs.sst_custos.setor', '/dashboard/ehs/sst/custos', 'Setor',
   'O setor que originou o custo (opcional).',
   'Permite ver o custo de SST por setor e, com o adicional, levar ao centro de custo dele.',
   'Produção', 'Deixar sem setor quando ele já existe e ajudaria no rateio.',
   'ehs', 5, 1, 'publicado'),
  ('ehs.sst_custos.origem', '/dashboard/ehs/sst/custos', 'Origem do custo',
   'De onde o custo veio: lançamento manual ou de um registro de EHS (entrega de EPI, exame, incidente).',
   'Mostra a rastreabilidade do custo até a ação de SST que o gerou.',
   'Manual', 'Marcar "manual" quando o custo já nasceu de uma entrega de EPI registrada.',
   'ehs', 6, 1, 'publicado'),
  ('ehs.sst_custos.observacoes', '/dashboard/ehs/sst/custos', 'Observações',
   'Anotações livres sobre o custo.',
   'Guarda contexto que não cabe nos outros campos.',
   'Nota fiscal 4521; rateio 60% produção / 40% manutenção.', 'Usar para dado que tem campo próprio (ex.: valor).',
   'ehs', 7, 1, 'publicado'),
  ('ehs.sst_custos.total', '/dashboard/ehs/sst/custos', 'Total de SST no período',
   'Indicador — a soma dos custos de SST do período filtrado.',
   'Dá a dimensão do investimento em segurança e saúde no período.',
   'R$ 18.400,00', 'Comparar meses com filtros de período diferentes.',
   'ehs', 8, 1, 'publicado'),
  ('ehs.sst_custos.adicional', '/dashboard/ehs/sst/custos', 'Financeiro acoplado',
   'Indicador — mostra se o adicional financeiro (Gestão Empresarial) está contratado.',
   'Com o adicional, estes custos entram na DRE e no fluxo de caixa por centro de custo; sem ele, ficam só aqui.',
   'Acoplado', 'Esperar os custos na DRE sem ter o adicional contratado.',
   'ehs', 9, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- ------------------------------------------------------------
-- 6) Seed fictício realista — SÓ nas DEMOs EHS (idempotente por descrição+competência+empresa)
--    …00b (compliance, NÃO acoplado) e …00c (compliance + financeiro, acoplado)
-- ------------------------------------------------------------
DO $seed$
DECLARE v_c uuid;
BEGIN
  FOREACH v_c IN ARRAY ARRAY[
    'b0700000-0000-4000-a000-00000000000b'::uuid,
    'b0700000-0000-4000-a000-00000000000c'::uuid
  ] LOOP
    IF EXISTS (SELECT 1 FROM public.companies WHERE id = v_c AND is_demo = true) THEN
      INSERT INTO public.ehs_evento_custo
        (company_id, tipo, descricao, valor, competencia, origem_tipo, observacoes)
      SELECT v_c, d.tipo, d.descricao, d.valor, d.competencia, d.origem_tipo, d.observacoes
      FROM (VALUES
        ('epi',          'Compra de protetores auriculares (produção)', 1250.00, date_trunc('month', CURRENT_DATE)::date,                       'epi_entrega', 'Reposição trimestral de EPI auditivo.'),
        ('epi',          'Luvas e botas de segurança (manutenção)',      980.00, date_trunc('month', CURRENT_DATE)::date,                       'epi_entrega', 'Entrega registrada na ficha de EPI.'),
        ('treinamento',  'Treinamento NR-35 (trabalho em altura)',      3400.00, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date, 'treinamento', 'Turma de 12 colaboradores.'),
        ('exame',        'Exames periódicos ocupacionais (ASO)',        2600.00, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date, 'exame_aso',   'PCMSO — lote de exames do mês.'),
        ('acidente',     'Custo de afastamento por acidente típico',    1850.00, (date_trunc('month', CURRENT_DATE) - interval '2 month')::date, 'incidente',   'Estimativa de custo direto do afastamento.'),
        ('sst_geral',    'Manutenção da brigada e sinalização',          720.00, date_trunc('month', CURRENT_DATE)::date,                       'manual',      'Recarga de extintores e placas.')
      ) AS d(tipo, descricao, valor, competencia, origem_tipo, observacoes)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.ehs_evento_custo e
         WHERE e.company_id = v_c AND e.descricao = d.descricao AND e.competencia = d.competencia
      );
    END IF;
  END LOOP;
END $seed$;
