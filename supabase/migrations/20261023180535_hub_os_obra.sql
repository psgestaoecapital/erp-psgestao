-- HB0 item 6 (CEO 23/10): a Ordem de Serviço do Hub é de OBRA — obra, etapa, serviço e equipe —, não de oficina
-- (placa, veículo, mecânico). Tela própria do Hub: /dashboard/projetos/obras/os. A OS da oficina (erp_os,
-- /dashboard/os) não muda.
-- Só objetos NOVOS: tabela com RLS por empresa, REVOKE anon, gravação só pelas funções com guarda de empresa
-- (fn__guarda_empresa), exclusão lógica (RD-30). Mais os textos do "?" (RD-95) e o cadastro da tela.
CREATE TABLE IF NOT EXISTS public.projetos_obra_os (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  obra_id        uuid NOT NULL REFERENCES public.projetos_obras(id),
  numero         text NOT NULL,
  tarefa_id      uuid REFERENCES public.projetos_obra_tarefa(id),
  obra_item_id   uuid REFERENCES public.projetos_obra_item(id),
  descricao      text NOT NULL CHECK (length(btrim(descricao)) > 0),
  equipe         text,
  responsavel    text,
  data_prevista  date,
  prioridade     text NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('baixa', 'normal', 'alta', 'urgente')),
  status         text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'em_execucao', 'concluida', 'cancelada')),
  iniciada_em    timestamptz,
  concluida_em   timestamptz,
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz,
  excluido_por   uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS projetos_obra_os_numero_uq
  ON public.projetos_obra_os (company_id, numero);
CREATE INDEX IF NOT EXISTS projetos_obra_os_idx
  ON public.projetos_obra_os (company_id, obra_id, criado_em DESC) WHERE excluido_em IS NULL;

ALTER TABLE public.projetos_obra_os ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projetos_obra_os FROM PUBLIC, anon;
DROP POLICY IF EXISTS projetos_obra_os_ler ON public.projetos_obra_os;
CREATE POLICY projetos_obra_os_ler ON public.projetos_obra_os FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.projetos_obra_os TO authenticated;

-- Lista as OS de obra das empresas do usuário, com os nomes da obra, da etapa e do serviço.
CREATE OR REPLACE FUNCTION public.fn_obra_os_listar(p_company_ids uuid[], p_obra_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', o.id, 'company_id', o.company_id, 'numero', o.numero, 'obra_id', o.obra_id,
      'obra_numero', ob.numero, 'obra_nome', ob.nome,
      'tarefa_id', o.tarefa_id, 'etapa', t.nome, 'obra_item_id', o.obra_item_id, 'servico', i.descricao,
      'descricao', o.descricao, 'equipe', o.equipe, 'responsavel', o.responsavel,
      'data_prevista', o.data_prevista, 'prioridade', o.prioridade, 'status', o.status,
      'iniciada_em', o.iniciada_em, 'concluida_em', o.concluida_em, 'criado_em', o.criado_em)
    ORDER BY o.criado_em DESC), '[]'::jsonb)
  FROM public.projetos_obra_os o
  JOIN public.projetos_obras ob ON ob.id = o.obra_id
  LEFT JOIN public.projetos_obra_tarefa t ON t.id = o.tarefa_id
  LEFT JOIN public.projetos_obra_item i ON i.id = o.obra_item_id
  WHERE auth.uid() IS NOT NULL
    AND o.excluido_em IS NULL
    AND o.company_id = ANY (p_company_ids)
    AND (public.is_admin() OR o.company_id IN (SELECT public.get_user_company_ids()))
    AND (p_obra_id IS NULL OR o.obra_id = p_obra_id)
$$;
REVOKE ALL ON FUNCTION public.fn_obra_os_listar(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_os_listar(uuid[], uuid) TO authenticated, service_role;

-- Cria (sem id) ou altera (com id) uma OS de obra. A empresa vem da obra; etapa e serviço têm de ser dessa obra.
CREATE OR REPLACE FUNCTION public.fn_obra_os_salvar(p_obra_id uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_company uuid; v_id uuid := NULLIF(p_dados->>'id', '')::uuid;
  v_tarefa uuid := NULLIF(p_dados->>'tarefa_id', '')::uuid;
  v_item uuid := NULLIF(p_dados->>'obra_item_id', '')::uuid;
  v_desc text := NULLIF(btrim(COALESCE(p_dados->>'descricao', '')), '');
  v_numero text;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Obra não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF v_tarefa IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projetos_obra_tarefa
       WHERE id = v_tarefa AND obra_id = p_obra_id AND excluido_em IS NULL) THEN
    RAISE EXCEPTION 'A etapa escolhida não é desta obra';
  END IF;
  IF v_item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projetos_obra_item
       WHERE id = v_item AND obra_id = p_obra_id AND excluido_em IS NULL) THEN
    RAISE EXCEPTION 'O serviço escolhido não é desta obra';
  END IF;
  IF v_id IS NULL THEN
    IF v_desc IS NULL THEN RAISE EXCEPTION 'Descreva o que a equipe vai fazer'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('projetos_obra_os:' || v_company::text));
    SELECT 'OSO-' || lpad((COALESCE(max(NULLIF(regexp_replace(numero, '\D', '', 'g'), '')::int), 0) + 1)::text, 4, '0')
      INTO v_numero FROM public.projetos_obra_os WHERE company_id = v_company;
    INSERT INTO public.projetos_obra_os (company_id, obra_id, numero, tarefa_id, obra_item_id, descricao, equipe,
      responsavel, data_prevista, prioridade, criado_por)
    VALUES (v_company, p_obra_id, v_numero, v_tarefa, v_item, v_desc,
      NULLIF(btrim(COALESCE(p_dados->>'equipe', '')), ''), NULLIF(btrim(COALESCE(p_dados->>'responsavel', '')), ''),
      NULLIF(p_dados->>'data_prevista', '')::date, COALESCE(NULLIF(p_dados->>'prioridade', ''), 'normal'), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.projetos_obra_os SET
      tarefa_id = v_tarefa, obra_item_id = v_item,
      descricao = COALESCE(v_desc, descricao),
      equipe = NULLIF(btrim(COALESCE(p_dados->>'equipe', '')), ''),
      responsavel = NULLIF(btrim(COALESCE(p_dados->>'responsavel', '')), ''),
      data_prevista = NULLIF(p_dados->>'data_prevista', '')::date,
      prioridade = COALESCE(NULLIF(p_dados->>'prioridade', ''), prioridade),
      atualizado_em = now()
    WHERE id = v_id AND obra_id = p_obra_id AND company_id = v_company AND excluido_em IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
    SELECT numero INTO v_numero FROM public.projetos_obra_os WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_os_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_os_salvar(uuid, jsonb) TO authenticated, service_role;

-- Avança a OS: aberta → em execução → concluída; cancelar a partir de aberta/em execução; reabrir uma cancelada.
CREATE OR REPLACE FUNCTION public.fn_obra_os_status(p_id uuid, p_status text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_atual text;
BEGIN
  SELECT company_id, status INTO v_company, v_atual FROM public.projetos_obra_os WHERE id = p_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF NOT ((v_atual = 'aberta' AND p_status IN ('em_execucao', 'cancelada'))
       OR (v_atual = 'em_execucao' AND p_status IN ('concluida', 'cancelada'))
       OR (v_atual = 'cancelada' AND p_status = 'aberta')) THEN
    RAISE EXCEPTION 'Não dá para passar a OS de % para %', v_atual, p_status;
  END IF;
  UPDATE public.projetos_obra_os SET status = p_status, atualizado_em = now(),
    iniciada_em = CASE WHEN p_status = 'em_execucao' THEN now() ELSE iniciada_em END,
    concluida_em = CASE WHEN p_status = 'concluida' THEN now() ELSE NULL END
  WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'status', p_status);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_os_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_os_status(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_obra_os_excluir(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obra_os WHERE id = p_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.projetos_obra_os SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_os_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_os_excluir(uuid) TO authenticated, service_role;

-- RD-95: "?" de cada campo, filtro e ação da tela.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('projetos.os_obra.filtro_obra', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 1, 'Filtrar por obra',
   'Escolha uma obra para ver só as ordens dela, ou Todas as obras.', 'Só filtra a lista. Não muda nenhuma OS.',
   'Residencial Jardins', 'Esquecer o filtro ligado e achar que a OS sumiu.'),
  ('projetos.os_obra.filtro_status', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 2, 'Filtrar por situação',
   'Em andamento (abertas e em execução), Concluídas, Canceladas ou Todas.', 'Só filtra a lista.',
   'Em andamento, para a reunião de obra da manhã', 'Procurar uma OS concluída com o filtro em Em andamento.'),
  ('projetos.os_obra.nova', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 3, 'Nova OS',
   'Nada a preencher: abre o formulário da ordem de serviço.', 'Registra o que uma equipe vai executar, em qual obra e etapa.',
   'Abrir uma OS para o forro do 2º pavimento', 'Abrir uma OS para a obra inteira — a OS é por frente de trabalho.'),
  ('projetos.os_obra.obra', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 4, 'Obra',
   'A obra onde o serviço será executado. É obrigatória.', 'Liga a OS à obra; a lista de etapas e de serviços passa a ser a desta obra.',
   'OB-0042 · Residencial Jardins', 'Escolher a obra errada — etapa e serviço somem porque são de outra obra.'),
  ('projetos.os_obra.etapa', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 5, 'Etapa',
   'Opcional. A etapa do cronograma da obra a que esta OS pertence.', 'Mostra em que fase da obra a equipe está trabalhando e ajuda a cobrar o prazo da etapa.',
   'Forros — 2º pavimento', 'Deixar vazio quando a obra tem cronograma: perde-se a ligação com o prazo.'),
  ('projetos.os_obra.servico', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 6, 'Serviço',
   'Opcional. O serviço contratado da obra que será executado.', 'Liga a OS ao item do contrato, para conferir depois o que foi medido.',
   'Forro de gesso acartonado — 320 m²', 'Escolher um serviço parecido de outra obra.'),
  ('projetos.os_obra.descricao', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 7, 'O que fazer',
   'O que a equipe deve executar, com local e quantidade quando ajudar. É obrigatório.', 'É a instrução que a equipe recebe no campo.',
   'Fechar o forro das salas 201 a 205 (85 m²)', 'Texto vago ("terminar forro") — a equipe não sabe onde parar.'),
  ('projetos.os_obra.equipe', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 8, 'Equipe',
   'Quem vai executar: nome do encarregado e composição da equipe.', 'Mostra quem está em cada frente e evita duas equipes no mesmo lugar.',
   'Equipe do João — 2 gesseiros + 1 ajudante', 'Deixar em branco — no campo ninguém sabe de quem é a OS.'),
  ('projetos.os_obra.responsavel', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 9, 'Responsável',
   'Opcional. Quem confere e responde pela OS (mestre de obras, engenheiro).', 'É quem recebe as dúvidas da equipe e dá a OS por concluída.',
   'Eng. Carla', 'Pôr o nome do executor aqui e não na Equipe.'),
  ('projetos.os_obra.data_prevista', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 10, 'Para quando',
   'Opcional. O dia em que o serviço deve estar pronto.', 'Marca em vermelho a OS atrasada na lista.',
   '05/11/2026', 'Data antes da etapa começar no cronograma.'),
  ('projetos.os_obra.prioridade', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 11, 'Prioridade',
   'Baixa, Normal, Alta ou Urgente.', 'Ordena a atenção da equipe; a urgente aparece destacada na lista.',
   'Urgente para liberar a pintura amanhã', 'Marcar tudo como urgente — aí nada é urgente.'),
  ('projetos.os_obra.salvar', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 12, 'Salvar OS',
   'Nada a preencher: grava a OS. Só grava ao clicar.', 'A OS entra na lista como aberta, com número automático (OSO-0001…).',
   'OSO-0007 criada', 'Fechar o formulário sem salvar — nada é gravado.'),
  ('projetos.os_obra.acoes', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 13, 'Avançar a OS',
   'Iniciar quando a equipe começa; Concluir quando termina; Cancelar se não vai mais ser feita (dá para reabrir).', 'Mostra em tempo real o que está em execução em cada obra.',
   'Iniciar às 7h, Concluir no fim do dia', 'Concluir sem conferir no campo.')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES ('dashboard.projetos_obras_os', '/dashboard/projetos/obras/os', 'hub_construcao', 'Ordens de serviço de obra',
        'OS do Hub por obra, etapa, serviço e equipe (não é a OS de oficina)', 'parcial', 'alta')
ON CONFLICT (id) DO NOTHING;
