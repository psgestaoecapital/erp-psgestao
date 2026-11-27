-- Plano de Ação 5W2H — slice 2 (Hub): a listagem passa a devolver a obra ligada à ação, para o
-- seletor de obra do formulário (rota Hub) pré-selecionar no modo edição, e seed do "?" (RD-95) do campo.
-- Aditivo: só ACRESCENTA obra_id/obra_numero/obra_nome ao JSON de cada linha (LEFT JOIN em projetos_obras);
-- nenhum filtro, RLS ou coluna existente muda. Depende do writer (slice 1, fn_plano_acao_salvar lê obra_id)
-- para que a gravação persista — enquanto o writer não entrar, obra_id vem sempre nulo (comportamento idêntico ao atual).
-- Code: code-desenvolvedor-3

CREATE OR REPLACE FUNCTION public.fn_plano_acao_listar(
  p_company_id uuid,
  p_status text DEFAULT NULL::text,
  p_responsavel uuid DEFAULT NULL::uuid,
  p_setor uuid DEFAULT NULL::uuid,
  p_prioridade text DEFAULT NULL::text,
  p_origem text DEFAULT NULL::text,
  p_so_atrasadas boolean DEFAULT false,
  p_busca text DEFAULT NULL::text,
  p_reuniao uuid DEFAULT NULL::uuid,
  p_incluir_arquivadas boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; q text := nullif(btrim(p_busca),'');
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT jsonb_agg(row_to_json(a) ORDER BY a.prazo_ord NULLS LAST, a.criado_em DESC) INTO v FROM (
    SELECT pa.id, pa.codigo, pa.titulo, pa.o_que, pa.por_que, pa.onde, pa.setor_id, s.nome AS setor_nome,
           pa.quando, pa.responsavel_user_id, pa.responsavel_nome, pa.como, pa.custo_estimado, pa.custo_real,
           pa.status, pa.prioridade, pa.origem, pa.origem_ref, pa.indicador_vinculado, pa.resultado_obtido,
           pa.reuniao_id, re.codigo AS reuniao_codigo, re.titulo AS reuniao_titulo,
           pa.obra_id, ob.numero AS obra_numero, ob.nome AS obra_nome,
           pa.concluida_em, pa.criado_em, pa.atualizado_em,
           (pa.quando IS NOT NULL AND pa.quando < current_date AND pa.status NOT IN ('concluida','cancelada')) AS atrasada,
           pa.arquivada, pa.arquivada_em,
           pa.quando AS prazo_ord
    FROM erp_plano_acao pa
    LEFT JOIN prod_setor s ON s.id = pa.setor_id
    LEFT JOIN erp_plano_acao_reuniao re ON re.id = pa.reuniao_id
    LEFT JOIN projetos_obras ob ON ob.id = pa.obra_id AND ob.company_id = pa.company_id AND ob.deleted_at IS NULL
    WHERE pa.company_id = p_company_id AND pa.excluido_em IS NULL
      AND (p_incluir_arquivadas OR NOT pa.arquivada)
      AND (p_status IS NULL OR pa.status = p_status)
      AND (p_responsavel IS NULL OR pa.responsavel_user_id = p_responsavel)
      AND (p_setor IS NULL OR pa.setor_id = p_setor)
      AND (p_prioridade IS NULL OR pa.prioridade = p_prioridade)
      AND (p_origem IS NULL OR pa.origem = p_origem)
      AND (p_reuniao IS NULL OR pa.reuniao_id = p_reuniao)
      AND (NOT p_so_atrasadas OR (pa.quando IS NOT NULL AND pa.quando < current_date AND pa.status NOT IN ('concluida','cancelada')))
      AND (q IS NULL OR pa.titulo ILIKE '%'||q||'%' OR pa.codigo ILIKE '%'||q||'%'
           OR coalesce(pa.o_que,'') ILIKE '%'||q||'%' OR coalesce(pa.responsavel_nome,'') ILIKE '%'||q||'%'
           OR coalesce(pa.origem_ref,'') ILIKE '%'||q||'%' OR coalesce(re.titulo,'') ILIKE '%'||q||'%' OR coalesce(re.codigo,'') ILIKE '%'||q||'%')
  ) a;
  RETURN jsonb_build_object('ok',true,'resultados',coalesce(v,'[]'::jsonb));
END $function$;

-- Seed do "?" (RD-95) do campo Obra do formulário — só na rota Hub (é onde o seletor aparece).
-- Idempotente: ON CONFLICT (chave) atualiza o texto; chave única por campo (não por rota).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'hub.plano_acao.obra',
  '/dashboard/hub/plano-acao',
  'Plano de Ação 5W2H',
  'Obra (opcional)',
  'A obra do Hub de Projetos a que esta ação pertence.',
  'Liga a ação à obra para ela aparecer no bloco "Ações abertas desta obra" do cockpit da obra.',
  'Obra "001 — Reforma do galpão".',
  'Deixar em branco quando a ação é de uma obra específica — aí ela não aparece no cockpit daquela obra.',
  'projetos',
  18,
  'publicado'
)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, status = EXCLUDED.status, atualizado_em = now();

-- ACL da função SECURITY DEFINER recriada (check_fn_guards): espelha a ACL viva
-- (authenticated + service_role; anon/PUBLIC revogados). Conteúdo da função inalterado.
REVOKE ALL ON FUNCTION public.fn_plano_acao_listar(uuid,text,uuid,uuid,text,text,boolean,text,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_listar(uuid,text,uuid,uuid,text,text,boolean,text,uuid,boolean) TO authenticated, service_role;
