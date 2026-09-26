-- Estrela Polar passa a viver no banco (erp_documento_vertical, vertical = 'estrela_polar'), como as verticais.
-- Decisão do CEO 26/09 (RD-52: uma fonte, não duas). O arquivo do Project Knowledge vira cópia de emergência
-- SÓ depois de provado que a sessão lê a versão vigente pelo briefing.
--
-- 1) fn_estrela_polar_vigente(): leitura completa (versão, status, datas, bytes, conteúdo). Só PS_ADMIN ou
--    sessão sem usuário (service_role / Claude via MCP). Sem documento → ok:false 'ausente' com o aviso.
-- 2) fn_estrela_polar_gravar(versao, titulo, conteudo, resumo, arquivos): grava nova versão como vigente
--    (a anterior fica no histórico, vigente=false) em RASCUNHO — o CEO aprova em /dashboard/dev
--    (fn_dev_documento_aprovar, a mesma das verticais). Recusa versão que não seja maior que a última.
-- 3) fn_briefing_sessao ganha a chave 'estrela_polar' = fn_estrela_polar_vigente() com o documento INTEIRO.
--    Motivo (medido 26/09): briefing hoje = 30.992 caracteres; a Estrela Polar ~24 KB → ~55 KB numa chamada.
--    Separar em "resumo + RPC" recria o defeito que o CLAUDE.md combate: a próxima sessão teria de lembrar
--    de uma SEGUNDA chamada. Uma chamada, o documento inteiro.
-- 4) SEGURANÇA (achado ao fazer este PR): fn_briefing_sessao era EXECUTE para authenticated e não tinha
--    guarda — qualquer usuário logado de cliente podia ler handoff, alertas do CEO, resumo de empresas.
--    O app não chama o briefing (grep em src/: 0); só a Claude via MCP (sem usuário). Guarda PS_ADMIN no corpo
--    + REVOKE de authenticated. Com a Estrela Polar dentro, isso deixou de ser opcional.
-- Patch do briefing no padrão das migrations de 26/09 (âncora + idempotente), sem reescrever as 16 KB.

CREATE OR REPLACE FUNCTION public.fn_estrela_polar_vigente()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.fn_eh_ps_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'apenas_ps_admin');
  END IF;
  SELECT id, versao, titulo, status, conteudo_md, resumo_mudanca, criado_em, aprovado_em
    INTO r FROM public.erp_documento_vertical WHERE vertical = 'estrela_polar' AND vigente;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ausente',
      'aviso', 'Estrela Polar ainda não está no banco (erp_documento_vertical, vertical=estrela_polar). Use a cópia do Project Knowledge.');
  END IF;
  RETURN jsonb_build_object(
    'ok', true, 'fonte', 'erp_documento_vertical', 'id', r.id,
    'versao', r.versao, 'titulo', r.titulo, 'status', r.status, 'aprovado', r.status = 'aprovado',
    'criado_em', r.criado_em, 'aprovado_em', r.aprovado_em, 'resumo_mudanca', r.resumo_mudanca,
    'bytes', octet_length(r.conteudo_md), 'conteudo_md', r.conteudo_md);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_estrela_polar_gravar(
  p_versao integer, p_titulo text, p_conteudo_md text,
  p_resumo_mudanca text DEFAULT NULL, p_origem_arquivos text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_ultima integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.fn_eh_ps_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'apenas_ps_admin');
  END IF;
  IF p_versao IS NULL OR p_versao < 1 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'versao_invalida');
  END IF;
  IF NULLIF(btrim(p_titulo), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'titulo_obrigatorio');
  END IF;
  -- um documento-mestre não tem menos que isso; protege contra gravar vazio/truncado por engano
  IF p_conteudo_md IS NULL OR length(btrim(p_conteudo_md)) < 2000 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'conteudo_curto', 'caracteres', coalesce(length(p_conteudo_md), 0));
  END IF;
  SELECT max(versao) INTO v_ultima FROM public.erp_documento_vertical WHERE vertical = 'estrela_polar';
  IF v_ultima IS NOT NULL AND p_versao <= v_ultima THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'versao_nao_e_nova', 'ultima', v_ultima);
  END IF;

  UPDATE public.erp_documento_vertical SET vigente = false WHERE vertical = 'estrela_polar' AND vigente;
  INSERT INTO public.erp_documento_vertical (vertical, titulo, conteudo_md, versao, vigente, origem_arquivos, resumo_mudanca, status, criado_por)
  VALUES ('estrela_polar', btrim(p_titulo), p_conteudo_md, p_versao, true, p_origem_arquivos, p_resumo_mudanca, 'rascunho', auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'versao', p_versao, 'status', 'rascunho',
    'bytes', octet_length(p_conteudo_md), 'proximo_passo', 'CEO aprova em /dashboard/dev › Estrela Polar');
END $function$;

REVOKE ALL ON FUNCTION public.fn_estrela_polar_vigente() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_estrela_polar_gravar(integer, text, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_estrela_polar_vigente() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_estrela_polar_gravar(integer, text, text, text, text[]) TO authenticated, service_role;

-- ---------- fn_briefing_sessao: guarda PS_ADMIN + chave estrela_polar (patch idempotente por âncora) ----------
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname = 'fn_briefing_sessao';

  IF v_def !~ 'apenas_ps_admin' THEN
    v_new := replace(v_def, E'BEGIN\n  SELECT * INTO v_ultimo_handoff',
      E'BEGIN\n  -- 26/09: só PS_ADMIN ou sessão sem usuário (Claude via MCP / service_role). Antes: qualquer logado lia tudo.\n'
      || E'  IF auth.uid() IS NOT NULL AND NOT public.fn_eh_ps_admin() THEN\n'
      || E'    RETURN jsonb_build_object(''ok'', false, ''erro'', ''apenas_ps_admin'');\n  END IF;\n'
      || E'  SELECT * INTO v_ultimo_handoff');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_briefing_sessao: ancora do BEGIN nao encontrada'; END IF;
    v_def := v_new;
  END IF;

  IF v_def !~ 'fn_estrela_polar_vigente' THEN
    v_new := replace(v_def, E'  RETURN v_result;\nEND;',
      E'  -- 26/09: Estrela Polar vigente, inteira, do banco (fonte única; RD-52)\n'
      || E'  v_result := v_result || jsonb_build_object(''estrela_polar'', public.fn_estrela_polar_vigente());\n'
      || E'  RETURN v_result;\nEND;');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_briefing_sessao: ancora RETURN v_result nao encontrada'; END IF;
    v_def := v_new;
  END IF;

  EXECUTE v_def;
END $do$;

REVOKE ALL ON FUNCTION public.fn_briefing_sessao() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_briefing_sessao() TO service_role;
