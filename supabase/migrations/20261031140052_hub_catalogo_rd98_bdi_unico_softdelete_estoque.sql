-- Hub · Catálogo (/dashboard/projetos/catalogo) — plano aud8 28/10 (55→95), Code: desenvolvedor_4_g.
-- ADITIVA: colunas novas (soft-delete em projetos_servicos; elo ao estoque em m16_insumos), 3 RPCs novas e a troca de
-- fn_projetos_deletar_servico (DELETE físico → soft-delete rastreável). Nenhum dado de cliente é alterado ou apagado.
--
-- Prova no dado (RD-38) que originou esta migration:
--   • BDI DUPLICADO: a LISTA calculava preço = custo × (1 + projetos_modulo_config.bdi_total_pct) (GE: 36,58%), enquanto o
--     detalhe da composição (fn_servico_composicao_detalhe → motor erp_precificacao_config) mostra o BDI implícito do motor
--     (GE: ~20,97%). Duas fontes para o mesmo serviço. Agora UMA fonte: fn_projetos_catalogo_precos devolve, por serviço,
--     custo, preço e BDI aplicado + a FONTE ('motor' = precificação da empresa; 'bdi_empresa' = BDI único do módulo quando
--     a empresa ainda não tem precificação; 'sem_bdi' = nenhuma regra → sem preço, nunca número inventado). Lista e detalhe
--     passam a mostrar o mesmo número, porque a lista chama a mesma função do detalhe.
--   • BOM × estoque: 0 dos 31 insumos da GE casam com erp_produtos (por código). Por isso o elo é explícito
--     (m16_insumos.produto_id) e a tela mostra "X de Y insumos ligados ao estoque" com a ação "Ligar ao estoque".
--   • Exclusão: fn_projetos_deletar_servico apagava fisicamente e não checava a empresa do usuário.

ALTER TABLE public.projetos_servicos
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS motivo_exclusao text;

ALTER TABLE public.m16_insumos
  ADD COLUMN IF NOT EXISTS produto_id uuid REFERENCES public.erp_produtos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_m16_insumos_produto_id ON public.m16_insumos (produto_id) WHERE produto_id IS NOT NULL;

-- A lista não mostra serviço excluído (mesmas colunas de antes; só o filtro muda).
CREATE OR REPLACE VIEW public.v_projetos_servicos_catalogo WITH (security_invoker = true) AS
 SELECT id, company_id, codigo, nome, descricao, unidade, categoria, custo_material, custo_mao_obra, custo_equipamento,
        custo_unitario_total, produtividade_unidade_dia, equipe_padrao, is_publico, forked_from, source_type, source_ref,
        versao, versao_anterior_id, ativo, observacoes, created_at, updated_at,
    ( SELECT count(*) FROM projetos_servicos_bom WHERE projetos_servicos_bom.servico_id = s.id) AS qtd_itens_bom,
    ( SELECT count(*) FROM projetos_servicos_bom WHERE projetos_servicos_bom.servico_id = s.id AND projetos_servicos_bom.tipo = 'insumo'::text) AS qtd_insumos,
    ( SELECT count(*) FROM projetos_servicos_bom WHERE projetos_servicos_bom.servico_id = s.id AND projetos_servicos_bom.tipo = 'mao_obra'::text) AS qtd_mo,
        CASE
            WHEN is_publico THEN (EXISTS ( SELECT 1 FROM projetos_servicos s2
              WHERE s2.forked_from = s.id AND s2.company_id = (current_setting('app.current_company_id'::text, true))::uuid))
            ELSE false
        END AS foi_forkado
   FROM projetos_servicos s
  WHERE ativo = true AND deleted_at IS NULL;

-- Exclusão rastreável (soft-delete): quem, quando e por quê; some da lista; nada é apagado.
CREATE OR REPLACE FUNCTION public.fn_projetos_deletar_servico(p_servico_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v public.projetos_servicos%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.projetos_servicos WHERE id = p_servico_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Serviço não encontrado'); END IF;
  IF v.is_publico THEN
    RETURN jsonb_build_object('success', false, 'error', 'Não é permitido excluir serviços da biblioteca pública');
  END IF;
  PERFORM public.fn__guarda_empresa(v.company_id);
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Informe o motivo da exclusão (mínimo 3 letras).');
  END IF;
  UPDATE public.projetos_servicos
     SET deleted_at = now(), deleted_by = auth.uid(), motivo_exclusao = btrim(p_motivo), ativo = false, updated_at = now()
   WHERE id = p_servico_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v.company_id, auth.uid(), 'projetos_servicos', p_servico_id::text, 'excluir',
            jsonb_build_object('codigo', v.codigo, 'nome', v.nome, 'categoria', v.categoria, 'custo_unitario_total', v.custo_unitario_total),
            jsonb_build_object('motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('success', true, 'deletado', v.codigo);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_projetos_deletar_servico(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_deletar_servico(uuid, text) TO authenticated, service_role;
-- a assinatura antiga (1 argumento) sai: não deve existir caminho sem motivo.
DROP FUNCTION IF EXISTS public.fn_projetos_deletar_servico(uuid);

-- UMA fonte de preço/BDI por serviço (lista e detalhe da composição mostram o mesmo número).
CREATE OR REPLACE FUNCTION public.fn_projetos_catalogo_precos(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  s record; d jsonb; h jsonb; v_bdi_emp numeric; v_out jsonb := '[]'::jsonb;
  v_custo numeric; v_preco numeric; v_bdi numeric; v_fonte text;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT bdi_total_pct INTO v_bdi_emp FROM public.projetos_modulo_config WHERE company_id = p_company_id;
  FOR s IN
    SELECT sv.id, sv.custo_unitario_total,
           (SELECT count(*) FROM public.projetos_servicos_bom b WHERE b.servico_id = sv.id AND b.tipo IN ('insumo','equipamento')) AS n_ins,
           (SELECT count(*) FROM public.projetos_servicos_bom b JOIN public.m16_insumos i ON i.id = b.insumo_id
             WHERE b.servico_id = sv.id AND b.tipo IN ('insumo','equipamento') AND i.produto_id IS NOT NULL) AS n_lig
      FROM public.projetos_servicos sv
     WHERE sv.company_id = p_company_id AND NOT sv.is_publico AND sv.ativo AND sv.deleted_at IS NULL
     ORDER BY sv.codigo LIMIT 300
  LOOP
    d := public.fn_servico_composicao_detalhe(p_company_id, s.id);
    h := coalesce(d->'header', '{}'::jsonb);
    v_custo := CASE WHEN coalesce((h->>'custo_total')::numeric, 0) > 0 THEN (h->>'custo_total')::numeric ELSE s.custo_unitario_total END;
    IF (h->>'preco_venda') IS NOT NULL AND coalesce((d->>'sem_config')::boolean, false) = false THEN
      v_preco := (h->>'preco_venda')::numeric; v_bdi := (h->>'bdi_pct')::numeric; v_fonte := 'motor';
    ELSIF v_bdi_emp IS NOT NULL AND v_custo IS NOT NULL THEN
      v_preco := round(v_custo * (1 + v_bdi_emp / 100), 2); v_bdi := v_bdi_emp; v_fonte := 'bdi_empresa';
    ELSE
      v_preco := NULL; v_bdi := NULL; v_fonte := 'sem_bdi';
    END IF;
    v_out := v_out || jsonb_build_object('servico_id', s.id, 'custo', v_custo, 'preco_venda', v_preco,
                                         'bdi_pct', v_bdi, 'fonte', v_fonte,
                                         'insumos_total', s.n_ins, 'insumos_ligados_estoque', s.n_lig);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'servicos', v_out);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_projetos_catalogo_precos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_catalogo_precos(uuid) TO authenticated, service_role;

-- Insumos do serviço com o produto do estoque ligado (ou "sem ligação").
CREATE OR REPLACE FUNCTION public.fn_projetos_servico_insumos_estoque(p_servico_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_servicos WHERE id = p_servico_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'servico_nao_encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  RETURN jsonb_build_object('ok', true, 'insumos', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'insumo_id', i.id, 'codigo', i.erp_code, 'nome', i.name, 'unidade', i.unit,
             'produto_id', p.id, 'produto_nome', p.nome, 'produto_codigo', p.codigo, 'estoque_atual', p.estoque_atual)
           ORDER BY b.ordem)
      FROM public.projetos_servicos_bom b
      JOIN public.m16_insumos i ON i.id = b.insumo_id
      LEFT JOIN public.erp_produtos p ON p.id = i.produto_id
     WHERE b.servico_id = p_servico_id AND b.tipo IN ('insumo','equipamento')), '[]'::jsonb));
END
$function$;
REVOKE ALL ON FUNCTION public.fn_projetos_servico_insumos_estoque(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_servico_insumos_estoque(uuid) TO authenticated, service_role;

-- Liga (ou desliga, com produto nulo) um insumo da empresa a um produto do estoque da MESMA empresa.
CREATE OR REPLACE FUNCTION public.fn_projetos_insumo_ligar_estoque(p_insumo_id uuid, p_produto_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE i public.m16_insumos%ROWTYPE; v_prod_company uuid;
BEGIN
  SELECT * INTO i FROM public.m16_insumos WHERE id = p_insumo_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insumo não encontrado.'; END IF;
  IF i.is_publico OR i.company_id IS NULL THEN RAISE EXCEPTION 'Insumo da biblioteca pública não pode ser ligado; copie-o para a empresa.'; END IF;
  PERFORM public.fn__guarda_empresa(i.company_id);
  IF p_produto_id IS NOT NULL THEN
    SELECT company_id INTO v_prod_company FROM public.erp_produtos WHERE id = p_produto_id;
    IF v_prod_company IS DISTINCT FROM i.company_id THEN RAISE EXCEPTION 'Produto não pertence ao estoque desta empresa.'; END IF;
  END IF;
  UPDATE public.m16_insumos SET produto_id = p_produto_id, updated_at = now() WHERE id = p_insumo_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (i.company_id, auth.uid(), 'm16_insumos', p_insumo_id::text, 'ligar_estoque',
            jsonb_build_object('produto_id', i.produto_id), jsonb_build_object('produto_id', p_produto_id));
  RETURN jsonb_build_object('ok', true);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_projetos_insumo_ligar_estoque(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_insumo_ligar_estoque(uuid, uuid) TO authenticated, service_role;

-- RD-98 p3: origem do dado da rota com as fontes que a tela passa a usar.
UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_projetos_servicos_catalogo','projetos_servicos','projetos_servicos_bom','projetos_modulo_config','erp_precificacao_config','m16_insumos','projetos_mao_obra','erp_produtos']::text[],
       rpcs_chamadas = ARRAY['fn_projetos_catalogo_precos','fn_projetos_servico_insumos_estoque','fn_projetos_insumo_ligar_estoque','fn_projetos_duplicar_servico','fn_projetos_deletar_servico','fn_projetos_importar_catalogo_publico','fn_projetos_servico_completo','fn_servico_composicao_detalhe']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/catalogo';

-- RD-95: "?" das peças novas (chave nova = linha nova).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('projetos.catalogo.col_bdi', '/dashboard/projetos/catalogo', 'Catálogo', 'BDI aplicado',
   'Não se preenche: mostra o BDI que está valendo para este serviço e de onde ele vem (precificação da empresa ou BDI padrão).', 'Explica a diferença entre Custo e Preço de venda. É o mesmo BDI que aparece no detalhe da composição.', '20,97% (precificação da empresa)', 'Esperar o BDI padrão da configuração: se a empresa tem precificação cadastrada, ela manda.', 'hub', 970, 1, 'publicado'),
  ('projetos.catalogo.col_estoque', '/dashboard/projetos/catalogo', 'Catálogo', 'Ligação ao estoque',
   'Mostra quantos insumos do serviço já estão ligados a produtos reais do seu estoque.', 'Garante que o custo do serviço use o material que você realmente compra e tem em estoque.', '3 de 4 insumos ligados', 'Achar que o insumo "genérico" já é o produto do estoque: a ligação é feita por você, insumo a insumo.', 'hub', 971, 1, 'publicado'),
  ('projetos.catalogo.ligar_estoque', '/dashboard/projetos/catalogo', 'Catálogo', 'Ligar ao estoque',
   'Escolha, para cada insumo do serviço, o produto correspondente do estoque da empresa.', 'Passa a mostrar o saldo do produto real ao lado do insumo e prepara a baixa de material da obra.', 'Cimento CP-II → "Cimento CP II 50kg"', 'Ligar a um produto de outra unidade de medida: confira a unidade antes.', 'hub', 972, 1, 'publicado'),
  ('projetos.catalogo.acao_editar', '/dashboard/projetos/catalogo', 'Catálogo', 'Editar serviço',
   'Abre o serviço para mudar nome, código, categoria, unidade, produtividade e a composição (BOM).', 'Todo ajuste do serviço acontece no editor; a lista se atualiza ao voltar.', 'Trocar a unidade de m² para m', 'Editar serviço da biblioteca pública: duplique-o primeiro para virar seu.', 'hub', 973, 1, 'publicado'),
  ('projetos.catalogo.acao_duplicar', '/dashboard/projetos/catalogo', 'Catálogo', 'Duplicar serviço',
   'Cria uma cópia do serviço com a composição, para você ajustar sem mexer no original.', 'Agiliza criar variações de um serviço parecido.', 'Forro de gesso → Forro de gesso hidrófugo', 'Esquecer de trocar o código da cópia.', 'hub', 974, 1, 'publicado'),
  ('projetos.catalogo.acao_excluir', '/dashboard/projetos/catalogo', 'Catálogo', 'Excluir serviço',
   'Tira o serviço da lista, informando o motivo. Não apaga: guarda quem excluiu, quando e por quê.', 'Limpa serviços duplicados ou criados por engano sem perder o histórico.', 'Serviço duplicado', 'Deixar o motivo em branco: a exclusão não é aceita.', 'hub', 975, 1, 'publicado'),
  ('projetos.catalogo.motivo_exclusao', '/dashboard/projetos/catalogo', 'Catálogo', 'Motivo da exclusão',
   'Por que o serviço está sendo excluído (mínimo 3 letras).', 'Fica na auditoria do serviço.', 'criado em duplicidade', 'Deixar em branco.', 'hub', 976, 1, 'publicado'),
  ('projetos.catalogo.acao_importar', '/dashboard/projetos/catalogo', 'Catálogo', 'Importar biblioteca',
   'Copia para a sua empresa os serviços prontos da biblioteca pública, com insumos e mão de obra.', 'Começa o catálogo com serviços de referência (SINAPI/TCPO/PS) que você ajusta depois.', 'Forro, drywall, sanca', 'Importar de novo achando que atualiza: serviços já copiados não são duplicados.', 'hub', 977, 1, 'publicado'),
  ('projetos.catalogo.acao_novo', '/dashboard/projetos/catalogo', 'Catálogo', 'Novo serviço',
   'Abre o formulário do serviço. Nada é gravado até você confirmar em "Criar serviço".', 'Cria um serviço próprio da empresa para montar a composição.', 'Contrapiso 5 cm', 'Achar que clicar já cria uma linha em branco: só grava ao confirmar.', 'hub', 978, 1, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
