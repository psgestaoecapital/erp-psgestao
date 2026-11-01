-- Hub · Diário de Obra (RDO) — tela dedicada por obra (HBF-4.2, META CEO 02/11)
-- A tabela projetos_obra_rdo e o fn_obra_rdo_salvar(p_os_id,p_dados) já existem (form inline na OS).
-- Esta migration é ADITIVA: só acrescenta a exclusão rastreável (soft-delete + audit), registra a tela em
-- system_screens (RD-98 p3 origem do dado) e cadastra as chaves de ajuda "?" (RD-95) da tela nova.
-- Não altera dado de cliente nem título pago; nenhum DELETE físico.

-- 1) Exclusão rastreável do diário (RD-98 p4: nunca DELETE físico; grava quem/quando + valor anterior no audit_log).
CREATE OR REPLACE FUNCTION public.fn_obra_rdo_excluir(p_rdo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_row public.projetos_obra_rdo%ROWTYPE; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_row FROM public.projetos_obra_rdo WHERE id = p_rdo_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'diário não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_row.company_id);
  -- Idempotência: já excluído → nada a fazer (o passo re-roda sem duplicar audit).
  IF v_row.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_excluido', true); END IF;

  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_row.company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
          'projetos_obra_rdo', p_rdo_id::text, 'obra_rdo_excluido',
          jsonb_build_object('obra_id', v_row.obra_id, 'os_id', v_row.os_id, 'data', v_row.data,
                             'efetivo', v_row.efetivo, 'atividades', v_row.atividades, 'ocorrencias', v_row.ocorrencias),
          jsonb_build_object('excluido', true, 'excluido_por', v_uid));

  UPDATE public.projetos_obra_rdo
     SET excluido_em = now(), excluido_por = v_uid
   WHERE id = p_rdo_id;

  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_rdo_excluir(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_rdo_excluir(uuid) TO authenticated;

-- 2) RD-98 p3: a tela nova em system_screens, com origem do dado (views/rpcs que consome).
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, views_consumidas, rpcs_chamadas, estado_real, prioridade_monitoramento)
VALUES (gen_random_uuid(), '/dashboard/projetos/obras/[id]/rdo', 'hub_construcao', 'Diário de Obra (RDO)',
  'Livro de Ordem / Diário de Obra (RDO) por obra (CONFEA 1.094/2017): histórico diário com data, clima, se deu para trabalhar, efetivo, atividades, ocorrências, quantidade executada e fotos; novo/editar o diário do dia por OS e exclusão rastreável.',
  ARRAY['projetos_obra_rdo','projetos_obra_os','projetos_obras'],
  ARRAY['fn_obra_rdo_salvar','fn_obra_rdo_excluir','fn_obra_existe'],
  'parcial', 'alta')
ON CONFLICT (rota) DO UPDATE SET
  area = EXCLUDED.area, titulo = EXCLUDED.titulo, descricao_funcional = EXCLUDED.descricao_funcional,
  views_consumidas = EXCLUDED.views_consumidas, rpcs_chamadas = EXCLUDED.rpcs_chamadas, atualizado_em = now();

-- 3) RD-95: chaves de ajuda "?" dos controles NOVOS desta tela (os campos do formulário reaproveitam
--    as chaves projetos.os_obra.rdo_* já existentes). Idempotente por chave.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('projetos.obra_rdo.historico', '/dashboard/projetos/obras/[id]/rdo', 'Diário de Obra', 'Histórico de diários',
  'A lista dos diários já lançados nesta obra, do mais recente para o mais antigo, com data, clima, efetivo e um resumo.',
  'Acompanhar o andamento da obra dia a dia (Livro de Ordem) e abrir um dia para corrigir ou excluir.',
  '31/10/2026 · sol · 4 na equipe', 'Procurar um diário que foi excluído — excluído some da lista.', 'hub_projetos', 1, 1, 'publicado'),
 ('projetos.obra_rdo.os', '/dashboard/projetos/obras/[id]/rdo', 'Diário de Obra', 'OS do diário',
  'A ordem de serviço (OS) desta obra a que o diário se refere. Só aparecem OS aberta ou em execução.',
  'Cada diário é de uma OS e de um dia; a OS liga o diário à frente de serviço e ao avanço.',
  'OS 1203 — Forro de gesso', 'Lançar o diário na OS errada quando a obra tem várias frentes.', 'hub_projetos', 2, 1, 'publicado'),
 ('projetos.obra_rdo.filtro_os', '/dashboard/projetos/obras/[id]/rdo', 'Diário de Obra', 'Filtrar por OS',
  'Mostra só os diários da OS escolhida; deixe em "Todas" para ver a obra inteira.',
  'Separar o diário por frente de serviço quando a obra tem várias OS.',
  'Todas', 'Achar que a obra está sem diário porque um filtro de OS ficou ligado.', 'hub_projetos', 3, 1, 'publicado'),
 ('projetos.obra_rdo.novo', '/dashboard/projetos/obras/[id]/rdo', 'Diário de Obra', 'Novo diário',
  'Abre o formulário para lançar o diário de um dia. Se o dia já tiver diário na OS, abre esse para corrigir.',
  'Registrar o que aconteceu na obra no dia (um diário por OS e por dia).',
  'Novo diário', 'Abrir vários diários do mesmo dia na mesma OS — o sistema atualiza o existente.', 'hub_projetos', 4, 1, 'publicado'),
 ('projetos.obra_rdo.excluir', '/dashboard/projetos/obras/[id]/rdo', 'Diário de Obra', 'Excluir diário',
  'Remove o diário da lista. A exclusão é rastreável: fica registrado quem excluiu e quando, e o conteúdo é preservado no histórico.',
  'Tirar um diário lançado por engano, sem apagar o rastro (Livro de Ordem é documento).',
  'Excluir', 'Excluir o diário certo achando que corrige — para corrigir, abra o dia e edite.', 'hub_projetos', 5, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, atualizado_em = now();
