-- SPEC ANEXO-1 · anexos COM DESCRIÇÃO (proposta · oportunidade · visita). Uma peça, três pedidos.
-- RD-26: molde erp_cliente_arquivos (auditado). Armadilha do logo: o bucket PRECISA de policy de SELECT
-- (o upsert checa existência). Aqui uso UMA policy FOR ALL (padrão projetos-plantas) que cobre os 4 verbos.

-- ── ENTREGA 1 · bucket privado, 50 MB (vídeo precisa de folga) ─────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('crm-anexos', 'crm-anexos', false, 52428800, NULL)
ON CONFLICT (id) DO NOTHING;

-- 4 verbos numa policy só (SELECT/INSERT/UPDATE/DELETE) — inclui o SELECT que faltou no logo.
-- Caminho: {company_id}/{contexto}/{registro_id}/{arquivo} — company_id SEMPRE na 1ª pasta.
DROP POLICY IF EXISTS crm_anexos_rw ON storage.objects;
CREATE POLICY crm_anexos_rw ON storage.objects FOR ALL TO authenticated
  USING      (bucket_id = 'crm-anexos' AND (storage.foldername(name))[1] IN (SELECT get_user_company_ids()::text))
  WITH CHECK (bucket_id = 'crm-anexos' AND (storage.foldername(name))[1] IN (SELECT get_user_company_ids()::text));

-- ── ENTREGA 2 · tabela erp_crm_anexo (molde + vínculos + descrição) ────────────
CREATE TABLE IF NOT EXISTS public.erp_crm_anexo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  proposta_id     uuid REFERENCES public.agency_propostas(id)     ON DELETE CASCADE,
  oportunidade_id uuid REFERENCES public.erp_crm_oportunidade(id) ON DELETE CASCADE,
  visita_id       uuid REFERENCES public.erp_crm_visita(id)       ON DELETE CASCADE,
  tipo            text NOT NULL DEFAULT 'arquivo',   -- 'arquivo' | 'link'
  categoria       text,                              -- foto · video · documento · planta · contrato · outro
  descricao       text,                              -- ⭐ o pedido do CEO
  ordem           int  NOT NULL DEFAULT 1,
  nome_arquivo    text,
  storage_path    text,
  mime_type       text,
  tamanho_bytes   bigint,
  hash_sha256     text,
  url             text,
  enviado_por     uuid,
  enviado_em      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT chk_um_vinculo CHECK (
    (proposta_id IS NOT NULL)::int + (oportunidade_id IS NOT NULL)::int + (visita_id IS NOT NULL)::int = 1),
  CONSTRAINT chk_arquivo_ou_link CHECK (
    (tipo = 'arquivo' AND storage_path IS NOT NULL) OR (tipo = 'link' AND url IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_crm_anexo_proposta ON public.erp_crm_anexo (proposta_id)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_crm_anexo_oport    ON public.erp_crm_anexo (oportunidade_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_crm_anexo_visita   ON public.erp_crm_anexo (visita_id)       WHERE deleted_at IS NULL;
ALTER TABLE public.erp_crm_anexo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_crm_anexo_rw ON public.erp_crm_anexo;
CREATE POLICY erp_crm_anexo_rw ON public.erp_crm_anexo FOR ALL
  USING      (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- ── ENTREGA 3 · RPCs ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_crm_anexo_adicionar(
  p_company_id uuid, p_vinculo_tipo text, p_vinculo_id uuid,
  p_tipo text DEFAULT 'arquivo', p_categoria text DEFAULT NULL, p_descricao text DEFAULT NULL,
  p_nome text DEFAULT NULL, p_path text DEFAULT NULL, p_mime text DEFAULT NULL,
  p_tamanho bigint DEFAULT NULL, p_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid; v_ord int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_vinculo_tipo NOT IN ('proposta','oportunidade','visita') THEN RETURN jsonb_build_object('ok', false, 'erro', 'vinculo_invalido'); END IF;
  IF p_tipo = 'arquivo' AND NULLIF(btrim(COALESCE(p_path,'')),'') IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_arquivo'); END IF;
  IF p_tipo = 'link'    AND NULLIF(btrim(COALESCE(p_url,'')),'')  IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_url'); END IF;

  SELECT COALESCE(max(ordem),0)+1 INTO v_ord FROM erp_crm_anexo
   WHERE deleted_at IS NULL AND ((p_vinculo_tipo='proposta' AND proposta_id=p_vinculo_id)
      OR (p_vinculo_tipo='oportunidade' AND oportunidade_id=p_vinculo_id)
      OR (p_vinculo_tipo='visita' AND visita_id=p_vinculo_id));

  INSERT INTO erp_crm_anexo (company_id, proposta_id, oportunidade_id, visita_id, tipo, categoria, descricao, ordem,
      nome_arquivo, storage_path, mime_type, tamanho_bytes, url, enviado_por)
  VALUES (p_company_id,
      CASE WHEN p_vinculo_tipo='proposta'     THEN p_vinculo_id END,
      CASE WHEN p_vinculo_tipo='oportunidade' THEN p_vinculo_id END,
      CASE WHEN p_vinculo_tipo='visita'       THEN p_vinculo_id END,
      COALESCE(p_tipo,'arquivo'), NULLIF(btrim(COALESCE(p_categoria,'')),''), NULLIF(btrim(COALESCE(p_descricao,'')),''), v_ord,
      NULLIF(btrim(COALESCE(p_nome,'')),''), NULLIF(btrim(COALESCE(p_path,'')),''), NULLIF(btrim(COALESCE(p_mime,'')),''),
      p_tamanho, NULLIF(btrim(COALESCE(p_url,'')),''), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'ordem', v_ord);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_crm_anexo_editar(p_anexo_id uuid, p_descricao text DEFAULT NULL, p_categoria text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_crm_anexo WHERE id = p_anexo_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE erp_crm_anexo SET descricao = NULLIF(btrim(COALESCE(p_descricao,'')),''),
                           categoria = COALESCE(NULLIF(btrim(COALESCE(p_categoria,'')),''), categoria)
   WHERE id = p_anexo_id;
  RETURN jsonb_build_object('ok', true);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_crm_anexo_excluir(p_anexo_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_crm_anexo WHERE id = p_anexo_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE erp_crm_anexo SET deleted_at = now() WHERE id = p_anexo_id;   -- soft-delete (RD-30); arquivo fica no bucket
  RETURN jsonb_build_object('ok', true);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_crm_anexos_listar(p_vinculo_tipo text, p_vinculo_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT jsonb_build_object('ok', true, 'anexos', COALESCE(jsonb_agg(a ORDER BY (a->>'ordem')::int, a->>'enviado_em'), '[]'::jsonb))
  FROM (
    SELECT jsonb_build_object('id', x.id, 'tipo', x.tipo, 'categoria', x.categoria, 'descricao', x.descricao,
      'ordem', x.ordem, 'nome_arquivo', x.nome_arquivo, 'storage_path', x.storage_path, 'mime_type', x.mime_type,
      'tamanho_bytes', x.tamanho_bytes, 'url', x.url, 'enviado_em', x.enviado_em) AS a
    FROM erp_crm_anexo x
    WHERE x.deleted_at IS NULL AND x.company_id IN (SELECT get_user_company_ids())
      AND ((p_vinculo_tipo='proposta' AND x.proposta_id=p_vinculo_id)
        OR (p_vinculo_tipo='oportunidade' AND x.oportunidade_id=p_vinculo_id)
        OR (p_vinculo_tipo='visita' AND x.visita_id=p_vinculo_id))
  ) t;
$fn$;

REVOKE ALL ON FUNCTION public.fn_crm_anexo_adicionar(uuid,text,uuid,text,text,text,text,text,text,bigint,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_crm_anexo_adicionar(uuid,text,uuid,text,text,text,text,text,text,bigint,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_crm_anexo_editar(uuid,text,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_crm_anexo_editar(uuid,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_crm_anexo_excluir(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_crm_anexo_excluir(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_crm_anexos_listar(text,uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_crm_anexos_listar(text,uuid) TO authenticated, service_role;
