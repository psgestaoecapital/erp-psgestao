-- Chamado #6724 (Vianz · vale para toda empresa com OS): relatório de Ordens de Serviço por período.
-- Só leitura. RPC nova com guarda: empresa do usuário (ou admin) e SEM acesso a valor para o mecânico
-- (mesma trava de fn_oficina_os_listar). Ordens excluídas ou canceladas não entram.
-- Aditiva: função nova + registro da tela + textos de ajuda "?" (RD-95). Não altera dado de cliente.
CREATE OR REPLACE FUNCTION public.fn_os_relatorio_periodo(
  p_company_id uuid, p_de date, p_ate date, p_base text DEFAULT 'abertura')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_col text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF public.fn_oficina_papel(p_company_id) = 'OFICINA_MECANICO' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'seu perfil não vê valores de ordens de serviço');
  END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'período inválido');
  END IF;
  IF p_ate - p_de > 400 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'período máximo de 400 dias');
  END IF;
  IF p_base NOT IN ('abertura', 'conclusao', 'entrega') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'base de data inválida');
  END IF;

  WITH base AS (
    SELECT o.id, o.numero, o.cliente_nome, o.placa, o.status,
           COALESCE(o.valor_servico, 0) AS servico, COALESCE(o.valor_materiais, 0) AS pecas,
           COALESCE(o.total, 0) AS total,
           CASE p_base WHEN 'conclusao' THEN o.data_conclusao::date
                       WHEN 'entrega' THEN o.entregue_em::date
                       ELSE o.data_abertura::date END AS data_ref
    FROM erp_os o
    WHERE o.company_id = p_company_id AND o.excluida = false AND o.cancelada_em IS NULL
  ), f AS (SELECT * FROM base WHERE data_ref BETWEEN p_de AND p_ate)
  SELECT jsonb_build_object(
    'ok', true, 'base', p_base,
    'totais', (SELECT jsonb_build_object('qtd', count(*), 'servico', COALESCE(sum(servico),0),
                 'pecas', COALESCE(sum(pecas),0), 'total', COALESCE(sum(total),0)) FROM f),
    'por_status', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'qtd', q, 'servico', s, 'pecas', p, 'total', t) ORDER BY t DESC)
                 FROM (SELECT status, count(*) q, sum(servico) s, sum(pecas) p, sum(total) t FROM f GROUP BY status) x), '[]'::jsonb),
    'itens', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'numero', numero, 'cliente_nome', cliente_nome,
                 'placa', placa, 'status', status, 'data_ref', data_ref, 'servico', servico, 'pecas', pecas, 'total', total)
                 ORDER BY data_ref DESC, numero DESC) FROM (SELECT * FROM f LIMIT 2000) y), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.fn_os_relatorio_periodo(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_relatorio_periodo(uuid, date, date, text) TO authenticated;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, views_consumidas, rpcs_chamadas, estado_real, prioridade_monitoramento)
VALUES (gen_random_uuid(), '/dashboard/os/relatorio', 'oficina', 'Relatório de Ordens de Serviço por período',
  'Soma de serviços, peças e total das ordens de serviço num período (mês ou datas livres), por situação, com a lista das ordens; escolhe a data usada (abertura, conclusão ou entrega). Só leitura; não vale para o perfil mecânico.',
  ARRAY['erp_os'], ARRAY['fn_os_relatorio_periodo'], 'parcial', 'media')
ON CONFLICT (rota) DO UPDATE SET titulo = EXCLUDED.titulo, descricao_funcional = EXCLUDED.descricao_funcional,
  views_consumidas = EXCLUDED.views_consumidas, rpcs_chamadas = EXCLUDED.rpcs_chamadas, atualizado_em = now();

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Relatório de OS', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/os/relatorio', 'oficina', 'publicado'
FROM (VALUES
 ('os.relatorio.periodo', 'Período', 'Escolha o dia inicial e o dia final (ou use os atalhos de mês).',
  'Define quais ordens entram na soma.', 'Do dia 01/10 ao dia 31/10 para ver outubro inteiro.',
  'Esquecer que o dia final também entra na soma.', 10),
 ('os.relatorio.base_data', 'Data usada', 'Escolha qual data decide se a ordem cai no período: abertura, conclusão ou entrega.',
  'Uma ordem aberta em setembro e entregue em outubro aparece em outubro se a base for "entrega".', 'Para saber quanto foi entregue no mês, use "entrega".',
  'Comparar dois relatórios com datas-base diferentes e achar que os números estão errados.', 11),
 ('os.relatorio.totais', 'Totais do período', 'Não preenche: mostra quantidade, serviços, peças e total.',
  'Soma os valores gravados em cada ordem; não inclui ordens excluídas nem canceladas.', 'Outubro com 1 ordem aprovada de R$ 1.249,85 mostra esse mesmo total.',
  'Estranhar total zero: ordens abertas ou em orçamento sem valor lançado somam R$ 0,00.', 12),
 ('os.relatorio.por_situacao', 'Por situação', 'Não preenche: separa a soma por situação da ordem.',
  'Mostra quanto está entregue, aprovado, aberto etc.', 'Entregue: 5 ordens, R$ 8.000,00.',
  'Somar a coluna de situações e o total já mostrado: é a mesma soma, só dividida.', 13)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
