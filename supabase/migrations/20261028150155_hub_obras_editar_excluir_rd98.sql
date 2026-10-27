-- Hub · /dashboard/projetos/obras — delta 84 -> 95 (aud 27/10 17:25Z · Code: dev7claudeps)
--   1) RD-98 p2: CRUD completo no card da obra. EDITAR (campos da obra) e EXCLUIR (soft-delete RASTREÁVEL:
--      deleted_at + deleted_by + audit_log_global; nunca DELETE físico). Excluir só vale para obra já CANCELADA
--      (obra em andamento/concluída/pausada precisa ser cancelada antes — protege faturamento e medição).
--   2) Listagem NOVA fn_obras_listar_hub (filtra deleted_at e devolve os campos de edição) — as funções
--      existentes fn_obras_listar/fn_obras_kpis NÃO são alteradas (consumidas por outras telas).
--   3) RD-95: chaves de ajuda de Editar/Excluir. RD-98 p3: origem do dado (system_screens) da rota.
-- Migration ADITIVA (RD-94.1): 2 colunas nulas novas, 3 funções NOVAS (SECURITY DEFINER, guarda de empresa,
-- REVOKE anon/public), INSERT de ajuda (ON CONFLICT DO NOTHING), UPDATE de catálogo. Sem RLS nem view alterada.

ALTER TABLE public.projetos_obras
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

CREATE OR REPLACE FUNCTION public.fn_obras_listar_hub(p_company_ids uuid[])
 RETURNS TABLE(id uuid, company_id uuid, numero text, nome text, cliente_nome text, status text, valor_previsto numeric, pct_conclusao integer,
               cidade text, uf text, responsavel_nome text, data_inicio date, data_prevista_fim date, data_conclusao date,
               endereco text, numero_endereco text, bairro text, cep text, observacoes text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT o.id, o.company_id, o.numero, o.nome, o.cliente_nome, o.status, o.valor_previsto, o.pct_conclusao,
         o.cidade, o.uf, o.responsavel_nome, o.data_inicio, o.data_prevista_fim, o.data_conclusao,
         o.endereco, o.numero_endereco, o.bairro, o.cep, o.observacoes
    FROM public.projetos_obras o
   WHERE o.company_id = ANY(p_company_ids) AND o.company_id IN (SELECT get_user_company_ids())
     AND o.deleted_at IS NULL
   ORDER BY CASE o.status WHEN 'em_andamento' THEN 0 WHEN 'pausada' THEN 1 WHEN 'concluida' THEN 2 ELSE 3 END,
     o.data_inicio DESC NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.fn_obra_editar(p_obra_id uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_old public.projetos_obras%ROWTYPE; v_nome text; v_valor numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para editar a obra' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_old FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_old.company_id);
  v_nome := coalesce(nullif(btrim(p_dados->>'nome'), ''), v_old.nome);
  v_valor := CASE WHEN p_dados ? 'valor_previsto' AND nullif(btrim(p_dados->>'valor_previsto'), '') IS NOT NULL THEN (p_dados->>'valor_previsto')::numeric ELSE v_old.valor_previsto END;
  IF v_valor < 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'O valor previsto não pode ser negativo.'); END IF;
  UPDATE public.projetos_obras SET
      nome = v_nome,
      cliente_nome = CASE WHEN p_dados ? 'cliente_nome' THEN nullif(btrim(p_dados->>'cliente_nome'), '') ELSE cliente_nome END,
      endereco = CASE WHEN p_dados ? 'endereco' THEN nullif(btrim(p_dados->>'endereco'), '') ELSE endereco END,
      numero_endereco = CASE WHEN p_dados ? 'numero_endereco' THEN nullif(btrim(p_dados->>'numero_endereco'), '') ELSE numero_endereco END,
      bairro = CASE WHEN p_dados ? 'bairro' THEN nullif(btrim(p_dados->>'bairro'), '') ELSE bairro END,
      cidade = CASE WHEN p_dados ? 'cidade' THEN nullif(btrim(p_dados->>'cidade'), '') ELSE cidade END,
      uf = CASE WHEN p_dados ? 'uf' THEN nullif(upper(btrim(p_dados->>'uf')), '') ELSE uf END,
      cep = CASE WHEN p_dados ? 'cep' THEN nullif(btrim(p_dados->>'cep'), '') ELSE cep END,
      responsavel_nome = CASE WHEN p_dados ? 'responsavel_nome' THEN nullif(btrim(p_dados->>'responsavel_nome'), '') ELSE responsavel_nome END,
      valor_previsto = v_valor,
      data_inicio = CASE WHEN p_dados ? 'data_inicio' THEN nullif(p_dados->>'data_inicio', '')::date ELSE data_inicio END,
      data_prevista_fim = CASE WHEN p_dados ? 'data_prevista_fim' THEN nullif(p_dados->>'data_prevista_fim', '')::date ELSE data_prevista_fim END,
      observacoes = CASE WHEN p_dados ? 'observacoes' THEN nullif(btrim(p_dados->>'observacoes'), '') ELSE observacoes END,
      updated_at = now()
    WHERE id = p_obra_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_old.company_id, auth.uid(), 'projetos_obras', p_obra_id, 'editar',
            jsonb_build_object('nome', v_old.nome, 'cliente_nome', v_old.cliente_nome, 'valor_previsto', v_old.valor_previsto, 'cidade', v_old.cidade, 'uf', v_old.uf,
                               'responsavel_nome', v_old.responsavel_nome, 'data_inicio', v_old.data_inicio, 'data_prevista_fim', v_old.data_prevista_fim),
            p_dados);
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_obra_excluir(p_obra_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_o public.projetos_obras%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para excluir a obra' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_o FROM public.projetos_obras WHERE id = p_obra_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_o.company_id);
  IF v_o.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true); END IF;  -- idempotente
  IF v_o.status <> 'cancelada' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só obra cancelada pode ser excluída. Cancele a obra primeiro.');
  END IF;
  UPDATE public.projetos_obras SET deleted_at = now(), deleted_by = auth.uid(), updated_at = now() WHERE id = p_obra_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_o.company_id, auth.uid(), 'projetos_obras', p_obra_id, 'excluir',
            jsonb_build_object('numero', v_o.numero, 'nome', v_o.nome, 'status', v_o.status),
            jsonb_build_object('deleted', true, 'motivo', nullif(btrim(coalesce(p_motivo, '')), '')));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obras_listar_hub(uuid[]) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_obra_editar(uuid, jsonb) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_obra_excluir(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_obras_listar_hub(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_editar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_excluir(uuid, text) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
  ('projetos.obras.acao.editar', 'Obras', 'Editar obra',
   'Nada a preencher: é um botão. Abre o formulário com nome, cliente, endereço, responsável, valor previsto, datas e observações.',
   'Serve para corrigir ou completar os dados da obra depois de criada. Cada alteração fica registrada (quem, quando, antes e depois).',
   'O cliente mudou o prazo: toque em Editar, ajuste a data prevista de fim e salve.',
   'Tentar mudar a situação (concluir, pausar, cancelar) por aqui: isso é feito pelos botões de situação do card.',
   62, '/dashboard/projetos/obras'),
  ('projetos.obras.acao.excluir', 'Obras', 'Excluir obra',
   'Nada a preencher: é um botão (aparece só em obra cancelada). Pede confirmação e um motivo opcional.',
   'Tira a obra da lista sem apagar nada do banco: ela fica marcada como excluída, com quem e quando na auditoria. Só obra cancelada pode ser excluída, para nunca perder faturamento ou medição de obra viva.',
   'Obra criada em duplicidade: cancele, depois exclua a cópia.',
   'Procurar Excluir numa obra em andamento: primeiro use Cancelar; o Excluir aparece depois.',
   63, '/dashboard/projetos/obras'),
  ('projetos.obras.edit.responsavel', 'Obras', 'Responsável (edição)', 'Nome de quem responde pela obra no dia a dia.', 'Aparece no card da obra e ajuda a achar quem cobrar prazo e medição.', 'Eng. Marina Souza.', 'Colocar o nome do cliente aqui: o cliente tem campo próprio.', 65, '/dashboard/projetos/obras'),
  ('projetos.obras.edit.endereco', 'Obras', 'Endereço da obra (edição)', 'Rua, número, bairro, cidade, UF e CEP do local onde a obra acontece.', 'Define o local para a NFS-e de construção e para localizar a obra. Para CNO e código municipal use "Dados fiscais".', 'Rua das Flores, 120, Centro, Chapecó/SC, 89800-000.', 'Usar o endereço do cliente em vez do endereço da obra.', 66, '/dashboard/projetos/obras'),
  ('projetos.obras.edit.valor', 'Obras', 'Valor previsto (edição)', 'Valor total esperado da obra em reais, sem pontos de milhar (ex.: 120000.50).', 'Alimenta os indicadores de valor em andamento/concluído e a comparação com o custo real.', '85000 para uma reforma de R$ 85 mil.', 'Digitar o valor medido ou faturado: esses vêm das medições e notas.', 67, '/dashboard/projetos/obras'),
  ('projetos.obras.edit.datas', 'Obras', 'Datas da obra (edição)', 'Data de início e a previsão de término.', 'Controlam o prazo exibido no cockpit e na linha do tempo.', 'Início 01/11, previsão de fim 30/01.', 'Previsão de fim anterior ao início.', 68, '/dashboard/projetos/obras'),
  ('projetos.obras.edit.observacoes', 'Obras', 'Observações da obra (edição)', 'Texto livre: acesso ao local, restrições, combinados com o cliente.', 'Guarda o que a equipe precisa saber e não tem campo próprio.', 'Entrada de material só pelo portão 2, das 7h às 16h.', 'Colocar senha ou dado pessoal sensível: o texto é visível a quem vê a obra.', 69, '/dashboard/projetos/obras'),
  ('projetos.obras.resultado_vazio', 'Obras', 'Resultado da obra sem lançamento',
   'Nada a preencher: é um aviso. Aparece no lugar de R$ 0,00 quando a obra ainda não tem nota fiscal de serviço (NFS-e) nem medição.',
   'Mostra que o zero não é erro: a receita só aparece depois que uma NFS-e é autorizada para a obra. Evita confundir "ainda não faturou" com "dado quebrado".',
   'Obra nova, sem nota emitida: o card diz "sem faturamento lançado". Emitiu a primeira NFS-e: faturado, recebido e a receber passam a aparecer.',
   'Achar que o valor sumiu: a obra só precisa de uma NFS-e autorizada ligada a ela.',
   64, '/dashboard/projetos/obras')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

UPDATE public.system_screens
   SET views_consumidas = ARRAY[
        'projetos_obras',      -- lista, KPIs e edição das obras
        'v_obra_resultado',    -- custo real (material + viagens) por obra
        'erp_nfse_emitidas',   -- faturado (NFS-e autorizadas, via fn_obras_receita)
        'erp_receber',         -- títulos das notas (via fn_obras_receita)
        'erp_receber_baixa',   -- recebido (via fn_obras_receita)
        'projetos_obra_itens'  -- escopo da obra (fn_obra_escopo)
       ]::text[],
       rpcs_chamadas = ARRAY['fn_obras_kpis','fn_obras_listar_hub','fn_obras_receita','fn_obra_mudar_status','fn_obra_editar','fn_obra_excluir',
                             'fn_obra_escopo','fn_obra_item_adicionar','fn_obra_item_excluir','fn_obra_fiscal_obter','fn_obra_salvar_fiscal']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/obras';
