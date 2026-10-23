-- HB0 item 6: a OS de empresa de obra passa a dizer de qual OBRA, ETAPA (tarefa do cronograma), SERVIÇO (item do
-- escopo) e EQUIPE ela é — em vez de só placa/veículo de oficina. Só objetos NOVOS: 1 tabela do Hub ligada à erp_os
-- (a erp_os não é alterada) e 2 funções. RLS por empresa, REVOKE anon, gravação só pela função com guarda de empresa
-- que confere que OS, obra, etapa e serviço são da MESMA empresa.
CREATE TABLE IF NOT EXISTS public.projetos_os_obra (
  os_id         uuid PRIMARY KEY REFERENCES public.erp_os(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  obra_id       uuid NOT NULL REFERENCES public.projetos_obras(id),
  tarefa_id     uuid REFERENCES public.projetos_obra_tarefa(id) ON DELETE SET NULL,
  obra_item_id  uuid REFERENCES public.projetos_obra_item(id) ON DELETE SET NULL,
  equipe        text CHECK (equipe IS NULL OR length(equipe) <= 200),
  atualizado_por uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projetos_os_obra_obra_idx ON public.projetos_os_obra (company_id, obra_id);

ALTER TABLE public.projetos_os_obra ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projetos_os_obra FROM PUBLIC, anon;
DROP POLICY IF EXISTS projetos_os_obra_ler ON public.projetos_os_obra;
CREATE POLICY projetos_os_obra_ler ON public.projetos_os_obra FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.projetos_os_obra TO authenticated;

-- Lê o vínculo da OS + as opções (obras ativas da empresa, etapas e serviços da obra escolhida) numa chamada só.
-- Empresa sem obra em andamento (e OS sem vínculo) → tem_obras = false e a ficha da OS não mostra o bloco (oficina segue igual).
CREATE OR REPLACE FUNCTION public.fn_os_obra_obter(p_os_id uuid, p_obra_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_vinc public.projetos_os_obra; v_obra uuid; v_obras jsonb;
BEGIN
  SELECT company_id INTO v_company FROM public.erp_os WHERE id = p_os_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  SELECT * INTO v_vinc FROM public.projetos_os_obra WHERE os_id = p_os_id;
  v_obra := COALESCE(p_obra_id, v_vinc.obra_id);
  v_obras := COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'numero', o.numero, 'nome', o.nome) ORDER BY o.nome)
      FROM public.projetos_obras o
      WHERE o.company_id = v_company
        AND (o.id = v_vinc.obra_id OR COALESCE(o.status, '') NOT IN ('concluida', 'cancelada', 'encerrada'))), '[]'::jsonb);
  RETURN jsonb_build_object(
    'ok', true,
    'tem_obras', jsonb_array_length(v_obras) > 0,
    'vinculo', CASE WHEN v_vinc.os_id IS NULL THEN NULL ELSE jsonb_build_object(
      'obra_id', v_vinc.obra_id, 'tarefa_id', v_vinc.tarefa_id, 'obra_item_id', v_vinc.obra_item_id, 'equipe', v_vinc.equipe) END,
    'obras', v_obras,
    'etapas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome) ORDER BY t.ordem, t.inicio, t.nome)
      FROM public.projetos_obra_tarefa t
      WHERE t.obra_id = v_obra AND t.company_id = v_company AND t.excluido_em IS NULL), '[]'::jsonb),
    'servicos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'descricao', i.descricao, 'unidade', i.unidade) ORDER BY i.ordem, i.descricao)
      FROM public.projetos_obra_item i
      WHERE i.obra_id = v_obra AND i.company_id = v_company AND i.excluido_em IS NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.fn_os_obra_obter(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_obra_obter(uuid, uuid) TO authenticated, service_role;

-- Grava (ou limpa, com obra nula) o vínculo da OS. Etapa e serviço precisam ser da obra escolhida.
CREATE OR REPLACE FUNCTION public.fn_os_obra_salvar(p_os_id uuid, p_obra_id uuid, p_tarefa_id uuid DEFAULT NULL,
  p_obra_item_id uuid DEFAULT NULL, p_equipe text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.erp_os WHERE id = p_os_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF p_obra_id IS NULL THEN
    DELETE FROM public.projetos_os_obra WHERE os_id = p_os_id;
    RETURN jsonb_build_object('ok', true, 'vinculo', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projetos_obras WHERE id = p_obra_id AND company_id = v_company) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'A obra não é desta empresa.');
  END IF;
  IF p_tarefa_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projetos_obra_tarefa
       WHERE id = p_tarefa_id AND obra_id = p_obra_id AND excluido_em IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'A etapa escolhida não é desta obra.');
  END IF;
  IF p_obra_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projetos_obra_item
       WHERE id = p_obra_item_id AND obra_id = p_obra_id AND excluido_em IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O serviço escolhido não é desta obra.');
  END IF;
  INSERT INTO public.projetos_os_obra (os_id, company_id, obra_id, tarefa_id, obra_item_id, equipe, atualizado_por)
  VALUES (p_os_id, v_company, p_obra_id, p_tarefa_id, p_obra_item_id, NULLIF(btrim(p_equipe), ''), auth.uid())
  ON CONFLICT (os_id) DO UPDATE SET obra_id = EXCLUDED.obra_id, tarefa_id = EXCLUDED.tarefa_id,
    obra_item_id = EXCLUDED.obra_item_id, equipe = EXCLUDED.equipe, atualizado_por = auth.uid(), atualizado_em = now();
  RETURN jsonb_build_object('ok', true, 'vinculo', jsonb_build_object('obra_id', p_obra_id, 'tarefa_id', p_tarefa_id,
    'obra_item_id', p_obra_item_id, 'equipe', NULLIF(btrim(p_equipe), '')));
END $$;
REVOKE ALL ON FUNCTION public.fn_os_obra_salvar(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_obra_salvar(uuid, uuid, uuid, uuid, text) TO authenticated, service_role;

-- "?" (RD-95) do bloco Obra na ficha da OS.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('os.ficha.obra', 'Ficha da OS · Obra', 'Obra',
 'Escolha a obra em que o serviço desta OS é executado.',
 'Liga a OS à obra: ela passa a contar no acompanhamento e no histórico daquela obra.', 'OBR-0012 · Residencial Jardins', 'Abrir a OS sem obra e perder o rastro de onde o serviço foi feito.', 10, '/dashboard/os', 'projetos', 'publicado'),
('os.ficha.etapa', 'Ficha da OS · Obra', 'Etapa',
 'Etapa do cronograma da obra a que este serviço pertence. Opcional.',
 'Mostra em que fase da obra a OS entra (ex.: estrutura, vedação, acabamento).', 'Vedação — 2º pavimento', 'Escolher uma etapa já concluída no cronograma.', 20, '/dashboard/os', 'projetos', 'publicado'),
('os.ficha.servico', 'Ficha da OS · Obra', 'Serviço da obra',
 'Item do escopo contratado que esta OS executa. Opcional.',
 'Liga a OS ao serviço do contrato, para conferir o que foi feito contra o que foi vendido.', 'Parede drywall ST 12,5 mm', 'Escolher um serviço de outra frente da obra.', 30, '/dashboard/os', 'projetos', 'publicado'),
('os.ficha.equipe', 'Ficha da OS · Obra', 'Equipe',
 'Quem executa o serviço: nome da equipe ou das pessoas.',
 'Registra quem esteve na obra para este serviço.', 'Equipe João: 2 montadores + 1 ajudante', 'Deixar em branco e não saber depois quem executou.', 40, '/dashboard/os', 'projetos', 'publicado'),
('os.ficha.obra_salvar', 'Ficha da OS · Obra', 'Salvar obra da OS',
 'Toque para gravar a obra, a etapa, o serviço e a equipe desta OS.',
 'Só grava quando você toca aqui; sem salvar, a OS fica sem a obra.', '—', 'Mudar a obra e sair sem salvar.', 50, '/dashboard/os', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;
