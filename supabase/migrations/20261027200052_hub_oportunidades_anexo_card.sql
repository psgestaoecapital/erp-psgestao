-- Hub · Oportunidades (tela 273) — badge de anexo no card do kanban + "?" dos avisos de card suspeito (auditor FC 27/10).
-- fn_crm_pipeline passa a devolver a contagem de anexos por oportunidade (antes o anexo só aparecia na ficha/detalhe).
-- SÓ ACRESCENTA o campo 'anexos' a cada card — nada mais muda. Faixa 52 (desenvolvedor_4_g).
-- (O alerta de outlier/duplicata é calculado na própria tela, sem gravar nada.)

CREATE OR REPLACE FUNCTION public.fn_crm_pipeline(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PR A2b (CEO 28/09): a empresa tem de ser do usuário (sem usuário = serviço/cron passa)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'etapas', (SELECT jsonb_agg(e) FROM (
      SELECT o.etapa, count(*) AS qtd, COALESCE(sum(o.valor_estimado),0) AS valor_total,
             jsonb_agg(jsonb_build_object(
               'id', o.id, 'titulo', o.titulo,
               'cliente', COALESCE(c.nome_fantasia, c.razao_social),
               'cliente_telefone', NULLIF(COALESCE(NULLIF(btrim(c.celular),''), NULLIF(btrim(c.whatsapp),''), NULLIF(btrim(c.telefone),'')), ''),
               'valor_estimado', o.valor_estimado, 'probabilidade', o.probabilidade,
               'responsavel_id', o.responsavel_id,
               'responsavel_nome', NULLIF(btrim(o.responsavel_nome), ''),
               'ordem', o.ordem,
               'anexos', (SELECT count(*)::int FROM erp_crm_anexo a WHERE a.oportunidade_id = o.id AND a.deleted_at IS NULL),
               'data_prevista', o.data_prevista_fechamento) ORDER BY o.ordem) AS cards
      FROM erp_crm_oportunidade o LEFT JOIN erp_clientes c ON c.id=o.cliente_id
      WHERE o.company_id=p_company_id AND o.deleted_at IS NULL AND o.etapa NOT IN ('ganho','perdido')
      GROUP BY o.etapa) e),
    'resumo', (SELECT jsonb_build_object(
      'abertas', count(*) FILTER (WHERE etapa NOT IN ('ganho','perdido')),
      'ganhas_mes', count(*) FILTER (WHERE etapa='ganho' AND data_fechamento >= date_trunc('month', now())),
      'valor_pipeline', COALESCE(sum(valor_estimado) FILTER (WHERE etapa NOT IN ('ganho','perdido')),0))
      FROM erp_crm_oportunidade WHERE company_id=p_company_id AND deleted_at IS NULL)
  );
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_pipeline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_pipeline(uuid) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/oportunidades', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.oportunidades.card_anexos', 'Kanban', 'Anexos no card', 'Calculado: quantos anexos (fotos, PDF, planta) a oportunidade tem.', 'Mostra no card se a oportunidade já tem documentação, sem precisar abrir a ficha.', '2 anexos', 'Card sem o selo: a oportunidade ainda não tem anexo — anexe pela ficha.', 70),
  ('projetos.oportunidades.card_alerta', 'Kanban', 'Aviso de card suspeito', 'Calculado: acende quando a oportunidade parece duplicada (mesmo cliente e título/valor de outra em aberto) ou tem valor atípico (muito acima da mediana das abertas).', 'Chama atenção para conferir antes de seguir — evita duplicata e erro de digitação no valor (ex.: um zero a mais).', 'Possível duplicata · Valor atípico', 'Ignorar o aviso: segue uma venda duplicada ou um valor errado pelo funil.', 71)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

-- Semente DEMO (idempotente, só is_demo): uma oportunidade duplicada do mesmo cliente/título/valor de uma existente,
-- para o aviso "possível duplicata" aparecer na foto da DEMO. KPIs seguem consistentes (soma dos cards = topo).
INSERT INTO public.erp_crm_oportunidade (id, company_id, cliente_id, titulo, etapa, valor_estimado, probabilidade, responsavel_nome, ordem)
SELECT 'b0700000-0000-4000-a000-00000c3b0001', 'b0700000-0000-4000-a000-000000000006',
       'c778374f-293b-44a5-a00f-dfc3777211a1', 'Drywall sala comercial – Horizonte', 'prospeccao', 41000.00, 30, 'Responsável Demo', 1
WHERE EXISTS (SELECT 1 FROM public.companies WHERE id='b0700000-0000-4000-a000-000000000006')
  AND EXISTS (SELECT 1 FROM public.erp_crm_oportunidade WHERE id='cdefd8a9-9e52-4425-b0c3-1680236fc6b4')
ON CONFLICT (id) DO NOTHING;
