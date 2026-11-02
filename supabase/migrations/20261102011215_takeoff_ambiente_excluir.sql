-- PDCA Hub · /dashboard/projetos/engenharia (aud8 90/95): RD-98 p2 (CRUD completo) + p4 (exclusão rastreável).
-- A tela só tinha Incluir e Editar de ambiente; faltava EXCLUIR. O take-off já tem fn_takeoff_planta_excluir
-- (soft-delete + audit) — falta só o do AMBIENTE. Esta migration é ADITIVA:
--   1) colunas de soft-delete (nullable, sem default NOT NULL) em erp_obra_planta_ambiente;
--   2) função NOVA guardada fn_takeoff_ambiente_excluir (soft-delete reversível + rastro + audit_log_global).
-- Não apaga/altera nenhum dado existente. RLS da tabela já cobre as colunas novas.

ALTER TABLE public.erp_obra_planta_ambiente
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  uuid;

CREATE INDEX IF NOT EXISTS ix_obra_planta_ambiente_vivos
  ON public.erp_obra_planta_ambiente (planta_id)
  WHERE deleted_at IS NULL;

-- Exclusão lógica (RD-30/RD-98 p4): soft-delete rastreável de um ambiente do take-off.
-- Guarda por empresa (fn__guarda_empresa) porque é SECURITY DEFINER; registra em audit_log_global.
CREATE OR REPLACE FUNCTION public.fn_takeoff_ambiente_excluir(p_company_id uuid, p_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE a public.erp_obra_planta_ambiente%ROWTYPE;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_usuario'); END IF;
  SELECT * INTO a
    FROM public.erp_obra_planta_ambiente
   WHERE id = p_id AND company_id = p_company_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;

  UPDATE public.erp_obra_planta_ambiente
     SET deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
   WHERE id = p_id;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, auth.uid(), 'erp_obra_planta_ambiente', p_id::text, 'excluir',
          jsonb_build_object('nome', a.nome, 'planta_id', a.planta_id, 'servico_id', a.servico_id,
                             'area_m2', a.area_m2, 'confirmado', a.confirmado),
          jsonb_build_object('deleted_at', now()));
  RETURN jsonb_build_object('ok', true);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_takeoff_ambiente_excluir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_takeoff_ambiente_excluir(uuid, uuid) TO authenticated, service_role;

-- RD-95: "?" das novas ações (excluir ambiente · excluir take-off). Catálogo global, idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum) VALUES
  ('projetos.engenharia.amb_excluir', '/dashboard/projetos/engenharia', 'Ambientes', 'hub', 70,
   'Excluir ambiente',
   'Remove da lista o ambiente daquela linha. A exclusão é reversível e fica registrada (quem e quando).',
   'Tira um ambiente duplicado ou digitado errado para não entrar no cálculo do orçamento.',
   'Apagar um "Sala 01" repetido antes de gerar o orçamento.',
   'Excluir um ambiente já confirmado e esquecer de conferir o total: gere o orçamento de novo depois de ajustar.'),
  ('projetos.engenharia.excluir_takeoff', '/dashboard/projetos/engenharia', 'Take-off', 'hub', 71,
   'Excluir take-off',
   'Manda este take-off para a lixeira (soft-delete), com o motivo. Fica registrado quem excluiu e quando.',
   'Remove um take-off criado por engano ou abandonado, sem perder o histórico.',
   'Excluir um "Projeto teste" que não vai virar orçamento.',
   'Tentar excluir um take-off que já gerou itens de orçamento: ele fica travado para preservar o orçamento.')
ON CONFLICT (chave) DO NOTHING;
