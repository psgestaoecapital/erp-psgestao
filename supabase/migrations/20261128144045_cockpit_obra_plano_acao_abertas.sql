-- Hub · Cockpit da obra — bloco "Ações abertas desta obra" (CEO 20/11 13:21, msg eng_chefe 112b6b3a) — RPC de leitura
-- ============================================================================
-- "Passa o 5W2H também para o Hub de Projetos." O elo opcional ação→obra já existe
-- (coluna erp_plano_acao.obra_id, migration 20261126002645). Esta fatia só ADICIONA a
-- leitura que o Cockpit da obra usa: listar as ações 5W2H ABERTAS (status não concluída
-- nem cancelada, não arquivadas) ligadas a esta obra, para o empresário ver no cockpit o
-- que ainda está em aberto e abrir o plano de ação. NÃO cria tela nem motor novo (RD-26):
-- a tela do 5W2H segue única (industrial/hub plano-acao).
--
-- ADITIVA e IDEMPOTENTE: só uma função nova de LEITURA (CREATE OR REPLACE de função que
-- não existe), guardada por empresa (fn__guarda_empresa resolve a partir da obra), REVOKE
-- anon. Não toca estrutura, dado de cliente nem policy. Mesma guarda da fn_obra_cockpit_orcamento.
--
-- RD-38 (provado no dado antes do PR): na DEMO b0700000-...-006 a lógica de filtro retorna
-- 5 ações abertas (aberta + em_andamento), excluindo concluída/cancelada/arquivada, e com a
-- coluna `atrasada` (quando < hoje). Filtrando por obra ainda retorna 0 (nenhuma ação ligada
-- a obra — elo novo; a UI de vínculo entra pela tela do 5W2H).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_obra_plano_acao_abertas(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v jsonb;
BEGIN
  IF p_obra_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'obra_nao_informada');
  END IF;

  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'obra_nao_encontrada');
  END IF;

  -- Só a empresa dona lê as ações da obra (isolamento por empresa; levanta 42501 sem acesso).
  PERFORM public.fn__guarda_empresa(v_company);

  SELECT jsonb_agg(row_to_json(a) ORDER BY a.prazo_ord NULLS LAST, a.criado_em DESC) INTO v FROM (
    SELECT pa.id, pa.codigo, pa.titulo, pa.quando, pa.responsavel_nome,
           pa.status, pa.prioridade,
           (pa.quando IS NOT NULL AND pa.quando < current_date) AS atrasada,
           pa.criado_em, pa.quando AS prazo_ord
    FROM public.erp_plano_acao pa
    WHERE pa.company_id = v_company
      AND pa.obra_id = p_obra_id
      AND pa.excluido_em IS NULL
      AND NOT pa.arquivada
      AND pa.status NOT IN ('concluida', 'cancelada')
  ) a;

  RETURN jsonb_build_object('ok', true, 'resultados', COALESCE(v, '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_obra_plano_acao_abertas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_plano_acao_abertas(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_obra_plano_acao_abertas(uuid) IS
  'Cockpit da obra: ações 5W2H abertas (erp_plano_acao.obra_id) desta obra — leitura guardada por empresa.';

-- RD-95: "?" do bloco no Cockpit da obra.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.cockpit.acoes_abertas', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Ações abertas desta obra',
  'Nada a preencher: o sistema lista as ações do plano 5W2H que ainda estão abertas e ligadas a esta obra.',
  'Mostra, sem sair do cockpit, o que foi combinado resolver nesta obra e ainda não concluiu, com responsável e prazo.',
  'Negociar prazo com fornecedor de esquadrias — responsável João, vence 16/11 (atrasada).',
  'Deixar ação vencida sem replanejar: ela some do radar do dia se não for acompanhada no plano de ação.',
  'projetos', 915, 'publicado')
ON CONFLICT (chave) DO NOTHING;
