-- P&M · Benchmark de Mercado (/dashboard/pm/benchmark)
-- Radar competitivo PRÓPRIO: cadastro de concorrentes por cliente + campanhas observadas.
-- Substitui a tela placeholder "EM BREVE" (RD-98 p1: nada de tela morta).
-- ADITIVA: tabela/funções NOVAS, RLS por company_id, REVOKE anon, soft-delete rastreável + audit_log_global.
-- Nenhum dado de cliente é alterado/apagado. RD-100: nenhum nome de sistema de terceiros.
-- Code: code-desenvolvedor-3

-- ========================================================================
-- 1) TABELA  agency_concorrente  (radar competitivo da agência)
-- ========================================================================
CREATE TABLE IF NOT EXISTS public.agency_concorrente (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cliente_id            uuid REFERENCES public.agency_clientes(id) ON DELETE SET NULL,
  nome                  text NOT NULL,
  segmento              text,
  site                  text,
  nivel_ameaca          text NOT NULL DEFAULT 'media'
                          CHECK (nivel_ameaca IN ('baixa','media','alta')),
  posicionamento        text,
  forcas                text,
  fraquezas             text,
  campanhas_observadas  text,
  ultima_observacao     date,
  observacoes           text,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  criado_por            uuid DEFAULT auth.uid(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  excluido_em           timestamptz,
  excluido_por          uuid
);

COMMENT ON TABLE public.agency_concorrente IS
  'P&M · Benchmark de Mercado: concorrentes monitorados por cliente (radar competitivo próprio). Soft-delete via excluido_em/excluido_por.';

CREATE INDEX IF NOT EXISTS idx_agency_concorrente_company
  ON public.agency_concorrente (company_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_agency_concorrente_cliente
  ON public.agency_concorrente (cliente_id) WHERE excluido_em IS NULL;

-- RLS: isolamento por empresa (mesmo padrão das demais agency_*)
ALTER TABLE public.agency_concorrente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agency_concorrente_access ON public.agency_concorrente;
CREATE POLICY agency_concorrente_access ON public.agency_concorrente
  FOR ALL TO public
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin())
  WITH CHECK ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

REVOKE ALL ON public.agency_concorrente FROM anon;
-- escritas só via RPC SECURITY DEFINER; SELECT direto permitido (RLS ainda isola por empresa)
GRANT SELECT ON public.agency_concorrente TO authenticated;

-- ========================================================================
-- 2) RPC listar
-- ========================================================================
CREATE OR REPLACE FUNCTION public.fn_agency_concorrente_listar(
  p_company_id uuid,
  p_cliente_id uuid DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x))
    FROM (
      SELECT c.id, c.company_id, c.cliente_id, cl.nome AS cliente_nome,
             c.nome, c.segmento, c.site, c.nivel_ameaca, c.posicionamento,
             c.forcas, c.fraquezas, c.campanhas_observadas, c.ultima_observacao,
             c.observacoes, c.criado_em, c.atualizado_em
        FROM public.agency_concorrente c
        LEFT JOIN public.agency_clientes cl ON cl.id = c.cliente_id
       WHERE c.company_id = p_company_id
         AND c.excluido_em IS NULL
         AND (p_cliente_id IS NULL OR c.cliente_id = p_cliente_id)
       ORDER BY CASE c.nivel_ameaca WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
                c.nome
    ) x
  ), '[]'::jsonb);
END $function$;

-- ========================================================================
-- 3) RPC salvar (insert/update por id no payload)
-- ========================================================================
CREATE OR REPLACE FUNCTION public.fn_agency_concorrente_salvar(
  p_company_id uuid,
  p_payload jsonb
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_id      uuid := NULLIF(p_payload->>'id','')::uuid;
  v_ameaca  text := COALESCE(NULLIF(p_payload->>'nivel_ameaca',''),'media');
  r         public.agency_concorrente;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);
  IF COALESCE(btrim(p_payload->>'nome'),'') = '' THEN
    RAISE EXCEPTION 'nome_obrigatorio';
  END IF;
  IF v_ameaca NOT IN ('baixa','media','alta') THEN
    RAISE EXCEPTION 'nivel_ameaca_invalido';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.agency_concorrente
      (company_id, cliente_id, nome, segmento, site, nivel_ameaca, posicionamento,
       forcas, fraquezas, campanhas_observadas, ultima_observacao, observacoes)
    VALUES (
      p_company_id,
      NULLIF(p_payload->>'cliente_id','')::uuid,
      btrim(p_payload->>'nome'),
      NULLIF(btrim(p_payload->>'segmento'),''),
      NULLIF(btrim(p_payload->>'site'),''),
      v_ameaca,
      NULLIF(btrim(p_payload->>'posicionamento'),''),
      NULLIF(btrim(p_payload->>'forcas'),''),
      NULLIF(btrim(p_payload->>'fraquezas'),''),
      NULLIF(btrim(p_payload->>'campanhas_observadas'),''),
      NULLIF(p_payload->>'ultima_observacao','')::date,
      NULLIF(btrim(p_payload->>'observacoes'),'')
    ) RETURNING * INTO r;
  ELSE
    UPDATE public.agency_concorrente SET
      cliente_id           = NULLIF(p_payload->>'cliente_id','')::uuid,
      nome                 = btrim(p_payload->>'nome'),
      segmento             = NULLIF(btrim(p_payload->>'segmento'),''),
      site                 = NULLIF(btrim(p_payload->>'site'),''),
      nivel_ameaca         = v_ameaca,
      posicionamento       = NULLIF(btrim(p_payload->>'posicionamento'),''),
      forcas               = NULLIF(btrim(p_payload->>'forcas'),''),
      fraquezas            = NULLIF(btrim(p_payload->>'fraquezas'),''),
      campanhas_observadas = NULLIF(btrim(p_payload->>'campanhas_observadas'),''),
      ultima_observacao    = NULLIF(p_payload->>'ultima_observacao','')::date,
      observacoes          = NULLIF(btrim(p_payload->>'observacoes'),''),
      atualizado_em        = now()
    WHERE id = v_id AND company_id = p_company_id AND excluido_em IS NULL
    RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'concorrente_nao_encontrado'; END IF;
  END IF;

  RETURN to_jsonb(r);
END $function$;

-- ========================================================================
-- 4) RPC excluir (soft-delete rastreável + audit_log_global) — RD-98 p4
-- ========================================================================
CREATE OR REPLACE FUNCTION public.fn_agency_concorrente_excluir(
  p_id uuid,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_c public.agency_concorrente%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM public.agency_concorrente WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'concorrente não encontrado'); END IF;
  IF NOT (v_c.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_c.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_excluido', true); END IF;

  UPDATE public.agency_concorrente
     SET excluido_em = now(), excluido_por = v_uid
   WHERE id = p_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (
    v_c.company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
    'agency_concorrente', p_id::text, 'concorrente_excluir',
    jsonb_build_object('nome', v_c.nome, 'nivel_ameaca', v_c.nivel_ameaca),
    jsonb_build_object('excluido_em', now(), 'excluido_por', v_uid, 'motivo', p_motivo));

  RETURN jsonb_build_object('ok', true);
END $function$;

-- grants das funções
REVOKE ALL ON FUNCTION public.fn_agency_concorrente_listar(uuid, uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_agency_concorrente_salvar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_agency_concorrente_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_concorrente_listar(uuid, uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_concorrente_salvar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_concorrente_excluir(uuid, text) TO authenticated;

-- ========================================================================
-- 5) system_screens — origem do dado (RD-98 p3)
-- ========================================================================
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_agency_concorrente_listar','fn_agency_concorrente_salvar','fn_agency_concorrente_excluir'],
       views_consumidas = COALESCE(views_consumidas, ARRAY[]::text[]),
       componentes_principais = ARRAY['BenchmarkView'],
       estado_real = 'ativo',
       modulo = 'pm',
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/benchmark';

-- ========================================================================
-- 6) erp_ajuda_campo — "?" RD-95 (campos, filtros, ações)
-- ========================================================================
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('pm.benchmark.filtro_cliente','/dashboard/pm/benchmark','Benchmark · Filtros','Cliente','Escolha um cliente para ver só os concorrentes mapeados para ele, ou deixe em "Todos".','Foca o radar no mercado de um cliente específico.','Academia Pulso','Esquecer de voltar para "Todos" e achar que não há concorrentes.','pm',10,'publicado'),
 ('pm.benchmark.filtro_ameaca','/dashboard/pm/benchmark','Benchmark · Filtros','Nível de ameaça','Filtra a lista pelo quanto o concorrente ameaça o cliente (baixa, média, alta).','Prioriza quem exige resposta mais rápida.','Alta','—','pm',20,'publicado'),
 ('pm.benchmark.novo','/dashboard/pm/benchmark','Benchmark · Ações','Novo concorrente','Abre o formulário para cadastrar um concorrente que você quer monitorar.','Alimenta o radar competitivo da agência.','—','—','pm',30,'publicado'),
 ('pm.benchmark.editar','/dashboard/pm/benchmark','Benchmark · Ações','Editar','Atualiza os dados de um concorrente já cadastrado.','Mantém o radar atualizado conforme o mercado muda.','—','—','pm',40,'publicado'),
 ('pm.benchmark.excluir','/dashboard/pm/benchmark','Benchmark · Ações','Excluir','Remove o concorrente do radar. A exclusão é rastreável (fica registrado quem excluiu e quando).','Tira do radar quem saiu do mercado, sem perder o histórico.','—','Excluir por engano: fale com o gestor, o registro fica no log de auditoria.','pm',50,'publicado'),
 ('pm.benchmark.cliente','/dashboard/pm/benchmark','Benchmark · Concorrente','Cliente monitorado','Cliente da sua carteira cujo mercado este concorrente disputa (opcional).','Liga o concorrente ao cliente certo no radar.','Clínica Sorriso Vale','Deixar em branco quando o concorrente é específico de um cliente.','pm',100,'publicado'),
 ('pm.benchmark.nome','/dashboard/pm/benchmark','Benchmark · Concorrente','Nome do concorrente','Nome da empresa/marca concorrente que você está monitorando.','Identifica o concorrente no radar.','Studio Vita','Deixar vazio — o nome é obrigatório.','pm',110,'publicado'),
 ('pm.benchmark.segmento','/dashboard/pm/benchmark','Benchmark · Concorrente','Segmento','Área de atuação do concorrente.','Agrupa concorrentes por mercado.','Academia / Fitness','—','pm',120,'publicado'),
 ('pm.benchmark.site','/dashboard/pm/benchmark','Benchmark · Concorrente','Site / rede','Endereço do site ou perfil principal do concorrente.','Acesso rápido para acompanhar o concorrente.','instagram.com/studiovita','Colar o link errado.','pm',130,'publicado'),
 ('pm.benchmark.nivel_ameaca','/dashboard/pm/benchmark','Benchmark · Concorrente','Nível de ameaça','O quanto este concorrente ameaça o cliente: baixa, média ou alta.','Prioriza a atenção da equipe.','Alta','Classificar tudo como alta e perder a priorização.','pm',140,'publicado'),
 ('pm.benchmark.posicionamento','/dashboard/pm/benchmark','Benchmark · Concorrente','Posicionamento','Como o concorrente se posiciona (preço, premium, nicho, etc.).','Ajuda a diferenciar a proposta do cliente.','Premium, foco em experiência','—','pm',150,'publicado'),
 ('pm.benchmark.forcas','/dashboard/pm/benchmark','Benchmark · Concorrente','Forças','Pontos fortes do concorrente.','Mostra onde o cliente precisa reagir.','Marca forte, grande base de seguidores','—','pm',160,'publicado'),
 ('pm.benchmark.fraquezas','/dashboard/pm/benchmark','Benchmark · Concorrente','Fraquezas','Pontos fracos do concorrente.','Revela oportunidades para o cliente avançar.','Atendimento lento, pouca presença digital','—','pm',170,'publicado'),
 ('pm.benchmark.campanhas_observadas','/dashboard/pm/benchmark','Benchmark · Concorrente','Campanhas observadas','Campanhas ou ações recentes do concorrente que você observou.','Mantém um mapa vivo do que o concorrente está fazendo.','Promo de verão 20% off em out/2026','—','pm',180,'publicado'),
 ('pm.benchmark.ultima_observacao','/dashboard/pm/benchmark','Benchmark · Concorrente','Última observação','Data em que você atualizou as informações deste concorrente pela última vez.','Mostra se o radar está atualizado.','02/11/2026','Deixar antiga e tomar decisão com dado velho.','pm',190,'publicado'),
 ('pm.benchmark.observacoes','/dashboard/pm/benchmark','Benchmark · Concorrente','Observações','Anotações livres sobre o concorrente.','Guarda contexto que não cabe nos outros campos.','Abriu segunda unidade no bairro do cliente','—','pm',200,'publicado'),
 ('pm.benchmark.tela','/dashboard/pm/benchmark','Benchmark · Tela','Benchmark de Mercado','Radar competitivo da agência: monitore os concorrentes de cada cliente e as campanhas que eles rodam.','Transforma estratégia em algo tangível — a agência sabe o que o concorrente faz e cria resposta melhor.','—','—','pm',1,'publicado'),
 ('pm.benchmark.kpi_total','/dashboard/pm/benchmark','Benchmark · Indicadores','Concorrentes monitorados','Quantidade total de concorrentes no radar (não excluídos).','Mostra o tamanho do radar competitivo.','12','—','pm',2,'publicado'),
 ('pm.benchmark.kpi_alta','/dashboard/pm/benchmark','Benchmark · Indicadores','Ameaça alta','Quantos concorrentes estão classificados como ameaça alta.','Destaca onde a equipe precisa reagir primeiro.','3','—','pm',3,'publicado'),
 ('pm.benchmark.kpi_clientes','/dashboard/pm/benchmark','Benchmark · Indicadores','Clientes cobertos','Quantos clientes já têm pelo menos um concorrente mapeado.','Indica a cobertura do radar na carteira.','5','—','pm',4,'publicado'),
 ('pm.benchmark.col_nome','/dashboard/pm/benchmark','Benchmark · Colunas','Concorrente','Nome do concorrente monitorado.','Identifica a linha na lista.','—','—','pm',5,'publicado'),
 ('pm.benchmark.col_cliente','/dashboard/pm/benchmark','Benchmark · Colunas','Cliente','Cliente da carteira cujo mercado o concorrente disputa.','Liga o concorrente ao cliente.','—','—','pm',6,'publicado'),
 ('pm.benchmark.col_segmento','/dashboard/pm/benchmark','Benchmark · Colunas','Segmento','Área de atuação do concorrente.','Agrupa por mercado.','—','—','pm',7,'publicado'),
 ('pm.benchmark.col_ameaca','/dashboard/pm/benchmark','Benchmark · Colunas','Ameaça','Nível de ameaça do concorrente (alta/média/baixa).','Prioriza a atenção.','—','—','pm',8,'publicado'),
 ('pm.benchmark.col_ultima','/dashboard/pm/benchmark','Benchmark · Colunas','Última observação','Data da última atualização das informações do concorrente.','Mostra se o radar está atualizado.','—','—','pm',9,'publicado'),
 ('pm.benchmark.col_acoes','/dashboard/pm/benchmark','Benchmark · Colunas','Ações','Editar ou excluir (rastreável) o concorrente.','Mantém o radar em dia.','—','—','pm',10,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status,
  atualizado_em = now();

-- ========================================================================
-- 7) Seed DEMO (idempotente, só na empresa DEMO P&M) — RD-98 p1 vitrine com dado real
-- ========================================================================
DO $seed$
DECLARE v_demo uuid := 'b0700000-0000-4000-a000-000000000002';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_demo AND is_demo) THEN
    RETURN;
  END IF;

  -- Academia Pulso  → concorrente alto
  INSERT INTO public.agency_concorrente
    (company_id, cliente_id, nome, segmento, site, nivel_ameaca, posicionamento, forcas, fraquezas, campanhas_observadas, ultima_observacao, observacoes)
  SELECT v_demo, cl.id, 'Studio Vita Fit', 'Academia / Fitness', 'instagram.com/studiovitafit', 'alta',
         'Premium, foco em experiência e personal', 'Marca forte no bairro, base grande de alunos',
         'Mensalidade cara, atendimento digital fraco', 'Promo "Verão em forma": 1ª mensalidade grátis (out/2026)',
         CURRENT_DATE - 5, 'Abriu unidade a 400 m do cliente.'
    FROM public.agency_clientes cl
   WHERE cl.company_id = v_demo AND cl.nome = 'Academia Pulso' AND cl.excluido_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.agency_concorrente c WHERE c.company_id = v_demo AND c.nome = 'Studio Vita Fit' AND c.excluido_em IS NULL)
   LIMIT 1;

  -- Clínica Sorriso Vale → concorrente médio
  INSERT INTO public.agency_concorrente
    (company_id, cliente_id, nome, segmento, site, nivel_ameaca, posicionamento, forcas, fraquezas, campanhas_observadas, ultima_observacao, observacoes)
  SELECT v_demo, cl.id, 'OdontoMais Vale', 'Odontologia', 'odontomaisvale.com.br', 'media',
         'Rede com preço agressivo', 'Vários pontos de atendimento, tráfego pago constante',
         'Pouca fidelização, avaliações baixas', 'Campanha de clareamento com parcelamento (set/2026)',
         CURRENT_DATE - 12, 'Investindo pesado em anúncios locais.'
    FROM public.agency_clientes cl
   WHERE cl.company_id = v_demo AND cl.nome = 'Clínica Sorriso Vale' AND cl.excluido_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.agency_concorrente c WHERE c.company_id = v_demo AND c.nome = 'OdontoMais Vale' AND c.excluido_em IS NULL)
   LIMIT 1;

  -- Café Serra Azul → concorrente baixo
  INSERT INTO public.agency_concorrente
    (company_id, cliente_id, nome, segmento, site, nivel_ameaca, posicionamento, forcas, fraquezas, campanhas_observadas, ultima_observacao, observacoes)
  SELECT v_demo, cl.id, 'Grão & Prosa', 'Cafeteria', 'instagram.com/graoeprosa', 'baixa',
         'Artesanal, ambiente instagramável', 'Estética forte nas redes',
         'Preço alto, operação pequena', 'Lançamento de cookies autorais (out/2026)',
         CURRENT_DATE - 20, 'Concorrência mais indireta.'
    FROM public.agency_clientes cl
   WHERE cl.company_id = v_demo AND cl.nome = 'Café Serra Azul' AND cl.excluido_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.agency_concorrente c WHERE c.company_id = v_demo AND c.nome = 'Grão & Prosa' AND c.excluido_em IS NULL)
   LIMIT 1;
END $seed$;
