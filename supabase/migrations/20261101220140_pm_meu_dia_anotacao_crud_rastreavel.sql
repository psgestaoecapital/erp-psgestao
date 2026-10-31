-- PDCA P&M · /dashboard/pm/meu-dia — RD-98 p2 (editar faltava) + p4 (exclusão não era rastreável)
--
-- CAUSA-RAIZ (RD-38, provado no dado):
--   As anotações pessoais (agency_anotacoes, RLS owner-only: user_id = auth.uid()) tinham só INSERT (salvarNota)
--   e soft-delete por UPDATE direto no cliente (page.tsx mexerNota, só excluido_em). FALTAVA:
--     • EDITAR o texto de uma anotação já criada (CRUD incompleto — RD-98 p2);
--     • rastro de QUEM excluiu — a coluna excluido_por NÃO existia e nada ia para audit_log_global (RD-98 p4).
--   Colunas em agency_anotacoes antes desta migration: id, company_id, user_id, job_id, texto, fixada,
--   criado_em, atualizado_em, excluido_em (sem excluido_por).
--
-- ESTA MIGRATION (ADITIVA — 1 coluna NOVA nullable + 2 funções NOVAS; nenhuma tabela/RLS/policy existente alterada):
--   1) ADD COLUMN excluido_por uuid (nullable) em agency_anotacoes.
--   2) fn_pm_anotacao_editar(p_id, p_texto) — SECURITY DEFINER, dono-apenas (user_id = auth.uid()), confere empresa,
--      atualiza texto + atualizado_em e grava audit_log_global (acao 'editar').
--   3) fn_pm_anotacao_excluir(p_id) — SECURITY DEFINER, dono-apenas, idempotente, soft-delete
--      (excluido_em + excluido_por + atualizado_em) e grava audit_log_global (acao 'excluir').
--   Mesmo padrão de fn_pm_planejamento_excluir. A tela passa a chamar essas RPCs em vez do UPDATE direto.
--   REVOKE anon; GRANT só authenticated/service_role.
--   4) system_screens (RD-98 p3): acrescenta as 2 RPCs novas a rpcs_chamadas da rota.
--   5) erp_ajuda_campo (RD-95): 3 chaves novas para as ações da anotação (editar/excluir/fixar).

ALTER TABLE public.agency_anotacoes ADD COLUMN IF NOT EXISTS excluido_por uuid;

CREATE OR REPLACE FUNCTION public.fn_pm_anotacao_editar(p_id uuid, p_texto text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_user uuid; v_antes text; v_excl timestamptz; v_novo text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para editar'); END IF;
  v_novo := btrim(coalesce(p_texto, ''));
  IF v_novo = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'texto_vazio'); END IF;
  SELECT company_id, user_id, texto, excluido_em INTO v_company, v_user, v_antes, v_excl
    FROM public.agency_anotacoes WHERE id = p_id FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'anotacao_nao_encontrada'); END IF;
  -- anotação é privada do autor (RLS owner-only); só o dono edita
  IF v_user <> auth.uid() THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_excl IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'anotacao_excluida'); END IF;
  UPDATE public.agency_anotacoes
     SET texto = v_novo, atualizado_em = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'agency_anotacoes', p_id, 'editar',
            jsonb_build_object('texto', v_antes),
            jsonb_build_object('texto', v_novo));
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'texto', v_novo);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_pm_anotacao_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_user uuid; v_texto text; v_excl timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT company_id, user_id, texto, excluido_em INTO v_company, v_user, v_texto, v_excl
    FROM public.agency_anotacoes WHERE id = p_id FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'anotacao_nao_encontrada'); END IF;
  IF v_user <> auth.uid() THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_excl IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'ja_excluido', true); END IF;  -- idempotente
  UPDATE public.agency_anotacoes
     SET excluido_em = now(), excluido_por = auth.uid(), atualizado_em = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'agency_anotacoes', p_id, 'excluir',
            jsonb_build_object('excluido_em', null),
            jsonb_build_object('excluido_em', now(), 'texto', v_texto));
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_anotacao_editar(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_anotacao_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_anotacao_editar(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pm_anotacao_excluir(uuid) TO authenticated, service_role;

-- RD-98 p3: registra as RPCs novas como origem do dado da tela
UPDATE public.system_screens
   SET rpcs_chamadas = (
     SELECT array_agg(DISTINCT x ORDER BY x)
       FROM unnest(coalesce(rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_pm_anotacao_editar','fn_pm_anotacao_excluir']) AS x
   )
 WHERE rota = '/dashboard/pm/meu-dia';

-- RD-95: chaves de ajuda das ações da anotação
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
 ('pm.dia.anotacao.editar', '/dashboard/pm/meu-dia', 'Meu dia · Anotações', 'pm', 'Editar anotação',
  'Abre a anotação para corrigir o texto. Só você vê e edita as suas anotações.',
  'Mantém o lembrete atualizado sem precisar apagar e recriar; a alteração fica registrada (quem e quando).',
  'Trocar "ligar 15h" por "ligar 16h — reagendado".',
  'Esquecer de salvar: a edição só vale depois de clicar em Guardar.'),
 ('pm.dia.anotacao.excluir', '/dashboard/pm/meu-dia', 'Meu dia · Anotações', 'pm', 'Arquivar anotação',
  'Arquiva a anotação (sai da sua lista). Não some de vez: fica o registro de quem arquivou e quando.',
  'Tira do caminho o que já resolveu, mantendo rastro para auditoria.',
  'Arquivar o lembrete de uma ligação que já foi feita.',
  'Arquivar achando que some para sempre: é reversível pelo histórico, não é exclusão definitiva.'),
 ('pm.dia.anotacao.fixar', '/dashboard/pm/meu-dia', 'Meu dia · Anotações', 'pm', 'Fixar no topo',
  'Prende a anotação no topo da lista para ela não se perder entre as novas.',
  'Dá destaque ao que você precisa ver primeiro todo dia.',
  'Fixar "fechar a folha até dia 5".',
  'Fixar tudo: se tudo fica no topo, nada fica em destaque.')
ON CONFLICT (chave) DO NOTHING;
