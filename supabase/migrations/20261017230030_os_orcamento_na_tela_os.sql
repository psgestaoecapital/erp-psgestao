-- Chamado #2867 (VIANZ Performance Diesel · carteira Rodrigo) — Oficina/mecânica.
-- Pedido: criar uma Ordem de Serviço já como ORÇAMENTO direto na tela "Ordens de Serviço", sem depender da
-- recepção do veículo (muitas vezes o carro ainda não está no pátio). A OS marcada como orçamento nasce com
-- status 'orcamento' (a tela exibe "Orçamento"); quando o cliente aprova, segue para os demais status
-- (inclusive agendar) normalmente. Marcamos nasceu_orcamento para, numa 2ª etapa (front), mostrar o aviso
-- "Ordem de serviço gerada através de um orçamento, verifique o diagnóstico" mesmo depois de a OS sair do status.
--
-- Observação: isto é o ORÇAMENTO DE NÍVEL OS. Não se confunde com o orçamento-hub (erp_orcamentos) que a recepção
-- cria pela opção "Somente orçamento" — aquele é um documento à parte e segue inalterado.
--
-- via revisada (revisao-eng-chefe): ALTERa o CHECK de erp_os e faz CREATE OR REPLACE de funções centrais da
-- oficina (fn_os_criar — assinatura nova, com DROP da antiga na mesma leva; fn_os_salvar — mesma assinatura).

-- 1) Marcador aditivo: OS que nasceu como orçamento na própria tela de OS.
ALTER TABLE public.erp_os ADD COLUMN IF NOT EXISTS nasceu_orcamento boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.erp_os.nasceu_orcamento IS
  'OS criada diretamente como orçamento na tela de Ordens de Serviço (#2867). Base do aviso "verifique o diagnóstico".';

-- 2) Novo status 'orcamento' (chave ASCII, como os demais; a tela exibe "Orçamento").
ALTER TABLE public.erp_os DROP CONSTRAINT IF EXISTS erp_os_status_check;
ALTER TABLE public.erp_os ADD CONSTRAINT erp_os_status_check
  CHECK (((status)::text = ANY (ARRAY[
    ('orcamento'::character varying)::text,
    ('aberta'::character varying)::text,
    ('aguardando_aprovacao'::character varying)::text,
    ('aprovada'::character varying)::text,
    ('em_execucao'::character varying)::text,
    ('aguardando_peca'::character varying)::text,
    ('pronta'::character varying)::text,
    ('entregue'::character varying)::text,
    ('cancelada'::character varying)::text
  ])));

-- 3) fn_os_criar: novo parâmetro p_orcamento (default false). A assinatura MUDA, então dropamos a antiga na mesma
--    leva (gate check-rpc-overload — evita PGRST203). O único chamador interno (fn_oficina_recepcao_criar) passa
--    12 argumentos posicionais e continua resolvendo com p_orcamento=false (a recepção segue criando OS 'aberta').
-- Dropa TODAS as assinaturas antigas vivas (12 args atual + a histórica de 10 args de 20260613190000, que já
-- não existe em produção). IF EXISTS torna cada drop um no-op onde a assinatura não existe. Dropamos nas DUAS
-- grafias (varchar e character varying) porque o gate check-rpc-overload casa os tipos pelo texto, e os CREATEs
-- históricos usaram `varchar` enquanto o padrão do pg_get_functiondef é `character varying`.
DROP FUNCTION IF EXISTS public.fn_os_criar(uuid, text, uuid, character varying, character varying, character varying, text, uuid, character varying, character varying, character varying, character varying);
DROP FUNCTION IF EXISTS public.fn_os_criar(uuid, text, uuid, varchar, varchar, varchar, text, uuid, varchar, varchar, varchar, varchar);
DROP FUNCTION IF EXISTS public.fn_os_criar(uuid, text, uuid, character varying, character varying, character varying, text, uuid, character varying, character varying);
DROP FUNCTION IF EXISTS public.fn_os_criar(uuid, text, uuid, varchar, varchar, varchar, text, uuid, varchar, varchar);

CREATE OR REPLACE FUNCTION public.fn_os_criar(p_company_id uuid, p_descricao_servico text, p_cliente_id uuid DEFAULT NULL::uuid, p_cliente_nome character varying DEFAULT NULL::character varying, p_cliente_cnpj character varying DEFAULT NULL::character varying, p_equipamento character varying DEFAULT NULL::character varying, p_defeito_relatado text DEFAULT NULL::text, p_tecnico_id uuid DEFAULT NULL::uuid, p_tecnico_nome character varying DEFAULT NULL::character varying, p_prioridade character varying DEFAULT 'normal'::character varying, p_placa character varying DEFAULT NULL::character varying, p_modelo character varying DEFAULT NULL::character varying, p_orcamento boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_os     erp_os%ROWTYPE;
  v_numero varchar;
  vc       erp_clientes%ROWTYPE;
  v_nome   varchar;
  v_cnpj   varchar;
  v_end    text;
  v_dec    jsonb;     -- FASE 3b · decisão de acesso (aditiva)
  v_op     text;      -- nível efetivo no subgrupo 'operacao' (já capado pelo TETO)
  v_orc    boolean := COALESCE(p_orcamento, false);
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Empresa nao informada');
  END IF;
  IF p_company_id NOT IN (SELECT user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  -- FASE 3b · RBAC aperta SÓ onde foi configurado. Sem papel → legado (não mexe). Com papel → exige
  -- 'editar'/'aprovar' em 'operacao' pra abrir OS. Narrowing: papel que dá 'aprovar' num 'ver' vira 'ver'.
  -- BYPASS (decisão do CEO): o DONO da empresa cliente (papel_gestao=CLIENT_OWNER) e o ADMIN da PS
  -- (is_admin) passam POR CIMA do gate — respondem pela empresa/plataforma e não podem ser barrados de
  -- abrir OS. Isso mantém a regra-mãe: aperta onde foi configurado, nunca em cima de quem manda.
  -- Ex.: supervisoradm@ (Fabiane) é CLIENT_OWNER com papel 'ind_ger_administrativo' (sem 'operacao') —
  -- sem o bypass seria barrada de abrir OS na própria empresa.
  v_dec := public.fn_acesso_efetivo(auth.uid(), p_company_id);
  IF COALESCE((v_dec -> 'decidido' ->> 'tem_papel')::boolean, false)
     AND (v_dec ->> 'papel_gestao') IS DISTINCT FROM 'CLIENT_OWNER'
     AND NOT public.is_admin() THEN
    v_op := v_dec -> 'acessos' ->> 'operacao';
    IF v_op IS NULL OR v_op NOT IN ('editar','aprovar') THEN
      RETURN jsonb_build_object('ok', false, 'erro',
        'Seu papel de acesso não permite abrir Ordem de Serviço (é necessário nível "editar" em Operação). Peça a quem administra os acessos da empresa.');
    END IF;
  END IF;

  v_nome := NULLIF(btrim(COALESCE(p_cliente_nome,'')), '');
  v_cnpj := NULLIF(btrim(COALESCE(p_cliente_cnpj,'')), '');

  IF p_cliente_id IS NOT NULL THEN
    SELECT * INTO vc FROM erp_clientes WHERE id = p_cliente_id AND company_id = p_company_id;
    IF FOUND THEN
      v_nome := COALESCE(v_nome, NULLIF(btrim(COALESCE(vc.nome_fantasia,'')),''), NULLIF(btrim(COALESCE(vc.razao_social,'')),''));
      v_cnpj := COALESCE(v_cnpj, NULLIF(btrim(COALESCE(vc.cpf_cnpj,'')),''));
      v_end := NULLIF(btrim(concat_ws(', ',
                 NULLIF(btrim(concat_ws(' ', vc.logradouro, vc.numero)), ''),
                 NULLIF(btrim(COALESCE(vc.bairro,'')), ''),
                 NULLIF(btrim(concat_ws('/', NULLIF(btrim(COALESCE(vc.cidade,'')),''), NULLIF(btrim(COALESCE(vc.uf,'')),''))), '')
               )), '');
    END IF;
  END IF;

  v_numero := next_os_numero(p_company_id);

  INSERT INTO erp_os (
    company_id, numero, descricao_servico,
    cliente_id, cliente_nome, cliente_cnpj, endereco_servico,
    equipamento, defeito_relatado,
    tecnico_id, tecnico_nome, prioridade,
    placa, modelo,
    status, nasceu_orcamento, data_abertura, created_by
  ) VALUES (
    p_company_id, v_numero,
    COALESCE(NULLIF(btrim(p_descricao_servico),''), 'Ordem de servico'),
    p_cliente_id, v_nome, v_cnpj, v_end,
    p_equipamento, p_defeito_relatado,
    p_tecnico_id, p_tecnico_nome, COALESCE(NULLIF(p_prioridade,''),'normal'),
    NULLIF(upper(regexp_replace(COALESCE(p_placa,''), '[^A-Za-z0-9]', '', 'g')), ''),
    NULLIF(btrim(COALESCE(p_modelo,'')), ''),
    CASE WHEN v_orc THEN 'orcamento' ELSE 'aberta' END, v_orc, CURRENT_DATE, auth.uid()
  ) RETURNING * INTO v_os;

  RETURN jsonb_build_object('ok', true, 'ja_existia', false,
    'os_id', v_os.id, 'numero', v_os.numero, 'status', v_os.status);
END; $function$;

-- SECURITY DEFINER: só usuário logado (a tela chama como authenticated) e o canal de serviço; nunca anon/PUBLIC.
REVOKE ALL ON FUNCTION public.fn_os_criar(uuid, text, uuid, character varying, character varying, character varying, text, uuid, character varying, character varying, character varying, character varying, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_criar(uuid, text, uuid, character varying, character varying, character varying, text, uuid, character varying, character varying, character varying, character varying, boolean) TO authenticated, service_role;

-- 4) fn_os_salvar: 'orcamento' passa a ser status válido (abrir/editar a OS-orçamento e transitar dela para os
--    demais status na aprovação). Mesma assinatura (sem overload). Corpo idêntico ao vivo + 'orcamento' na whitelist.
CREATE OR REPLACE FUNCTION public.fn_os_salvar(p_os_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_os erp_os%ROWTYPE; v_novo_status text := p_dados->>'status'; v_faturada boolean; v_antes jsonb;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;

  IF v_os.company_id NOT IN (SELECT user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta OS');
  END IF;

  -- 🛡️ Guarda pós-entrega: OS já entregue só pode ser ajustada por Master (CLIENT_OWNER) ou admin PS.
  IF v_os.status = 'entregue'
     AND NOT is_admin()
     AND public.fn_oficina_papel(v_os.company_id) IS DISTINCT FROM 'CLIENT_OWNER'
     AND NOT EXISTS (SELECT 1 FROM bpo_companies_assignment b WHERE b.company_id = v_os.company_id AND b.user_id = auth.uid() AND b.ativo) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'bloqueio', 'pos_entrega_sem_master',
      'erro', 'OS entregue: apenas usuário Master pode ajustar. Fale com o responsável.'
    );
  END IF;

  IF v_novo_status IS NOT NULL AND v_novo_status NOT IN
    ('orcamento','aberta','aguardando_aprovacao','aprovada','em_execucao','aguardando_peca','pronta','entregue','cancelada')
  THEN RETURN jsonb_build_object('ok', false, 'erro', 'Status invalido'); END IF;

  v_faturada := COALESCE(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL;
  IF v_faturada AND (
       (p_dados ? 'valor_servico'      AND NULLIF(p_dados->>'valor_servico','')::numeric      IS DISTINCT FROM v_os.valor_servico)
    OR (p_dados ? 'valor_materiais'    AND NULLIF(p_dados->>'valor_materiais','')::numeric    IS DISTINCT FROM v_os.valor_materiais)
    OR (p_dados ? 'valor_deslocamento' AND NULLIF(p_dados->>'valor_deslocamento','')::numeric IS DISTINCT FROM v_os.valor_deslocamento)
    OR (p_dados ? 'valor_hora'         AND NULLIF(p_dados->>'valor_hora','')::numeric         IS DISTINCT FROM v_os.valor_hora)
    OR (p_dados ? 'desconto_valor'     AND NULLIF(p_dados->>'desconto_valor','')::numeric     IS DISTINCT FROM v_os.desconto_valor)
    OR (p_dados ? 'horas_previstas'    AND NULLIF(p_dados->>'horas_previstas','')::numeric    IS DISTINCT FROM v_os.horas_previstas)
    OR (p_dados ? 'horas_executadas'   AND NULLIF(p_dados->>'horas_executadas','')::numeric   IS DISTINCT FROM v_os.horas_executadas)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'faturada', true,
      'erro', 'OS faturada: os valores não podem ser alterados (já virou lançamento na GE). Dados do veículo/cliente podem.');
  END IF;

  v_antes := jsonb_build_object('placa', v_os.placa, 'cliente_id', v_os.cliente_id, 'cliente_nome', v_os.cliente_nome, 'modelo', v_os.modelo,
    'marca', v_os.marca, 'km', v_os.km, 'defeito_relatado', v_os.defeito_relatado, 'status', v_os.status, 'total', v_os.total);

  UPDATE erp_os SET
    placa=COALESCE(NULLIF(upper(regexp_replace(COALESCE(p_dados->>'placa',''), '[^A-Za-z0-9]', '', 'g')),''), placa),
    modelo=COALESCE(NULLIF(btrim(p_dados->>'modelo'),''), modelo),
    marca=COALESCE(NULLIF(btrim(p_dados->>'marca'),''), marca),
    ano=COALESCE(NULLIF(p_dados->>'ano','')::int, ano),
    km=COALESCE(NULLIF(p_dados->>'km','')::int, km),
    chassi=COALESCE(NULLIF(btrim(p_dados->>'chassi'),''), chassi),
    cliente_id=CASE WHEN p_dados ? 'cliente_id' THEN NULLIF(btrim(p_dados->>'cliente_id'),'')::uuid ELSE cliente_id END,
    cliente_nome=COALESCE(NULLIF(btrim(p_dados->>'cliente_nome'),''), cliente_nome),
    cliente_cnpj=COALESCE(NULLIF(btrim(p_dados->>'cliente_cnpj'),''), cliente_cnpj),
    equipamento=COALESCE(p_dados->>'equipamento',equipamento),
    defeito_relatado=COALESCE(p_dados->>'defeito_relatado',defeito_relatado),
    descricao_servico=COALESCE(p_dados->>'descricao_servico',descricao_servico),
    endereco_servico=COALESCE(p_dados->>'endereco_servico',endereco_servico),
    observacoes_cliente=COALESCE(p_dados->>'observacoes_cliente',observacoes_cliente),
    observacoes_internas=COALESCE(p_dados->>'observacoes_internas',observacoes_internas),
    prioridade=COALESCE(NULLIF(p_dados->>'prioridade',''), prioridade),
    tecnico_nome=COALESCE(p_dados->>'tecnico_nome',tecnico_nome),
    horas_previstas=CASE WHEN v_faturada THEN horas_previstas ELSE COALESCE(NULLIF(p_dados->>'horas_previstas','')::numeric,horas_previstas) END,
    horas_executadas=CASE WHEN v_faturada THEN horas_executadas ELSE COALESCE(NULLIF(p_dados->>'horas_executadas','')::numeric,horas_executadas) END,
    valor_hora=CASE WHEN v_faturada THEN valor_hora ELSE COALESCE(NULLIF(p_dados->>'valor_hora','')::numeric,valor_hora) END,
    valor_servico=CASE WHEN v_faturada THEN valor_servico ELSE COALESCE(NULLIF(p_dados->>'valor_servico','')::numeric,valor_servico) END,
    valor_materiais=CASE WHEN v_faturada THEN valor_materiais ELSE COALESCE(NULLIF(p_dados->>'valor_materiais','')::numeric,valor_materiais) END,
    valor_deslocamento=CASE WHEN v_faturada THEN valor_deslocamento ELSE COALESCE(NULLIF(p_dados->>'valor_deslocamento','')::numeric,valor_deslocamento) END,
    desconto_valor=CASE WHEN v_faturada THEN desconto_valor ELSE COALESCE(NULLIF(p_dados->>'desconto_valor','')::numeric,desconto_valor) END,
    status=COALESCE(v_novo_status,status),
    data_execucao=CASE WHEN v_novo_status='em_execucao' AND data_execucao IS NULL THEN CURRENT_DATE ELSE data_execucao END,
    data_conclusao=CASE WHEN v_novo_status IN ('pronta','entregue') AND data_conclusao IS NULL THEN CURRENT_DATE ELSE data_conclusao END,
    updated_at=now()
  WHERE id=p_os_id RETURNING * INTO v_os;

  IF NOT v_faturada THEN
    UPDATE erp_os SET total =
        (COALESCE(valor_hora,0) * COALESCE(NULLIF(horas_executadas,0), horas_previstas, 0))
      + COALESCE(valor_servico,0) + COALESCE(valor_materiais,0)
      + COALESCE(valor_deslocamento,0) - COALESCE(desconto_valor,0)
    WHERE id=p_os_id RETURNING * INTO v_os;
  END IF;

  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_os.company_id, auth.uid(), (SELECT email FROM users WHERE id=auth.uid()),
      'erp_os', v_os.id::text,
      CASE WHEN v_antes->>'status' = 'entregue' THEN 'EDITOU_POS_ENTREGA' ELSE 'EDITOU' END,
      v_antes,
      jsonb_build_object('placa', v_os.placa, 'cliente_id', v_os.cliente_id, 'cliente_nome', v_os.cliente_nome, 'modelo', v_os.modelo,
        'marca', v_os.marca, 'km', v_os.km, 'defeito_relatado', v_os.defeito_relatado, 'status', v_os.status, 'total', v_os.total));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok',true,'os_id',v_os.id,'status',v_os.status,'total',v_os.total);
END; $function$;

-- SECURITY DEFINER: só usuário logado e o canal de serviço; nunca anon/PUBLIC (check_fn_guards).
REVOKE ALL ON FUNCTION public.fn_os_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_salvar(uuid, jsonb) TO authenticated, service_role;

-- 5) RD-95: ajuda do novo campo "É orçamento?" na tela de Ordens de Serviço.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Nova Ordem de Serviço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/os', 'oficina', 'publicado'
FROM (VALUES
  ('os.nova.orcamento',
   'É orçamento?',
   'Marque quando esta OS for só um orçamento — o veículo ainda não está na oficina e você está registrando um valor para o cliente aprovar.',
   'A OS nasce com status "Orçamento". Quando o cliente aprovar, você muda o status e toca o serviço (inclusive agendando); antes disso ela não entra na execução.',
   'Cliente ligou pedindo um valor para a revisão: crie a OS, marque "É orçamento?" e passe o valor. Aprovou → mude o status.',
   'Deixar marcado depois de o cliente aprovar: lembre de mudar o status para dar sequência ao serviço.',
   1)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
