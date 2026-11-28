-- 20261125061540 · code-desenvolvedor-3 · PDCA Hub RDO (tela 321, msg 3f5bbae1)
-- Diário de Obra / Livro de Ordem (CONFEA 1.094/2017) — critério h do PDCA:
--   item 1 · blocos ESTRUTURADOS do diário (equipamentos, materiais recebidos/usados + fornecedor,
--            serviços iniciados/em andamento/concluídos) — blueprint 32e5bdfb;
--   item 5 · registro de QUEM e QUANDO alterou o diário (atualizado_por + nome + trilha em audit_log_global) — 47fbe3a2;
--   item 4 · "?" (RD-95) da busca nos diários (palavra-chave + dia) — 7f49b919.
--
-- ADITIVA: 3 colunas novas em projetos_obra_rdo (IF NOT EXISTS; default constante = só metadado, sem reescrever a tabela).
-- fn_obra_rdo_salvar: corpo VIVO (pg_get_functiondef 23/11) preservado; acrescenta só:
--   (a) normalização/limite dos blocos (whitelist de chaves e valores, máx. 30 itens por bloco, textos truncados);
--   (b) "conte o que foi feito" passa a aceitar diário só com blocos estruturados;
--   (c) UPDATE: tela antiga sem o campo (ex.: OS) NÃO apaga os blocos (mesmo padrão já usado em quantidade_executada);
--   (d) UPDATE grava atualizado_por/atualizado_por_nome e uma linha 'obra_rdo_editado' em audit_log_global
--       (antes/depois), espelhando o fn_obra_rdo_excluir.
-- Guarda: fn__guarda_empresa(company da OS) mantida; autoria só por auth.uid(); REVOKE anon reafirmado.
-- Nenhum dado de cliente é alterado por esta migration (linhas existentes ficam com blocos = '{}').

ALTER TABLE public.projetos_obra_rdo ADD COLUMN IF NOT EXISTS blocos jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.projetos_obra_rdo ADD COLUMN IF NOT EXISTS atualizado_por uuid;
ALTER TABLE public.projetos_obra_rdo ADD COLUMN IF NOT EXISTS atualizado_por_nome text;

COMMENT ON COLUMN public.projetos_obra_rdo.blocos IS
  'Livro de Ordem estruturado: {equipamentos:[{nome,quantidade}], materiais:[{nome,quantidade,movimento(recebido|usado),fornecedor}], servicos:[{descricao,situacao(iniciado|andamento|concluido)}]}';
COMMENT ON COLUMN public.projetos_obra_rdo.atualizado_por IS 'Quem fez a última alteração do diário (auth.uid()); trilha completa em audit_log_global (obra_rdo_editado).';

CREATE OR REPLACE FUNCTION public.fn_obra_rdo_salvar(p_os_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid; v_obra uuid; v_status text; v_id uuid;
  v_uid uuid := auth.uid();
  v_data date := COALESCE(NULLIF(p_dados->>'data', '')::date, current_date);
  v_clima text := COALESCE(NULLIF(p_dados->>'clima', ''), 'sol');
  v_efetivo integer := COALESCE(NULLIF(p_dados->>'efetivo', '')::integer, 0);
  v_ativ text := NULLIF(btrim(COALESCE(p_dados->>'atividades', '')), '');
  v_ocor text := NULLIF(btrim(COALESCE(p_dados->>'ocorrencias', '')), '');
  v_qtd numeric := NULLIF(replace(btrim(COALESCE(p_dados->>'quantidade_executada', '')), ',', '.'), '')::numeric;
  v_fotos text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_dados->'fotos', '[]'::jsonb))), '{}');
  v_blocos jsonb;     -- blocos normalizados vindos da tela (NULL = tela sem o campo, ex.: OS)
  v_blocos_ef jsonb;  -- blocos efetivos (os novos ou os já gravados) — base da validação "conte o que foi feito"
  v_ant public.projetos_obra_rdo%ROWTYPE;
  v_nome text;
BEGIN
  SELECT company_id, obra_id, status INTO v_company, v_obra, v_status
    FROM public.projetos_obra_os WHERE id = p_os_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF v_status NOT IN ('aberta', 'em_execucao') THEN
    RAISE EXCEPTION 'Só dá para lançar o diário em OS aberta ou em execução';
  END IF;
  IF v_data > current_date THEN RAISE EXCEPTION 'O diário é do dia que já aconteceu — a data não pode ser futura'; END IF;
  IF v_clima NOT IN ('sol', 'nublado', 'chuva', 'chuva_forte') THEN RAISE EXCEPTION 'Clima inválido'; END IF;
  IF v_efetivo < 0 THEN RAISE EXCEPTION 'O efetivo não pode ser negativo'; END IF;

  -- (a) blocos estruturados: só as 3 chaves conhecidas, só itens-objeto com nome/descrição, valores em whitelist.
  IF p_dados ? 'blocos' THEN
    IF jsonb_typeof(p_dados->'blocos') <> 'object' THEN
      RAISE EXCEPTION 'Os blocos do diário vieram em formato inválido';
    END IF;
    v_blocos := jsonb_build_object(
      'equipamentos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'nome', left(btrim(e->>'nome'), 120),
                 'quantidade', left(btrim(COALESCE(e->>'quantidade', '')), 40)) ORDER BY o)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_dados->'blocos'->'equipamentos') = 'array'
                                         THEN p_dados->'blocos'->'equipamentos' ELSE '[]'::jsonb END) WITH ORDINALITY AS x(e, o)
         WHERE jsonb_typeof(e) = 'object' AND NULLIF(btrim(COALESCE(e->>'nome', '')), '') IS NOT NULL), '[]'::jsonb),
      'materiais', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'nome', left(btrim(m->>'nome'), 120),
                 'quantidade', left(btrim(COALESCE(m->>'quantidade', '')), 40),
                 'movimento', CASE WHEN m->>'movimento' = 'usado' THEN 'usado' ELSE 'recebido' END,
                 'fornecedor', left(btrim(COALESCE(m->>'fornecedor', '')), 120)) ORDER BY o)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_dados->'blocos'->'materiais') = 'array'
                                         THEN p_dados->'blocos'->'materiais' ELSE '[]'::jsonb END) WITH ORDINALITY AS x(m, o)
         WHERE jsonb_typeof(m) = 'object' AND NULLIF(btrim(COALESCE(m->>'nome', '')), '') IS NOT NULL), '[]'::jsonb),
      'servicos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'descricao', left(btrim(s->>'descricao'), 200),
                 'situacao', CASE WHEN s->>'situacao' IN ('iniciado', 'andamento', 'concluido') THEN s->>'situacao' ELSE 'andamento' END) ORDER BY o)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_dados->'blocos'->'servicos') = 'array'
                                         THEN p_dados->'blocos'->'servicos' ELSE '[]'::jsonb END) WITH ORDINALITY AS x(s, o)
         WHERE jsonb_typeof(s) = 'object' AND NULLIF(btrim(COALESCE(s->>'descricao', '')), '') IS NOT NULL), '[]'::jsonb));
    IF jsonb_array_length(v_blocos->'equipamentos') > 30 OR jsonb_array_length(v_blocos->'materiais') > 30
       OR jsonb_array_length(v_blocos->'servicos') > 30 THEN
      RAISE EXCEPTION 'No máximo 30 itens em cada bloco do diário';
    END IF;
  END IF;

  -- diário do dia já existente nesta OS (upsert por OS + dia)
  SELECT * INTO v_ant FROM public.projetos_obra_rdo WHERE os_id = p_os_id AND data = v_data AND excluido_em IS NULL;
  v_id := v_ant.id;
  v_blocos_ef := COALESCE(v_blocos, v_ant.blocos, '{}'::jsonb);

  -- (b) "o que foi feito" pode vir no texto livre OU nos blocos estruturados
  IF v_ativ IS NULL AND v_ocor IS NULL
     AND COALESCE(jsonb_array_length(v_blocos_ef->'equipamentos'), 0)
       + COALESCE(jsonb_array_length(v_blocos_ef->'materiais'), 0)
       + COALESCE(jsonb_array_length(v_blocos_ef->'servicos'), 0) = 0 THEN
    RAISE EXCEPTION 'Conte o que foi feito ou o que aconteceu no dia';
  END IF;
  IF v_qtd < 0 THEN RAISE EXCEPTION 'A quantidade executada não pode ser negativa'; END IF;
  IF cardinality(v_fotos) > 10 THEN RAISE EXCEPTION 'No máximo 10 fotos por dia'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_fotos) f WHERE f NOT LIKE v_company::text || '/rdo/' || p_os_id::text || '/%') THEN
    RAISE EXCEPTION 'Foto fora da pasta desta OS';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.projetos_obra_rdo
      (company_id, obra_id, os_id, data, clima, praticavel, efetivo, atividades, ocorrencias, fotos, criado_por, quantidade_executada, blocos)
    VALUES (v_company, v_obra, p_os_id, v_data, v_clima, COALESCE((p_dados->>'praticavel')::boolean, true), v_efetivo,
      v_ativ, v_ocor, v_fotos, v_uid, v_qtd, COALESCE(v_blocos, '{}'::jsonb))
    RETURNING id INTO v_id;
  ELSE
    SELECT COALESCE(NULLIF(btrim(u.full_name), ''), u.email) INTO v_nome FROM public.users u WHERE u.id = v_uid;
    UPDATE public.projetos_obra_rdo SET clima = v_clima, praticavel = COALESCE((p_dados->>'praticavel')::boolean, true),
      efetivo = v_efetivo, atividades = v_ativ, ocorrencias = v_ocor, fotos = v_fotos, atualizado_em = now(),
      -- tela antiga (sem o campo) não apaga a quantidade já lançada
      quantidade_executada = CASE WHEN p_dados ? 'quantidade_executada' THEN v_qtd ELSE quantidade_executada END,
      -- (c) tela antiga sem os blocos (ex.: OS) não apaga os blocos já lançados
      blocos = CASE WHEN p_dados ? 'blocos' THEN v_blocos ELSE blocos END,
      -- (d) quem alterou (o quando é atualizado_em)
      atualizado_por = v_uid, atualizado_por_nome = v_nome
    WHERE id = v_id;

    -- (d) trilha de alteração (antes/depois), no mesmo padrão do fn_obra_rdo_excluir
    INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
            'projetos_obra_rdo', v_id::text, 'obra_rdo_editado',
            jsonb_build_object('data', v_ant.data, 'clima', v_ant.clima, 'praticavel', v_ant.praticavel, 'efetivo', v_ant.efetivo,
                               'atividades', v_ant.atividades, 'ocorrencias', v_ant.ocorrencias,
                               'quantidade_executada', v_ant.quantidade_executada, 'fotos', to_jsonb(v_ant.fotos),
                               'blocos', v_ant.blocos),
            jsonb_build_object('clima', v_clima, 'praticavel', COALESCE((p_dados->>'praticavel')::boolean, true),
                               'efetivo', v_efetivo, 'atividades', v_ativ, 'ocorrencias', v_ocor,
                               'quantidade_executada', CASE WHEN p_dados ? 'quantidade_executada' THEN v_qtd ELSE v_ant.quantidade_executada END,
                               'fotos', to_jsonb(v_fotos), 'blocos', COALESCE(v_blocos, v_ant.blocos)));
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- CREATE OR REPLACE preserva os grants vivos (authenticated, service_role); reafirma a guarda (idempotente).
REVOKE ALL ON FUNCTION public.fn_obra_rdo_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_rdo_salvar(uuid, jsonb) TO authenticated, service_role;

-- RD-95: "?" dos campos novos da tela (busca + blocos estruturados). Aditivo e idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('projetos.obra_rdo.busca', '/dashboard/projetos/obras/[id]/rdo', 'Diário de Obra', 'Buscar no diário',
  'Digite uma palavra para achar os diários que a contêm — procura no que foi feito, nas ocorrências, nos equipamentos, materiais e serviços, no clima e na OS.',
  'Localizar rápido um dia específico pelo serviço, pela ocorrência, por um material ou por qualquer termo, sem rolar a lista inteira.',
  'concretagem', 'Esperar que a busca ache fotos — ela procura só no texto do diário.', 'hub_projetos', 6, 1, 'publicado'),
 ('projetos.obra_rdo.busca_data', '/dashboard/projetos/obras/[id]/rdo', 'Diário de Obra', 'Buscar por dia',
  'Escolha uma data para ver só o diário daquele dia; deixe em branco para ver todos os dias.',
  'Abrir direto o diário de uma data (ex.: conferir o que foi lançado numa visita específica).',
  '18/11/2026', 'Procurar um dia futuro — o diário é sempre de um dia que já aconteceu.', 'hub_projetos', 7, 1, 'publicado'),
 ('projetos.obra_rdo.equipamentos', '/dashboard/projetos/obras/[id]/rdo', 'Diário de Obra', 'Equipamentos no dia',
  'Liste os equipamentos que trabalharam na obra no dia: o nome e a quantidade (ou as horas). Toque em "+ Equipamento" para cada um.',
  'Registrar no Livro de Ordem o que esteve em operação — base para conferir locação, produtividade e cobrança.',
  'Betoneira 400 L · 1', 'Lançar equipamento que só ficou parado no canteiro como se tivesse trabalhado.', 'hub_projetos', 8, 1, 'publicado'),
 ('projetos.obra_rdo.materiais', '/dashboard/projetos/obras/[id]/rdo', 'Diário de Obra', 'Materiais do dia',
  'Liste os materiais que chegaram (Recebido) ou foram aplicados (Usado) no dia, com a quantidade e, se tiver, o fornecedor.',
  'Registrar entradas e consumo de material no Livro de Ordem — ajuda a conferir nota fiscal e estoque da obra.',
  'Cimento CP-II · 40 sc · Recebido · Casa do Construtor', 'Marcar como Usado o material que só chegou e ainda está guardado.', 'hub_projetos', 9, 1, 'publicado'),
 ('projetos.obra_rdo.servicos', '/dashboard/projetos/obras/[id]/rdo', 'Diário de Obra', 'Serviços do dia',
  'Liste os serviços da obra e a situação de cada um no dia: Iniciado, Em andamento ou Concluído.',
  'Mostrar no Livro de Ordem o avanço por serviço — o que começou, o que segue e o que terminou naquele dia.',
  'Alvenaria do 2º pavimento · Em andamento', 'Marcar como Concluído um serviço que ainda tem pendência.', 'hub_projetos', 10, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, atualizado_em = now();
