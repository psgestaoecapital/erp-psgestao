-- Hub · Gestão de Obras · Ficha da obra — responsável técnico (ART/RRT) (blueprint vivo tela 314).
-- Requisito essencial da tela 314 (auditor_pdca_1 24/11): "FALTAM ... ART/RRT/resp técnico ... na ficha".
-- Também cobre a tela 107 ("Responsáveis Técnicos (ART/RRT) na própria obra", parcial).
-- Esta fatia acrescenta o responsável técnico da obra e o registro da ART (CREA) / RRT (CAU), na mesma
-- página /dashboard/projetos/obras/[id]/ficha, ao lado de identidade e endereço.
--
-- Padrão colisão-livre (igual ao da fatia de endereço): NÃO toca fn_obra_ficha_ler nem fn_obra_ficha_salvar
-- (nenhum CREATE OR REPLACE de função existente) — cria um leitor e um gravador NOVOS só para estes campos,
-- evitando conflito de ordem de merge com outras fatias da mesma tela.
-- Aditiva e idempotente: ADD COLUMN IF NOT EXISTS (colunas novas, nullable) + 2 funções NOVAS. Sem CHECK na
-- tabela (valida na RPC). A RLS da projetos_obras já cobre as colunas novas. Não toca dado de cliente.
--
-- Prova RD-38 (no banco, BEGIN/ROLLBACK, obra DEMO da Construtora): leitor devolve ok=true com os 4 campos
-- NULL antes de gravar; gravador grava nome/registro/tipo/número, o leitor relê os valores e o audit_log_global
-- recebe 1 linha 'obra_ficha_resp_tecnico'. Rolled back.

ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS responsavel_tecnico_nome     text;
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS responsavel_tecnico_registro text;
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS art_rrt_tipo                 text;
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS art_rrt_numero               text;

COMMENT ON COLUMN public.projetos_obras.responsavel_tecnico_nome     IS 'Nome do responsável técnico pela obra (engenheiro/arquiteto). NULL = não informado.';
COMMENT ON COLUMN public.projetos_obras.responsavel_tecnico_registro IS 'Registro profissional do responsável técnico (CREA, para engenheiro; CAU, para arquiteto). NULL = não informado.';
COMMENT ON COLUMN public.projetos_obras.art_rrt_tipo                 IS 'Tipo do documento de responsabilidade técnica: ''ART'' (CREA/engenharia) | ''RRT'' (CAU/arquitetura). NULL = não informado.';
COMMENT ON COLUMN public.projetos_obras.art_rrt_numero               IS 'Número da ART/RRT emitida para a obra. NULL = não informado.';

-- Leitor próprio (colisão-livre): só os campos do responsável técnico
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_resptec_ler(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'responsavel_tecnico_nome', v.responsavel_tecnico_nome,
    'responsavel_tecnico_registro', v.responsavel_tecnico_registro,
    'art_rrt_tipo', v.art_rrt_tipo,
    'art_rrt_numero', v.art_rrt_numero
  );
END; $function$;

-- Gravador do responsável técnico (separado, para não mudar a assinatura da fn_obra_ficha_salvar)
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_resptec_salvar(
  p_obra_id uuid, p_responsavel_tecnico_nome text, p_responsavel_tecnico_registro text,
  p_art_rrt_tipo text, p_art_rrt_numero text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.projetos_obras%ROWTYPE;
  v_nome text := nullif(btrim(p_responsavel_tecnico_nome), '');
  v_reg  text := nullif(btrim(p_responsavel_tecnico_registro), '');
  v_tipo text := nullif(btrim(p_art_rrt_tipo), '');
  v_num  text := nullif(btrim(p_art_rrt_numero), '');
BEGIN
  SELECT * INTO v FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('ART', 'RRT') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Tipo do documento deve ser ART ou RRT.');
  END IF;

  UPDATE public.projetos_obras
     SET responsavel_tecnico_nome = v_nome, responsavel_tecnico_registro = v_reg,
         art_rrt_tipo = v_tipo, art_rrt_numero = v_num, updated_at = now()
   WHERE id = p_obra_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'obra_ficha_resp_tecnico',
          jsonb_build_object('responsavel_tecnico_nome', v.responsavel_tecnico_nome, 'responsavel_tecnico_registro', v.responsavel_tecnico_registro, 'art_rrt_tipo', v.art_rrt_tipo, 'art_rrt_numero', v.art_rrt_numero),
          jsonb_build_object('responsavel_tecnico_nome', v_nome, 'responsavel_tecnico_registro', v_reg, 'art_rrt_tipo', v_tipo, 'art_rrt_numero', v_num));

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_obra_ficha_resptec_ler(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_ficha_resptec_salvar(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_resptec_ler(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_resptec_salvar(uuid, text, text, text, text) TO authenticated, service_role;

-- RD-95: "?" dos campos e ação novos
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('projetos.obra_ficha.resp_tecnico_nome',
  '/dashboard/projetos/obras/[id]/ficha', 'Responsável técnico', 'Responsável técnico',
  'Nome do profissional responsável técnico pela obra (engenheiro ou arquiteto).',
  'Identifica quem responde tecnicamente pela obra perante o órgão de classe e a fiscalização.',
  'Eng. Civil Ana Souza.',
  'Deixar em branco quando a obra já tem responsável definido — informe para constar nos documentos.',
  'hub_projetos', 20, 1, 'publicado'),
 ('projetos.obra_ficha.resp_tecnico_registro',
  '/dashboard/projetos/obras/[id]/ficha', 'Responsável técnico', 'Registro profissional (CREA/CAU)',
  'Número do registro do responsável técnico: CREA (engenheiro) ou CAU (arquiteto).',
  'Comprova a habilitação do responsável técnico; usado na ART/RRT e nos documentos da obra.',
  'CREA-SC 123456-7 (engenheiro) ou CAU A12345-6 (arquiteto).',
  'Trocar o registro profissional pelo número da ART/RRT — são campos diferentes.',
  'hub_projetos', 21, 1, 'publicado'),
 ('projetos.obra_ficha.art_rrt_tipo',
  '/dashboard/projetos/obras/[id]/ficha', 'Responsável técnico', 'Tipo (ART/RRT)',
  'Escolha o tipo do documento de responsabilidade técnica: ART (engenharia, via CREA) ou RRT (arquitetura, via CAU).',
  'Define o documento legal que registra a responsabilidade técnica pela obra.',
  'Obra conduzida por engenheiro → ART. Obra conduzida por arquiteto → RRT.',
  'Escolher ART para projeto de arquiteto — nesse caso é RRT.',
  'hub_projetos', 22, 1, 'publicado'),
 ('projetos.obra_ficha.art_rrt_numero',
  '/dashboard/projetos/obras/[id]/ficha', 'Responsável técnico', 'Número da ART/RRT',
  'Número da ART (CREA) ou RRT (CAU) emitida para esta obra.',
  'Vincula a obra ao documento de responsabilidade técnica registrado no órgão de classe.',
  'ART nº 1234567890 ou RRT nº BR0001234567.',
  'Informar o número antes de emitir a ART/RRT — preencha só depois da emissão.',
  'hub_projetos', 23, 1, 'publicado'),
 ('projetos.obra_ficha.salvar_resp_tecnico',
  '/dashboard/projetos/obras/[id]/ficha', 'Responsável técnico', 'Salvar responsável técnico',
  'Clique para gravar o responsável técnico e a ART/RRT da obra.',
  'Guarda os dados de responsabilidade técnica na ficha da obra.',
  'Depois de preencher o responsável e a ART/RRT, clique em Salvar.',
  'Sair da tela sem salvar — os dados do responsável técnico só valem depois de gravar.',
  'hub_projetos', 24, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
