-- Hub · Take-off / Engenharia (/dashboard/projetos/takeoff, /engenharia) — aud8 27/10 (caixas 300cc641 [48→95] e 0dcf79a1 [28→95] · Code: dev7claudeps)
--   RD-98 p1: Engenharia era "tela morta" (2 selects vazios). Nova RPC fn_takeoff_plantas_listar entrega a lista real de take-offs
--             (ambientes, área, serviços vinculados, status, orçamento) para as duas telas.
--   RD-98 p2/p4: Editar e Excluir rastreável (soft-delete: deleted_at + autor + motivo + audit_log_global) de PLANTA e de AMBIENTE.
--             Nunca DELETE físico. Quem lê planta/ambiente (geração do orçamento, sugestão de serviços, busca por hash, área total)
--             passa a ignorar o excluído — o quantitativo nunca soma ambiente excluído.
--   RD-98 p3: system_screens.views_consumidas/rpcs_chamadas.   RD-95: "?" das ações/colunas novas.
-- Aditiva: colunas novas (NULL), funções novas; as funções existentes ganham só o filtro deleted_at IS NULL (mesma assinatura/retorno).

ALTER TABLE public.erp_obra_planta
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by uuid, ADD COLUMN IF NOT EXISTS delete_motivo text;
ALTER TABLE public.erp_obra_planta_ambiente
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by uuid, ADD COLUMN IF NOT EXISTS delete_motivo text;
CREATE INDEX IF NOT EXISTS ix_obra_planta_ativas ON public.erp_obra_planta (company_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_obra_planta_amb_ativos ON public.erp_obra_planta_ambiente (planta_id) WHERE deleted_at IS NULL;

-- ── Funções existentes: só ignoram o excluído ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_takeoff_gerar_orcamento(p_company_id uuid, p_planta_id uuid, p_orcamento_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE v_count int := 0; a record; v_qtd numeric; v_ordem int; v_bdi numeric; v_preco numeric;
BEGIN
  SELECT COALESCE(bdi_total_pct,0) INTO v_bdi FROM projetos_modulo_config WHERE company_id=p_company_id;
  v_bdi := COALESCE(v_bdi,0);
  SELECT COALESCE(max(ordem),0) INTO v_ordem FROM erp_orcamentos_itens WHERE orcamento_id=p_orcamento_id;
  FOR a IN
    SELECT amb.*, s.nome AS s_nome, s.codigo AS s_codigo, s.unidade AS s_unidade, s.custo_unitario_total
      FROM erp_obra_planta_ambiente amb
      JOIN projetos_servicos s ON s.id=amb.servico_id
     WHERE amb.planta_id=p_planta_id AND amb.company_id=p_company_id
       AND amb.confirmado=true AND amb.servico_id IS NOT NULL AND amb.deleted_at IS NULL
  LOOP
    v_qtd := CASE a.base_calculo
               WHEN 'perimetro' THEN COALESCE(a.perimetro_ml,0)
               WHEN 'pe_direito_parede' THEN COALESCE(a.perimetro_ml,0)*COALESCE(a.pe_direito_m,0)
               ELSE COALESCE(a.area_m2,0) END;
    v_preco := ROUND(COALESCE(a.custo_unitario_total,0) * (1 + v_bdi/100), 2);
    v_ordem := v_ordem + 1;
    INSERT INTO erp_orcamentos_itens(orcamento_id,company_id,ordem,tipo_item,servico_id,servico_codigo,servico_descricao,
      produto_nome,unidade,quantidade,preco_custo,preco_unitario,subtotal,bdi_percentual,observacoes)
    VALUES (p_orcamento_id,p_company_id,v_ordem,'servico',a.servico_id,a.s_codigo,a.s_nome,
      a.s_nome||' - '||a.nome, a.s_unidade, v_qtd, a.custo_unitario_total, v_preco,
      ROUND(v_qtd*v_preco,2), v_bdi, 'Gerado por takeoff IA - '||a.nome);
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    UPDATE erp_obra_planta
       SET ia_erro='Nenhum ambiente elegível: confirme os ambientes e escolha o serviço de cada um.', updated_at=now()
     WHERE id=p_planta_id AND company_id=p_company_id;
  ELSE
    UPDATE erp_obra_planta SET status='confirmada', ia_erro=NULL, updated_at=now()
     WHERE id=p_planta_id AND company_id=p_company_id;
  END IF;
  RETURN v_count;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_takeoff_criar_orcamento(p_company_id uuid, p_planta_id uuid, p_cliente_id uuid DEFAULT NULL::uuid, p_oportunidade_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_planta record; v_orc_id uuid; v_numero text; v_cli_id uuid; v_cli_nome text; v_validade int; v_qtd int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO v_planta FROM erp_obra_planta WHERE id=p_planta_id AND company_id=p_company_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'planta_nao_encontrada'); END IF;
  SELECT count(*) INTO v_qtd FROM erp_obra_planta_ambiente
   WHERE planta_id=p_planta_id AND company_id=p_company_id AND confirmado=true AND servico_id IS NOT NULL AND deleted_at IS NULL;
  IF v_qtd = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nenhum_ambiente_pronto',
      'mensagem', 'Confirme os ambientes e escolha o serviço de cada um antes de gerar o orçamento.'); END IF;
  v_cli_id := COALESCE(p_cliente_id, v_planta.cliente_id);
  v_cli_nome := v_planta.cliente_nome;
  IF v_cli_nome IS NULL AND v_cli_id IS NOT NULL THEN
    SELECT COALESCE(nome_fantasia, razao_social) INTO v_cli_nome FROM erp_clientes WHERE id=v_cli_id; END IF;
  SELECT COALESCE(validade_proposta_dias, 30) INTO v_validade FROM projetos_modulo_config WHERE company_id=p_company_id;
  v_validade := COALESCE(v_validade, 30);
  INSERT INTO erp_orcamentos (company_id, cliente_id, cliente_nome, status,
      data_emissao, data_validade, observacoes_internas, created_by)
  VALUES (p_company_id, v_cli_id, v_cli_nome, 'rascunho',
      CURRENT_DATE, CURRENT_DATE + v_validade, 'Gerado do take-off: ' || COALESCE(v_planta.nome,'planta'), auth.uid())
  RETURNING id, numero INTO v_orc_id, v_numero;
  PERFORM public.fn_takeoff_gerar_orcamento(p_company_id, p_planta_id, v_orc_id);
  UPDATE erp_obra_planta SET orcamento_id=v_orc_id, updated_at=now() WHERE id=p_planta_id AND company_id=p_company_id;
  -- F2.7 · vincula à oportunidade quando veio de uma (só se ela ainda não tem orçamento — não sobrescreve)
  IF p_oportunidade_id IS NOT NULL THEN
    UPDATE erp_crm_oportunidade SET orcamento_id=v_orc_id, updated_at=now()
     WHERE id=p_oportunidade_id AND company_id=p_company_id AND orcamento_id IS NULL;
  END IF;
  RETURN jsonb_build_object('ok', true, 'orcamento_id', v_orc_id, 'numero', v_numero,
    'itens', (SELECT count(*) FROM erp_orcamentos_itens WHERE orcamento_id=v_orc_id));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_takeoff_sugerir_servicos(p_company_id uuid, p_planta_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_n int := 0; a record; v_serv uuid;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  FOR a IN
    SELECT id, nome FROM erp_obra_planta_ambiente
     WHERE planta_id = p_planta_id AND company_id = p_company_id AND servico_id IS NULL AND deleted_at IS NULL
  LOOP
    SELECT k.servico_id INTO v_serv
      FROM projetos_servico_palavra_chave k
      JOIN projetos_servicos s ON s.id = k.servico_id AND s.ativo
     WHERE k.company_id = p_company_id AND k.ativo
       AND unaccent(lower(a.nome)) LIKE '%' || unaccent(lower(k.palavra)) || '%'
     ORDER BY k.prioridade ASC, length(k.palavra) DESC
     LIMIT 1;
    IF v_serv IS NOT NULL THEN
      UPDATE erp_obra_planta_ambiente SET servico_id = v_serv, updated_at = now() WHERE id = a.id;
      v_n := v_n + 1;
    END IF;
    v_serv := NULL;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'sugeridos', v_n);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_takeoff_planta_procurar_por_hash(p_company_id uuid, p_arquivo_hash text)
 RETURNS TABLE(id uuid, nome text, aps_status text, analisado_em timestamp with time zone, arquivo_dwg_path text, arquivo_path text, arquivo_tipo text, orcamento_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_arquivo_hash IS NULL OR length(p_arquivo_hash) < 16 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.nome, p.aps_status, p.analisado_em,
         p.arquivo_dwg_path, p.arquivo_path, p.arquivo_tipo, p.orcamento_id
    FROM public.erp_obra_planta p
   WHERE p.company_id = p_company_id
     AND p.arquivo_hash = p_arquivo_hash
     AND p.deleted_at IS NULL
   ORDER BY
     (CASE p.aps_status
        WHEN 'radiografado' THEN 1
        WHEN 'traduzindo'   THEN 2
        ELSE                     3 END),
     p.updated_at DESC
   LIMIT 1;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_takeoff_ambientes_salvar(p_company_id uuid, p_planta_id uuid, p_ambientes jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE v_count int := 0; r jsonb;
BEGIN
  DELETE FROM erp_obra_planta_ambiente WHERE planta_id=p_planta_id AND company_id=p_company_id AND origem='ia' AND confirmado=false;
  FOR r IN SELECT * FROM jsonb_array_elements(p_ambientes)
  LOOP
    INSERT INTO erp_obra_planta_ambiente(company_id,planta_id,nome,largura_m,comprimento_m,area_m2,perimetro_ml,pe_direito_m,confianca,origem)
    VALUES (p_company_id,p_planta_id,
      COALESCE(r->>'nome','Ambiente'),
      NULLIF(r->>'largura_m','')::numeric, NULLIF(r->>'comprimento_m','')::numeric,
      NULLIF(r->>'area_m2','')::numeric, NULLIF(r->>'perimetro_ml','')::numeric, NULLIF(r->>'pe_direito_m','')::numeric,
      COALESCE(r->>'confianca','media'),'ia');
    v_count := v_count + 1;
  END LOOP;
  UPDATE erp_obra_planta SET status='processada',
    area_total_m2=(SELECT COALESCE(sum(area_m2),0) FROM erp_obra_planta_ambiente WHERE planta_id=p_planta_id AND deleted_at IS NULL)
  WHERE id=p_planta_id AND company_id=p_company_id;
  RETURN v_count;
END $function$;

-- ── Lista real de take-offs (Engenharia + Take-off) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_takeoff_plantas_listar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_company_id IS NULL OR p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  RETURN jsonb_build_object('ok', true, 'itens', COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'created_at') DESC) FROM (
      SELECT jsonb_build_object(
        'id', p.id, 'nome', p.nome, 'status', p.status, 'aps_status', p.aps_status, 'arquivo_tipo', p.arquivo_tipo,
        'orcamento_id', p.orcamento_id, 'orcamento_numero', o.numero, 'cliente_nome', p.cliente_nome,
        'observacoes', p.observacoes, 'created_at', p.created_at,
        'n_ambientes', COALESCE(am.n, 0), 'n_prontos', COALESCE(am.prontos, 0), 'area_total', COALESCE(am.area, 0),
        'servicos', COALESCE(am.servicos, '[]'::jsonb)) AS x
        FROM public.erp_obra_planta p
        LEFT JOIN public.erp_orcamentos o ON o.id = p.orcamento_id
        LEFT JOIN LATERAL (
          SELECT count(*) AS n, count(*) FILTER (WHERE a.confirmado AND a.servico_id IS NOT NULL) AS prontos,
                 COALESCE(sum(a.area_m2), 0) AS area,
                 (SELECT COALESCE(jsonb_agg(DISTINCT s.nome), '[]'::jsonb) FROM public.erp_obra_planta_ambiente a2
                    JOIN public.projetos_servicos s ON s.id = a2.servico_id
                   WHERE a2.planta_id = p.id AND a2.deleted_at IS NULL) AS servicos
            FROM public.erp_obra_planta_ambiente a WHERE a.planta_id = p.id AND a.deleted_at IS NULL) am ON true
       WHERE p.company_id = p_company_id AND p.deleted_at IS NULL
       ORDER BY p.created_at DESC LIMIT 100) t), '[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_takeoff_planta_editar(p_planta_id uuid, p_nome text, p_orcamento_id uuid DEFAULT NULL, p_cliente_nome text DEFAULT NULL, p_observacoes text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE p public.erp_obra_planta%ROWTYPE; v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para editar'); END IF;
  SELECT * INTO p FROM public.erp_obra_planta WHERE id = p_planta_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Take-off não encontrado'); END IF;
  IF p.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_nome := COALESCE(NULLIF(btrim(p_nome), ''), p.nome);
  IF p_orcamento_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.erp_orcamentos WHERE id = p_orcamento_id AND company_id = p.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Orçamento de destino inválido para esta empresa');
  END IF;
  UPDATE public.erp_obra_planta SET nome = v_nome, orcamento_id = COALESCE(p_orcamento_id, orcamento_id),
         cliente_nome = COALESCE(NULLIF(btrim(p_cliente_nome), ''), cliente_nome), observacoes = COALESCE(p_observacoes, observacoes), updated_at = now()
   WHERE id = p_planta_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p.company_id, auth.uid(), 'erp_obra_planta', p_planta_id, 'editar',
          jsonb_build_object('nome', p.nome, 'orcamento_id', p.orcamento_id), jsonb_build_object('nome', v_nome, 'orcamento_id', COALESCE(p_orcamento_id, p.orcamento_id)));
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_takeoff_planta_excluir(p_planta_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE p public.erp_obra_planta%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT * INTO p FROM public.erp_obra_planta WHERE id = p_planta_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Take-off não encontrado ou já excluído'); END IF;
  IF p.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.erp_obra_planta SET deleted_at = now(), deleted_by = auth.uid(), delete_motivo = NULLIF(btrim(p_motivo), ''), updated_at = now() WHERE id = p_planta_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p.company_id, auth.uid(), 'erp_obra_planta', p_planta_id, 'excluir',
          jsonb_build_object('nome', p.nome, 'status', p.status, 'orcamento_id', p.orcamento_id),
          jsonb_build_object('deleted_at', now(), 'motivo', NULLIF(btrim(p_motivo), '')));
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_takeoff_ambiente_excluir(p_ambiente_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE a public.erp_obra_planta_ambiente%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT * INTO a FROM public.erp_obra_planta_ambiente WHERE id = p_ambiente_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Ambiente não encontrado ou já excluído'); END IF;
  IF a.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.erp_obra_planta_ambiente SET deleted_at = now(), deleted_by = auth.uid(), delete_motivo = NULLIF(btrim(p_motivo), ''), updated_at = now() WHERE id = p_ambiente_id;
  UPDATE public.erp_obra_planta SET area_total_m2 = (SELECT COALESCE(sum(area_m2), 0) FROM public.erp_obra_planta_ambiente WHERE planta_id = a.planta_id AND deleted_at IS NULL), updated_at = now()
   WHERE id = a.planta_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (a.company_id, auth.uid(), 'erp_obra_planta_ambiente', p_ambiente_id, 'excluir',
          jsonb_build_object('nome', a.nome, 'area_m2', a.area_m2, 'servico_id', a.servico_id),
          jsonb_build_object('deleted_at', now(), 'motivo', NULLIF(btrim(p_motivo), '')));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_takeoff_plantas_listar(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_takeoff_planta_editar(uuid, text, uuid, text, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_takeoff_planta_excluir(uuid, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_takeoff_ambiente_excluir(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_takeoff_plantas_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_takeoff_planta_editar(uuid, text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_takeoff_planta_excluir(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_takeoff_ambiente_excluir(uuid, text) TO authenticated;

-- RD-95: "?" das ações/colunas novas
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.engenharia.lista', 'Lista', 'Take-offs da empresa',
 'Nada a preencher: lista os take-offs já criados, com ambientes, área total, serviços vinculados, status e orçamento.',
 'Mostra o que já foi medido para você retomar, editar ou excluir sem recomeçar.', 'Piso galpão — 6 ambientes, 420 m²', 'Criar outro take-off sem olhar se já existe um da mesma obra.', 600, '/dashboard/projetos/engenharia', 'projetos', 'publicado'),
('projetos.engenharia.col_ambientes', 'Lista', 'Ambientes',
 'Nada a preencher: quantidade de ambientes do take-off e quantos já estão prontos (confirmados e com serviço).',
 'Só ambiente pronto entra no cálculo do orçamento.', '6 (4 prontos)', 'Gerar o orçamento com ambientes ainda não confirmados.', 610, '/dashboard/projetos/engenharia', 'projetos', 'publicado'),
('projetos.engenharia.col_area_total', 'Lista', 'Área total (m²)',
 'Nada a preencher: soma da área dos ambientes do take-off.',
 'Base de conferência com a metragem do projeto.', '420', 'Somar área de ambientes excluídos: eles saem da conta.', 620, '/dashboard/projetos/engenharia', 'projetos', 'publicado'),
('projetos.engenharia.col_servicos', 'Lista', 'Serviços vinculados',
 'Nada a preencher: serviços do catálogo ligados aos ambientes.',
 'Mostra o que será orçado. “Nenhum vinculado” indica que falta escolher o serviço de cada ambiente.', 'Piso epóxi, Rodapé', 'Deixar ambiente sem serviço: ele não gera item.', 630, '/dashboard/projetos/engenharia', 'projetos', 'publicado'),
('projetos.engenharia.col_status', 'Lista', 'Status do take-off',
 'Nada a preencher: situação do take-off (enviada, processada, confirmada...).',
 'Indica em que etapa o take-off está.', 'confirmada', 'Ler “confirmada” como orçamento enviado ao cliente: é só o take-off.', 640, '/dashboard/projetos/engenharia', 'projetos', 'publicado'),
('projetos.engenharia.col_acoes', 'Lista', 'Ações do take-off',
 'Abrir carrega o take-off para trabalhar. Editar muda o nome e o orçamento de destino. Excluir pede o motivo.',
 'Mantém a lista limpa; a exclusão é rastreável (quem, quando e por quê) e some também do cálculo.', 'Excluir um take-off criado em duplicidade', 'Excluir esperando apagar o orçamento já gerado: ele continua existindo.', 650, '/dashboard/projetos/engenharia', 'projetos', 'publicado'),
('projetos.engenharia.amb_qtd', 'Ambientes', 'Quantidade do ambiente',
 'Nada a preencher: quantidade que o ambiente gera, conforme a base de cálculo (área, perímetro ou parede).',
 'É o que multiplica o serviço no orçamento e no quantitativo de materiais.', 'Sala 01: 35 m²', 'Trocar a base e esquecer de conferir esta quantidade.', 660, '/dashboard/projetos/engenharia', 'projetos', 'publicado'),
('projetos.engenharia.amb_excluir', 'Ambientes', 'Excluir ambiente',
 'Tira o ambiente do take-off pedindo o motivo.',
 'O ambiente excluído deixa de entrar no cálculo; o registro fica guardado.', 'Ambiente lançado duas vezes', 'Excluir para “zerar” um serviço: prefira desmarcar o OK.', 670, '/dashboard/projetos/engenharia', 'projetos', 'publicado'),
('projetos.engenharia.quantitativo', 'Resultado', 'Quantitativo previsto',
 'Nada a preencher: materiais e horas de mão de obra dos serviços dos ambientes confirmados, multiplicados pela quantidade de cada ambiente.',
 'Atualiza sozinho a cada ambiente confirmado, antes mesmo de gerar o orçamento — serve para conferir e comprar.', 'Resina epóxi: 336 kg', 'Esperar valores sem confirmar os ambientes: só os confirmados entram.', 680, '/dashboard/projetos/engenharia', 'projetos', 'publicado'),
('projetos.engenharia.edit_nome', 'Editar', 'Nome do take-off',
 'Como o take-off é chamado na lista.',
 'Facilita achar o take-off depois.', 'Galpão — piso industrial', 'Nomes iguais para obras diferentes.', 690, '/dashboard/projetos/engenharia', 'projetos', 'publicado'),
('projetos.engenharia.edit_orcamento', 'Editar', 'Orçamento de destino do take-off',
 'Orçamento que vai receber os itens gerados. Deixe “manter o atual” para não mudar.',
 'Define para onde vão os itens ao gerar o orçamento.', 'Proposta 0042', 'Trocar o destino depois de já ter gerado os itens: eles ficam no orçamento anterior.', 700, '/dashboard/projetos/engenharia', 'projetos', 'publicado'),
('projetos.engenharia.excluir_motivo', 'Editar', 'Motivo da exclusão',
 'Escreva em uma frase por que está excluindo.',
 'Fica na trilha de auditoria com seu nome e a data.', 'Criado em duplicidade', 'Deixar em branco.', 710, '/dashboard/projetos/engenharia', 'projetos', 'publicado'),
('projetos.takeoff.tab_excluir', 'Ambientes', 'Excluir ambiente',
 'Tira o ambiente do take-off pedindo o motivo.',
 'O ambiente excluído deixa de entrar no cálculo; o registro fica guardado.', 'Ambiente detectado duas vezes pela IA', 'Excluir para zerar um serviço: prefira desmarcar o OK.', 700, '/dashboard/projetos/takeoff', 'projetos', 'publicado'),
('projetos.takeoff.acoes_planta', 'Plantas enviadas', 'Ações da planta',
 'Ver/Reabrir carrega a planta. Editar muda o nome e o orçamento de destino. Excluir pede o motivo.',
 'Permite retomar de onde parou e manter a lista limpa; a exclusão é rastreável e a planta some do cálculo e do acervo.', 'Reabrir a planta do galpão para gerar o orçamento', 'Excluir esperando apagar o orçamento já gerado: ele continua existindo.', 710, '/dashboard/projetos/takeoff', 'projetos', 'publicado'),
('projetos.takeoff.etapa_planta', 'Etapas', 'Etapa: Enviar a planta',
 'Envie o arquivo (DWG, PDF, PNG ou JPG). Antes, escolha o orçamento de destino.',
 'Sem a planta não há o que medir.', 'planta-galpao.pdf', 'Enviar sem escolher o destino: o envio é bloqueado.', 720, '/dashboard/projetos/takeoff', 'projetos', 'publicado'),
('projetos.takeoff.etapa_analise', 'Etapas', 'Etapa: Analisar',
 'Peça a análise da planta para a IA/CAD extrair os ambientes e as medidas.',
 'Gera a lista de ambientes que você vai revisar.', '8 ambientes encontrados', 'Confiar sem revisar as medidas.', 730, '/dashboard/projetos/takeoff', 'projetos', 'publicado'),
('projetos.takeoff.etapa_revisar', 'Etapas', 'Etapa: Revisar medidas',
 'Confira área, perímetro e pé-direito de cada ambiente e confirme.',
 'A IA sugere e você confirma: só ambiente confirmado entra no orçamento.', 'Corrigir a área da sala de 38 para 35 m²', 'Confirmar tudo sem olhar a planta.', 740, '/dashboard/projetos/takeoff', 'projetos', 'publicado'),
('projetos.takeoff.etapa_servico', 'Etapas', 'Etapa: Vincular serviços',
 'Escolha o serviço do catálogo de cada ambiente.',
 'O serviço define o preço e os materiais do ambiente.', 'Sala → Piso epóxi', 'Esquecer ambientes sem serviço.', 750, '/dashboard/projetos/takeoff', 'projetos', 'publicado'),
('projetos.takeoff.etapa_destino', 'Etapas', 'Etapa: Escolher orçamento',
 'Selecione o orçamento que vai receber os itens.',
 'Liga o take-off à proposta do cliente.', 'Proposta 0042', 'Escolher a proposta de outro cliente.', 760, '/dashboard/projetos/takeoff', 'projetos', 'publicado'),
('projetos.takeoff.etapa_gerar', 'Etapas', 'Etapa: Gerar orçamento',
 'Gera os itens do orçamento a partir dos ambientes confirmados.',
 'Termina o take-off: os itens aparecem na proposta.', '12 itens gerados', 'Gerar duas vezes seguidas: os itens se repetem.', 770, '/dashboard/projetos/takeoff', 'projetos', 'publicado'),
('projetos.takeoff.edit_nome', 'Editar', 'Nome do take-off',
 'Como a planta/take-off é chamado na lista.',
 'Facilita achar a planta depois.', 'Galpão — piso industrial', 'Nomes iguais para obras diferentes.', 780, '/dashboard/projetos/takeoff', 'projetos', 'publicado'),
('projetos.takeoff.edit_orcamento', 'Editar', 'Orçamento de destino do take-off',
 'Orçamento que vai receber os itens. “Manter o atual” não muda nada.',
 'Define para onde vão os itens ao gerar.', 'Proposta 0042', 'Trocar depois de gerar os itens.', 790, '/dashboard/projetos/takeoff', 'projetos', 'publicado'),
('projetos.takeoff.excluir_motivo', 'Editar', 'Motivo da exclusão',
 'Escreva em uma frase por que está excluindo.',
 'Fica na trilha de auditoria com seu nome e a data.', 'Planta enviada por engano', 'Deixar em branco.', 800, '/dashboard/projetos/takeoff', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: origem do dado das rotas
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_obra_planta','erp_obra_planta_ambiente','erp_orcamentos','erp_orcamentos_itens','v_projetos_servicos_catalogo','v_projetos_bom_completo']::text[],
       rpcs_chamadas = ARRAY['fn_takeoff_plantas_listar','fn_takeoff_planta_salvar','fn_takeoff_planta_editar','fn_takeoff_planta_excluir','fn_takeoff_ambiente_criar_manual','fn_takeoff_ambiente_atualizar','fn_takeoff_ambiente_excluir','fn_takeoff_sugerir_servicos','fn_takeoff_gerar_orcamento']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/engenharia';
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_obra_planta','erp_obra_planta_ambiente','erp_orcamentos','projetos_servicos','projetos_modulo_config']::text[],
       rpcs_chamadas = ARRAY['fn_takeoff_planta_procurar_por_hash','fn_takeoff_planta_salvar','fn_takeoff_ambientes_salvar','fn_takeoff_ambiente_atualizar','fn_takeoff_ambiente_criar_manual','fn_takeoff_sugerir_servicos','fn_takeoff_gerar_orcamento','fn_takeoff_criar_orcamento','fn_takeoff_planta_editar','fn_takeoff_planta_excluir','fn_takeoff_ambiente_excluir']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/takeoff';
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_obra_planta']::text[],
       rpcs_chamadas = ARRAY[]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/takeoff/acervo';
