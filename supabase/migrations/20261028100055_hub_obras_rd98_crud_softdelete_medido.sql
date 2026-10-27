-- Hub · Obras (/dashboard/projetos/obras) — RD-98: CRUD completo + exclusão rastreável + origem do dado.
-- Adiciona: soft-delete (deleted_at/deleted_by/motivo) em projetos_obras; fn_obra_ler / fn_obra_editar / fn_obra_excluir
-- (guarda por empresa + audit_log_global); fn_obras_medido (medido e custo por obra, para o cartão sair do R$0 mudo).
-- Altera (CREATE OR REPLACE, mesma assinatura/retorno): fn_obras_listar, fn_obras_kpis, fn_obras_receita passam a
-- ignorar obra excluída. Nunca há DELETE físico. Nenhum dado existente é alterado.

ALTER TABLE public.projetos_obras
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS motivo_exclusao text;

CREATE INDEX IF NOT EXISTS ix_projetos_obras_ativas ON public.projetos_obras (company_id) WHERE deleted_at IS NULL;

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

-- Medido (avanço físico medido) e custo realizado por obra: o cartão mostra o que a obra já mediu mesmo sem NFS-e.
CREATE OR REPLACE FUNCTION public.fn_obras_medido(p_company_ids uuid[])
 RETURNS TABLE(obra_id uuid, valor_medido numeric, custo_realizado numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT o.id, COALESCE(o.valor_medido, 0), COALESCE(o.custo_realizado, 0)
    FROM public.projetos_obras o
   WHERE o.company_id = ANY(p_company_ids) AND o.company_id IN (SELECT public.get_user_company_ids())
     AND o.deleted_at IS NULL;
$function$;

-- Lê todos os campos editáveis da obra
CREATE OR REPLACE FUNCTION public.fn_obra_ler(p_obra_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE o public.projetos_obras%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obra não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(o.company_id);
  RETURN jsonb_build_object('id', o.id, 'numero', o.numero, 'nome', o.nome, 'cliente_nome', o.cliente_nome, 'endereco', o.endereco,
    'bairro', o.bairro, 'cidade', o.cidade, 'uf', o.uf, 'responsavel_nome', o.responsavel_nome, 'valor_previsto', o.valor_previsto,
    'pct_conclusao', o.pct_conclusao, 'data_inicio', o.data_inicio, 'data_prevista_fim', o.data_prevista_fim, 'observacoes', o.observacoes);
END
$function$;

-- Edita os campos da obra (status e vínculos com o orçamento NÃO mudam aqui)
CREATE OR REPLACE FUNCTION public.fn_obra_editar(p_obra_id uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE o public.projetos_obras%ROWTYPE; v_ant jsonb; v_pct int; v_val numeric; v_ini date; v_fim date;
BEGIN
  SELECT * INTO o FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obra não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(o.company_id);
  IF length(btrim(coalesce(p_dados->>'nome', o.nome))) = 0 THEN RAISE EXCEPTION 'Informe o nome da obra.'; END IF;
  v_pct := COALESCE(NULLIF(p_dados->>'pct_conclusao', '')::int, o.pct_conclusao);
  IF v_pct < 0 OR v_pct > 100 THEN RAISE EXCEPTION 'O percentual concluído vai de 0 a 100.'; END IF;
  v_val := COALESCE(NULLIF(p_dados->>'valor_previsto', '')::numeric, o.valor_previsto);
  IF v_val < 0 THEN RAISE EXCEPTION 'O valor previsto não pode ser negativo.'; END IF;
  v_ini := CASE WHEN p_dados ? 'data_inicio' THEN NULLIF(p_dados->>'data_inicio', '')::date ELSE o.data_inicio END;
  v_fim := CASE WHEN p_dados ? 'data_prevista_fim' THEN NULLIF(p_dados->>'data_prevista_fim', '')::date ELSE o.data_prevista_fim END;
  IF v_ini IS NOT NULL AND v_fim IS NOT NULL AND v_fim < v_ini THEN RAISE EXCEPTION 'O fim previsto não pode ser antes do início.'; END IF;
  v_ant := jsonb_build_object('nome', o.nome, 'cliente_nome', o.cliente_nome, 'endereco', o.endereco, 'bairro', o.bairro, 'cidade', o.cidade,
    'uf', o.uf, 'responsavel_nome', o.responsavel_nome, 'valor_previsto', o.valor_previsto, 'pct_conclusao', o.pct_conclusao,
    'data_inicio', o.data_inicio, 'data_prevista_fim', o.data_prevista_fim, 'observacoes', o.observacoes);
  UPDATE public.projetos_obras SET
    nome = btrim(COALESCE(p_dados->>'nome', nome)),
    cliente_nome = CASE WHEN p_dados ? 'cliente_nome' THEN NULLIF(btrim(p_dados->>'cliente_nome'), '') ELSE cliente_nome END,
    endereco = CASE WHEN p_dados ? 'endereco' THEN NULLIF(btrim(p_dados->>'endereco'), '') ELSE endereco END,
    bairro = CASE WHEN p_dados ? 'bairro' THEN NULLIF(btrim(p_dados->>'bairro'), '') ELSE bairro END,
    cidade = CASE WHEN p_dados ? 'cidade' THEN NULLIF(btrim(p_dados->>'cidade'), '') ELSE cidade END,
    uf = CASE WHEN p_dados ? 'uf' THEN NULLIF(upper(btrim(p_dados->>'uf')), '') ELSE uf END,
    responsavel_nome = CASE WHEN p_dados ? 'responsavel_nome' THEN NULLIF(btrim(p_dados->>'responsavel_nome'), '') ELSE responsavel_nome END,
    valor_previsto = v_val, pct_conclusao = v_pct, data_inicio = v_ini, data_prevista_fim = v_fim,
    observacoes = CASE WHEN p_dados ? 'observacoes' THEN NULLIF(btrim(p_dados->>'observacoes'), '') ELSE observacoes END,
    updated_at = now()
  WHERE id = p_obra_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (o.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'editar', v_ant, p_dados);
  RETURN jsonb_build_object('ok', true);
END
$function$;

-- Exclusão rastreável (soft-delete): quem, quando e por quê; nunca DELETE físico
CREATE OR REPLACE FUNCTION public.fn_obra_excluir(p_obra_id uuid, p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE o public.projetos_obras%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obra não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(o.company_id);
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;
  IF EXISTS (SELECT 1 FROM public.erp_nfse_emitidas n WHERE n.obra_id = p_obra_id AND n.status = 'autorizada') THEN
    RAISE EXCEPTION 'Esta obra tem NFS-e autorizada ligada. Cancele a nota antes de excluir a obra.';
  END IF;
  UPDATE public.projetos_obras SET deleted_at = now(), deleted_by = auth.uid(), motivo_exclusao = btrim(p_motivo), updated_at = now()
   WHERE id = p_obra_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (o.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'excluir',
            jsonb_build_object('numero', o.numero, 'nome', o.nome, 'status', o.status, 'valor_previsto', o.valor_previsto),
            jsonb_build_object('motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_obras_medido(uuid[]), public.fn_obra_ler(uuid), public.fn_obra_editar(uuid, jsonb), public.fn_obra_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obras_medido(uuid[]), public.fn_obra_ler(uuid), public.fn_obra_editar(uuid, jsonb), public.fn_obra_excluir(uuid, text) TO authenticated, service_role;

-- Origem do dado (RD-98 pilar 3)
UPDATE public.system_screens
   SET views_consumidas = ARRAY['projetos_obras', 'v_obra_resultado', 'erp_nfse_emitidas', 'erp_receber'],
       rpcs_chamadas = ARRAY['fn_obras_kpis', 'fn_obras_listar', 'fn_obras_receita', 'fn_obras_medido', 'fn_obra_ler', 'fn_obra_editar',
                             'fn_obra_excluir', 'fn_obra_mudar_status', 'fn_obra_escopo']
 WHERE rota = '/dashboard/projetos/obras';

-- Ajuda de campo (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('projetos.obras.editar', '/dashboard/projetos/obras', 'Obras', 'Editar obra',
   'Abre os dados da obra para corrigir nome, cliente, endereço, valor, datas e andamento.', 'Mantém a obra atualizada sem recriar. Cada alteração fica na auditoria.', 'Corrigir o fim previsto', 'Querer mudar a situação aqui: use Concluir, Pausar ou Cancelar.', 'hub', 940, 1, 'publicado'),
  ('projetos.obras.excluir', '/dashboard/projetos/obras', 'Obras', 'Excluir obra',
   'Remove a obra da lista informando o motivo. Não apaga: fica guardada com quem excluiu e quando.', 'Tira da tela obras lançadas por engano ou duplicadas, sem perder o histórico.', 'Obra duplicada', 'Excluir obra que já tem NFS-e autorizada: cancele a nota primeiro.', 'hub', 941, 1, 'publicado'),
  ('projetos.obras.motivo_exclusao', '/dashboard/projetos/obras', 'Obras', 'Motivo da exclusão',
   'Por que a obra está sendo excluída (mínimo 3 letras).', 'Fica na auditoria: quem excluiu, quando e por quê.', 'lançada em duplicidade', 'Deixar em branco: a exclusão não é aceita sem motivo.', 'hub', 942, 1, 'publicado'),
  ('projetos.obras.campo_nome', '/dashboard/projetos/obras', 'Obras', 'Nome da obra',
   'Como a obra é chamada no dia a dia.', 'Aparece no cartão, no cockpit e nos relatórios.', 'Reforma loja Centro', 'Deixar em branco: a obra fica sem nome.', 'hub', 943, 1, 'publicado'),
  ('projetos.obras.campo_cliente', '/dashboard/projetos/obras', 'Obras', 'Cliente',
   'O nome do cliente dono da obra.', 'Identifica a obra na lista e na busca.', 'Clínica Bem Viver', 'Usar o nome do contato em vez do cliente.', 'hub', 944, 1, 'publicado'),
  ('projetos.obras.campo_endereco', '/dashboard/projetos/obras', 'Obras', 'Endereço',
   'Rua e número onde a obra é executada.', 'Aparece nas equipes e documentos fiscais.', 'Rua das Flores, 120', 'Colocar o endereço do cliente quando a obra é em outro lugar.', 'hub', 945, 1, 'publicado'),
  ('projetos.obras.campo_cidade_uf', '/dashboard/projetos/obras', 'Obras', 'Cidade e UF',
   'Cidade e estado da obra.', 'Filtra e identifica a obra; usado no ISS da NFS-e.', 'Joinville / SC', 'Cidade do cliente em vez da cidade da obra.', 'hub', 946, 1, 'publicado'),
  ('projetos.obras.campo_responsavel', '/dashboard/projetos/obras', 'Obras', 'Responsável',
   'Quem toca a obra (engenheiro ou mestre).', 'Aparece no cartão para saber com quem falar.', 'Carlos Mendes', 'Deixar em branco: o cartão mostra "sem responsável".', 'hub', 947, 1, 'publicado'),
  ('projetos.obras.campo_valor', '/dashboard/projetos/obras', 'Obras', 'Valor previsto',
   'O valor total contratado da obra.', 'Base dos indicadores "Valor em andamento" e "Valor concluído".', '85000,00', 'Colocar o custo em vez do valor de venda.', 'hub', 948, 1, 'publicado'),
  ('projetos.obras.campo_pct', '/dashboard/projetos/obras', 'Obras', '% concluído',
   'O avanço da obra, de 0 a 100.', 'Mostra a barra de progresso do cartão.', '40', 'Informar 4 em vez de 40.', 'hub', 949, 1, 'publicado'),
  ('projetos.obras.campo_datas', '/dashboard/projetos/obras', 'Obras', 'Início e fim previsto',
   'Quando a obra começou e quando deve terminar.', 'Alimenta o prazo do cockpit e da linha do tempo.', '01/11/2026 a 30/01/2027', 'Fim previsto antes do início: não é aceito.', 'hub', 950, 1, 'publicado'),
  ('projetos.obras.campo_observacoes', '/dashboard/projetos/obras', 'Obras', 'Observações',
   'Qualquer detalhe que a equipe precise saber (opcional).', 'Fica junto da obra.', 'Acesso só pela rua lateral', 'Colocar aqui dados que têm campo próprio.', 'hub', 951, 1, 'publicado'),
  ('projetos.obras.card_medido', '/dashboard/projetos/obras', 'Obras', 'Medido',
   'Calculado: valor das medições já lançadas na obra.', 'Mostra quanto da obra já foi medido, mesmo antes de emitir a NFS-e.', 'R$ 12.000,00', 'Esperar valor sem lançar medição: zero significa que nenhuma medição foi lançada.', 'hub', 952, 1, 'publicado')
) AS t(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = t.chave);
