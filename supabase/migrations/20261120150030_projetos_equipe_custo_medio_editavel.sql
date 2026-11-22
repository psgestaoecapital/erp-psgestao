-- CEO 18/11 (Hub/Projetos · piloto FC Pisos): "Equipes de Mão de obra" com custo médio/hora editável.
-- A empresa monta EQUIPES (ex.: "Equipe Lapa") puxando as FUNÇÕES do catálogo de mão de obra (projetos_mao_obra,
-- que já tem R$/h por função), pode dar o NOME de cada pessoa (opcional, LGPD) e o sistema calcula o CUSTO MÉDIO/HORA
-- da equipe (média do custo/hora dos membros). A empresa pode AJUSTAR um custo/hora EFETIVO (que entra nos orçamentos),
-- e aí a equipe fica marcada como "ajustado"; enquanto não ajusta, o efetivo acompanha o médio automaticamente.
--
-- Aditiva (RD-97): 2 tabelas NOVAS + 4 RPCs NOVOS + seed da ajuda (RD-95). Não altera tabela de domínio existente,
-- não toca RLS de nenhuma outra tabela, REUSA projetos_mao_obra (não duplica catálogo de funções). RLS por empresa
-- nas duas tabelas (Pilar 2 / LGPD): cada empresa só vê e mexe nas equipes dela. Não toca equipes de outras verticais
-- (agency/chamado). Sem UUID de empresa real no arquivo — as equipes nascem pela tela, por empresa.
-- SENSÍVEL (RLS/policy nova, tela) → etiqueta revisao-eng-chefe + MERGE AUTORIZADO.

-- ───────────────────────────── 1) Tabelas ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.projetos_equipe (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL,
  nome               text NOT NULL,
  descricao          text,
  custo_medio_hora   numeric(12,2),              -- calculado: média do custo/hora dos membros ativos
  custo_hora_efetivo numeric(12,2),              -- editável; sem ajuste, acompanha o médio
  qtd_pessoas        integer NOT NULL DEFAULT 0, -- calculado: nº de membros
  ajustado           boolean NOT NULL DEFAULT false, -- true quando a empresa fixou um efetivo diferente do médio
  ativo              boolean NOT NULL DEFAULT true,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.projetos_equipe_membro (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipe_id          uuid NOT NULL REFERENCES public.projetos_equipe(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL,
  nome_pessoa        text,                        -- opcional (LGPD): a empresa pode nomear ou deixar em branco
  funcao_mao_obra_id uuid REFERENCES public.projetos_mao_obra(id) ON DELETE SET NULL, -- opcional: puxa do catálogo
  custo_hora         numeric(12,2) NOT NULL,      -- R$/h do membro (herdado da função ou digitado); snapshot
  ordem              integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_projetos_equipe_company ON public.projetos_equipe(company_id);
CREATE INDEX IF NOT EXISTS ix_projetos_equipe_membro_equipe ON public.projetos_equipe_membro(equipe_id);
CREATE INDEX IF NOT EXISTS ix_projetos_equipe_membro_company ON public.projetos_equipe_membro(company_id);

COMMENT ON TABLE public.projetos_equipe IS 'Hub/Projetos: equipes de mão de obra com custo médio/hora calculado e efetivo editável (CEO 18/11).';
COMMENT ON TABLE public.projetos_equipe_membro IS 'Membros de uma equipe de mão de obra; custo_hora é snapshot (função do catálogo ou digitado).';

-- ───────────────────────────── 2) RLS por empresa ─────────────────────────────
ALTER TABLE public.projetos_equipe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projetos_equipe_membro ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projetos_equipe_rls ON public.projetos_equipe;
CREATE POLICY projetos_equipe_rls ON public.projetos_equipe
  FOR ALL
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());

DROP POLICY IF EXISTS projetos_equipe_membro_rls ON public.projetos_equipe_membro;
CREATE POLICY projetos_equipe_membro_rls ON public.projetos_equipe_membro
  FOR ALL
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());

-- Leitura direta (RLS gated) para a empresa; escrita só pelos RPCs SECURITY DEFINER abaixo. anon nunca.
REVOKE ALL ON TABLE public.projetos_equipe FROM anon;
REVOKE ALL ON TABLE public.projetos_equipe_membro FROM anon;
GRANT SELECT ON TABLE public.projetos_equipe TO authenticated;
GRANT SELECT ON TABLE public.projetos_equipe_membro TO authenticated;
GRANT ALL ON TABLE public.projetos_equipe TO service_role;
GRANT ALL ON TABLE public.projetos_equipe_membro TO service_role;

-- ───────────────────────────── 3) RPCs ─────────────────────────────
-- Salvar (criar/alterar) uma equipe + substituir seus membros; recalcula médio/qtd e, sem ajuste, o efetivo.
CREATE OR REPLACE FUNCTION public.fn_projetos_equipe_salvar(
  p_company_id uuid,
  p_equipe     jsonb,
  p_membros    jsonb DEFAULT '[]'::jsonb,
  p_id         uuid DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_interno  boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_id       uuid := p_id;
  v_nome     text := nullif(btrim(coalesce(p_equipe->>'nome', '')), '');
  v_desc     text := nullif(btrim(coalesce(p_equipe->>'descricao', '')), '');
  v_ajustado boolean;
  v_medio    numeric;
  v_qtd      integer;
BEGIN
  -- guarda de empresa (RD-25): só a dona da empresa, admin, ou a conexão de serviço (sem JWT) escreve.
  IF NOT (v_interno OR is_admin() OR p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF v_nome IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio');
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.projetos_equipe (company_id, nome, descricao, created_by)
    VALUES (p_company_id, v_nome, v_desc, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.projetos_equipe
       SET nome = v_nome, descricao = v_desc, updated_at = now()
     WHERE id = v_id AND company_id = p_company_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'equipe_nao_encontrada');
    END IF;
  END IF;

  -- substitui os membros (snapshot do custo/hora); função só vale se for do catálogo da MESMA empresa (não vaza).
  DELETE FROM public.projetos_equipe_membro WHERE equipe_id = v_id;
  INSERT INTO public.projetos_equipe_membro (equipe_id, company_id, nome_pessoa, funcao_mao_obra_id, custo_hora, ordem)
  SELECT v_id,
         p_company_id,
         nullif(btrim(coalesce(m->>'nome_pessoa', '')), ''),
         (SELECT mo.id FROM public.projetos_mao_obra mo
           WHERE mo.id = nullif(m->>'funcao_mao_obra_id', '')::uuid AND mo.company_id = p_company_id),
         round(coalesce((m->>'custo_hora')::numeric, 0), 2),
         (ord - 1)::integer
    FROM jsonb_array_elements(coalesce(p_membros, '[]'::jsonb)) WITH ORDINALITY AS t(m, ord)
   WHERE coalesce((m->>'custo_hora')::numeric, 0) > 0;

  SELECT round(avg(custo_hora), 2), count(*) INTO v_medio, v_qtd
    FROM public.projetos_equipe_membro WHERE equipe_id = v_id;

  SELECT ajustado INTO v_ajustado FROM public.projetos_equipe WHERE id = v_id;

  UPDATE public.projetos_equipe
     SET custo_medio_hora   = v_medio,
         qtd_pessoas        = coalesce(v_qtd, 0),
         custo_hora_efetivo = CASE WHEN v_ajustado THEN custo_hora_efetivo ELSE v_medio END,
         updated_at         = now()
   WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'custo_medio_hora', v_medio, 'qtd_pessoas', coalesce(v_qtd, 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_equipe_salvar(uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_equipe_salvar(uuid, jsonb, jsonb, uuid) TO authenticated, service_role;

-- Listar as equipes da empresa (com os membros).
CREATE OR REPLACE FUNCTION public.fn_projetos_equipe_listar(p_company_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_out     jsonb;
BEGIN
  IF NOT (v_interno OR is_admin() OR p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.ativo DESC, lower(e.nome)), '[]'::jsonb) INTO v_out
  FROM (
    SELECT eq.id, eq.nome, eq.descricao, eq.custo_medio_hora, eq.custo_hora_efetivo,
           eq.qtd_pessoas, eq.ajustado, eq.ativo,
           coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', m.id,
                      'nome_pessoa', m.nome_pessoa,
                      'funcao_mao_obra_id', m.funcao_mao_obra_id,
                      'funcao_nome', mo.funcao,
                      'custo_hora', m.custo_hora,
                      'ordem', m.ordem
                    ) ORDER BY m.ordem, m.created_at)
             FROM public.projetos_equipe_membro m
             LEFT JOIN public.projetos_mao_obra mo ON mo.id = m.funcao_mao_obra_id
             WHERE m.equipe_id = eq.id
           ), '[]'::jsonb) AS membros
    FROM public.projetos_equipe eq
    WHERE eq.company_id = p_company_id
  ) e;

  RETURN jsonb_build_object('ok', true, 'equipes', v_out);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_equipe_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_equipe_listar(uuid) TO authenticated, service_role;

-- Fixar (ou soltar) o custo/hora EFETIVO da equipe. p_custo NULL volta ao médio (deixa de ser "ajustado").
CREATE OR REPLACE FUNCTION public.fn_projetos_equipe_set_custo_efetivo(
  p_company_id uuid,
  p_id         uuid,
  p_custo      numeric DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
BEGIN
  IF NOT (v_interno OR is_admin() OR p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  IF p_custo IS NULL THEN
    UPDATE public.projetos_equipe
       SET custo_hora_efetivo = custo_medio_hora, ajustado = false, updated_at = now()
     WHERE id = p_id AND company_id = p_company_id;
  ELSE
    IF p_custo < 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'custo_invalido');
    END IF;
    UPDATE public.projetos_equipe
       SET custo_hora_efetivo = round(p_custo, 2), ajustado = true, updated_at = now()
     WHERE id = p_id AND company_id = p_company_id;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'equipe_nao_encontrada');
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_equipe_set_custo_efetivo(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_equipe_set_custo_efetivo(uuid, uuid, numeric) TO authenticated, service_role;

-- Arquivar/reativar a equipe (não apaga — RD-30; o histórico fica).
CREATE OR REPLACE FUNCTION public.fn_projetos_equipe_arquivar(
  p_company_id uuid,
  p_id         uuid,
  p_ativo      boolean DEFAULT false
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
BEGIN
  IF NOT (v_interno OR is_admin() OR p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  UPDATE public.projetos_equipe
     SET ativo = coalesce(p_ativo, false), updated_at = now()
   WHERE id = p_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'equipe_nao_encontrada');
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'ativo', coalesce(p_ativo, false));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_equipe_arquivar(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_equipe_arquivar(uuid, uuid, boolean) TO authenticated, service_role;

-- ───────────────────────────── 4) Ajuda de campo (RD-95) ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
  ('projetos.mao_obra.equipes.acao.nova', '/dashboard/projetos/mao-obra', 'Equipes', 'Nova equipe', 'Clique para montar uma equipe: dê um nome e some as pessoas (por função do catálogo ou digitando o custo).', 'Agrupa várias pessoas numa equipe com um custo médio/hora, para usar nos orçamentos e medições da obra.', 'Equipe Lapa', 'Criar uma equipe sem nenhum membro: sem pessoas, não há custo médio para calcular.', 'hub_projetos', 400),
  ('projetos.mao_obra.equipes.col_nome', '/dashboard/projetos/mao-obra', 'Equipes', 'Nome da equipe', 'Não se preenche aqui: aparece o nome que você deu à equipe.', 'Identifica a equipe nas listas e nos orçamentos.', 'Equipe Lapa', 'Usar o nome de uma obra em vez da equipe: a equipe pode atender várias obras.', 'hub_projetos', 401),
  ('projetos.mao_obra.equipes.col_pessoas', '/dashboard/projetos/mao-obra', 'Equipes', 'Nº de pessoas', 'Não se preenche: é a quantidade de membros somados à equipe.', 'Mostra o tamanho da equipe de relance.', '8', 'Esperar que conte quem está só de passagem: conta os membros cadastrados na equipe.', 'hub_projetos', 402),
  ('projetos.mao_obra.equipes.col_medio', '/dashboard/projetos/mao-obra', 'Equipes', 'Custo médio/h', 'Não se preenche: o sistema calcula a média do custo/hora dos membros.', 'Mostra quanto custa, em média, uma hora da equipe, sem ajuste manual.', 'R$ 31,50/h', 'Confundir com o total por hora da equipe: é a MÉDIA por pessoa, não a soma de todas.', 'hub_projetos', 403),
  ('projetos.mao_obra.equipes.col_efetivo', '/dashboard/projetos/mao-obra', 'Equipes', 'Custo efetivo/h', 'Não se preenche aqui: é o custo/hora que entra nos orçamentos (igual ao médio, até você ajustar).', 'Permite usar um valor combinado (com margem, acordo ou arredondamento) sem perder o médio de referência.', 'R$ 35,00/h · ajustado', 'Esquecer que, ajustado, ele NÃO acompanha mais o médio: volte ao médio quando quiser que acompanhe.', 'hub_projetos', 404),
  ('projetos.mao_obra.equipes.acao.editar', '/dashboard/projetos/mao-obra', 'Equipes', 'Editar equipe', 'Clique para mudar o nome, trocar membros ou ajustar o custo efetivo da equipe.', 'Mantém a equipe atualizada conforme a obra muda.', 'Editar', 'Editar membros e esquecer de salvar: as mudanças só valem depois de Salvar.', 'hub_projetos', 405),
  ('projetos.mao_obra.equipes.acao.arquivar', '/dashboard/projetos/mao-obra', 'Equipes', 'Arquivar equipe', 'Clique para tirar a equipe do uso ativo sem apagar o histórico; dá para reativar depois.', 'Guarda equipes que não estão em uso sem perder o que já foi registrado.', 'Arquivar', 'Achar que apaga: só some do uso ativo; o histórico fica e pode ser reativado.', 'hub_projetos', 406),
  ('projetos.mao_obra.equipes.nome', '/dashboard/projetos/mao-obra', 'Equipes', 'Nome da equipe', 'O nome que a obra usa para a equipe: pela frente de serviço, pelo encarregado ou pela região.', 'Identifica a equipe nas listas, orçamentos e medições.', 'Equipe Lapa', 'Nomes genéricos como "Equipe 1" que ninguém reconhece depois.', 'hub_projetos', 407),
  ('projetos.mao_obra.equipes.descricao', '/dashboard/projetos/mao-obra', 'Equipes', 'Descrição (opcional)', 'Uma nota curta sobre a equipe: do que ela cuida, encarregado, turno.', 'Ajuda a lembrar para que serve a equipe quando houver várias.', 'Acabamento e gesso · turno da manhã', 'Repetir o nome da equipe em vez de descrever o que ela faz.', 'hub_projetos', 408),
  ('projetos.mao_obra.equipes.membro_funcao', '/dashboard/projetos/mao-obra', 'Equipes', 'Função (do catálogo)', 'Escolha uma função já cadastrada em Mão de obra: ela traz o custo/hora pronto. Deixe em branco para digitar à mão.', 'Reaproveita o custo/hora que você já calculou na função, sem redigitar.', 'Pedreiro (R$ 32,00/h)', 'Digitar um custo diferente do da função sem querer: ao escolher a função, o custo vem dela.', 'hub_projetos', 409),
  ('projetos.mao_obra.equipes.membro_nome', '/dashboard/projetos/mao-obra', 'Equipes', 'Nome da pessoa (opcional)', 'O nome de quem ocupa a vaga, se quiser registrar. Pode deixar em branco (LGPD).', 'Permite saber quem está na equipe, sem obrigar a expor nomes.', 'João da Silva', 'Achar que é obrigatório: pode somar a pessoa só pela função, sem nome.', 'hub_projetos', 410),
  ('projetos.mao_obra.equipes.membro_custo', '/dashboard/projetos/mao-obra', 'Equipes', 'Custo/hora do membro', 'O custo por hora dessa pessoa. Vem da função escolhida, mas você pode ajustar ou digitar direto.', 'É o valor que entra na média da equipe.', '32,00', 'Informar o salário do mês no lugar do custo por hora: aqui é R$ por HORA.', 'hub_projetos', 411),
  ('projetos.mao_obra.equipes.custo_medio', '/dashboard/projetos/mao-obra', 'Equipes', 'Custo médio/h (calculado)', 'Não se preenche: é a média do custo/hora dos membros que você somou.', 'Mostra, em tempo real, quanto fica a hora média da equipe conforme você adiciona pessoas.', 'R$ 31,50/h', 'Esperar a soma de todos: é a MÉDIA por pessoa, não o total da equipe.', 'hub_projetos', 412),
  ('projetos.mao_obra.equipes.custo_efetivo', '/dashboard/projetos/mao-obra', 'Equipes', 'Custo efetivo/h', 'Comece igual ao médio; mude se quiser um valor combinado (margem, acordo, arredondamento). Em branco = acompanha o médio.', 'É o custo/hora da equipe que vai para os orçamentos. Ao mudar, a equipe fica marcada como "ajustado".', '35,00', 'Ajustar e esperar que volte a acompanhar o médio: para isso, limpe o campo (volta ao médio).', 'hub_projetos', 413)
ON CONFLICT (chave) DO NOTHING;
