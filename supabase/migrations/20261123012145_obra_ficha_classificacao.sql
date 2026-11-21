-- Hub · Gestão de Obras · Ficha da obra — classificação (blueprint vivo tela 314, "obra como cadastro central")
-- Requisitos essenciais do blueprint hub_projetos / tela 314:
--   • "Identificar se a obra é própria ou gerenciada para terceiros." [escopo 2]
--   • "Modelo de contratação da obra (administração, empreitada global, empreitada por preço unitário, outro),
--      que define como o financeiro da obra é tratado."
-- Hoje a obra não guarda essas duas classificações; esta fatia adiciona as colunas (aditivas, nullable),
-- as RPCs de leitura/gravação guardadas por empresa e as chaves de ajuda (RD-95). A UI é a nova página
-- /dashboard/projetos/obras/[id]/ficha, aberta pelo cockpit.
-- Aditiva e idempotente: só ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE de funções NOVAS; não altera nada
-- existente, não toca dado de cliente. A validação dos valores permitidos fica na RPC (sem CHECK na tabela,
-- para não varrer/lockar a tabela em produção). RLS da projetos_obras já cobre as colunas novas.

-- 1) Colunas de classificação (nullable; linhas existentes seguem NULL = "não classificada")
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS tipo_execucao      text;
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS modelo_contratacao text;

COMMENT ON COLUMN public.projetos_obras.tipo_execucao      IS 'Execução da obra: ''propria'' (da própria empresa) ou ''terceiros'' (gerenciada para o contratante). NULL = não classificada.';
COMMENT ON COLUMN public.projetos_obras.modelo_contratacao IS 'Modelo de contratação: ''administracao'' | ''empreitada_global'' | ''empreitada_preco_unitario'' | ''outro''. Define como o financeiro da obra é tratado. NULL = não informado.';

-- 2) Leitura da ficha (classificação) — guarda de acesso por company_id, igual às demais fn_obra_*
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_ler(p_obra_id uuid)
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
    'numero', v.numero,
    'nome', v.nome,
    'cliente_nome', v.cliente_nome,
    'tipo_execucao', v.tipo_execucao,
    'modelo_contratacao', v.modelo_contratacao
  );
END; $function$;

-- 3) Gravação da classificação — valida os valores permitidos (ou NULL), atualiza e registra trilha
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_salvar(
  p_obra_id uuid, p_tipo_execucao text, p_modelo_contratacao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.projetos_obras%ROWTYPE;
  v_tipo   text := nullif(btrim(p_tipo_execucao), '');
  v_modelo text := nullif(btrim(p_modelo_contratacao), '');
BEGIN
  SELECT * INTO v FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('propria', 'terceiros') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Tipo de execução inválido.');
  END IF;
  IF v_modelo IS NOT NULL AND v_modelo NOT IN ('administracao', 'empreitada_global', 'empreitada_preco_unitario', 'outro') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Modelo de contratação inválido.');
  END IF;

  UPDATE public.projetos_obras
     SET tipo_execucao = v_tipo, modelo_contratacao = v_modelo, updated_at = now()
   WHERE id = p_obra_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'obra_ficha_classificacao',
          jsonb_build_object('tipo_execucao', v.tipo_execucao, 'modelo_contratacao', v.modelo_contratacao),
          jsonb_build_object('tipo_execucao', v_tipo, 'modelo_contratacao', v_modelo));

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'tipo_execucao', v_tipo, 'modelo_contratacao', v_modelo);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_obra_ficha_ler(uuid)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_ficha_salvar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_ler(uuid)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_salvar(uuid, text, text) TO authenticated, service_role;

-- 4) system_screens: a nova rota existe e é auditável (RD-96: a tela aparece no sistema)
INSERT INTO public.system_screens (id, rota, area, titulo, modulo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES ('dashboard.projetos_obras_id_ficha', '/dashboard/projetos/obras/[id]/ficha', 'hub_construcao',
        'Ficha da obra', 'projetos_obras', 'parcial', 'media', false)
ON CONFLICT (id) DO NOTHING;

-- 5) RD-95: "?" dos campos e ações novos
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('projetos.obra_ficha.tipo_execucao',
  '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Execução',
  'Escolha se a obra é da própria empresa (own) ou gerenciada para terceiros (você administra a obra de um contratante).',
  'Define o papel da empresa na obra: obra própria entra no seu resultado; obra de terceiros é administrada e costuma remunerar por taxa de administração.',
  'Construtora erguendo um prédio próprio → Própria. Escritório que gerencia a obra do cliente → Para terceiros.',
  'Marcar "Própria" numa obra que, na verdade, é só gerenciada para o cliente — isso distorce o resultado da empresa.',
  'hub_projetos', 1, 1, 'publicado'),
 ('projetos.obra_ficha.modelo_contratacao',
  '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Modelo de contratação',
  'Como a obra foi contratada: por administração, empreitada global (preço fechado), empreitada por preço unitário (por item medido) ou outro.',
  'Define como o financeiro da obra é tratado — por exemplo, administração costuma cobrar taxa sobre o custo; empreitada global trabalha com preço fechado.',
  'Preço fechado para entregar a obra pronta → Empreitada global. Paga por m² ou por item medido → Empreitada por preço unitário.',
  'Deixar sem modelo e depois não saber como medir/faturar — escolha o modelo logo no começo da obra.',
  'hub_projetos', 2, 1, 'publicado'),
 ('projetos.obra_ficha.salvar',
  '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Salvar classificação',
  'Clique para gravar a execução e o modelo de contratação da obra.',
  'Guarda a classificação na ficha da obra; ela passa a valer para o resultado e para o faturamento.',
  'Depois de escolher Própria/Para terceiros e o modelo, clique em Salvar.',
  'Sair da tela sem salvar — a classificação só vale depois de gravar.',
  'hub_projetos', 3, 1, 'publicado'),
 ('projetos.cockpit.ficha',
  '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Ficha da obra',
  'Abre a ficha da obra para classificar a execução (própria/terceiros) e o modelo de contratação.',
  'Centraliza os dados de cadastro da obra; a classificação alimenta o resultado e o faturamento.',
  'Clique em "Ficha da obra" para informar se a obra é própria ou gerenciada e como foi contratada.',
  'Deixar a obra sem classificação — o resultado por obra fica incompleto.',
  'hub_projetos', 20, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
