-- Hub · Gestão de Obras · Encerramento (H8 · HBF-7.x) — Bucket privado dos documentos da obra.
-- Fatia seguinte da aba Encerramento: o STORAGE privado para os anexos de erp_obra_arquivos (#3752),
-- cujo storage_path usa o prefixo 'obra_id/...'. Esta PR só ACRESCENTA o bucket e as policies de
-- storage; a tabela (dados) está na #3752 e a aba de UI entra em PR própria — nada aqui bloqueia aquela.
--
-- Espelha o padrão JÁ PROVADO do bucket 'compliance-pausas' (NR-36, em produção): bucket privado +
-- policies por empresa, SEM policy de DELETE (exclusão é soft, por deleted_at na tabela; o arquivo
-- permanece como trilha → RD-30, "exclusão rastreável"). ADITIVA: bucket NOVO, nenhuma policy existente
-- é tocada, REVOKE anon implícito (policies só para 'authenticated').
--
-- Isolamento (RD-38, provado no dado): o 1º segmento do path é o obra_id; cada obra pertence a UMA
-- empresa (projetos_obras.company_id). A policy casa o prefixo com a obra e exige que a empresa da obra
-- esteja entre as do usuário (get_user_company_ids) — um usuário nunca alcança arquivo de obra de outra
-- empresa. Comparação por texto (o.id::text = split_part(name,'/',1)) evita erro de cast em path inválido.
-- Code: desenvolvedor_5_g

-- 1 · bucket privado (público=false). Idempotente.
INSERT INTO storage.buckets (id, name, public)
VALUES ('obra-documentos', 'obra-documentos', false)
ON CONFLICT (id) DO NOTHING;

-- 2 · policies por empresa (via obra_id no prefixo do path). Sem DELETE (soft-delete na tabela).
DROP POLICY IF EXISTS obra_docs_select ON storage.objects;
CREATE POLICY obra_docs_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'obra-documentos' AND (
      is_admin() OR EXISTS (
        SELECT 1 FROM public.projetos_obras o
        WHERE o.id::text = split_part(storage.objects.name, '/', 1)
          AND o.company_id IN (SELECT get_user_company_ids())
      )
    )
  );

DROP POLICY IF EXISTS obra_docs_insert ON storage.objects;
CREATE POLICY obra_docs_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'obra-documentos' AND (
      is_admin() OR EXISTS (
        SELECT 1 FROM public.projetos_obras o
        WHERE o.id::text = split_part(storage.objects.name, '/', 1)
          AND o.company_id IN (SELECT get_user_company_ids())
      )
    )
  );

DROP POLICY IF EXISTS obra_docs_update ON storage.objects;
CREATE POLICY obra_docs_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'obra-documentos' AND (
      is_admin() OR EXISTS (
        SELECT 1 FROM public.projetos_obras o
        WHERE o.id::text = split_part(storage.objects.name, '/', 1)
          AND o.company_id IN (SELECT get_user_company_ids())
      )
    )
  )
  WITH CHECK (
    bucket_id = 'obra-documentos' AND (
      is_admin() OR EXISTS (
        SELECT 1 FROM public.projetos_obras o
        WHERE o.id::text = split_part(storage.objects.name, '/', 1)
          AND o.company_id IN (SELECT get_user_company_ids())
      )
    )
  );
