-- Hub · Ponto da obra por COLABORADOR (blueprint tela 327 req 37de7d98 "...e ponto da obra" [Hub V29.3]).
-- O "Lançar horas na obra" (fn_obra_mao_obra_apontar/_editar) grava o ponto por FUNÇÃO; esta migration permite
-- atribuir cada lançamento a um colaborador da EQUIPE da obra (projetos_equipe_membro.nome_pessoa) — nome
-- operacional do Hub, sem PII de compliance_funcionarios e sem expor custo individual novo.
-- Aditiva/idempotente: coluna nullable + CREATE OR REPLACE das 2 RPCs mantendo guardas/REVOKE/GRANT idênticos.
-- Code: code-desenvolvedor-3

-- 1) Coluna opcional de atribuição ao colaborador da equipe (ON DELETE SET NULL: tirar o membro não apaga o ponto)
ALTER TABLE public.projetos_obra_mao_obra_apontamento
  ADD COLUMN IF NOT EXISTS membro_id uuid REFERENCES public.projetos_equipe_membro(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.projetos_obra_mao_obra_apontamento.membro_id IS
  'Colaborador da equipe (projetos_equipe_membro) a quem o ponto/horas foi atribuído. Opcional; ON DELETE SET NULL.';

CREATE INDEX IF NOT EXISTS idx_projetos_obra_mao_obra_apont_membro
  ON public.projetos_obra_mao_obra_apontamento (membro_id) WHERE membro_id IS NOT NULL;

-- 2) fn_obra_mao_obra_apontar — aceita membro_id opcional, validado na MESMA empresa da obra (isolamento)
CREATE OR REPLACE FUNCTION public.fn_obra_mao_obra_apontar(p_obra_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_id uuid; v_membro uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Obra não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);

  v_membro := NULLIF(p_dados->>'membro_id','')::uuid;
  IF v_membro IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projetos_equipe_membro WHERE id = v_membro AND company_id = v_company
  ) THEN
    RAISE EXCEPTION 'Colaborador inválido para esta obra.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.projetos_obra_mao_obra_apontamento
    (company_id, obra_id, data, funcao_id, membro_id, descricao, horas, custo_hora, criado_por)
  VALUES (v_company, p_obra_id, COALESCE((p_dados->>'data')::date, current_date),
    NULLIF(p_dados->>'funcao_id','')::uuid, v_membro, p_dados->>'descricao',
    (p_dados->>'horas')::numeric, (p_dados->>'custo_hora')::numeric, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_mao_obra_apontar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_mao_obra_apontar(uuid, jsonb) TO authenticated, service_role;

-- 3) fn_obra_mao_obra_editar — campo ausente mantém; '' limpa; membro validado na empresa; trilha de auditoria
CREATE OR REPLACE FUNCTION public.fn_obra_mao_obra_editar(p_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row     public.projetos_obra_mao_obra_apontamento%ROWTYPE;
  v_data    date;
  v_funcao  uuid;
  v_membro  uuid;
  v_desc    text;
  v_horas   numeric;
  v_custo   numeric;
BEGIN
  SELECT * INTO v_row FROM public.projetos_obra_mao_obra_apontamento
   WHERE id = p_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Apontamento não encontrado' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.fn__guarda_empresa(v_row.company_id);

  -- campo ausente mantém o valor atual; função/colaborador podem ser limpados enviando '' explicitamente.
  v_data   := COALESCE(NULLIF(p_dados->>'data','')::date, v_row.data);
  v_funcao := CASE WHEN p_dados ? 'funcao_id' THEN NULLIF(p_dados->>'funcao_id','')::uuid ELSE v_row.funcao_id END;
  v_membro := CASE WHEN p_dados ? 'membro_id' THEN NULLIF(p_dados->>'membro_id','')::uuid ELSE v_row.membro_id END;
  v_desc   := CASE WHEN p_dados ? 'descricao' THEN NULLIF(btrim(p_dados->>'descricao'),'') ELSE v_row.descricao END;
  v_horas  := COALESCE(NULLIF(p_dados->>'horas','')::numeric, v_row.horas);
  v_custo  := COALESCE(NULLIF(p_dados->>'custo_hora','')::numeric, v_row.custo_hora);

  IF v_horas IS NULL OR v_horas <= 0 THEN RAISE EXCEPTION 'Informe as horas trabalhadas (maior que zero).' USING ERRCODE = '22023'; END IF;
  IF v_custo IS NULL OR v_custo < 0 THEN RAISE EXCEPTION 'Informe o custo da hora.' USING ERRCODE = '22023'; END IF;
  IF v_membro IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projetos_equipe_membro WHERE id = v_membro AND company_id = v_row.company_id
  ) THEN
    RAISE EXCEPTION 'Colaborador inválido para esta obra.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.projetos_obra_mao_obra_apontamento
     SET data = v_data, funcao_id = v_funcao, membro_id = v_membro, descricao = v_desc, horas = v_horas, custo_hora = v_custo
   WHERE id = p_id;

  -- RD-98 p4: trilha central de auditoria (mesmo padrão de fn_obra_mao_obra_excluir / fn_obra_custo_editar)
  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_row.company_id, auth.uid(), auth.jwt() ->> 'email', 'projetos_obra_mao_obra_apontamento', p_id::text, 'obra_mao_obra_editar',
          jsonb_build_object('data', v_row.data, 'funcao_id', v_row.funcao_id, 'membro_id', v_row.membro_id, 'descricao', v_row.descricao, 'horas', v_row.horas, 'custo_hora', v_row.custo_hora),
          jsonb_build_object('data', v_data, 'funcao_id', v_funcao, 'membro_id', v_membro, 'descricao', v_desc, 'horas', v_horas, 'custo_hora', v_custo));

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_mao_obra_editar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_mao_obra_editar(uuid, jsonb) TO authenticated, service_role;

-- 4) RD-95: ajuda "?" do novo campo Colaborador na tela de ponto da obra
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'projetos.horas_obra.membro',
  '/dashboard/projetos/obras/[id]/horas',
  'Lançar horas na obra',
  'Colaborador',
  'Opcional: escolha quem fez as horas, entre os colaboradores da equipe da obra (cadastrados em Mão de obra › Equipes). Ao escolher, a função e o custo da hora dele já vêm preenchidos.',
  'Registra o ponto da obra por pessoa, não só por função — você vê quem trabalhou em cada dia e mantém o custo por função no Resultado por obra.',
  'João da Silva (pedreiro).',
  'Deixar sem colaborador quando você quer saber quem trabalhou; ou escolher alguém de outra equipe/empresa.',
  'hub_construcao', 3, 1, 'publicado'
)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, versao = EXCLUDED.versao, status = EXCLUDED.status, atualizado_em = now();
