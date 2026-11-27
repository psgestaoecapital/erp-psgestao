-- Hub · Gestão de Obras · Ficha da obra (blueprint vivo tela 314 — "Obra como cadastro central").
-- Fecha o item PARCIAL do §314: além de endereço/identidade/classificação, a ficha passa a guardar o
-- PADRÃO CONSTRUTIVO e o SISTEMA ESTRUTURAL da obra (requisito escopo 5).
--
-- Fatia COLLISION-FREE: NÃO toca fn_obra_ficha_ler (está em CREATE OR REPLACE na #5751, em voo) — usa um
-- leitor próprio (fn_obra_ficha_tecnica_ler) e um gravador próprio (fn_obra_ficha_tecnica_salvar), para as duas
-- migrations em voo não se sobrescreverem.
--
-- Aditiva: 2 colunas nullable + 2 funções NOVAS (nada recriado), RLS da tabela inalterada, sem toque em dado de cliente.

ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS padrao_construtivo  text;
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS sistema_estrutural  text;

-- Leitor próprio (não depende de fn_obra_ficha_ler): devolve só os 2 campos técnicos, guardado por empresa.
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_tecnica_ler(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.projetos_obras%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'padrao_construtivo', v.padrao_construtivo,
    'sistema_estrutural', v.sistema_estrutural
  );
END; $function$;

-- Gravador próprio: mesma guarda por empresa da fn_obra_ficha_identidade_salvar, valida o domínio e grava audit.
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_tecnica_salvar(
  p_obra_id uuid, p_padrao_construtivo text, p_sistema_estrutural text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.projetos_obras%ROWTYPE;
  v_padrao  text := nullif(btrim(p_padrao_construtivo), '');
  v_sistema text := nullif(btrim(p_sistema_estrutural), '');
BEGIN
  SELECT * INTO v FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF v_padrao IS NOT NULL AND v_padrao NOT IN ('popular', 'normal', 'alto', 'luxo') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Padrão construtivo inválido.');
  END IF;
  IF v_sistema IS NOT NULL AND v_sistema NOT IN
     ('alvenaria_estrutural', 'concreto_armado', 'estrutura_metalica', 'madeira', 'pre_moldado', 'misto', 'outro') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sistema estrutural inválido.');
  END IF;

  UPDATE public.projetos_obras
     SET padrao_construtivo = v_padrao, sistema_estrutural = v_sistema, updated_at = now()
   WHERE id = p_obra_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'obra_ficha_tecnica',
          jsonb_build_object('padrao_construtivo', v.padrao_construtivo, 'sistema_estrutural', v.sistema_estrutural),
          jsonb_build_object('padrao_construtivo', v_padrao, 'sistema_estrutural', v_sistema));

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id);
END; $function$;

-- SECURITY DEFINER: fecha ao anon, abre a authenticated/service_role (regra do check_fn_guards).
REVOKE ALL ON FUNCTION public.fn_obra_ficha_tecnica_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_tecnica_ler(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_obra_ficha_tecnica_salvar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_tecnica_salvar(uuid, text, text) TO authenticated, service_role;

-- RD-95: "?" dos 2 campos novos (idempotente por UNIQUE(chave)).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('projetos.obra_ficha.padrao_construtivo', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra',
   'Padrão construtivo',
   'Escolha o nível de acabamento/padrão da obra: popular, normal, alto ou luxo.',
   'Classifica a obra pelo padrão de acabamento — orienta custo por m², especificação de materiais e comparação com obras semelhantes.',
   'Casa simples de programa habitacional → Popular. Apartamento de alto padrão com acabamentos finos → Luxo.',
   'Marcar "Luxo" numa obra de padrão normal só porque o cliente é exigente — use o padrão real dos materiais e acabamentos.',
   'hub_projetos', 7, 'publicado'),
  ('projetos.obra_ficha.sistema_estrutural', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra',
   'Sistema estrutural',
   'Escolha como a estrutura da obra é feita: alvenaria estrutural, concreto armado, estrutura metálica, madeira, pré-moldado, misto ou outro.',
   'Identifica a solução estrutural — orienta projeto, orçamento, prazos e os serviços de execução de cada etapa.',
   'Prédio de concreto moldado no local → Concreto armado. Galpão com pilares e vigas de aço → Estrutura metálica.',
   'Confundir "estrutura metálica" (aço) com "pré-moldado" (peças de concreto prontas) — são sistemas diferentes.',
   'hub_projetos', 8, 'publicado'),
  ('projetos.obra_ficha.salvar_tecnica', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra',
   'Salvar dados técnicos',
   'Clique para gravar o padrão construtivo e o sistema estrutural informados.',
   'Guarda os dados técnicos na ficha da obra; podem ser ajustados a qualquer momento.',
   'Preencheu padrão e sistema → clique em Salvar dados técnicos.',
   'Trocar os campos e sair da tela sem salvar — a alteração só vale depois de clicar em Salvar.',
   'hub_projetos', 9, 'publicado')
ON CONFLICT (chave) DO NOTHING;
