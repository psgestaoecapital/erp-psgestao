-- P&M · Benchmark de Mercado (CEO/auditor_pdca_2 01/11) — CONSTRUIR a tela (hoje placeholder, nota 28).
-- RD-98 p1 (sem tela morta): a tela passa a ter DADO REAL — referências de mercado cadastradas pelo próprio
-- usuário (indicador × segmento × serviço, valor de referência, período e fonte). Não é mockup/preview.
-- RD-98 p2 CRUD completo; p3 origem do dado; p4 exclusão rastreável (soft-delete + quem/quando + audit_log).
-- RD-95 "?" em todo campo/filtro/indicador/ação. Multi-tenant (RD-45). Aditivo. Zero API paga.
-- Code: code-desenvolvedor-3

-- 1) Tabela nova
CREATE TABLE IF NOT EXISTS public.agency_benchmark (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  indicador text NOT NULL,                 -- métrica: "Fee mensal médio", "Valor hora", "Margem alvo"...
  segmento text,                           -- segmento de mercado: "Varejo", "Indústria", "Serviços"...
  servico text,                            -- serviço ao qual a referência se aplica (texto livre)
  unidade text NOT NULL DEFAULT 'R$',      -- R$, %, R$/h, R$/mês, R$/m², x, pts
  valor_referencia numeric NOT NULL,       -- valor de referência de mercado
  periodo text,                            -- período da referência: "2026", "jan/26"...
  fonte text,                              -- de onde veio (pesquisa, associação, estimativa interna)
  observacoes text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid(),
  atualizado_em timestamptz,
  excluido_em timestamptz,                 -- exclusão rastreável (RD-98 p4; nunca DELETE físico)
  excluido_por uuid,
  excluido_motivo text
);
CREATE INDEX IF NOT EXISTS idx_agency_benchmark_empresa ON public.agency_benchmark (company_id, indicador);

ALTER TABLE public.agency_benchmark ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.agency_benchmark'::regclass AND polname='agency_benchmark_sel') THEN
    CREATE POLICY agency_benchmark_sel ON public.agency_benchmark
      FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;
-- escrita só pelas RPCs (SECURITY DEFINER); leitura por empresa. Sem anon.
REVOKE ALL ON public.agency_benchmark FROM PUBLIC, anon;
GRANT SELECT ON public.agency_benchmark TO authenticated;

-- 2) RPCs de CRUD (mesmo padrão vivo de fn_pm_evento_salvar/_excluir: guarda de empresa, audit_log_global, REVOKE anon)
CREATE OR REPLACE FUNCTION public.fn_pm_benchmark_salvar(p_company_id uuid, p_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_id uuid; v_ant agency_benchmark%ROWTYPE;
  v_indicador text := nullif(btrim(p_dados->>'indicador'),'');
  v_unidade text := COALESCE(nullif(btrim(p_dados->>'unidade'),''),'R$');
  v_valor numeric := nullif(p_dados->>'valor_referencia','')::numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
  IF v_indicador IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','o indicador é obrigatório'); END IF;
  IF v_valor IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','informe o valor de referência'); END IF;

  IF p_id IS NULL THEN
    INSERT INTO agency_benchmark (company_id, indicador, segmento, servico, unidade, valor_referencia, periodo, fonte, observacoes)
    VALUES (p_company_id, v_indicador, nullif(btrim(p_dados->>'segmento'),''), nullif(btrim(p_dados->>'servico'),''),
            v_unidade, v_valor, nullif(btrim(p_dados->>'periodo'),''), nullif(btrim(p_dados->>'fonte'),''), nullif(btrim(p_dados->>'observacoes'),''))
    RETURNING id INTO v_id;
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_benchmark', v_id, 'benchmark_criar', NULL, p_dados);
    RETURN jsonb_build_object('ok',true,'id',v_id);
  ELSE
    SELECT * INTO v_ant FROM agency_benchmark WHERE id = p_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','referência não encontrada'); END IF;
    IF NOT (v_ant.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
    IF v_ant.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'erro','referência excluída'); END IF;
    UPDATE agency_benchmark
       SET indicador=v_indicador, segmento=nullif(btrim(p_dados->>'segmento'),''), servico=nullif(btrim(p_dados->>'servico'),''),
           unidade=v_unidade, valor_referencia=v_valor, periodo=nullif(btrim(p_dados->>'periodo'),''),
           fonte=nullif(btrim(p_dados->>'fonte'),''), observacoes=nullif(btrim(p_dados->>'observacoes'),''), atualizado_em=now()
     WHERE id = p_id;
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_ant.company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_benchmark', p_id, 'benchmark_editar',
            jsonb_build_object('indicador',v_ant.indicador,'valor_referencia',v_ant.valor_referencia,'unidade',v_ant.unidade), p_dados);
    RETURN jsonb_build_object('ok',true,'id',p_id);
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_pm_benchmark_excluir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_b agency_benchmark%ROWTYPE;
BEGIN
  SELECT * INTO v_b FROM agency_benchmark WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','referência não encontrada'); END IF;
  IF NOT (v_b.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
  IF v_b.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'ja_excluido',true); END IF;
  UPDATE agency_benchmark SET excluido_em=now(), excluido_por=v_uid, excluido_motivo=nullif(btrim(p_motivo),''), atualizado_em=now() WHERE id=p_id;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_b.company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_benchmark', p_id, 'benchmark_excluir',
          jsonb_build_object('indicador',v_b.indicador,'valor_referencia',v_b.valor_referencia), jsonb_build_object('excluido_em',now(),'motivo',nullif(btrim(p_motivo),'')));
  RETURN jsonb_build_object('ok',true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_benchmark_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_benchmark_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_benchmark_salvar(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pm_benchmark_excluir(uuid, text) TO authenticated, service_role;

-- 3) Ajuda (RD-95) — "?" de todo campo/filtro/indicador/ação
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('pm.benchmark.tela', '/dashboard/pm/benchmark', 'Benchmark', 'Benchmark de Mercado',
  'Cadastre referências de mercado (fee médio, valor/hora, margem alvo…) por segmento e serviço para comparar com os seus números.',
  'Ter um parâmetro de mercado ao lado dos indicadores da agência.',
  'Fee mensal médio de social media no varejo: R$ 6.000.',
  'Guardar aqui o seu número real: aqui é a REFERÊNCIA de mercado, não o praticado.',
  'pm', 1, 1, 'publicado'),
 ('pm.benchmark.kpi_total', '/dashboard/pm/benchmark', 'Benchmark · Indicadores', 'Referências', 'Total de referências ativas (não excluídas) no filtro atual.', 'Dimensão da base de comparação.', '12 referências.', 'Esquecer que respeita os filtros.', 'pm', 2, 1, 'publicado'),
 ('pm.benchmark.kpi_segmentos', '/dashboard/pm/benchmark', 'Benchmark · Indicadores', 'Segmentos', 'Quantos segmentos de mercado distintos têm referência cadastrada.', 'Ver a abrangência da base.', '4 segmentos.', '—', 'pm', 3, 1, 'publicado'),
 ('pm.benchmark.kpi_indicadores', '/dashboard/pm/benchmark', 'Benchmark · Indicadores', 'Indicadores', 'Quantos indicadores distintos estão cobertos.', 'Ver quais métricas já têm referência.', '5 indicadores.', '—', 'pm', 4, 1, 'publicado'),
 ('pm.benchmark.filtro_segmento', '/dashboard/pm/benchmark', 'Benchmark · Filtros', 'Segmento', 'Filtra as referências por segmento de mercado.', 'Focar num segmento.', 'Varejo.', '—', 'pm', 5, 1, 'publicado'),
 ('pm.benchmark.filtro_busca', '/dashboard/pm/benchmark', 'Benchmark · Filtros', 'Buscar', 'Procura por indicador, serviço ou fonte.', 'Achar rápido uma referência.', 'valor hora.', '—', 'pm', 6, 1, 'publicado'),
 ('pm.benchmark.acao_novo', '/dashboard/pm/benchmark', 'Benchmark · Ações', 'Nova referência', 'Abre o formulário para cadastrar uma referência de mercado.', 'Registrar um novo parâmetro.', 'Nova referência → indicador, segmento, valor.', 'Deixar o indicador ou o valor vazios: são obrigatórios.', 'pm', 7, 1, 'publicado'),
 ('pm.benchmark.acao_editar', '/dashboard/pm/benchmark', 'Benchmark · Ações', 'Editar', 'Edita os dados da referência.', 'Atualizar valor, fonte ou período.', 'Nova pesquisa saiu → Editar.', '—', 'pm', 8, 1, 'publicado'),
 ('pm.benchmark.acao_excluir', '/dashboard/pm/benchmark', 'Benchmark · Ações', 'Excluir', 'Exclui a referência de forma rastreável (guarda quem/quando/motivo; não some do banco).', 'Remover uma referência indevida sem perder o histórico.', 'Referência duplicada → Excluir com motivo.', 'Esperar apagar de vez: é exclusão rastreável (auditável).', 'pm', 9, 1, 'publicado'),
 ('pm.benchmark.campo_indicador', '/dashboard/pm/benchmark', 'Benchmark · Formulário', 'Indicador', 'A métrica de referência (fee médio, valor/hora, margem alvo…).', 'Identificar o que a referência mede.', 'Fee mensal médio.', 'Indicador genérico demais dificulta a comparação.', 'pm', 10, 1, 'publicado'),
 ('pm.benchmark.campo_segmento', '/dashboard/pm/benchmark', 'Benchmark · Formulário', 'Segmento', 'Segmento de mercado da referência.', 'Comparar maçãs com maçãs.', 'Varejo.', '—', 'pm', 11, 1, 'publicado'),
 ('pm.benchmark.campo_servico', '/dashboard/pm/benchmark', 'Benchmark · Formulário', 'Serviço', 'Serviço ao qual a referência se aplica.', 'Ligar a referência ao serviço certo.', 'Social media.', '—', 'pm', 12, 1, 'publicado'),
 ('pm.benchmark.campo_unidade', '/dashboard/pm/benchmark', 'Benchmark · Formulário', 'Unidade', 'A unidade do valor (R$, %, R$/h, R$/mês…).', 'Deixar claro como ler o número.', 'R$/mês.', 'Usar % num valor em R$ (ou o contrário).', 'pm', 13, 1, 'publicado'),
 ('pm.benchmark.campo_valor', '/dashboard/pm/benchmark', 'Benchmark · Formulário', 'Valor de referência', 'O número de referência de mercado.', 'Base da comparação.', '6000 (com unidade R$/mês).', 'Deixar vazio: é obrigatório.', 'pm', 14, 1, 'publicado'),
 ('pm.benchmark.campo_periodo', '/dashboard/pm/benchmark', 'Benchmark · Formulário', 'Período', 'A que período a referência se refere.', 'Saber se o número está atual.', '2026.', 'Referência antiga sem período engana.', 'pm', 15, 1, 'publicado'),
 ('pm.benchmark.campo_fonte', '/dashboard/pm/benchmark', 'Benchmark · Formulário', 'Fonte', 'De onde veio a referência (pesquisa, associação, estimativa).', 'Dar credibilidade ao número.', 'Pesquisa setorial 2026.', 'Sem fonte, a referência vale menos.', 'pm', 16, 1, 'publicado'),
 ('pm.benchmark.campo_observacoes', '/dashboard/pm/benchmark', 'Benchmark · Formulário', 'Observações', 'Notas livres sobre a referência.', 'Registrar ressalvas e contexto.', 'Média das 3 maiores praças.', '—', 'pm', 17, 1, 'publicado'),
 ('pm.benchmark.col_acoes', '/dashboard/pm/benchmark', 'Benchmark · Colunas', 'Ações', 'Editar ou excluir a referência da linha.', 'Agir sem sair da lista.', 'Editar/Excluir.', '—', 'pm', 18, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- 4) Semente DEMO (idempotente, só empresa is_demo com carteira P&M) — para a tela não nascer morta (RD-98 p1)
DO $$
DECLARE v_comp uuid;
BEGIN
  SELECT c.id INTO v_comp FROM companies c
   WHERE c.is_demo = true AND EXISTS (SELECT 1 FROM agency_jobs j WHERE j.company_id = c.id)
   ORDER BY c.id LIMIT 1;
  IF v_comp IS NULL THEN RETURN; END IF;

  INSERT INTO agency_benchmark (company_id, indicador, segmento, servico, unidade, valor_referencia, periodo, fonte, observacoes)
  SELECT v_comp, d.indicador, d.segmento, d.servico, d.unidade, d.valor, d.periodo, d.fonte, d.obs
  FROM (VALUES
    ('Fee mensal médio', 'Varejo', 'Social media', 'R$/mês', 6000::numeric, '2026', 'Pesquisa setorial', 'Média das principais praças.'),
    ('Valor da hora', 'Serviços', 'Produção audiovisual', 'R$/h', 180::numeric, '2026', 'Associação do setor', 'Hora de produção sênior.'),
    ('Margem alvo', 'Indústria', 'Projeto', '%', 35::numeric, '2026', 'Estimativa interna', 'Margem de contribuição saudável.')
  ) AS d(indicador, segmento, servico, unidade, valor, periodo, fonte, obs)
  WHERE NOT EXISTS (SELECT 1 FROM agency_benchmark b WHERE b.company_id = v_comp AND b.indicador = d.indicador AND b.segmento = d.segmento);
END $$;

-- 5) Origem do dado (RD-98 pilar 3)
UPDATE public.system_screens
   SET views_consumidas = ARRAY['agency_benchmark']::text[],
       rpcs_chamadas = ARRAY['fn_pm_benchmark_salvar','fn_pm_benchmark_excluir']::text[],
       estado_real = 'pronto',
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/benchmark';
