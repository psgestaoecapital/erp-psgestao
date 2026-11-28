-- Portal do cliente da obra (H9) · Recontagem 95 · SLICE 2 — APROVAÇÕES DO CLIENTE
-- Tela 314/326 (blueprint 310-326 V30) · gap essencial [critério h]: o gestor não tem onde
-- acompanhar/registrar as aprovações do cliente (orçamento, alteração, medição, serviço extra)
-- com data, autor e conteúdo, e o cliente não tem como aprovar no portal com rastro.
-- Code: code-desenvolvedor-3
--
-- CONCEITO: a equipe REGISTRA um pedido de aprovação da obra (tipo + título + descrição + valor
-- opcional). O cliente convidado VÊ o pedido no portal e DECIDE (aprova/recusa) com comentário —
-- tudo com rastro (quem criou, quem decidiu, quando). Nada do financeiro interno vaza: o cliente
-- só vê título/descrição/valor do pedido, nunca custo/margem nem pedido de outra obra.
--
-- SEGURANÇA/LGPD:
--   • Quem REGISTRA / EXCLUI = só a EQUIPE da empresa dona (get_user_company_ids/is_admin).
--   • Quem LISTA e quem DECIDE no portal = cliente convidado OU equipe (fn_obra_portal_pode_ver).
--   • RLS por company_id, REVOKE anon, trigger anti-spoof (company_id tem de bater com a obra).
--   • RD-98 pilar 4: exclusão rastreável (soft-delete deleted_at), nunca DELETE físico.
-- ADITIVA e idempotente: tabela/trigger/funções NOVOS; nenhum UPDATE/DELETE em dado de cliente.
-- RD-52: arquivo em supabase/migrations + PR, versão acima da main (faixa code-desenvolvedor-3 :35–:44).

-- ── 1) Tabela de pedidos de aprovação do portal ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_portal_aprovacao (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  obra_id             uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  tipo                text NOT NULL,
  titulo              text NOT NULL,
  descricao           text,
  valor_referencia    numeric(14,2),
  status              text NOT NULL DEFAULT 'pendente',
  criado_por          uuid REFERENCES public.users(id),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  decidido_por        uuid REFERENCES public.users(id),
  decidido_em         timestamptz,
  decisao_comentario  text,
  deleted_at          timestamptz,
  CONSTRAINT erp_portal_aprovacao_tipo_chk
    CHECK (tipo IN ('orcamento','alteracao','medicao','servico_extra')),
  CONSTRAINT erp_portal_aprovacao_status_chk
    CHECK (status IN ('pendente','aprovado','recusado')),
  CONSTRAINT erp_portal_aprovacao_titulo_chk CHECK (btrim(titulo) <> '')
);

COMMENT ON TABLE public.erp_portal_aprovacao IS
  'Portal do cliente (H9) SLICE 2: pedidos de aprovação da obra (orçamento/alteração/medição/serviço extra) que a equipe registra e o cliente convidado aprova/recusa no portal, com rastro. RLS por empresa; cliente age via RPC SECURITY DEFINER guardada por fn_obra_portal_pode_ver.';

CREATE INDEX IF NOT EXISTS idx_portal_aprovacao_obra    ON public.erp_portal_aprovacao (obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portal_aprovacao_empresa ON public.erp_portal_aprovacao (company_id);
CREATE INDEX IF NOT EXISTS idx_portal_aprovacao_status  ON public.erp_portal_aprovacao (obra_id, status) WHERE deleted_at IS NULL;

-- ── 2) Anti-spoof: company_id tem de bater com a empresa da obra ────────────────
CREATE OR REPLACE FUNCTION public.trg_portal_aprovacao_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = NEW.obra_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Obra % não encontrada', NEW.obra_id;
  END IF;
  IF NEW.company_id <> v_company THEN
    RAISE EXCEPTION 'company_id (%) não corresponde à empresa da obra (%)', NEW.company_id, v_company;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_portal_aprovacao_empresa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_portal_aprovacao_empresa ON public.erp_portal_aprovacao;
CREATE TRIGGER trg_portal_aprovacao_empresa
  BEFORE INSERT OR UPDATE OF company_id, obra_id ON public.erp_portal_aprovacao
  FOR EACH ROW EXECUTE FUNCTION public.trg_portal_aprovacao_empresa();

-- ── 3) RLS: só a equipe da empresa dona (o cliente age por RPC SECURITY DEFINER) ─
ALTER TABLE public.erp_portal_aprovacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_portal_aprovacao FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS erp_portal_aprovacao_empresa ON public.erp_portal_aprovacao;
CREATE POLICY erp_portal_aprovacao_empresa ON public.erp_portal_aprovacao FOR ALL TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

GRANT SELECT, INSERT, UPDATE ON public.erp_portal_aprovacao TO authenticated;
GRANT ALL ON public.erp_portal_aprovacao TO service_role;

-- ── 4) Listar pedidos de aprovação (equipe OU cliente convidado) ───────────────
-- Guardado por fn_obra_portal_pode_ver: ambos veem a MESMA lista (transparência). Nunca expõe
-- custo/margem: só título/descrição/valor do próprio pedido.
CREATE OR REPLACE FUNCTION public.fn_obra_portal_aprovacoes_listar(p_obra_id uuid)
RETURNS TABLE (
  id                 uuid,
  tipo               text,
  titulo             text,
  descricao          text,
  valor_referencia   numeric,
  status             text,
  criado_por_nome    text,
  criado_em          timestamptz,
  decidido_por_nome  text,
  decidido_em        timestamptz,
  decisao_comentario text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.fn_obra_portal_pode_ver(p_obra_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta obra' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.id, a.tipo, a.titulo, a.descricao, a.valor_referencia, a.status,
         uc.full_name, a.criado_em, ud.full_name, a.decidido_em, a.decisao_comentario
  FROM public.erp_portal_aprovacao a
  LEFT JOIN public.users uc ON uc.id = a.criado_por
  LEFT JOIN public.users ud ON ud.id = a.decidido_por
  WHERE a.obra_id = p_obra_id AND a.deleted_at IS NULL
  ORDER BY
    CASE a.status WHEN 'pendente' THEN 0 ELSE 1 END,
    a.criado_em DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_obra_portal_aprovacoes_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_portal_aprovacoes_listar(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_obra_portal_aprovacoes_listar(uuid) IS
  'Portal do cliente SLICE 2: lista os pedidos de aprovação da obra (pendentes primeiro). Guardado por fn_obra_portal_pode_ver (cliente ou equipe). Mesma lista para os dois lados.';

-- ── 5) Registrar pedido de aprovação (só a equipe da empresa dona) ─────────────
CREATE OR REPLACE FUNCTION public.fn_obra_portal_aprovacao_registrar(
  p_obra_id  uuid,
  p_tipo     text,
  p_titulo   text,
  p_descricao text DEFAULT NULL,
  p_valor    numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_tipo    text := btrim(COALESCE(p_tipo, ''));
  v_titulo  text := btrim(COALESCE(p_titulo, ''));
  v_id      uuid;
BEGIN
  IF v_tipo NOT IN ('orcamento','alteracao','medicao','servico_extra') THEN
    RAISE EXCEPTION 'Tipo inválido. Use orçamento, alteração, medição ou serviço extra.' USING ERRCODE = '22023';
  END IF;
  IF v_titulo = '' THEN
    RAISE EXCEPTION 'Informe um título para o pedido de aprovação.' USING ERRCODE = '22023';
  END IF;

  SELECT o.company_id INTO v_company FROM public.projetos_obras o
   WHERE o.id = p_obra_id AND o.deleted_at IS NULL;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Obra não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT ((v_company IN (SELECT public.get_user_company_ids())) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Sem permissão para esta obra.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.erp_portal_aprovacao
    (company_id, obra_id, tipo, titulo, descricao, valor_referencia, status, criado_por, criado_em)
  VALUES
    (v_company, p_obra_id, v_tipo, v_titulo, NULLIF(btrim(COALESCE(p_descricao,'')),''), p_valor, 'pendente', auth.uid(), now())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_obra_portal_aprovacao_registrar(uuid, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_portal_aprovacao_registrar(uuid, text, text, text, numeric) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_obra_portal_aprovacao_registrar(uuid, text, text, text, numeric) IS
  'Portal do cliente SLICE 2: a equipe registra um pedido de aprovação (pendente) da obra. Só a equipe da empresa dona.';

-- ── 6) Decidir pedido no portal (cliente convidado OU equipe) ──────────────────
-- Guardado por fn_obra_portal_pode_ver na obra do pedido. Só decide pedido PENDENTE; grava rastro.
CREATE OR REPLACE FUNCTION public.fn_obra_portal_aprovacao_decidir(
  p_aprovacao_id uuid,
  p_decisao      text,
  p_comentario   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_obra    uuid;
  v_status  text;
  v_novo    text;
BEGIN
  v_novo := CASE btrim(lower(COALESCE(p_decisao,'')))
              WHEN 'aprovado' THEN 'aprovado'
              WHEN 'aprovar'  THEN 'aprovado'
              WHEN 'recusado' THEN 'recusado'
              WHEN 'recusar'  THEN 'recusado'
              ELSE NULL END;
  IF v_novo IS NULL THEN
    RAISE EXCEPTION 'Decisão inválida. Use aprovar ou recusar.' USING ERRCODE = '22023';
  END IF;

  SELECT obra_id, status INTO v_obra, v_status
    FROM public.erp_portal_aprovacao
   WHERE id = p_aprovacao_id AND deleted_at IS NULL;
  IF v_obra IS NULL THEN
    RAISE EXCEPTION 'Pedido de aprovação não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.fn_obra_portal_pode_ver(v_obra) THEN
    RAISE EXCEPTION 'Sem acesso a esta obra' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'pendente' THEN
    RAISE EXCEPTION 'Este pedido já foi decidido (%).', v_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.erp_portal_aprovacao
     SET status = v_novo,
         decidido_por = auth.uid(),
         decidido_em = now(),
         decisao_comentario = NULLIF(btrim(COALESCE(p_comentario,'')),'')
   WHERE id = p_aprovacao_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_obra_portal_aprovacao_decidir(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_portal_aprovacao_decidir(uuid, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_obra_portal_aprovacao_decidir(uuid, text, text) IS
  'Portal do cliente SLICE 2: o cliente convidado (ou a equipe) aprova/recusa um pedido PENDENTE no portal, com rastro (decidido_por/decidido_em/comentário). Guardado por fn_obra_portal_pode_ver.';

-- ── 7) Excluir pedido (RD-98 pilar 4: soft-delete rastreável, só a equipe) ─────
CREATE OR REPLACE FUNCTION public.fn_obra_portal_aprovacao_excluir(p_aprovacao_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT company_id INTO v_company
    FROM public.erp_portal_aprovacao
   WHERE id = p_aprovacao_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Pedido de aprovação não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT ((v_company IN (SELECT public.get_user_company_ids())) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Sem permissão para excluir este pedido.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.erp_portal_aprovacao
     SET deleted_at = now()
   WHERE id = p_aprovacao_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_obra_portal_aprovacao_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_portal_aprovacao_excluir(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_obra_portal_aprovacao_excluir(uuid) IS
  'Portal do cliente SLICE 2: exclusão rastreável (RD-98 pilar 4, soft-delete) de um pedido de aprovação. Só a equipe da empresa dona.';

-- ── 8) RD-95: chaves de ajuda das novas superfícies ────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/projetos/obras/[id]/portal-cliente', 'projetos', 'publicado'
FROM (VALUES
  ('obra.portal.aprovacoes', 'Portal do cliente', 'Aprovações do cliente',
   'Acompanhe aqui os pedidos de aprovação que o cliente responde no portal: orçamento, alteração de escopo, medição e serviço extra.',
   'Dá rastro do aceite do cliente (quem aprovou/recusou, quando e com qual comentário). O cliente convidado vê os pedidos no portal e decide por lá; você vê a mesma lista com o status.',
   'Registrar “Medição nº 3” para o cliente aprovar antes de faturar.',
   'Esperar que o cliente aprove sem registrar o pedido: ele só decide o que você registrar aqui.',
   70),
  ('obra.portal.aprovacao_tipo', 'Portal do cliente', 'Tipo do pedido',
   'Escolha o que o cliente vai aprovar: orçamento, alteração (de escopo), medição ou serviço extra.',
   'Organiza os pedidos por natureza e ajuda o cliente a entender o que está aprovando.',
   'Tipo “Serviço extra” para uma demanda fora do contrato original.',
   'Usar sempre “orçamento”: escolha o tipo certo para o histórico ficar claro.',
   71),
  ('obra.portal.aprovacao_titulo', 'Portal do cliente', 'Título e descrição',
   'Dê um título curto e, se quiser, uma descrição e o valor de referência do que o cliente aprova.',
   'É o que o cliente lê no portal para decidir. Seja claro: ele aprova exatamente isto.',
   'Título “Alteração de revestimento – fachada”, valor R$ 12.500,00.',
   'Título vago (“aprovação 1”): o cliente não entende o que está aceitando.',
   72),
  ('obra.portal.aprovacao_status', 'Portal do cliente', 'Status da aprovação',
   'Mostra se o pedido está pendente, aprovado ou recusado pelo cliente.',
   'Você sabe na hora o que o cliente já respondeu, com a data e o comentário da decisão.',
   'Pendente até o cliente decidir; depois “Aprovado em 27/11 por Fulano”.',
   'Faturar antes de o status virar “aprovado”: espere o aceite do cliente.',
   73)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

-- Chave da superfície do PORTAL do cliente (rota /portal/obras/[id]).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES (
  'portal.obras.aprovacoes', 'Portal da obra', 'Aprovações',
  'Aqui a construtora pede o seu aceite de itens da obra: orçamento, medição, alteração de escopo ou serviço extra.',
  'Você aprova ou recusa cada pedido, com registro de data e do seu comentário. Enquanto não decide, o pedido fica “Aguardando você”.',
  'Aprovar a “Medição nº 3” para a construtora seguir com o faturamento.',
  'Recusar sem comentário quando há uma dúvida: escreva o motivo para a equipe entender e ajustar.',
  40, '/portal/obras/[id]', 'projetos', 'publicado'
)
ON CONFLICT (chave) DO NOTHING;
