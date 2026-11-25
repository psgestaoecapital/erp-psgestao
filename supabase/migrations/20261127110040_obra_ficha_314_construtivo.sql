-- 20261127110040 · code-desenvolvedor-3 · Tela 314 (Ficha da obra) — gap 4 do PDCA (auditor_pdca_1 25/11):
-- "padrão construtivo" e "sistema estrutural" NA FICHA (requisito blueprint 4c589239, escopo 5). Essas duas
-- características NÃO existiam em projetos_obras (provado no dado: information_schema sem as colunas) — então esta
-- fatia precisa de migration de estrutura ADITIVA: duas colunas novas, nullable, SEM default, nenhum dado de
-- cliente apagado/alterado. Domínio restrito por CHECK (aceita NULL → linhas existentes passam).
-- As funções de ler/gravar seguem o padrão collision-free das outras fatias da ficha (andamento/endereço):
-- SECURITY DEFINER + search_path + guarda por company_id (is_admin / get_user_company_ids) + audit_log + REVOKE anon.
-- Idempotente (ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS antes do ADD, CREATE OR REPLACE).

-- 1) Colunas novas (aditivas) ------------------------------------------------------------------------------------
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS padrao_construtivo text;
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS sistema_estrutural text;

ALTER TABLE public.projetos_obras DROP CONSTRAINT IF EXISTS projetos_obras_padrao_construtivo_chk;
ALTER TABLE public.projetos_obras ADD CONSTRAINT projetos_obras_padrao_construtivo_chk
  CHECK (padrao_construtivo IS NULL OR padrao_construtivo IN ('popular','economico','normal','alto','luxo'));

ALTER TABLE public.projetos_obras DROP CONSTRAINT IF EXISTS projetos_obras_sistema_estrutural_chk;
ALTER TABLE public.projetos_obras ADD CONSTRAINT projetos_obras_sistema_estrutural_chk
  CHECK (sistema_estrutural IS NULL OR sistema_estrutural IN
    ('alvenaria_estrutural','concreto_armado','estrutura_metalica','madeira','pre_moldado','steel_frame','wood_frame','misto'));

COMMENT ON COLUMN public.projetos_obras.padrao_construtivo IS 'Padrão construtivo da obra (popular/economico/normal/alto/luxo) — ficha da obra, tela 314.';
COMMENT ON COLUMN public.projetos_obras.sistema_estrutural IS 'Sistema estrutural predominante (alvenaria_estrutural/concreto_armado/estrutura_metalica/madeira/pre_moldado/steel_frame/wood_frame/misto) — ficha da obra, tela 314.';

-- 2) Leitura (collision-free; não toca fn_obra_ficha_ler) ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_construtivo_ler(p_obra_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v public.projetos_obras%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'obra_id', v.id,
    'padrao_construtivo', v.padrao_construtivo,
    'sistema_estrutural', v.sistema_estrutural
  );
END; $$;

-- 3) Gravação. Domínio validado (mesmo do CHECK); campo vazio (NULL) é aceito e limpa o valor. --------------------
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_construtivo_salvar(
  p_obra_id            uuid,
  p_padrao_construtivo text,
  p_sistema_estrutural text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  IF v_padrao IS NOT NULL AND v_padrao NOT IN ('popular','economico','normal','alto','luxo') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Padrão construtivo inválido.');
  END IF;
  IF v_sistema IS NOT NULL AND v_sistema NOT IN
     ('alvenaria_estrutural','concreto_armado','estrutura_metalica','madeira','pre_moldado','steel_frame','wood_frame','misto') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sistema estrutural inválido.');
  END IF;

  UPDATE public.projetos_obras
     SET padrao_construtivo = v_padrao,
         sistema_estrutural = v_sistema,
         updated_at = now()
   WHERE id = p_obra_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'obra_ficha_construtivo',
          jsonb_build_object('padrao_construtivo', v.padrao_construtivo, 'sistema_estrutural', v.sistema_estrutural),
          jsonb_build_object('padrao_construtivo', v_padrao, 'sistema_estrutural', v_sistema));

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id,
    'padrao_construtivo', v_padrao, 'sistema_estrutural', v_sistema);
END; $$;

REVOKE ALL ON FUNCTION public.fn_obra_ficha_construtivo_ler(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_ficha_construtivo_salvar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_construtivo_ler(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_construtivo_salvar(uuid, text, text) TO authenticated;

-- 4) "?" RD-95 dos campos novos (chave = projetos.obra_ficha.*, rota exata da tela 314) -------------------------
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.obra_ficha.padrao_construtivo', '/dashboard/projetos/obras/[id]/ficha', 'Identidade do imóvel', 'Padrão construtivo',
   'Selecione o padrão de acabamento/construção da obra: Popular, Econômico, Normal, Alto ou Luxo.',
   'Classifica o nível de acabamento da obra; ajuda a comparar custo por m² com referências de mercado e a dimensionar materiais e mão de obra.',
   'Residência de alto acabamento com materiais premium → Luxo.',
   'Confundir padrão construtivo (acabamento) com tipo de edificação (uso: residencial/comercial) — são campos diferentes.',
   'hub_projetos', 30, 1, 'publicado'),
  ('projetos.obra_ficha.sistema_estrutural', '/dashboard/projetos/obras/[id]/ficha', 'Identidade do imóvel', 'Sistema estrutural',
   'Selecione o sistema estrutural predominante: Alvenaria estrutural, Concreto armado, Estrutura metálica, Madeira, Pré-moldado, Steel frame, Wood frame ou Misto.',
   'Registra a técnica construtiva da obra; orienta o orçamento de estrutura, as ARTs/RRTs e o acompanhamento de execução.',
   'Prédio com pilares e vigas de concreto moldados no local → Concreto armado.',
   'Marcar Misto sem que a obra realmente combine sistemas — use Misto só quando houver mais de um sistema relevante.',
   'hub_projetos', 31, 1, 'publicado'),
  ('projetos.obra_ficha.salvar_construtivo', '/dashboard/projetos/obras/[id]/ficha', 'Identidade do imóvel', 'Salvar características',
   'Toque para gravar o padrão construtivo e o sistema estrutural da obra.',
   'Persiste as características construtivas na ficha; passam a valer nos cruzamentos de custo e nos relatórios da obra.',
   'Selecionou Normal + Concreto armado → Salvar características.',
   'Esquecer de salvar após escolher — a alteração só vale depois de salvar.',
   'hub_projetos', 32, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;

-- 5) "?" RD-95 do resumo de regularização surfado na ficha (gap 5 · CNO/ART/RRT/responsáveis — só leitura) -------
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.obra_ficha.reg_tecnicos', '/dashboard/projetos/obras/[id]/ficha', 'Regularização (alvará e licenças)', 'CNO, ART/RRT e responsáveis técnicos',
   'Este bloco é só leitura: mostra o CNO (matrícula da obra), as ARTs/RRTs e os responsáveis técnicos já cadastrados na Regularização da obra.',
   'Deixa à vista, na própria ficha, os documentos técnicos essenciais da obra sem precisar abrir outra tela. O cadastro e a edição ficam em Regularização da obra.',
   'CNO 12.345.678/9012-34 · ART 123456 (Eng. Fulano).',
   'Tentar editar aqui — para incluir ou alterar CNO/ART/RRT use o botão “Abrir” da Regularização.',
   'hub_projetos', 40, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
