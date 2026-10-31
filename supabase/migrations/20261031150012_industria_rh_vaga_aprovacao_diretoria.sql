-- Indústria › RH › Vagas (CEO 30/10): RH ABRE a vaga, só DIRETORIA aprova/recusa (RBAC no banco).
-- Aditiva: tabela nova com RLS por empresa; escrita só pelas RPCs SECURITY DEFINER; exclusão = cancelamento lógico.
CREATE TABLE IF NOT EXISTS public.rh_vaga (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  setor_id uuid REFERENCES public.prod_setor(id),
  cargo_id uuid REFERENCES public.prod_cargo(id),
  quantidade integer NOT NULL DEFAULT 1 CHECK (quantidade BETWEEN 1 AND 500),
  custo_estimado numeric(14,2) CHECK (custo_estimado IS NULL OR custo_estimado >= 0),
  justificativa text NOT NULL,
  status text NOT NULL DEFAULT 'solicitada' CHECK (status IN ('solicitada','aprovada','recusada','cancelada')),
  solicitante_user_id uuid NOT NULL,
  aprovador_user_id uuid,
  decidido_em timestamptz,
  motivo_decisao text,
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rh_vaga_company_status_idx ON public.rh_vaga (company_id, status) WHERE deleted_at IS NULL;

ALTER TABLE public.rh_vaga ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rh_vaga_sel ON public.rh_vaga;
CREATE POLICY rh_vaga_sel ON public.rh_vaga FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.rh_vaga FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rh_vaga FROM authenticated;
GRANT SELECT ON public.rh_vaga TO authenticated;
GRANT ALL ON public.rh_vaga TO service_role;

-- papel do usuário na empresa (RH abre; diretoria decide)
CREATE OR REPLACE FUNCTION public.fn_rh_vaga_papel(p_company_id uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT role FROM public.user_companies WHERE user_id = auth.uid() AND company_id = p_company_id LIMIT 1 $$;
REVOKE ALL ON FUNCTION public.fn_rh_vaga_papel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_vaga_papel(uuid) TO authenticated, service_role;

-- ci-sem-guarda: fn_rh_vaga_abrir — guarda por fn_rh_vaga_papel(p_company_id) (papel do auth.uid() na empresa via user_companies) + escopo por p_company_id
CREATE OR REPLACE FUNCTION public.fn_rh_vaga_abrir(
  p_company_id uuid, p_setor_id uuid, p_cargo_id uuid, p_quantidade integer, p_custo_estimado numeric, p_justificativa text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_papel text := public.fn_rh_vaga_papel(p_company_id); v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nao_autenticado'; END IF;
  IF v_papel IS NULL OR v_papel NOT IN ('rh_industrial','rh','adm','admin','gerente','acesso_total','diretor','diretor_area','owner') THEN
    RAISE EXCEPTION 'sem_permissao_abrir_vaga';
  END IF;
  IF btrim(coalesce(p_justificativa,'')) = '' THEN RAISE EXCEPTION 'justificativa_obrigatoria'; END IF;
  INSERT INTO public.rh_vaga (company_id, setor_id, cargo_id, quantidade, custo_estimado, justificativa, solicitante_user_id)
    VALUES (p_company_id, p_setor_id, p_cargo_id, greatest(coalesce(p_quantidade,1),1), p_custo_estimado, btrim(p_justificativa), auth.uid())
    RETURNING id INTO v_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (p_company_id, auth.uid(), 'rh_vaga', v_id::text, 'abrir',
            jsonb_build_object('setor_id', p_setor_id, 'cargo_id', p_cargo_id, 'quantidade', p_quantidade));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- só DIRETORIA decide; o solicitante nunca decide a própria vaga
-- ci-sem-guarda: fn_rh_vaga_decidir — guarda por fn_rh_vaga_papel(v.company_id) (só diretoria da empresa da vaga; FOR UPDATE na linha, solicitante não decide a própria)
CREATE OR REPLACE FUNCTION public.fn_rh_vaga_decidir(p_vaga_id uuid, p_aprovar boolean, p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v public.rh_vaga%ROWTYPE; v_papel text; v_novo text := CASE WHEN p_aprovar THEN 'aprovada' ELSE 'recusada' END;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nao_autenticado'; END IF;
  SELECT * INTO v FROM public.rh_vaga WHERE id = p_vaga_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vaga_nao_encontrada'; END IF;
  v_papel := public.fn_rh_vaga_papel(v.company_id);
  IF v_papel IS NULL OR v_papel NOT IN ('acesso_total','diretor','diretor_area','owner') THEN
    RAISE EXCEPTION 'somente_diretoria_decide';
  END IF;
  IF v.solicitante_user_id = auth.uid() THEN RAISE EXCEPTION 'solicitante_nao_decide_propria_vaga'; END IF;
  IF v.status <> 'solicitada' THEN RAISE EXCEPTION 'vaga_ja_decidida'; END IF;
  IF btrim(coalesce(p_motivo,'')) = '' THEN RAISE EXCEPTION 'motivo_obrigatorio'; END IF;
  UPDATE public.rh_vaga SET status = v_novo, aprovador_user_id = auth.uid(), decidido_em = now(),
         motivo_decisao = btrim(p_motivo), updated_at = now() WHERE id = p_vaga_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v.company_id, auth.uid(), 'rh_vaga', p_vaga_id::text, v_novo,
            jsonb_build_object('status', v.status), jsonb_build_object('status', v_novo, 'motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true, 'status', v_novo);
END $$;

-- cancelamento lógico (nunca DELETE): quem abriu ou a diretoria, só enquanto solicitada
-- ci-sem-guarda: fn_rh_vaga_cancelar — guarda por fn_rh_vaga_papel(v.company_id) (autor da vaga ou diretoria da empresa; FOR UPDATE na linha)
CREATE OR REPLACE FUNCTION public.fn_rh_vaga_cancelar(p_vaga_id uuid, p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v public.rh_vaga%ROWTYPE; v_papel text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nao_autenticado'; END IF;
  SELECT * INTO v FROM public.rh_vaga WHERE id = p_vaga_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vaga_nao_encontrada'; END IF;
  v_papel := public.fn_rh_vaga_papel(v.company_id);
  IF v.solicitante_user_id <> auth.uid() AND coalesce(v_papel,'') NOT IN ('acesso_total','diretor','diretor_area','owner') THEN
    RAISE EXCEPTION 'sem_permissao_cancelar';
  END IF;
  IF v.status <> 'solicitada' THEN RAISE EXCEPTION 'so_cancela_vaga_solicitada'; END IF;
  IF btrim(coalesce(p_motivo,'')) = '' THEN RAISE EXCEPTION 'motivo_obrigatorio'; END IF;
  UPDATE public.rh_vaga SET status = 'cancelada', deleted_at = now(), deleted_by = auth.uid(),
         motivo_decisao = btrim(p_motivo), updated_at = now() WHERE id = p_vaga_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v.company_id, auth.uid(), 'rh_vaga', p_vaga_id::text, 'cancelar',
            jsonb_build_object('status', v.status), jsonb_build_object('motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.fn_rh_vaga_abrir(uuid, uuid, uuid, integer, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_rh_vaga_decidir(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_rh_vaga_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_vaga_abrir(uuid, uuid, uuid, integer, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rh_vaga_decidir(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rh_vaga_cancelar(uuid, text) TO authenticated, service_role;

INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento, rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES ('industrial_rh_vagas', '/dashboard/industrial/rh/vagas', 'industria', 'industrial_rh_vagas', 'RH · Vagas',
  'RH abre a vaga de mão de obra (setor, cargo, quantidade, custo); só a diretoria aprova ou recusa, com motivo. Vaga aprovada vira posição a preencher.',
  'parcial', 'alta', ARRAY['fn_rh_vaga_abrir','fn_rh_vaga_decidir','fn_rh_vaga_cancelar']::text[], ARRAY['VagasPage']::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
 ('industria.vagas.setor', '/dashboard/industrial/rh/vagas', 'Vagas', 'Setor', 'Escolha o setor que vai receber a pessoa.', 'Aponta onde a posição aprovada entra no quadro de postos.', 'Desossa', 'Escolher o setor errado: a posição aparece no quadro de outro setor.', 'industria', 10, 1, 'publicado'),
 ('industria.vagas.cargo', '/dashboard/industrial/rh/vagas', 'Vagas', 'Cargo', 'Escolha o cargo da vaga.', 'Define a função da posição a preencher.', 'Auxiliar de produção', 'Abrir vaga de cargo que não existe no cadastro de cargos.', 'industria', 20, 1, 'publicado'),
 ('industria.vagas.quantidade', '/dashboard/industrial/rh/vagas', 'Vagas', 'Quantidade', 'Quantas pessoas a vaga pede.', 'Multiplica o custo estimado e o número de posições abertas.', '3', 'Abrir uma vaga por pessoa quando o pedido é o mesmo.', 'industria', 30, 1, 'publicado'),
 ('industria.vagas.custo', '/dashboard/industrial/rh/vagas', 'Vagas', 'Custo estimado', 'Custo mensal estimado por pessoa, em reais.', 'Ajuda a diretoria a decidir; não lança nada na folha.', 'R$ 3.200,00', 'Informar o total das pessoas em vez do valor de uma.', 'industria', 40, 1, 'publicado'),
 ('industria.vagas.justificativa', '/dashboard/industrial/rh/vagas', 'Vagas', 'Justificativa', 'Explique por que a vaga é necessária.', 'É o que a diretoria lê para aprovar ou recusar.', 'Aumento de abate de 60 para 80 cabeças/dia.', 'Deixar vago: a vaga não é aberta sem justificativa.', 'industria', 50, 1, 'publicado'),
 ('industria.vagas.aprovar', '/dashboard/industrial/rh/vagas', 'Vagas', 'Aprovar / Recusar', 'Só a diretoria vê estes botões. Escreva o motivo da decisão.', 'Vaga aprovada vira posição a preencher; fica registrado quem decidiu e quando.', 'Aprovada: reposição de turno.', 'Tentar aprovar a própria vaga: o banco não permite.', 'industria', 60, 1, 'publicado'),
 ('industria.vagas.cancelar', '/dashboard/industrial/rh/vagas', 'Vagas', 'Cancelar vaga', 'Informe o motivo. Só vale enquanto a vaga está solicitada.', 'A vaga sai da lista, mas fica no histórico (não é apagada).', 'Pedido duplicado.', 'Querer cancelar vaga já aprovada: peça à diretoria.', 'industria', 70, 1, 'publicado'),
 ('industria.vagas.status', '/dashboard/industrial/rh/vagas', 'Vagas', 'Situação', 'Filtro: solicitada, aprovada, recusada ou cancelada.', 'Separa o que espera decisão do que já foi decidido.', 'Solicitadas', 'Esquecer o filtro e achar que a vaga sumiu.', 'industria', 80, 1, 'publicado')
) AS t(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = t.chave);
