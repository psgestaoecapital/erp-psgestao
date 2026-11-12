-- Bandeja de aprovação dos sócios: só o que de fato espera o sócio (CEO, contexto a193d29f).
-- Problema (auditado): 16-19 chamados com Code AINDA TRABALHANDO (tarefa ativa, requer_ok_ceo posto na
-- CRIAÇÃO, sem resposta/pedido pronto) apareciam como "aguardando aprovação" com botão Aprovar — se o sócio
-- aprova, atropela o trabalho (o Rodrigo quase aprovou chamados em andamento).
-- Fix (fn_pr_bandeja_listar, MESMA assinatura/grants):
--  1) bloco `nucleo` (APROVÁVEL) passa a exigir PEDIDO CONCRETO: ok_ceo_pedido_em (Code pediu o OK de núcleo)
--     OU pedido_ok_socio (resposta ao cliente redigida). Só `requer_ok_ceo` (flag de criação) NÃO basta.
--  2) novo bloco `em_andamento` (INFORMATIVO, sem botão na tela): requer_ok_ceo SEM pedido — o Code ainda trabalha.
--  3) chamado resolvido/encerrado (sugestao concluida/arquivada/duplicada) sai dos dois blocos sozinho.
--  4) PR já DECIDIDA (há linha em erp_pr_aprovacao) não reaparece em `aguardando`.
-- Sem mudança de dado; sem NULL em NOT NULL. Guardada por fn__aprovador_pr_assert (só aprovadores).

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
    -- PRs sensíveis aguardando: exclui as que já têm decisão registrada (não reaparecem antes do cron sincronizar)
    'aguardando', coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.entrou_em)
        FROM public.erp_pr_bandeja b
        WHERE b.situacao = 'aguardando'
          AND NOT EXISTS (SELECT 1 FROM public.erp_pr_aprovacao a WHERE a.pr_numero = b.pr_numero)), '[]'::jsonb),
    'decididas', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.aprovado_em DESC) FROM (
        SELECT a.pr_numero, a.decisao, a.justificativa, a.aprovado_nome, a.aprovado_em, a.sincronizado_em, a.sincronizado_resultado,
               b.titulo, b.url, b.code
        FROM public.erp_pr_aprovacao a LEFT JOIN public.erp_pr_bandeja b ON b.pr_numero = a.pr_numero
        ORDER BY a.aprovado_em DESC LIMIT 20) x), '[]'::jsonb),
    -- APROVÁVEL: núcleo/chamado com PEDIDO concreto (Code pediu o OK) e chamado ainda não resolvido
    'nucleo', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', m.id, 'para', m.para, 'de', m.de, 'assunto', m.assunto,
          'criado_em', m.criado_em, 'corpo', left(m.corpo, 600),
          'sensivel', m.sensivel,
          'chamado_numero', s.numero, 'chamado_titulo', s.titulo,
          'empresa', coalesce(c.nome_fantasia, c.razao_social)) ORDER BY m.criado_em)
      FROM public.erp_agente_mensagem m
      LEFT JOIN public.sugestoes s ON s.id = m.sugestao_id OR (m.sugestao_id IS NULL AND s.numero = m.chamado_numero)
      LEFT JOIN public.companies c ON c.id = s.company_id
      WHERE m.requer_ok_ceo AND m.ok_ceo_em IS NULL AND NOT coalesce(m.arquivada, false)
        AND m.status NOT IN ('concluida','recusada')
        AND (m.ok_ceo_pedido_em IS NOT NULL OR m.pedido_ok_socio IS NOT NULL)
        AND coalesce(s.status, '') NOT IN ('concluida','arquivada','duplicada')), '[]'::jsonb),
    -- EM ANDAMENTO (só informativo): requer_ok_ceo SEM pedido pronto — o Code ainda está trabalhando
    'em_andamento', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', m.id, 'para', m.para, 'de', m.de, 'assunto', m.assunto,
          'criado_em', m.criado_em,
          'sensivel', m.sensivel,
          'chamado_numero', s.numero, 'chamado_titulo', s.titulo,
          'empresa', coalesce(c.nome_fantasia, c.razao_social)) ORDER BY m.criado_em)
      FROM public.erp_agente_mensagem m
      LEFT JOIN public.sugestoes s ON s.id = m.sugestao_id OR (m.sugestao_id IS NULL AND s.numero = m.chamado_numero)
      LEFT JOIN public.companies c ON c.id = s.company_id
      WHERE m.requer_ok_ceo AND m.ok_ceo_em IS NULL AND NOT coalesce(m.arquivada, false)
        AND m.status NOT IN ('concluida','recusada')
        AND m.ok_ceo_pedido_em IS NULL AND m.pedido_ok_socio IS NULL
        AND coalesce(s.status, '') NOT IN ('concluida','arquivada','duplicada')), '[]'::jsonb)
  );
END;
$function$;

-- Grants idênticos ao vivo (CREATE OR REPLACE preserva; reafirmado por clareza): sem anon.
REVOKE ALL ON FUNCTION public.fn_pr_bandeja_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pr_bandeja_listar() TO authenticated, service_role;

-- RD-95: "?" da nova seção informativa "Em andamento pelo Code".
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES ('dev.aprovar.em_andamento', 'Aprovações dos sócios', 'Em andamento pelo Code',
  'Nada a fazer: é só informativo. Aqui ficam os chamados/pedidos de núcleo que o Code ainda está trabalhando e que não têm resposta/pedido pronto.',
  'Dar visibilidade do que está em andamento sem risco de aprovar algo pela metade — só o que o Code deixou pronto (com pedido) aparece para aprovar acima.',
  'Chamado sensível recém-recebido: o Code ainda está diagnosticando; não há o que aprovar.',
  'Cobrar aprovação daqui: ainda não é para aprovar — aguarde o Code deixar o pedido pronto.', 5,
  '/dashboard/dev/codes', 'dev', 'publicado')
ON CONFLICT (chave) DO NOTHING;
