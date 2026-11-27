-- Portal do cliente da obra (H9) · Recontagem 95 · SLICE 1 — VISIBILIDADE POR PASTA
-- Tela 314/326 (blueprint 310-326 V30) · gap essencial [critério h]: o gestor precisa escolher
-- QUAIS pastas de documentos o cliente vê no portal, com padrão OCULTO. Hoje a tela só convida/revoga.
-- Code: code-desenvolvedor-3
--
-- CONCEITO: os documentos da obra ficam em public.erp_obra_arquivos, agrupados pela coluna `tipo`
-- (termo_entrega, art_rrt, as_built, laudo, foto, nota, outro...) — é a "pasta". Esta fatia adiciona,
-- POR OBRA e POR TIPO, um flag `visivel` (padrão FALSE = oculto). A query do portal (fn_obra_portal_documentos)
-- só devolve documento de pasta marcada como visível. A prévia da tela de gestão mostra exatamente isso.
--
-- SEGURANÇA/LGPD (crítico): nada vira visível por acidente — ausência de linha = OCULTO. O cliente nunca
-- vê custo/margem; o portal só expõe metadados do arquivo (nome, tipo, tamanho), nunca o caminho privado.
--   • Quem CONFIGURA (listar/set) = só a EQUIPE da empresa dona (get_user_company_ids/is_admin).
--   • Quem LÊ no portal (fn_obra_portal_documentos) = cliente convidado OU equipe (fn_obra_portal_pode_ver),
--     e só de pastas com visivel=true.
--   • RLS por company_id, REVOKE anon, trigger que impede company_id divergente da obra (anti-spoof).
-- ADITIVA e idempotente: tabela/trigger/funções NOVOS; nenhum UPDATE/DELETE em dado de cliente.
-- RD-52: arquivo em supabase/migrations + PR, versão acima da main (faixa code-desenvolvedor-3 :35–:44).

-- ── 1) Tabela de visibilidade da pasta no portal ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_obra_portal_pasta_visivel (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  obra_id        uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  tipo           text NOT NULL,
  visivel        boolean NOT NULL DEFAULT false,
  atualizado_por uuid REFERENCES public.users(id),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_obra_portal_pasta_visivel_uniq UNIQUE (obra_id, tipo),
  CONSTRAINT erp_obra_portal_pasta_visivel_tipo_chk CHECK (btrim(tipo) <> '')
);

COMMENT ON TABLE public.erp_obra_portal_pasta_visivel IS
  'Portal do cliente (H9) SLICE 1: por obra+tipo (pasta de documentos), se o cliente vê aquela pasta no portal. Ausência de linha = OCULTO (padrão seguro). Só a equipe da empresa dona configura.';

CREATE INDEX IF NOT EXISTS idx_portal_pasta_visivel_obra    ON public.erp_obra_portal_pasta_visivel (obra_id);
CREATE INDEX IF NOT EXISTS idx_portal_pasta_visivel_empresa ON public.erp_obra_portal_pasta_visivel (company_id);

-- ── 2) Anti-spoof: company_id tem de bater com a empresa da obra ────────────────
CREATE OR REPLACE FUNCTION public.trg_obra_portal_pasta_visivel_empresa()
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
REVOKE ALL ON FUNCTION public.trg_obra_portal_pasta_visivel_empresa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_obra_portal_pasta_visivel_empresa ON public.erp_obra_portal_pasta_visivel;
CREATE TRIGGER trg_obra_portal_pasta_visivel_empresa
  BEFORE INSERT OR UPDATE OF company_id, obra_id ON public.erp_obra_portal_pasta_visivel
  FOR EACH ROW EXECUTE FUNCTION public.trg_obra_portal_pasta_visivel_empresa();

-- ── 3) RLS: só a equipe da empresa dona ────────────────────────────────────────
ALTER TABLE public.erp_obra_portal_pasta_visivel ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_obra_portal_pasta_visivel FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS erp_obra_portal_pasta_visivel_empresa ON public.erp_obra_portal_pasta_visivel;
CREATE POLICY erp_obra_portal_pasta_visivel_empresa ON public.erp_obra_portal_pasta_visivel FOR ALL TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

GRANT SELECT, INSERT, UPDATE ON public.erp_obra_portal_pasta_visivel TO authenticated;
GRANT ALL ON public.erp_obra_portal_pasta_visivel TO service_role;

-- ── 4) Listar as pastas da obra (equipe) com a visibilidade atual ──────────────
-- Junta o catálogo padrão de tipos com os tipos que a obra REALMENTE tem em erp_obra_arquivos,
-- e devolve, por tipo: quantos documentos existem e se está visível (default false = oculto).
CREATE OR REPLACE FUNCTION public.fn_obra_portal_pastas_listar(p_obra_id uuid)
RETURNS TABLE (
  tipo       text,
  qtd_docs   integer,
  visivel    boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT o.company_id INTO v_company FROM public.projetos_obras o
   WHERE o.id = p_obra_id AND o.deleted_at IS NULL;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Obra não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT ((v_company IN (SELECT public.get_user_company_ids())) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Sem permissão para esta obra.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH tipos AS (
    -- catálogo padrão (mesma lista da tela de encerramento) + os tipos presentes na obra
    SELECT t AS tipo FROM unnest(ARRAY['termo_entrega','art_rrt','as_built','laudo','foto','nota','outro']) AS t
    UNION
    SELECT a.tipo FROM public.erp_obra_arquivos a
     WHERE a.obra_id = p_obra_id AND a.deleted_at IS NULL AND btrim(COALESCE(a.tipo,'')) <> ''
  ),
  cont AS (
    SELECT a.tipo, count(*)::int AS qtd
    FROM public.erp_obra_arquivos a
    WHERE a.obra_id = p_obra_id AND a.deleted_at IS NULL
    GROUP BY a.tipo
  )
  SELECT tp.tipo,
         COALESCE(c.qtd, 0) AS qtd_docs,
         COALESCE(v.visivel, false) AS visivel
  FROM tipos tp
  LEFT JOIN cont c ON c.tipo = tp.tipo
  LEFT JOIN public.erp_obra_portal_pasta_visivel v ON v.obra_id = p_obra_id AND v.tipo = tp.tipo
  ORDER BY (COALESCE(c.qtd,0) = 0), tp.tipo;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_obra_portal_pastas_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_portal_pastas_listar(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_obra_portal_pastas_listar(uuid) IS
  'Portal do cliente SLICE 1: pastas (tipos) de documento da obra com contagem e se estão visíveis ao cliente. Só a equipe da empresa dona.';

-- ── 5) Definir a visibilidade de uma pasta (equipe) ────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obra_portal_pasta_set(p_obra_id uuid, p_tipo text, p_visivel boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_tipo    text := btrim(COALESCE(p_tipo, ''));
BEGIN
  IF v_tipo = '' THEN
    RAISE EXCEPTION 'Informe a pasta (tipo de documento).' USING ERRCODE = '22023';
  END IF;
  IF p_visivel IS NULL THEN
    RAISE EXCEPTION 'Informe se a pasta fica visível ou oculta.' USING ERRCODE = '22023';
  END IF;

  SELECT o.company_id INTO v_company FROM public.projetos_obras o
   WHERE o.id = p_obra_id AND o.deleted_at IS NULL;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Obra não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT ((v_company IN (SELECT public.get_user_company_ids())) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Sem permissão para esta obra.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.erp_obra_portal_pasta_visivel (company_id, obra_id, tipo, visivel, atualizado_por, atualizado_em)
  VALUES (v_company, p_obra_id, v_tipo, p_visivel, auth.uid(), now())
  ON CONFLICT (obra_id, tipo) DO UPDATE
    SET visivel = EXCLUDED.visivel,
        atualizado_por = auth.uid(),
        atualizado_em = now();
END;
$$;
REVOKE ALL ON FUNCTION public.fn_obra_portal_pasta_set(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_portal_pasta_set(uuid, text, boolean) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_obra_portal_pasta_set(uuid, text, boolean) IS
  'Portal do cliente SLICE 1: liga/desliga a visibilidade de uma pasta (tipo) de documento ao cliente. Padrão é OCULTO. Só a equipe da empresa dona.';

-- ── 6) Documentos visíveis no portal (cliente OU prévia da equipe) ─────────────
-- Guardado por fn_obra_portal_pode_ver: cliente convidado ativo OU equipe da empresa dona.
-- Só devolve documento de pasta marcada visivel=true. Nunca expõe o storage_path (caminho privado).
CREATE OR REPLACE FUNCTION public.fn_obra_portal_documentos(p_obra_id uuid)
RETURNS TABLE (
  id           uuid,
  tipo         text,
  nome_arquivo text,
  mime_type    text,
  tamanho_bytes bigint,
  enviado_em   timestamptz
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
  SELECT a.id, a.tipo, a.nome_arquivo, a.mime_type, a.tamanho_bytes, a.enviado_em
  FROM public.erp_obra_arquivos a
  JOIN public.erp_obra_portal_pasta_visivel v
    ON v.obra_id = a.obra_id AND v.tipo = a.tipo AND v.visivel = true
  WHERE a.obra_id = p_obra_id AND a.deleted_at IS NULL
  ORDER BY a.enviado_em DESC NULLS LAST, a.nome_arquivo;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_obra_portal_documentos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_portal_documentos(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_obra_portal_documentos(uuid) IS
  'Portal do cliente SLICE 1: documentos da obra de pastas marcadas visíveis. Guardado por fn_obra_portal_pode_ver (cliente ou equipe). Nunca devolve o caminho privado do storage.';

-- ── 7) RD-95: chaves de ajuda das novas superfícies ────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/projetos/obras/[id]/portal-cliente', 'projetos', 'publicado'
FROM (VALUES
  ('obra.portal.pastas', 'Portal do cliente', 'Pastas que o cliente vê',
   'Marque quais pastas de documentos (termo de entrega, ART/RRT, as built, laudos, fotos…) o cliente enxerga no portal desta obra.',
   'Dá ao cliente só o que você quer compartilhar. O padrão é OCULTO: nada aparece no portal até você marcar a pasta como visível. O cliente nunca vê custo, margem nem documento de outra obra.',
   'Deixar “Fotos” e “Laudo” visíveis para o cliente acompanhar, e manter “Nota / documento” oculto.',
   'Achar que o cliente já vê os documentos: por segurança tudo começa oculto. Se a pasta não estiver marcada, o cliente não vê nenhum arquivo dela.',
   60),
  ('obra.portal.pasta_visivel', 'Portal do cliente', 'Visível para o cliente',
   'Ligue para o cliente ver os documentos desta pasta no portal; desligue para ocultar.',
   'Controla pasta por pasta o que o cliente acessa. A mudança vale na hora para o cliente convidado.',
   'Ligar a pasta “As built” quando a obra encerra, para o cliente baixar o as built.',
   'Ligar uma pasta com documento interno que não deveria ir ao cliente. Confira o conteúdo antes de deixar visível.',
   61),
  ('obra.portal.documentos', 'Portal do cliente', 'Documentos no portal',
   'Esta é a lista de documentos que o cliente vê — só das pastas que você marcou como visíveis.',
   'Confere, na prévia, exatamente o que o cliente baixa. Se estiver vazio, nenhuma pasta com documento está visível ainda.',
   'Depois de marcar “Fotos” como visível, os registros de foto aparecem aqui como o cliente vê.',
   'Esperar ver aqui um documento de pasta oculta: só entra o de pasta visível.',
   62)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
