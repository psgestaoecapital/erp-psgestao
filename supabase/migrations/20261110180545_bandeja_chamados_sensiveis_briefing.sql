-- Bandeja "Aprovações dos sócios" passa a mostrar também os chamados SENSÍVEIS esperando OK do CEO, e o briefing
-- ganha o bloco CHAMADOS (RD 329fe62e, CEO 09/11). Aditiva: 1 função nova e 2 CREATE OR REPLACE, corpos iguais aos
-- vivos exceto onde indicado. Sem cron, sem frequência, sem execução no merge.
--
-- 1) fn_pr_bandeja_listar: cada item de 'nucleo' ganha chamado_numero, chamado_titulo, empresa e sensivel.
--    Resto igual (aguardando, decididas, guarda do aprovador).
-- 2) fn_chamados_briefing (nova): bloco CHAMADOS do briefing. Só números e contagens (LGPD: sem título/descrição).
--    Guarda igual ao briefing: sessão sem usuário ou PS_ADMIN.
-- 3) fn_briefing_blueprints: passa a anexar o bloco 'chamados' ao briefing (corpo antigo preservado).

-- ── 1. Bandeja: núcleo com dados do chamado ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pr_bandeja_listar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_nome text := public.fn__aprovador_pr_assert();
BEGIN
  RETURN jsonb_build_object(
    'ok', true, 'eu', v_nome,
    'aguardando', coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.entrou_em) FROM public.erp_pr_bandeja b WHERE b.situacao = 'aguardando'), '[]'::jsonb),
    'decididas', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.aprovado_em DESC) FROM (
        SELECT a.pr_numero, a.decisao, a.justificativa, a.aprovado_nome, a.aprovado_em, a.sincronizado_em, a.sincronizado_resultado,
               b.titulo, b.url, b.code
        FROM public.erp_pr_aprovacao a LEFT JOIN public.erp_pr_bandeja b ON b.pr_numero = a.pr_numero
        ORDER BY a.aprovado_em DESC LIMIT 20) x), '[]'::jsonb),
    'nucleo', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', m.id, 'para', m.para, 'de', m.de, 'assunto', m.assunto,
          'criado_em', m.criado_em, 'corpo', left(m.corpo, 600),
          'sensivel', m.sensivel,
          'chamado_numero', s.numero,
          'chamado_titulo', s.titulo,
          'empresa', coalesce(c.nome_fantasia, c.razao_social)) ORDER BY m.criado_em)
      FROM public.erp_agente_mensagem m
      LEFT JOIN public.sugestoes s ON s.id = m.sugestao_id OR (m.sugestao_id IS NULL AND s.numero = m.chamado_numero)
      LEFT JOIN public.companies c ON c.id = s.company_id
      WHERE m.requer_ok_ceo AND m.ok_ceo_em IS NULL AND NOT coalesce(m.arquivada, false)
        AND m.status NOT IN ('concluida','recusada')), '[]'::jsonb)
  );
END;
$function$;

-- ── 2. Bloco CHAMADOS do briefing ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_chamados_briefing()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_orfaos jsonb; v_sens jsonb; v_parados int; v_resolvidos int;
BEGIN
  -- mesma guarda do briefing: sessão de usuário só para PS_ADMIN; sessão de serviço passa
  IF auth.uid() IS NOT NULL AND NOT public.fn_eh_ps_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- ativos sem dono: sem agente e sem dono de sócio pelo escopo
  SELECT coalesce(jsonb_agg(x.numero ORDER BY x.numero), '[]'::jsonb) INTO v_orfaos
    FROM (SELECT s.numero FROM public.sugestoes s
           WHERE s.status IN ('nova', 'em_analise', 'em_desenvolvimento', 'aguardando_confirmacao')
             AND coalesce(s.interno, false) = false AND s.numero IS NOT NULL
             AND (s.agente IS NULL OR s.agente = '')
             AND public.fn_chamado_agente_dono(s.id) IS NULL) x;

  -- sensíveis esperando OK do CEO: tarefa de chamado com requer_ok_ceo e sem OK
  SELECT coalesce(jsonb_agg(jsonb_build_object('chamado', y.n, 'desde', y.d) ORDER BY y.d), '[]'::jsonb) INTO v_sens
    FROM (SELECT coalesce(s.numero, m.chamado_numero) AS n, m.criado_em AS d
            FROM public.erp_agente_mensagem m
            LEFT JOIN public.sugestoes s ON s.id = m.sugestao_id OR (m.sugestao_id IS NULL AND s.numero = m.chamado_numero)
           WHERE m.requer_ok_ceo AND m.ok_ceo_em IS NULL AND NOT coalesce(m.arquivada, false)
             AND m.status NOT IN ('concluida', 'recusada')
             AND (m.sugestao_id IS NOT NULL OR m.chamado_numero IS NOT NULL)) y;

  -- ativos parados há mais de 3 dias
  SELECT count(*) INTO v_parados FROM public.sugestoes s
   WHERE s.status IN ('nova', 'em_analise', 'em_desenvolvimento', 'aguardando_confirmacao')
     AND coalesce(s.interno, false) = false AND s.numero IS NOT NULL
     AND coalesce(s.ultimo_movimento, s.created_at) < now() - interval '3 days';

  -- resolvidos nos últimos 7 dias
  SELECT count(*) INTO v_resolvidos FROM public.sugestoes s
   WHERE s.status = 'concluida' AND s.concluido_em >= now() - interval '7 days';

  RETURN jsonb_build_object(
    'ok', true,
    'orfaos_sem_dono', jsonb_build_object('n', jsonb_array_length(v_orfaos), 'numeros', v_orfaos),
    'sensiveis_aguardando_ok', jsonb_build_object('n', jsonb_array_length(v_sens), 'itens', v_sens),
    'ativos_parados_3d', v_parados,
    'resolvidos_7d', v_resolvidos);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_chamados_briefing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_chamados_briefing() TO authenticated, service_role;

-- ── 3. Briefing: bloco CHAMADOS anexado (o resto do corpo fica igual) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_briefing_blueprints()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('chamados', public.fn_chamados_briefing())
     || jsonb_build_object(
    'blueprints_vigentes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'vertical', d.vertical,
               'versao', d.versao,
               'titulo', d.titulo,
               'data', COALESCE(d.aprovado_em, d.criado_em)::date)
             ORDER BY d.vertical)
        FROM public.erp_documento_vertical d
       WHERE d.vigente IS TRUE), '[]'::jsonb),
    'ponto_de_partida', (
      SELECT jsonb_build_object('titulo', c.titulo, 'descricao', c.descricao,
                                'atualizado_em', COALESCE(c.atualizado_em, c.criado_em), 'id', c.id)
        FROM public.erp_contexto_projeto c
       WHERE 'ponto-de-partida' = ANY (c.tags)
       ORDER BY COALESCE(c.atualizado_em, c.criado_em) DESC, c.criado_em DESC
       LIMIT 1));
$function$;

REVOKE ALL ON FUNCTION public.fn_pr_bandeja_listar() FROM PUBLIC, anon;
