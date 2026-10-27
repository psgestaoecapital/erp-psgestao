-- Hub · /dashboard/projetos/obras — delta 84→95 (aud8 27/10 17:25Z, caixa ace6f719 · Code: dev7claudeps)
--   RD-98 p2: card da obra só tinha Ver escopo/Cockpit/Linha do tempo/Fiscal/Status. Faltava EDITAR e EXCLUIR.
--   RD-98 p4: exclusão rastreável = soft-delete (deleted_at + deleted_by + motivo + audit_log_global), nunca DELETE físico.
--             Listagem, KPIs, receita e v_obra_resultado passam a filtrar deleted_at IS NULL.
--             Obra com medição/NFS-e/pedido ligados NÃO pode ser excluída (preserva o financeiro): cancele-a.
--   RD-98 p3: system_screens.views_consumidas/rpcs_chamadas da rota.
-- Aditiva: colunas novas (NULL), funções novas, filtros deleted_at IS NULL nas leituras existentes (sem mudar colunas/assinaturas).

ALTER TABLE public.projetos_obras
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS delete_motivo text;

CREATE INDEX IF NOT EXISTS ix_projetos_obras_ativas ON public.projetos_obras (company_id) WHERE deleted_at IS NULL;

-- Leituras existentes: mesma assinatura, só escondem a obra excluída.
CREATE OR REPLACE FUNCTION public.fn_obras_listar(p_company_ids uuid[], p_status text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, numero text, nome text, cliente_nome text, status text, valor_previsto numeric, pct_conclusao integer, cidade text, uf text, responsavel_nome text, data_inicio date, data_prevista_fim date, data_conclusao date)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT o.id, o.numero, o.nome, o.cliente_nome, o.status, o.valor_previsto, o.pct_conclusao,
         o.cidade, o.uf, o.responsavel_nome, o.data_inicio, o.data_prevista_fim, o.data_conclusao
    FROM public.projetos_obras o
   WHERE o.company_id = ANY(p_company_ids) AND o.company_id IN (SELECT get_user_company_ids())
     AND o.deleted_at IS NULL
     AND (p_status IS NULL OR o.status = p_status)
   ORDER BY CASE o.status WHEN 'em_andamento' THEN 0 WHEN 'pausada' THEN 1 WHEN 'concluida' THEN 2 ELSE 3 END,
     o.data_inicio DESC NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.fn_obras_kpis(p_company_ids uuid[])
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'em_andamento',       count(*) FILTER (WHERE status='em_andamento'),
    'concluidas',         count(*) FILTER (WHERE status='concluida'),
    'pausada',            count(*) FILTER (WHERE status='pausada'),
    'cancelada',          count(*) FILTER (WHERE status='cancelada'),
    'valor_em_andamento', COALESCE(sum(valor_previsto) FILTER (WHERE status='em_andamento'),0),
    'valor_concluido',    COALESCE(sum(valor_previsto) FILTER (WHERE status='concluida'),0))
  FROM public.projetos_obras WHERE company_id = ANY(p_company_ids) AND company_id IN (SELECT get_user_company_ids())
   AND deleted_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.fn_obras_receita(p_company_ids uuid[])
 RETURNS TABLE(obra_id uuid, faturado numeric, recebido numeric, a_receber numeric, notas integer, notas_sem_titulo integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH notas AS (
    SELECT n.obra_id, n.id, COALESCE(n.valor_bruto, n.valor_servicos, 0) AS bruto, n.erp_receber_id
      FROM public.erp_nfse_emitidas n
     WHERE n.company_id = ANY(p_company_ids)
       AND n.company_id IN (SELECT public.get_user_company_ids())
       AND n.obra_id IS NOT NULL
       AND n.status = 'autorizada'
  ), titulos AS (
    SELECT DISTINCT ON (r.id) nt.obra_id, r.id, r.valor, r.status,
           COALESCE((SELECT sum(b.valor) FROM public.erp_receber_baixa b WHERE b.receber_id = r.id AND b.deleted_at IS NULL),
                    CASE WHEN r.status = 'pago' THEN COALESCE(r.valor_pago, r.valor) ELSE COALESCE(r.valor_pago, 0) END) AS entrou
      FROM notas nt
      JOIN public.erp_receber r ON r.id = nt.erp_receber_id
     WHERE r.deleted_at IS NULL AND r.status <> 'cancelado'
  )
  SELECT o.id,
         COALESCE((SELECT sum(nt.bruto) FROM notas nt WHERE nt.obra_id = o.id), 0)::numeric(14,2),
         COALESCE((SELECT sum(t.entrou) FROM titulos t WHERE t.obra_id = o.id), 0)::numeric(14,2),
         COALESCE((SELECT sum(GREATEST(t.valor - t.entrou, 0)) FROM titulos t WHERE t.obra_id = o.id AND t.status <> 'pago'), 0)::numeric(14,2),
         (SELECT count(*) FROM notas nt WHERE nt.obra_id = o.id)::int,
         (SELECT count(*) FROM notas nt WHERE nt.obra_id = o.id AND nt.erp_receber_id IS NULL)::int
    FROM public.projetos_obras o
   WHERE o.company_id = ANY(p_company_ids)
     AND o.company_id IN (SELECT public.get_user_company_ids())
     AND o.deleted_at IS NULL;
$function$;

-- v_obra_resultado: mesma lista de colunas; só filtra a obra excluída (a _alocado herda, lê desta view).
CREATE OR REPLACE VIEW public.v_obra_resultado WITH (security_invoker = true) AS
 SELECT o.id AS obra_id,
    o.company_id,
    o.numero,
    o.nome,
    o.status,
    COALESCE(prev.custo_previsto, 0::numeric)::numeric(15,2) AS custo_previsto,
    COALESCE(prev.valor_contratado, 0::numeric)::numeric(15,2) AS receita_prevista,
    COALESCE(med.valor, 0::numeric)::numeric(15,2) AS receita_servico,
    COALESCE(ped.receita, 0::numeric)::numeric(15,2) AS receita_material,
    COALESCE(ped.cmv, 0::numeric)::numeric(15,2) AS custo_material,
    COALESCE(via.valor, 0::numeric)::numeric(15,2) AS custo_viagens,
    (COALESCE(med.valor, 0::numeric) + COALESCE(ped.receita, 0::numeric) - COALESCE(ped.cmv, 0::numeric) - COALESCE(via.valor, 0::numeric))::numeric(15,2) AS margem_realizada
   FROM projetos_obras o
     LEFT JOIN ( SELECT projetos_obra_item.obra_id,
            sum(projetos_obra_item.quantidade_contratada * COALESCE(projetos_obra_item.custo_unitario_previsto, 0::numeric)) AS custo_previsto,
            sum(projetos_obra_item.valor_contratado) AS valor_contratado
           FROM projetos_obra_item
          WHERE projetos_obra_item.excluido_em IS NULL
          GROUP BY projetos_obra_item.obra_id) prev ON prev.obra_id = o.id
     LEFT JOIN ( SELECT erp_nfse_obra_medicao.obra_id,
            sum(erp_nfse_obra_medicao.valor) AS valor
           FROM erp_nfse_obra_medicao
          WHERE erp_nfse_obra_medicao.estornada_em IS NULL AND erp_nfse_obra_medicao.descartada_em IS NULL
          GROUP BY erp_nfse_obra_medicao.obra_id) med ON med.obra_id = o.id
     LEFT JOIN ( SELECT erp_pedidos.obra_id,
            sum(erp_pedidos.total) AS receita,
            sum(COALESCE(erp_pedidos.cmv, 0::numeric)) AS cmv
           FROM erp_pedidos
          WHERE erp_pedidos.obra_id IS NOT NULL AND (COALESCE(erp_pedidos.status, ''::character varying)::text <> ALL (ARRAY['cancelado'::character varying, 'cancelada'::character varying]::text[]))
          GROUP BY erp_pedidos.obra_id) ped ON ped.obra_id = o.id
     LEFT JOIN ( SELECT v_viagem_custo_obra.obra_id,
            sum(v_viagem_custo_obra.custo_total) AS valor
           FROM v_viagem_custo_obra
          GROUP BY v_viagem_custo_obra.obra_id) via ON via.obra_id = o.id
  WHERE o.deleted_at IS NULL;

-- Obra excluída não "existe" para o cockpit por obra (cai no aviso de obra inexistente).
CREATE OR REPLACE FUNCTION public.fn_obra_existe(p_obra_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('existe', false, 'tem_acesso', false); END IF;
  SELECT company_id INTO v_company FROM projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('existe', false, 'tem_acesso', false); END IF;
  RETURN jsonb_build_object('existe', true, 'tem_acesso', v_company IN (SELECT get_user_company_ids()));
END $function$;

-- Obra excluída não muda de status.
CREATE OR REPLACE FUNCTION public.fn_obra_mudar_status(p_obra_id uuid, p_novo_status text)
 RETURNS projetos_obras LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_obra public.projetos_obras%ROWTYPE;
BEGIN
  IF p_novo_status NOT IN ('em_andamento','pausada','concluida','cancelada') THEN
    RAISE EXCEPTION 'Status inválido: %', p_novo_status; END IF;
  UPDATE public.projetos_obras
     SET status = p_novo_status,
         data_conclusao = CASE WHEN p_novo_status = 'concluida' THEN CURRENT_DATE ELSE data_conclusao END,
         pct_conclusao  = CASE WHEN p_novo_status = 'concluida' THEN 100 ELSE pct_conclusao END
   WHERE id = p_obra_id AND deleted_at IS NULL AND company_id IN (SELECT get_user_company_ids())
  RETURNING * INTO v_obra;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obra não encontrada ou sem permissão'; END IF;
  RETURN v_obra;
END $function$;

-- Dados da obra para o formulário de edição.
CREATE OR REPLACE FUNCTION public.fn_obra_obter(p_obra_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE o public.projetos_obras%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO o FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF o.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  RETURN jsonb_build_object('ok', true, 'obra', jsonb_build_object(
    'id', o.id, 'numero', o.numero, 'nome', o.nome, 'cliente_nome', o.cliente_nome, 'endereco', o.endereco,
    'numero_endereco', o.numero_endereco, 'bairro', o.bairro, 'cidade', o.cidade, 'uf', o.uf, 'cep', o.cep,
    'responsavel_nome', o.responsavel_nome, 'valor_previsto', o.valor_previsto, 'data_inicio', o.data_inicio,
    'data_prevista_fim', o.data_prevista_fim, 'pct_conclusao', o.pct_conclusao, 'observacoes', o.observacoes));
END $function$;

-- Editar todos os campos da obra (status continua em fn_obra_mudar_status; CNO/ART em fn_obra_salvar_fiscal). Audita antes/depois.
CREATE OR REPLACE FUNCTION public.fn_obra_editar(p_obra_id uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE o public.projetos_obras%ROWTYPE; v_ant jsonb; v_novo jsonb;
        v_nome text; v_valor numeric; v_pct int; v_ini date; v_fim date;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para editar'); END IF;
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Dados inválidos'); END IF;
  SELECT * INTO o FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF o.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  v_nome  := COALESCE(NULLIF(btrim(p_dados->>'nome'), ''), o.nome);
  v_valor := COALESCE(NULLIF(p_dados->>'valor_previsto', '')::numeric, o.valor_previsto);
  v_pct   := COALESCE(NULLIF(p_dados->>'pct_conclusao', '')::int, o.pct_conclusao);
  v_ini   := CASE WHEN p_dados ? 'data_inicio' THEN NULLIF(p_dados->>'data_inicio', '')::date ELSE o.data_inicio END;
  v_fim   := CASE WHEN p_dados ? 'data_prevista_fim' THEN NULLIF(p_dados->>'data_prevista_fim', '')::date ELSE o.data_prevista_fim END;
  IF v_valor < 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'O valor previsto não pode ser negativo'); END IF;
  IF v_pct < 0 OR v_pct > 100 THEN RETURN jsonb_build_object('ok', false, 'erro', 'O percentual concluído vai de 0 a 100'); END IF;
  IF v_ini IS NOT NULL AND v_fim IS NOT NULL AND v_fim < v_ini THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O fim previsto não pode ser antes do início');
  END IF;

  v_ant := jsonb_build_object('nome', o.nome, 'cliente_nome', o.cliente_nome, 'cidade', o.cidade, 'uf', o.uf,
    'responsavel_nome', o.responsavel_nome, 'valor_previsto', o.valor_previsto, 'pct_conclusao', o.pct_conclusao,
    'data_inicio', o.data_inicio, 'data_prevista_fim', o.data_prevista_fim);

  UPDATE public.projetos_obras SET
    nome = v_nome,
    cliente_nome = CASE WHEN p_dados ? 'cliente_nome' THEN NULLIF(btrim(p_dados->>'cliente_nome'), '') ELSE cliente_nome END,
    endereco = CASE WHEN p_dados ? 'endereco' THEN NULLIF(btrim(p_dados->>'endereco'), '') ELSE endereco END,
    numero_endereco = CASE WHEN p_dados ? 'numero_endereco' THEN NULLIF(btrim(p_dados->>'numero_endereco'), '') ELSE numero_endereco END,
    bairro = CASE WHEN p_dados ? 'bairro' THEN NULLIF(btrim(p_dados->>'bairro'), '') ELSE bairro END,
    cidade = CASE WHEN p_dados ? 'cidade' THEN NULLIF(btrim(p_dados->>'cidade'), '') ELSE cidade END,
    uf = CASE WHEN p_dados ? 'uf' THEN NULLIF(upper(btrim(p_dados->>'uf')), '') ELSE uf END,
    cep = CASE WHEN p_dados ? 'cep' THEN NULLIF(btrim(p_dados->>'cep'), '') ELSE cep END,
    responsavel_nome = CASE WHEN p_dados ? 'responsavel_nome' THEN NULLIF(btrim(p_dados->>'responsavel_nome'), '') ELSE responsavel_nome END,
    observacoes = CASE WHEN p_dados ? 'observacoes' THEN NULLIF(btrim(p_dados->>'observacoes'), '') ELSE observacoes END,
    valor_previsto = v_valor, pct_conclusao = v_pct, data_inicio = v_ini, data_prevista_fim = v_fim,
    updated_at = now()
  WHERE id = p_obra_id
  RETURNING jsonb_build_object('nome', nome, 'cliente_nome', cliente_nome, 'cidade', cidade, 'uf', uf,
    'responsavel_nome', responsavel_nome, 'valor_previsto', valor_previsto, 'pct_conclusao', pct_conclusao,
    'data_inicio', data_inicio, 'data_prevista_fim', data_prevista_fim) INTO v_novo;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (o.company_id, auth.uid(), 'projetos_obras', p_obra_id, 'editar', v_ant, v_novo);
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('ok', false, 'erro', 'Confira os valores digitados (números e datas)');
END $function$;

-- Exclusão rastreável (soft-delete). Recusa se há financeiro ligado: medição, NFS-e ou pedido.
CREATE OR REPLACE FUNCTION public.fn_obra_excluir(p_obra_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE o public.projetos_obras%ROWTYPE; v_mov int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT * INTO o FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada ou já excluída'); END IF;
  IF o.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT (SELECT count(*) FROM public.erp_nfse_obra_medicao m WHERE m.obra_id = p_obra_id AND m.estornada_em IS NULL AND m.descartada_em IS NULL)
       + (SELECT count(*) FROM public.erp_nfse_emitidas n WHERE n.obra_id = p_obra_id AND n.status = 'autorizada')
       + (SELECT count(*) FROM public.erp_pedidos p WHERE p.obra_id = p_obra_id AND COALESCE(p.status,'') NOT IN ('cancelado','cancelada'))
    INTO v_mov;
  IF v_mov > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'obra_com_movimento',
      'mensagem', 'Esta obra tem medição, nota fiscal ou pedido ligados e não pode ser excluída. Use "Cancelar" para encerrá-la mantendo o histórico.');
  END IF;

  UPDATE public.projetos_obras
     SET deleted_at = now(), deleted_by = auth.uid(), delete_motivo = NULLIF(btrim(p_motivo), ''), updated_at = now()
   WHERE id = p_obra_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (o.company_id, auth.uid(), 'projetos_obras', p_obra_id, 'excluir',
            jsonb_build_object('numero', o.numero, 'nome', o.nome, 'status', o.status),
            jsonb_build_object('deleted_at', now(), 'motivo', NULLIF(btrim(p_motivo), '')));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_obter(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_obra_editar(uuid, jsonb) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_obra_excluir(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_obra_obter(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_editar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_excluir(uuid, text) TO authenticated;

-- RD-98 p3: origem do dado de src/app/dashboard/projetos/obras/page.tsx
UPDATE public.system_screens
   SET views_consumidas = ARRAY['projetos_obras','v_obra_resultado','projetos_obra_item','erp_nfse_emitidas','erp_receber']::text[],
       rpcs_chamadas = ARRAY['fn_obras_kpis','fn_obras_listar','fn_obras_receita','fn_obra_mudar_status','fn_obra_obter',
                             'fn_obra_editar','fn_obra_excluir','fn_obra_escopo','fn_obra_item_adicionar','fn_obra_item_excluir',
                             'fn_obra_fiscal_obter','fn_obra_salvar_fiscal']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/obras';

-- RD-95: "?" das ações novas (linhas novas, ON CONFLICT para ser idempotente)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.obras.acao_editar', 'Ações da obra', 'Editar obra',
 'Abre o formulário com todos os dados da obra: nome, cliente, endereço, responsável, valor previsto, andamento, datas e observações.',
 'Mantém o cadastro da obra fiel ao contrato. Mudanças de valor e de datas alimentam os indicadores e o cockpit; cada edição fica registrada (quem e quando).', 'Corrigir o fim previsto depois de um aditivo de prazo', 'Tentar mudar a situação aqui: Concluir, Pausar e Cancelar ficam nos botões do cartão.', 200, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.acao_excluir', 'Ações da obra', 'Excluir obra',
 'Pede o motivo e tira a obra da lista, dos indicadores e do resultado. O registro fica guardado com quem excluiu e quando.',
 'Serve para obra cadastrada por engano. Não apaga nada de verdade: a exclusão é rastreável. Obra com medição, nota fiscal ou pedido não pode ser excluída — use Cancelar.', 'Obra criada em duplicidade', 'Excluir uma obra que já foi faturada: o sistema recusa; cancele-a para manter o histórico.', 210, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.excluir_motivo', 'Ações da obra', 'Motivo da exclusão',
 'Escreva em uma frase por que a obra está sendo excluída.',
 'Fica gravado na trilha de auditoria junto com o seu nome e a data.', 'Cadastro duplicado da obra 0012', 'Deixar em branco: ajuda a entender depois o que aconteceu.', 220, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.edit_nome', 'Editar obra', 'Nome da obra',
 'Como a obra é chamada no dia a dia.',
 'Aparece no cartão, no cockpit, no resultado e nas propostas ligadas.', 'Reforma loja Centro', 'Usar só o nome do cliente: fica difícil separar duas obras do mesmo cliente.', 230, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.edit_cliente', 'Editar obra', 'Cliente',
 'Nome do contratante da obra.',
 'Agrupa a obra no cadastro de clientes e sai na documentação fiscal.', 'Construtora Alfa Ltda', 'Escrever diferente do cadastro de clientes: a obra deixa de aparecer junto dele.', 240, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.edit_valor', 'Editar obra', 'Valor previsto',
 'Valor total contratado da obra, em reais.',
 'É a base do indicador "Valor em andamento" e do percentual de faturamento.', 'R$ 480.000,00', 'Colocar o valor medido no lugar do contratado.', 250, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.edit_pct', 'Editar obra', '% concluído',
 'Andamento físico da obra, de 0 a 100.',
 'Mostra a barra de progresso do cartão e do cockpit.', '35', 'Informar 0,35 em vez de 35.', 260, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.edit_inicio', 'Editar obra', 'Início',
 'Data em que a obra começou ou vai começar.',
 'Base do prazo no cockpit e na linha do tempo.', '01/09/2026', 'Deixar vazio: o cockpit não calcula atraso.', 270, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.edit_fim', 'Editar obra', 'Fim previsto',
 'Data prevista para entregar a obra.',
 'O cockpit compara com hoje para avisar atraso. Não pode ser antes do início.', '30/03/2027', 'Esquecer de atualizar após aditivo de prazo.', 280, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.edit_responsavel', 'Editar obra', 'Responsável',
 'Nome do engenheiro ou encarregado responsável.',
 'Aparece no cartão para saber quem responde pela obra.', 'Eng. Marcos', 'Usar apelido que ninguém reconhece.', 290, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.edit_endereco', 'Editar obra', 'Endereço da obra',
 'Rua, número, bairro, cidade, UF e CEP do local da obra.',
 'Usado nos documentos e na NFS-e de construção.', 'Rua das Palmeiras, 120 — Centro — Fortaleza/CE', 'Endereço do escritório no lugar do endereço da obra.', 300, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.edit_obs', 'Editar obra', 'Observações',
 'Anotações livres sobre a obra.',
 'Fica para a equipe; não entra em cálculo.', 'Cliente pediu acesso só após as 8h', 'Registrar aqui um valor que deveria estar no campo próprio.', 310, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.resultado_vazio', 'Ações da obra', 'Sem medição lançada',
 'Nada a preencher: avisa que a obra ainda não tem medição, nota fiscal nem pedido.',
 'Mostra "sem medição" em vez de R$ 0,00 para você não confundir falta de lançamento com resultado zero. Lance a medição da obra para ver faturado e recebido.', 'Obra recém-aprovada, sem medição', 'Achar que o sistema não calcula: falta lançar a primeira medição.', 320, '/dashboard/projetos/obras', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;
