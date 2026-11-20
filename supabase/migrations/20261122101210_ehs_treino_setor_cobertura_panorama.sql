-- PS EHS · M8 (/dashboard/ehs/treinamentos-por-setor · NR-8) — panorama de cobertura.
-- A tela abria só com o seletor "Escolha o setor…" e espaço vazio: o usuário não via
-- quais setores já têm treinamentos marcados nem o que falta (aud8, critério d parcial).
-- RPC read-only que devolve, por setor da empresa, a contagem de exigências marcadas
-- (compliance_exigencia_setor ativo). Mesma guarda das demais (fn_compliance_assert).
-- Aditiva/idempotente, sem tocar dado de cliente, RLS nem cálculo. REVOKE anon.
-- Code: dev7claudeps

CREATE OR REPLACE FUNCTION public.fn_compliance_setores_cobertura(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(y.x ORDER BY y.x->>'setor'), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
             'setor', q.setor,
             'setor_id', q.setor_id,
             'marcados', (SELECT count(*) FROM public.compliance_exigencia_setor es
                           WHERE es.company_id = p_company_id AND es.setor_id = q.setor_id AND es.ativo)
           ) AS x
    FROM (SELECT DISTINCT setor, setor_id
            FROM public.compliance_funcionarios
           WHERE company_id = p_company_id AND ativo AND setor_id IS NOT NULL) q
  ) y;
  RETURN jsonb_build_object('ok', true, 'setores', v);
END $function$;

REVOKE ALL ON FUNCTION public.fn_compliance_setores_cobertura(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_compliance_setores_cobertura(uuid) TO authenticated, service_role;

-- RD-95: ajuda do panorama
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
 'compliance.treinamentos_por_setor.panorama', '/dashboard/ehs/treinamentos-por-setor', 'Treinamentos por setor', 'Panorama de cobertura',
 'Não preenche: é um painel. Cada cartão é um setor da empresa e mostra quantos treinamentos já estão marcados como obrigatórios para ele. Clique no cartão para abrir o detalhe e marcar/desmarcar.',
 'Dá a visão geral antes de escolher um setor: você vê de relance quais setores já foram configurados e quais ainda estão sem nenhum treinamento marcado.',
 'O cartão "Abate" com "3 marcados" já tem 3 treinamentos definidos; um setor com "nenhum ainda" precisa de atenção.',
 'Achar que "nenhum ainda" significa que o setor não exige nada: pode já exigir pela regra atual (cargo/escopo); aqui você só acrescenta por setor.',
 'ehs', 10, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
