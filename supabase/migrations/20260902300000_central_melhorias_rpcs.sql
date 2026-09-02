-- Central de Melhorias · Fase 1 · RPCs + view da fila.
-- Fluxo: nova → em_analise → aceita → em_desenvolvimento → concluida  (↘ recusada exige motivo ↘ duplicada).
-- IA é sugestão, nunca decisão: ia_analise fica separado da resposta do atendente (RD-51). Teto USD 5/dia.

-- criar sugestão (nasce na empresa de quem abriu) + anexos (foto/marcação). Foto é opcional (decisão CEO).
CREATE OR REPLACE FUNCTION public.fn_sugestao_criar(
  p_company_id uuid, p_sugestao jsonb, p_anexos jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_email text; v_nome text; v_an jsonb; v_ord int := 0;
BEGIN
  IF p_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_usuario'); END IF;
  SELECT email, COALESCE(full_name, email) INTO v_email, v_nome FROM users WHERE id = p_user;

  INSERT INTO sugestoes (user_id, user_email, user_name, tipo, titulo, descricao, prioridade, status,
      company_id, rota, area, categoria)
  VALUES (p_user, v_email, v_nome, COALESCE(p_sugestao->>'tipo','melhoria'),
      NULLIF(p_sugestao->>'titulo',''), p_sugestao->>'descricao',
      COALESCE(NULLIF(p_sugestao->>'prioridade',''),'media'), 'nova',
      p_company_id, p_sugestao->>'rota', p_sugestao->>'area', NULLIF(p_sugestao->>'categoria',''))
  RETURNING id INTO v_id;

  IF p_anexos IS NOT NULL AND jsonb_typeof(p_anexos) = 'array' THEN
    FOR v_an IN SELECT * FROM jsonb_array_elements(p_anexos) LOOP
      INSERT INTO sugestao_anexo (sugestao_id, company_id, storage_path, url_publica, tipo, marcacoes, ordem, created_by)
      VALUES (v_id, p_company_id, v_an->>'storage_path', v_an->>'url_publica',
              COALESCE(v_an->>'tipo','imagem'), COALESCE(v_an->'marcacoes','[]'::jsonb), v_ord, p_user);
      v_ord := v_ord + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- transições de status. recusada exige motivo (§4.1/§5.3). assumir grava atendente. concluir grava data (+pr).
CREATE OR REPLACE FUNCTION public.fn_sugestao_status(
  p_id uuid, p_novo text, p_user uuid, p_motivo text DEFAULT NULL, p_pr_numero integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_atual text;
BEGIN
  IF NOT (is_admin() OR fn_pode_ver_fila_suporte()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT status INTO v_atual FROM sugestoes WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'sugestao_nao_encontrada'); END IF;
  IF p_novo NOT IN ('nova','em_analise','aceita','em_desenvolvimento','concluida','recusada','duplicada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido'); END IF;
  IF p_novo = 'recusada' AND COALESCE(trim(p_motivo),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'recusa_exige_motivo'); END IF;  -- §5.3

  UPDATE sugestoes SET
    status = p_novo,
    atendente_id = COALESCE(atendente_id, p_user),          -- quem mexeu assume, se ninguém assumiu
    resposta = CASE WHEN p_motivo IS NOT NULL AND trim(p_motivo) <> '' THEN p_motivo ELSE resposta END,
    pr_numero = COALESCE(p_pr_numero, pr_numero),
    concluido_em = CASE WHEN p_novo = 'concluida' THEN now() ELSE concluido_em END,
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'status', p_novo,
    'concluida_sem_pr', (p_novo='concluida' AND p_pr_numero IS NULL AND (SELECT pr_numero FROM sugestoes WHERE id=p_id) IS NULL));  -- §5.4 sinaliza
END $function$;

-- atendente assume a sugestão (aparece como "em_analise" e grava quem pegou)
CREATE OR REPLACE FUNCTION public.fn_sugestao_assumir(p_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (is_admin() OR fn_pode_ver_fila_suporte()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE sugestoes SET atendente_id = p_user, status = CASE WHEN status='nova' THEN 'em_analise' ELSE status END, updated_at=now()
   WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'sugestao_nao_encontrada'); END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- gasto de IA hoje (para o teto de USD 5/dia — a edge function checa antes de chamar a Claude)
CREATE OR REPLACE FUNCTION public.fn_sugestao_ia_gasto_hoje()
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(ia_custo_usd),0)::numeric FROM sugestoes WHERE ia_analisado_em::date = CURRENT_DATE
$function$;

-- registra a análise da IA (chamado pela edge function). Separado da resposta do atendente (RD-51).
CREATE OR REPLACE FUNCTION public.fn_sugestao_ia_registrar(p_id uuid, p_analise jsonb, p_custo numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE sugestoes SET ia_analise = p_analise, ia_analisado_em = now(), ia_custo_usd = COALESCE(p_custo,0)
   WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'sugestao_nao_encontrada'); END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- view da fila: RLS de sugestoes já gateia (fila-suporte vê todas; dono vê as suas). Junta empresa,
-- nº de anexos, e se tem IA (para a tela mostrar "não analisada" quando não, RD-51 §5.2).
CREATE OR REPLACE VIEW public.v_sugestao_fila WITH (security_invoker=on) AS
SELECT s.id, s.company_id, c.nome_fantasia AS empresa, s.user_email, s.user_name,
       s.tipo, s.titulo, s.descricao, s.categoria, s.prioridade, s.status, s.rota, s.area,
       s.atendente_id, s.pr_numero, s.resposta, s.concluido_em,
       (s.ia_analise IS NOT NULL) AS tem_ia, s.ia_analise, s.ia_analisado_em,
       (SELECT count(*) FROM sugestao_anexo a WHERE a.sugestao_id = s.id) AS n_anexos,
       s.created_at,
       (EXTRACT(EPOCH FROM (now() - s.created_at))/86400)::int AS dias_aberta
FROM sugestoes s
LEFT JOIN companies c ON c.id = s.company_id;

REVOKE ALL ON FUNCTION public.fn_sugestao_criar(uuid,jsonb,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sugestao_status(uuid,text,uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sugestao_assumir(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sugestao_ia_registrar(uuid,jsonb,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_criar(uuid,jsonb,jsonb,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_status(uuid,text,uuid,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_assumir(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_ia_gasto_hoje() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_ia_registrar(uuid,jsonb,numeric) TO service_role;
GRANT SELECT ON public.v_sugestao_fila TO authenticated, service_role;
