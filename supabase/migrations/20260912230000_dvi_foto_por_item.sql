-- ============================================================
-- Oficina Onda 2 · DVI (fundação) — ligar a FOTO ao ITEM do diagnóstico
-- ============================================================
-- Hoje erp_os_registro_foto prende a foto à OS + etapa, não ao item. Por isso só dá pra mostrar
-- "as 17 fotos do carro", não "a foto DA SUA pastilha" — e é a foto DO ITEM que converte (+19% anotada,
-- +30% com 20+ fotos). Esta é a base de tudo na Onda 2 (câmera no item, link público, anotação).
--
-- Aditivo (RD-30/RD-61): as 330 fotos existentes ficam com diagnostico_item_id NULL (continuam "fotos da
-- OS") — SEM backfill (não dá pra adivinhar de qual item é cada foto). anotacao jsonb guarda coordenadas
-- de seta/círculo/retângulo — NUNCA queima na imagem (o original é documento).

ALTER TABLE public.erp_os_registro_foto
  ADD COLUMN IF NOT EXISTS diagnostico_item_id uuid
    REFERENCES public.erp_os_diagnostico_item(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS anotacao jsonb;

CREATE INDEX IF NOT EXISTS idx_os_foto_item
  ON public.erp_os_registro_foto (diagnostico_item_id)
  WHERE diagnostico_item_id IS NOT NULL;

-- fn_oficina_registro_salvar ganha p_diagnostico_item_id. LIÇÃO ca93f795: adicionar parâmetro cria
-- um NOVO overload — então recriamos com o parâmetro novo E dropamos o antigo (6 args). Chamadores
-- atuais (diagnostico/page.tsx, VisaoExecucaoModal — 6 args com p_etapa) caem sem ambiguidade no novo
-- (p_diagnostico_item_id default NULL → foto da OS, comportamento inalterado).
CREATE OR REPLACE FUNCTION public.fn_oficina_registro_salvar(
  p_company_id uuid, p_os_id uuid, p_foto_path text, p_descricao text,
  p_criado_por_nome text DEFAULT NULL::text, p_etapa text DEFAULT 'servico'::text,
  p_diagnostico_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_etapa text := lower(coalesce(NULLIF(trim(p_etapa),''),'servico')); v_item uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF NULLIF(trim(coalesce(p_foto_path,'')),'') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'foto_obrigatoria'); END IF;
  IF NULLIF(trim(coalesce(p_descricao,'')),'') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'descricao_obrigatoria'); END IF;
  IF v_etapa NOT IN ('recepcao','diagnostico','servico') THEN v_etapa := 'servico'; END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id=p_os_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada nesta empresa'); END IF;
  -- item, quando informado, tem de ser desta OS/empresa (senão ignora — foto da OS)
  v_item := NULL;
  IF p_diagnostico_item_id IS NOT NULL THEN
    SELECT id INTO v_item FROM erp_os_diagnostico_item
      WHERE id = p_diagnostico_item_id AND os_id = p_os_id AND company_id = p_company_id;
  END IF;
  INSERT INTO erp_os_registro_foto (company_id, os_id, foto_path, descricao, criado_por, criado_por_nome, etapa, diagnostico_item_id)
  VALUES (p_company_id, p_os_id, p_foto_path, trim(p_descricao), auth.uid(), nullif(p_criado_por_nome,''), v_etapa, v_item)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'diagnostico_item_id', v_item);
END $function$;

-- dropa o overload ANTIGO (6 args) — todos os chamadores caem no novo
DROP FUNCTION IF EXISTS public.fn_oficina_registro_salvar(uuid, uuid, text, text, text, text);
