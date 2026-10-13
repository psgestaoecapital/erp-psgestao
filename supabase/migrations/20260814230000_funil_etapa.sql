-- Funis configuráveis (genérico) · motor de etapas add/editar/reordenar/excluir. Origem: CEO 14/08.
-- Tabela funil_etapa (company, tipo_funil, chave, rotulo, ordem, cor, tipo_etapa) + RLS.
-- Libera o CHECK fixo de agency_leads.etapa (validação passa a ser pela app/funil_etapa).
-- Seed das 8 etapas atuais por empresa que já usa o funil. RPCs listar/salvar/excluir (guarda de registros).
-- Aplicado 1º ao funil 'leads'; reusável em 'jobs' e futuros (mesmo mecanismo).

-- ── 1) Tabela genérica de etapas ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.funil_etapa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  tipo_funil text NOT NULL,                     -- 'leads' | 'jobs' | ... (extensível)
  chave text NOT NULL,                          -- slug estável usado nos registros (ex.: 'novo')
  rotulo text NOT NULL,                         -- nome exibido (editável)
  ordem int NOT NULL DEFAULT 0,
  cor text,                                     -- hex opcional
  tipo_etapa text NOT NULL DEFAULT 'normal',    -- 'normal' | 'ganho' | 'perda'
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz DEFAULT now(),
  UNIQUE (company_id, tipo_funil, chave)
);

ALTER TABLE public.funil_etapa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS funil_etapa_rls ON public.funil_etapa;
CREATE POLICY funil_etapa_rls ON public.funil_etapa
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

CREATE INDEX IF NOT EXISTS idx_funil_etapa ON public.funil_etapa (company_id, tipo_funil, ordem);

-- ── 2) Libera o campo hardcoded (permite etapas customizadas) ────────────────
ALTER TABLE public.agency_leads DROP CONSTRAINT IF EXISTS agency_leads_etapa_check;
-- validação passa a ser pela app/funil_etapa (não recriar CHECK fixo).

-- ── 3) Seed das 8 etapas atuais para cada company que já usa o funil de leads ──
INSERT INTO public.funil_etapa (company_id, tipo_funil, chave, rotulo, ordem, cor, tipo_etapa)
SELECT DISTINCT l.company_id, 'leads', e.chave, e.rotulo, e.ordem, e.cor, e.tipo
FROM public.agency_leads l
CROSS JOIN (VALUES
  ('novo','Novo',10,'#F0E9DE','normal'),
  ('atendimento','Em atendimento',20,'#FFF3D6','normal'),
  ('reuniao_agendada','Reunião agendada',30,'#FCE9C2','normal'),
  ('entendimento','Entendimento',40,'#FAD18A','normal'),
  ('proposta','Proposta',50,'#F4B860','normal'),
  ('negociacao','Negociação',60,'#E8A93A','normal'),
  ('ganho','Ganho',70,'#DCEFD7','ganho'),
  ('perdido','Perdido',80,'#F4D6D6','perda')
) AS e(chave,rotulo,ordem,cor,tipo)
ON CONFLICT (company_id, tipo_funil, chave) DO NOTHING;

-- ── 4) RPCs de gestão ────────────────────────────────────────────────────────

-- Lista etapas ativas ordenadas. Lazy-seed dos defaults de 'leads' se a empresa ainda não tem etapas
-- (garante funil utilizável para empresas sem histórico, sem depender do seed acima).
CREATE OR REPLACE FUNCTION public.fn_funil_etapas_listar(p_company_id uuid, p_tipo_funil text)
 RETURNS TABLE(id uuid, chave text, rotulo text, ordem int, cor text, tipo_etapa text, ativo boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem_acesso';
  END IF;

  IF p_tipo_funil = 'leads'
     AND NOT EXISTS (SELECT 1 FROM funil_etapa fe WHERE fe.company_id = p_company_id AND fe.tipo_funil = 'leads') THEN
    INSERT INTO funil_etapa (company_id, tipo_funil, chave, rotulo, ordem, cor, tipo_etapa)
    SELECT p_company_id, 'leads', d.chave, d.rotulo, d.ordem, d.cor, d.tipo
    FROM (VALUES
      ('novo','Novo',10,'#F0E9DE','normal'),
      ('atendimento','Em atendimento',20,'#FFF3D6','normal'),
      ('reuniao_agendada','Reunião agendada',30,'#FCE9C2','normal'),
      ('entendimento','Entendimento',40,'#FAD18A','normal'),
      ('proposta','Proposta',50,'#F4B860','normal'),
      ('negociacao','Negociação',60,'#E8A93A','normal'),
      ('ganho','Ganho',70,'#DCEFD7','ganho'),
      ('perdido','Perdido',80,'#F4D6D6','perda')
    ) AS d(chave,rotulo,ordem,cor,tipo)
    ON CONFLICT (company_id, tipo_funil, chave) DO NOTHING;
  END IF;

  RETURN QUERY
    SELECT fe.id, fe.chave, fe.rotulo, fe.ordem, fe.cor, fe.tipo_etapa, fe.ativo
    FROM funil_etapa fe
    WHERE fe.company_id = p_company_id AND fe.tipo_funil = p_tipo_funil AND fe.ativo = true
    ORDER BY fe.ordem, fe.rotulo;
END;
$function$;

-- Insere/edita etapa. Gera chave (slug) na criação; chave imutável depois (registros dependem dela).
CREATE OR REPLACE FUNCTION public.fn_funil_etapa_salvar(p_campos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := NULLIF(btrim(p_campos->>'id'), '')::uuid;
  v_company uuid := NULLIF(btrim(p_campos->>'company_id'), '')::uuid;
  v_tipo_funil text := NULLIF(btrim(p_campos->>'tipo_funil'), '');
  v_rotulo text := NULLIF(btrim(p_campos->>'rotulo'), '');
  v_ordem int := COALESCE(NULLIF(p_campos->>'ordem','')::int, 0);
  v_cor text := NULLIF(btrim(p_campos->>'cor'), '');
  v_tipo_etapa text := lower(COALESCE(NULLIF(btrim(p_campos->>'tipo_etapa'), ''), 'normal'));
  v_slug text; v_base text; v_i int := 1; v_row funil_etapa%ROWTYPE;
BEGIN
  IF v_tipo_etapa NOT IN ('normal','ganho','perda') THEN v_tipo_etapa := 'normal'; END IF;

  IF v_id IS NOT NULL THEN
    -- edição: rotulo/ordem/cor/tipo_etapa. chave, tipo_funil e company são imutáveis.
    SELECT * INTO v_row FROM funil_etapa WHERE id = v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'etapa não encontrada'); END IF;
    IF NOT is_admin() AND v_row.company_id NOT IN (SELECT get_user_company_ids()) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
    END IF;
    UPDATE funil_etapa SET
      rotulo = COALESCE(v_rotulo, rotulo),
      ordem = v_ordem,
      cor = v_cor,
      tipo_etapa = v_tipo_etapa
    WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'chave', v_row.chave);
  END IF;

  -- criação
  IF v_company IS NULL OR v_tipo_funil IS NULL OR v_rotulo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'company_id, tipo_funil e rotulo obrigatórios');
  END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  -- slug a partir do rótulo (remove acentos comuns, não-alfanuméricos → '_')
  v_slug := lower(v_rotulo);
  v_slug := translate(v_slug, 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
  v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '_', 'g');
  v_slug := btrim(v_slug, '_');
  IF v_slug = '' THEN v_slug := 'etapa'; END IF;
  v_base := v_slug;
  WHILE EXISTS (SELECT 1 FROM funil_etapa WHERE company_id = v_company AND tipo_funil = v_tipo_funil AND chave = v_slug) LOOP
    v_i := v_i + 1; v_slug := v_base || '_' || v_i;
  END LOOP;

  INSERT INTO funil_etapa (company_id, tipo_funil, chave, rotulo, ordem, cor, tipo_etapa)
  VALUES (v_company, v_tipo_funil, v_slug, v_rotulo, v_ordem, v_cor, v_tipo_etapa)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'chave', v_slug);
END;
$function$;

-- Exclui etapa. Guarda: se há registros na etapa (leads com etapa = chave), bloqueia (RD-54, sem órfãos).
CREATE OR REPLACE FUNCTION public.fn_funil_etapa_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row funil_etapa%ROWTYPE; v_qtd int := 0;
BEGIN
  SELECT * INTO v_row FROM funil_etapa WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'etapa não encontrada'); END IF;
  IF NOT is_admin() AND v_row.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  IF v_row.tipo_funil = 'leads' THEN
    SELECT count(*) INTO v_qtd FROM agency_leads
    WHERE company_id = v_row.company_id AND etapa = v_row.chave;
  END IF;
  -- (funil 'jobs' e outros: guarda entra junto com a onda que ativar o funil)

  IF v_qtd > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'etapa_com_registros', 'qtd', v_qtd);
  END IF;

  DELETE FROM funil_etapa WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_funil_etapas_listar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_funil_etapa_salvar(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_funil_etapa_excluir(uuid) TO authenticated;
