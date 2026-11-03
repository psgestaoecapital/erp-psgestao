-- P&M · Integrações Produtividade (/dashboard/pm/integracoes)
-- Central de conexões PRÓPRIA: a empresa registra quais ferramentas de produtividade estão
-- conectadas (arquivos, redes sociais, avisos, agenda, quadros), com estado real por empresa.
-- Substitui a tela placeholder "previsto" (ModuloPreview) — RD-98 p1: nada de tela morta.
-- ADITIVA: tabela/funções NOVAS, RLS por company_id, REVOKE anon, "desconectar" rastreável (soft-delete + audit_log_global).
-- Nenhum dado de cliente é alterado/apagado. O handshake OAuth/segredos do provedor é etapa posterior:
--   esta tela gerencia o CADASTRO da conexão (conta de referência + estado), não guarda segredo nenhum.
-- RD-100: os nomes abaixo (Drive, agenda, redes, avisos, quadros) são provedores de integração, não sistemas concorrentes.
-- Code: code-desenvolvedor-3

-- ========================================================================
-- 1) TABELA  agency_integracao  (conexões de produtividade por empresa)
-- ========================================================================
CREATE TABLE IF NOT EXISTS public.agency_integracao (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provedor          text NOT NULL,                 -- slug técnico do provedor (drive, meta, avisos, agenda, quadros…)
  conta_ref         text,                          -- conta/identificação exibível que a empresa conectou (e-mail, @perfil, workspace)
  status            text NOT NULL DEFAULT 'conectado'
                      CHECK (status IN ('conectado','pausado')),
  observacoes       text,
  conectado_em      timestamptz NOT NULL DEFAULT now(),
  conectado_por     uuid DEFAULT auth.uid(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  desconectado_em   timestamptz,                   -- soft-delete rastreável (RD-98 p4)
  desconectado_por  uuid
);

COMMENT ON TABLE public.agency_integracao IS
  'P&M · Integrações Produtividade: conexões ativas por empresa (estado conectado/pausado). Desconectar = soft-delete via desconectado_em/por. NÃO guarda segredo de provedor.';

-- Uma conexão ativa por provedor por empresa
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_integracao_ativa
  ON public.agency_integracao (company_id, provedor) WHERE desconectado_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_agency_integracao_company
  ON public.agency_integracao (company_id) WHERE desconectado_em IS NULL;

-- RLS: isolamento por empresa (mesmo padrão das demais agency_*)
ALTER TABLE public.agency_integracao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agency_integracao_access ON public.agency_integracao;
CREATE POLICY agency_integracao_access ON public.agency_integracao
  FOR ALL TO public
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin())
  WITH CHECK ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

REVOKE ALL ON public.agency_integracao FROM anon;
-- escritas só via RPC SECURITY DEFINER; SELECT direto permitido (RLS ainda isola por empresa)
GRANT SELECT ON public.agency_integracao TO authenticated;

-- ========================================================================
-- 2) RPC listar (conexões ativas da empresa)
-- ========================================================================
CREATE OR REPLACE FUNCTION public.fn_agency_integracao_listar(
  p_company_id uuid
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
      SELECT i.id, i.company_id, i.provedor, i.conta_ref, i.status,
             i.observacoes, i.conectado_em, i.atualizado_em
        FROM public.agency_integracao i
       WHERE i.company_id = p_company_id
         AND i.desconectado_em IS NULL
       ORDER BY i.conectado_em
    ) x
  ), '[]'::jsonb);
END $function$;

-- ========================================================================
-- 3) RPC conectar (incluir/reconfigurar a conexão de um provedor)
--    upsert pela conexão ativa (company_id, provedor)
-- ========================================================================
CREATE OR REPLACE FUNCTION public.fn_agency_integracao_conectar(
  p_company_id uuid,
  p_payload jsonb
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_prov   text := NULLIF(btrim(p_payload->>'provedor'),'');
  v_status text := COALESCE(NULLIF(p_payload->>'status',''),'conectado');
  v_id     uuid;
  r        public.agency_integracao;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);
  IF v_prov IS NULL THEN RAISE EXCEPTION 'provedor_obrigatorio'; END IF;
  IF v_status NOT IN ('conectado','pausado') THEN RAISE EXCEPTION 'status_invalido'; END IF;

  SELECT id INTO v_id FROM public.agency_integracao
   WHERE company_id = p_company_id AND provedor = v_prov AND desconectado_em IS NULL;

  IF v_id IS NULL THEN
    INSERT INTO public.agency_integracao (company_id, provedor, conta_ref, status, observacoes)
    VALUES (
      p_company_id, v_prov,
      NULLIF(btrim(p_payload->>'conta_ref'),''),
      v_status,
      NULLIF(btrim(p_payload->>'observacoes'),'')
    ) RETURNING * INTO r;
  ELSE
    UPDATE public.agency_integracao SET
      conta_ref     = NULLIF(btrim(p_payload->>'conta_ref'),''),
      status        = v_status,
      observacoes   = NULLIF(btrim(p_payload->>'observacoes'),''),
      atualizado_em = now()
    WHERE id = v_id AND company_id = p_company_id
    RETURNING * INTO r;
  END IF;

  RETURN to_jsonb(r);
END $function$;

-- ========================================================================
-- 4) RPC desconectar (soft-delete rastreável + audit_log_global) — RD-98 p4
-- ========================================================================
CREATE OR REPLACE FUNCTION public.fn_agency_integracao_desconectar(
  p_id uuid,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_i public.agency_integracao%ROWTYPE;
BEGIN
  SELECT * INTO v_i FROM public.agency_integracao WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'conexão não encontrada'); END IF;
  IF NOT (v_i.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_i.desconectado_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_desconectado', true); END IF;

  UPDATE public.agency_integracao
     SET desconectado_em = now(), desconectado_por = v_uid
   WHERE id = p_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (
    v_i.company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
    'agency_integracao', p_id::text, 'integracao_desconectar',
    jsonb_build_object('provedor', v_i.provedor, 'conta_ref', v_i.conta_ref, 'status', v_i.status),
    jsonb_build_object('desconectado_em', now(), 'desconectado_por', v_uid, 'motivo', p_motivo));

  RETURN jsonb_build_object('ok', true);
END $function$;

-- grants das funções
REVOKE ALL ON FUNCTION public.fn_agency_integracao_listar(uuid)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_agency_integracao_conectar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_agency_integracao_desconectar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_integracao_listar(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_integracao_conectar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_integracao_desconectar(uuid, text) TO authenticated;

-- ========================================================================
-- 5) system_screens — origem do dado (RD-98 p3)
-- ========================================================================
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_agency_integracao_listar','fn_agency_integracao_conectar','fn_agency_integracao_desconectar'],
       views_consumidas = COALESCE(views_consumidas, ARRAY[]::text[]),
       componentes_principais = ARRAY['IntegracoesView'],
       estado_real = 'pronto',
       modulo = 'pm',
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/integracoes';

-- ========================================================================
-- 6) erp_ajuda_campo — "?" RD-95 (indicadores, filtro, ações, campos, colunas)
-- ========================================================================
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('pm.integracoes.tela','/dashboard/pm/integracoes','Integrações · Tela','Integrações Produtividade','Central das ferramentas que a equipe já usa: marque quais estão conectadas à sua empresa e acompanhe o estado de cada uma.','Deixa o sistema como hub central — você sabe, num lugar só, o que está ligado (arquivos, redes, avisos, agenda, quadros).','—','—','pm',1,'publicado'),
 ('pm.integracoes.kpi_conectadas','/dashboard/pm/integracoes','Integrações · Indicadores','Conexões ativas','Quantas ferramentas estão conectadas e em uso agora (não pausadas, não desconectadas).','Mostra de relance o quanto do ecossistema já está integrado.','3','—','pm',2,'publicado'),
 ('pm.integracoes.kpi_pausadas','/dashboard/pm/integracoes','Integrações · Indicadores','Pausadas','Conexões que existem mas estão temporariamente pausadas.','Sinaliza integrações que precisam de atenção para voltar a funcionar.','1','—','pm',3,'publicado'),
 ('pm.integracoes.kpi_disponiveis','/dashboard/pm/integracoes','Integrações · Indicadores','Disponíveis para conectar','Quantas ferramentas do catálogo ainda não foram conectadas.','Mostra o potencial de integração que falta aproveitar.','2','—','pm',4,'publicado'),
 ('pm.integracoes.filtro_estado','/dashboard/pm/integracoes','Integrações · Filtros','Estado','Filtra o catálogo por estado: todas, só conectadas, pausadas ou ainda disponíveis.','Foca a tela no que você quer gerenciar agora.','Conectadas','—','pm',10,'publicado'),
 ('pm.integracoes.conectar','/dashboard/pm/integracoes','Integrações · Ações','Conectar','Registra a conexão de uma ferramenta: informe a conta de referência que você usa nela.','Marca a ferramenta como integrada à sua empresa.','—','Conectar sem informar a conta de referência que identifica o acesso.','pm',20,'publicado'),
 ('pm.integracoes.reconfigurar','/dashboard/pm/integracoes','Integrações · Ações','Reconfigurar','Atualiza a conta de referência, o estado (conectado/pausado) ou as observações de uma conexão existente.','Mantém a conexão em dia quando a conta ou o uso muda.','—','—','pm',30,'publicado'),
 ('pm.integracoes.desconectar','/dashboard/pm/integracoes','Integrações · Ações','Desconectar','Remove a conexão da ferramenta. A ação é rastreável (fica registrado quem desconectou e quando).','Tira do ar uma integração que não se usa mais, sem perder o histórico.','—','Desconectar por engano: o registro fica no log de auditoria e pode ser reconectado.','pm',40,'publicado'),
 ('pm.integracoes.provedor','/dashboard/pm/integracoes','Integrações · Conexão','Ferramenta','Ferramenta de produtividade que você quer conectar (arquivos, redes, avisos, agenda, quadros).','Identifica qual integração está sendo configurada.','Arquivos na nuvem','—','pm',100,'publicado'),
 ('pm.integracoes.conta_ref','/dashboard/pm/integracoes','Integrações · Conexão','Conta de referência','A conta, perfil ou espaço de trabalho que identifica o acesso usado na ferramenta.','Deixa claro QUAL conta está conectada (útil quando há mais de uma).','arquivos@suaempresa.com / @seuperfil','Deixar vazio e depois não saber qual conta foi ligada.','pm',110,'publicado'),
 ('pm.integracoes.status','/dashboard/pm/integracoes','Integrações · Conexão','Estado','Conectado (em uso) ou Pausado (configurado, mas temporariamente parado).','Controla se a integração está ativa sem precisar desconectá-la.','Conectado','—','pm',120,'publicado'),
 ('pm.integracoes.observacoes','/dashboard/pm/integracoes','Integrações · Conexão','Observações','Anotações livres sobre a conexão (quem administra, o que ela alimenta, etc.).','Guarda contexto que ajuda a equipe a entender a integração.','Responsável: Marketing. Alimenta o calendário de posts.','—','pm',130,'publicado'),
 ('pm.integracoes.col_ferramenta','/dashboard/pm/integracoes','Integrações · Colunas','Ferramenta','Nome da ferramenta de produtividade.','Identifica a linha no catálogo.','—','—','pm',5,'publicado'),
 ('pm.integracoes.col_conta','/dashboard/pm/integracoes','Integrações · Colunas','Conta de referência','Conta/perfil conectado à ferramenta.','Mostra qual acesso está em uso.','—','—','pm',6,'publicado'),
 ('pm.integracoes.col_estado','/dashboard/pm/integracoes','Integrações · Colunas','Estado','Conectado, pausado ou disponível para conectar.','Mostra a situação de cada integração.','—','—','pm',7,'publicado'),
 ('pm.integracoes.col_acoes','/dashboard/pm/integracoes','Integrações · Colunas','Ações','Conectar, reconfigurar ou desconectar (rastreável) a ferramenta.','Mantém o hub de integrações em dia.','—','—','pm',8,'publicado')
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

  -- Arquivos na nuvem → conectado
  INSERT INTO public.agency_integracao (company_id, provedor, conta_ref, status, observacoes)
  SELECT v_demo, 'drive', 'arquivos@agenciapulso.com', 'conectado', 'Pasta dos jobs dos clientes acessível pelo sistema.'
  WHERE NOT EXISTS (SELECT 1 FROM public.agency_integracao WHERE company_id = v_demo AND provedor = 'drive' AND desconectado_em IS NULL);

  -- Agenda → conectado
  INSERT INTO public.agency_integracao (company_id, provedor, conta_ref, status, observacoes)
  SELECT v_demo, 'agenda', 'equipe@agenciapulso.com', 'conectado', 'Prazos e gravações sincronizados com a agenda da equipe.'
  WHERE NOT EXISTS (SELECT 1 FROM public.agency_integracao WHERE company_id = v_demo AND provedor = 'agenda' AND desconectado_em IS NULL);

  -- Redes sociais → pausado (configurado, aguardando aprovação de contas)
  INSERT INTO public.agency_integracao (company_id, provedor, conta_ref, status, observacoes)
  SELECT v_demo, 'redes', '@agenciapulso', 'pausado', 'Publicação direta em revisão; métricas voltam ao Health Score.'
  WHERE NOT EXISTS (SELECT 1 FROM public.agency_integracao WHERE company_id = v_demo AND provedor = 'redes' AND desconectado_em IS NULL);
END $seed$;
