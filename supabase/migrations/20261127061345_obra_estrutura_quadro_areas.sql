-- Hub · Gestão de Obras · Tela 314 — Tabela/Quadro de áreas da obra (blueprint vivo hub_projetos, requisito "ausente")
-- "Tabela de áreas da obra é cadastro da obra (por pavimento/unidade: área privativa, área comum, vagas simples e dupla)."
-- ADITIVO e sem colisão: NÃO toca fn_obra_estrutura_listar/_salvar/_excluir. Acrescenta 4 colunas NULLable à
-- tabela já existente projetos_obra_estrutura (tela 314, migration 20261123022045) e 2 funções NOVAS só para as
-- áreas (leitor + gravador), guardadas por empresa (SECURITY DEFINER + fn__guarda_empresa / is_admin), REVOKE anon.
-- Dado atual não muda: colunas nascem NULL; os totais somam só o que for informado. Não toca núcleo nem dado de cliente.

-- 1) Colunas de área por nó da estrutura (aditivas, nullable) --------------------------------------
ALTER TABLE public.projetos_obra_estrutura
  ADD COLUMN IF NOT EXISTS area_privativa_m2 numeric,
  ADD COLUMN IF NOT EXISTS area_comum_m2     numeric,
  ADD COLUMN IF NOT EXISTS vagas_simples     integer,
  ADD COLUMN IF NOT EXISTS vagas_duplas      integer;

COMMENT ON COLUMN public.projetos_obra_estrutura.area_privativa_m2 IS 'Hub/Obras tela 314 — quadro de áreas: área privativa (m²) do pavimento/unidade.';
COMMENT ON COLUMN public.projetos_obra_estrutura.area_comum_m2     IS 'Hub/Obras tela 314 — quadro de áreas: área comum (m²) do pavimento/unidade.';
COMMENT ON COLUMN public.projetos_obra_estrutura.vagas_simples     IS 'Hub/Obras tela 314 — quadro de áreas: nº de vagas de garagem simples.';
COMMENT ON COLUMN public.projetos_obra_estrutura.vagas_duplas      IS 'Hub/Obras tela 314 — quadro de áreas: nº de vagas de garagem duplas.';

-- 2) Leitura: áreas por nó + totais da obra --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_estrutura_area_listar(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE v_obra public.projetos_obras%ROWTYPE; v_areas jsonb; v_tot jsonb;
BEGIN
  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_obra.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'area_privativa_m2', e.area_privativa_m2,
           'area_comum_m2',     e.area_comum_m2,
           'vagas_simples',     e.vagas_simples,
           'vagas_duplas',      e.vagas_duplas
         )), '[]'::jsonb)
    INTO v_areas
    FROM public.projetos_obra_estrutura e
   WHERE e.obra_id = p_obra_id AND e.company_id = v_obra.company_id AND e.excluido_em IS NULL
     AND (e.area_privativa_m2 IS NOT NULL OR e.area_comum_m2 IS NOT NULL
          OR e.vagas_simples IS NOT NULL OR e.vagas_duplas IS NOT NULL);

  SELECT jsonb_build_object(
           'area_privativa_m2', COALESCE(sum(e.area_privativa_m2), 0),
           'area_comum_m2',     COALESCE(sum(e.area_comum_m2), 0),
           'area_total_m2',     COALESCE(sum(e.area_privativa_m2), 0) + COALESCE(sum(e.area_comum_m2), 0),
           'vagas_simples',     COALESCE(sum(e.vagas_simples), 0),
           'vagas_duplas',      COALESCE(sum(e.vagas_duplas), 0),
           'vagas_total',       COALESCE(sum(e.vagas_simples), 0) + COALESCE(sum(e.vagas_duplas), 0)
         )
    INTO v_tot
    FROM public.projetos_obra_estrutura e
   WHERE e.obra_id = p_obra_id AND e.company_id = v_obra.company_id AND e.excluido_em IS NULL;

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'areas', v_areas, 'totais', v_tot);
END; $fn$;

-- 3) Gravação das áreas de um nó (não altera nome/nível/pai) ----------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_estrutura_area_salvar(
  p_id uuid,
  p_area_privativa_m2 numeric DEFAULT NULL,
  p_area_comum_m2     numeric DEFAULT NULL,
  p_vagas_simples     integer DEFAULT NULL,
  p_vagas_duplas      integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE v_item public.projetos_obra_estrutura%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_item FROM public.projetos_obra_estrutura WHERE id = p_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Item da estrutura não encontrado.'); END IF;
  PERFORM public.fn__guarda_empresa(v_item.company_id);

  -- Valores negativos não fazem sentido para área/vagas.
  IF COALESCE(p_area_privativa_m2, 0) < 0 OR COALESCE(p_area_comum_m2, 0) < 0
     OR COALESCE(p_vagas_simples, 0) < 0 OR COALESCE(p_vagas_duplas, 0) < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Área e vagas não podem ser negativas.');
  END IF;

  UPDATE public.projetos_obra_estrutura
     SET area_privativa_m2 = p_area_privativa_m2,
         area_comum_m2     = p_area_comum_m2,
         vagas_simples     = p_vagas_simples,
         vagas_duplas      = p_vagas_duplas,
         atualizado_em     = now()
   WHERE id = p_id AND company_id = v_item.company_id AND excluido_em IS NULL;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_item.company_id, auth.uid(), 'projetos_obra_estrutura', p_id::text, 'obra_estrutura_area_salvar',
          jsonb_build_object('area_privativa_m2', v_item.area_privativa_m2, 'area_comum_m2', v_item.area_comum_m2,
                             'vagas_simples', v_item.vagas_simples, 'vagas_duplas', v_item.vagas_duplas),
          jsonb_build_object('area_privativa_m2', p_area_privativa_m2, 'area_comum_m2', p_area_comum_m2,
                             'vagas_simples', p_vagas_simples, 'vagas_duplas', p_vagas_duplas));

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END; $fn$;

REVOKE ALL ON FUNCTION public.fn_obra_estrutura_area_listar(uuid)                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_estrutura_area_salvar(uuid, numeric, numeric, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_estrutura_area_listar(uuid)                              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_estrutura_area_salvar(uuid, numeric, numeric, integer, integer) TO authenticated, service_role;

-- 4) RD-95: "?" dos campos novos do quadro de áreas ------------------------------------------------
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('projetos.obra_estrutura.area_privativa',
  '/dashboard/projetos/obras/[id]/estrutura', 'Quadro de áreas', 'Área privativa (m²)',
  'Área privativa (de uso exclusivo) do pavimento ou da unidade, em metros quadrados.',
  'Compõe o quadro de áreas da obra e serve de base para custo por m² e rateio de área comum.',
  'Apto 101 com 62,50 m² de área privativa.',
  'Somar a área comum na privativa — informe cada uma no seu campo.',
  'hub_projetos', 6, 1, 'publicado'),
 ('projetos.obra_estrutura.area_comum',
  '/dashboard/projetos/obras/[id]/estrutura', 'Quadro de áreas', 'Área comum (m²)',
  'Área de uso comum atribuída ao pavimento ou à unidade (circulações, hall, lazer, garagens...), em m².',
  'Entra no quadro de áreas e na área total da obra, separada da privativa.',
  'Pavimento térreo com 180 m² de áreas comuns (hall, circulação e lazer).',
  'Repetir a mesma área comum no pavimento e nas unidades dele — escolha um nível para lançá-la.',
  'hub_projetos', 7, 1, 'publicado'),
 ('projetos.obra_estrutura.vagas_simples',
  '/dashboard/projetos/obras/[id]/estrutura', 'Quadro de áreas', 'Vagas simples',
  'Quantidade de vagas de garagem simples (uma vaga por box) do pavimento ou da unidade.',
  'Compõe o total de vagas da obra no quadro de áreas.',
  '2 vagas simples para o Apto 101.',
  'Contar uma vaga dupla como duas simples — a vaga dupla tem campo próprio.',
  'hub_projetos', 8, 1, 'publicado'),
 ('projetos.obra_estrutura.vagas_duplas',
  '/dashboard/projetos/obras/[id]/estrutura', 'Quadro de áreas', 'Vagas duplas',
  'Quantidade de vagas de garagem duplas (duas posições em sequência) do pavimento ou da unidade.',
  'Compõe o total de vagas da obra no quadro de áreas, separada das simples.',
  '1 vaga dupla para a cobertura.',
  'Lançar a vaga dupla no campo de vagas simples — use o campo de vagas duplas.',
  'hub_projetos', 9, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
