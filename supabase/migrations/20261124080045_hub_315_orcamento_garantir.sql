-- Hub · §315 Orçamento por EAP (Onda C-2) · PDCA RD-98 p4
-- GAP (PDCA 22/11, main 4371f79): obra criada pelo fluxo rápido (fn_hub_criar_obra_rapida)
-- fica com orcamento_id = NULL, e a tela do Orçamento por EAP não oferece como criar um —
-- beco sem saída na jornada "criar obra -> orçamento" (critério d: estado vazio sem botão).
-- Esta migration adiciona uma RPC ADITIVA, idempotente, que garante um orçamento vazio
-- vinculado à obra, para o botão "Criar orçamento desta obra" do estado vazio da tela.
-- Não altera estrutura de erp_orcamentos (compartilhada com o Comércio) nem fn_hub_criar_obra_rapida (núcleo).

CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_garantir(p_obra_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_orc_id     uuid;
  v_cliente_id uuid;
  v_cliente_nome text;
BEGIN
  IF p_obra_id IS NULL THEN
    RAISE EXCEPTION 'obra obrigatória' USING ERRCODE = '22004';
  END IF;

  SELECT company_id, orcamento_id, cliente_id, cliente_nome
    INTO v_company_id, v_orc_id, v_cliente_id, v_cliente_nome
  FROM public.projetos_obras
  WHERE id = p_obra_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Obra % não encontrada', p_obra_id USING ERRCODE = 'P0002';
  END IF;

  -- Guarda por empresa (mesmo padrão de fn_hub_criar_obra_rapida): sem usuário = conexão de serviço/cron passa.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta obra' USING ERRCODE = '42501';
  END IF;

  -- Idempotente: a obra que já tem orçamento devolve o mesmo, sem criar outro.
  IF v_orc_id IS NOT NULL THEN
    RETURN v_orc_id;
  END IF;

  -- Orçamento vazio vinculado à obra. numero é gerado pela trigger trg_orcamento_set_numero;
  -- status 'rascunho' (default) não dispara trg_orcamento_gera_obra. eh_obra=true é seguro:
  -- fn_obra_criar_de_orcamento é idempotente (acha a obra por orcamento_id e não duplica).
  INSERT INTO public.erp_orcamentos (company_id, status, eh_obra, obra_id, cliente_id, cliente_nome)
  VALUES (v_company_id, 'rascunho', true, p_obra_id, v_cliente_id, v_cliente_nome)
  RETURNING id INTO v_orc_id;

  UPDATE public.projetos_obras SET orcamento_id = v_orc_id WHERE id = p_obra_id;

  RETURN v_orc_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_garantir(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_garantir(uuid) TO authenticated;

-- RD-95: "?" do botão "Criar orçamento desta obra" no estado vazio da tela.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT
  'projetos.orcamento_eap.criar_orcamento',
  '/dashboard/projetos/obras/[id]/orcamento',
  'Orçamento por EAP',
  'Criar orçamento desta obra',
  'Clique para criar o orçamento desta obra quando ela ainda não tem um vinculado.',
  'Cria um orçamento vazio já ligado à obra para você começar a montar a EAP (adicionar itens ou importar a planilha). Obras criadas pelo cadastro rápido nascem sem orçamento.',
  'Obra OBR-2026-0001 sem orçamento: um clique cria o orçamento e libera o "+ Item" e a importação.',
  'Criar mais de um orçamento para a mesma obra — a ação é idempotente: se a obra já tem orçamento, ela só reabre o mesmo.',
  'projetos',
  5
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'projetos.orcamento_eap.criar_orcamento');
