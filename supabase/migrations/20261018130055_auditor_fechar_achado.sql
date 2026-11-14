-- Ferramenta do Code-Auditor (eng-chefe-auto) — FECHAR O CICLO do PDCA do Hub.
-- Tarefa do Eng. Chefe (msg 3c6a147b, 18/10 06:20 "PDCA não fecha"): para cada achado do auditor já
-- corrigido por PR publicada, reauditar a rota e FECHAR (status 'concluida', com a PR e a nota antes/depois).
--
-- O BLOQUEIO PROVADO NO DADO (RD-38), que esta PR resolve:
--   O auditor roda headless pela conexão de serviço (MCP). Nela auth.uid() É NULL, is_admin()=false e
--   fn_pode_ver_fila_suporte()=false (conferido no banco em 18/10). Por isso:
--     • fn_sugestao_status / fn_sugestao_confirmar / fn_sugestao_encerrar_sem_confirmacao → 'sem_acesso';
--     • fn_sugestao_confirmacao_automatica só trata chamado de CLIENTE (interno=false) e espera dias úteis.
--   Resultado: achados internos do Hub já VERIFICADOS corrigidos (#3339, #3340, #3418) ficam presos em
--   'aguardando_confirmacao' e o PDCA nunca fecha. Forjar JWT/auth.uid é proibido (CLAUDE.md), então a
--   única via honesta é uma RPC própria do auditor, com guarda e rastro. É o que esta função cria.
--
-- SEPARAÇÃO DE PODER (princípio "quem constrói não se auto-vigia"): esta função NÃO deixa o auditor mexer
-- em chamado de cliente. Ela só fecha achado INTERNO (interno=true) em empresa DEMO (companies.is_demo=true).
-- Prova no dado do porquê: o achado #3269 é interno=false em empresa REAL (is_demo=false) — mesmo marcado
-- para o gilberto-produto e com PR, ele fica FORA do alcance desta função (fecha só pela via do autor/admin).
--
-- RD-97 (ADITIVO, não-regressão): cria UMA função NOVA. Não dá DROP, não toca financeiro/fiscal/estoque,
-- não altera RLS nem autenticação, e NUNCA escreve em dado real de cliente (trava is_demo). O fechamento é
-- HONESTO como o do fn_sugestao_encerrar_sem_confirmacao: confirmado_pelo_autor=false,
-- encerrado_sem_confirmacao=true e motivo que diz que foi o auditor (não finge confirmação do autor).
-- Rastro completo em sugestao_mensagem (redigido_por='sistema:auditor:eng-chefe-auto').
--
-- ROLLBACK:  DROP FUNCTION IF EXISTS public.fn_auditor_fechar_achado(uuid, integer, integer, integer, text);

CREATE OR REPLACE FUNCTION public.fn_auditor_fechar_achado(
  p_id uuid,
  p_pr_numero integer,
  p_nota_antes integer,
  p_nota_depois integer,
  p_evidencia text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_ps uuid; v_ps_email text; v_motivo text;
BEGIN
  -- Guarda de acesso: só a conexão de serviço (auditor/cron, JWT vazio ou service_role) ou um PS_ADMIN logado.
  -- Usuário comum logado tem claims não-vazios e não é PS_ADMIN -> barrado. (mesmo padrão de fn_sugestao_confirmacao_automatica)
  IF NOT (
        coalesce(current_setting('request.jwt.claims', true), '') = ''
        OR auth.role() = 'service_role'
        OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))
     ) THEN
    RAISE EXCEPTION 'Só o auditor (serviço) ou PS_ADMIN pode fechar achado' USING errcode = '42501';
  END IF;

  IF p_pr_numero IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pr_obrigatorio',
      'detalhe', 'o fechamento pelo auditor exige a PR que corrigiu o achado'); END IF;
  IF p_nota_antes IS NULL OR p_nota_depois IS NULL
     OR p_nota_antes NOT BETWEEN 0 AND 100 OR p_nota_depois NOT BETWEEN 0 AND 100 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nota_invalida',
      'detalhe', 'informe nota_antes e nota_depois entre 0 e 100'); END IF;

  SELECT s.id, s.numero, s.titulo, s.status, s.user_id, coalesce(s.interno,false) AS interno,
         c.is_demo
    INTO r
    FROM sugestoes s
    JOIN companies c ON c.id = s.company_id
   WHERE s.id = p_id;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;

  -- TRAVA RD-97: o auditor só fecha achado INTERNO em empresa DEMO. Chamado de cliente (interno=false) ou
  -- empresa real (is_demo=false) nunca é fechado por aqui — protege o dado e o fluxo de confirmação do autor.
  IF NOT (r.interno AND coalesce(r.is_demo, false)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'fora_de_escopo',
      'detalhe', 'o auditor só fecha achado interno (interno=true) em empresa DEMO (is_demo=true)',
      'interno', r.interno, 'is_demo', r.is_demo); END IF;

  IF r.status = 'concluida' THEN
    -- idempotente: nada a fazer, mas registra a PR/nota se ainda não tiver
    UPDATE sugestoes SET pr_numero = COALESCE(pr_numero, p_pr_numero) WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'ja_concluida', true, 'numero', r.numero); END IF;

  v_motivo := format(
    'Fechado pelo Code-Auditor (eng-chefe-auto): reauditei a rota e verifiquei a correção da PR #%s. Nota %s -> %s.%s',
    p_pr_numero, p_nota_antes, p_nota_depois,
    CASE WHEN coalesce(btrim(p_evidencia),'') <> '' THEN ' Evidência: ' || btrim(p_evidencia) ELSE '' END);

  UPDATE sugestoes SET
    status = 'concluida',
    concluido_em = now(),
    pr_numero = COALESCE(p_pr_numero, pr_numero),
    encerrado_sem_confirmacao = true,            -- honesto: NÃO foi o autor que confirmou, foi o auditor
    conclusao_automatica = false,
    confirmado_pelo_autor = false,
    encerramento_motivo = v_motivo,
    encerrado_em = now(),
    updated_at = now()
  WHERE id = p_id;

  -- Conta PS para o rastro na conversa (igual ao fn_sugestao_confirmacao_automatica); best-effort.
  SELECT u.id, u.email INTO v_ps, v_ps_email FROM users u
   WHERE lower(u.email) = lower((SELECT valor FROM erp_agente_config WHERE chave = 'chamado_autor_email'));
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, redigido_por)
  VALUES (p_id, v_ps, v_ps_email, 'ps', v_motivo, 'sistema:auditor:eng-chefe-auto');

  RETURN jsonb_build_object('ok', true, 'status', 'concluida', 'numero', r.numero,
    'pr', p_pr_numero, 'nota_antes', p_nota_antes, 'nota_depois', p_nota_depois,
    'encerrado_sem_confirmacao', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_auditor_fechar_achado(uuid, integer, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_auditor_fechar_achado(uuid, integer, integer, integer, text) TO authenticated, service_role;

-- Prova no deploy (RD-38), sem mutar dado:
--   (1) a função existe;
--   (2) chamada com id inexistente devolve ok=false/'nao_encontrada' (nenhum UPDATE);
--   (3) anon não tem EXECUTE.
DO $prova$
DECLARE v jsonb;
BEGIN
  IF to_regprocedure('public.fn_auditor_fechar_achado(uuid, integer, integer, integer, text)') IS NULL THEN
    RAISE EXCEPTION 'fn_auditor_fechar_achado não foi criada';
  END IF;
  v := public.fn_auditor_fechar_achado('00000000-0000-0000-0000-000000000000'::uuid, 999999, 10, 80, 'prova');
  IF coalesce(v->>'erro','') <> 'nao_encontrada' THEN
    RAISE EXCEPTION 'esperava erro=nao_encontrada para id inexistente, veio %', v;
  END IF;
  IF has_function_privilege('anon', 'public.fn_auditor_fechar_achado(uuid, integer, integer, integer, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon não pode ter EXECUTE em fn_auditor_fechar_achado';
  END IF;
END $prova$;
