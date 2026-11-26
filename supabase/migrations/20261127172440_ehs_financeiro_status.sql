-- EHS-F slice-b (Parte F.2 · financeiro acoplado): status do adicional financeiro (GE) para a empresa.
--
-- O PS EHS vende sozinho; quem quiser contrata o financeiro (Gestão Empresarial) junto. A liberação é
-- SEMPRE por plano, nunca por código: "EHS + Financeiro" = duas assinaturas ativas na mesma empresa
-- (v15_compliance + v15_gestao_empresarial_pro) — provado nas DEMOs …00c (ambas) e …00b (só EHS).
--
-- Esta RPC só LÊ (padrão sem_plano das telas GE), para o cockpit EHS mostrar a tira "Financeiro:
-- acoplado / não" e, quando ausente, um CTA para contratar o adicional (F.2: nenhuma tela EHS quebra
-- nem fica vazia sem o adicional). Aditiva, read-only, guarda de empresa, sem acesso anon.

CREATE OR REPLACE FUNCTION public.fn_ehs_financeiro_status(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ehs boolean;
  v_financeiro boolean;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);

  SELECT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_compliance' AND status = 'active'
  ) INTO v_ehs;

  SELECT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active'
  ) INTO v_financeiro;

  RETURN jsonb_build_object(
    'ehs', v_ehs,
    'acoplado', v_financeiro,
    'plano_financeiro', 'v15_gestao_empresarial_pro'
  );
END;
$function$;

-- Guarda de acesso (check_fn_guards): SECURITY DEFINER não é aberta a anon.
REVOKE ALL ON FUNCTION public.fn_ehs_financeiro_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_financeiro_status(uuid) TO authenticated, service_role;

-- RD-95: "?" do indicador "Financeiro acoplado" do cockpit EHS (texto em linguagem do usuário).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'ehs.cockpit.financeiro', '/dashboard/ehs/cockpit', 'Cockpit SST', 'Financeiro acoplado',
  'Você não preenche nada aqui: a tira mostra se a sua empresa também contratou o módulo Financeiro (Gestão Empresarial) junto do EHS.',
  'O PS EHS funciona sozinho; o Financeiro é um adicional. Quando acoplado, contas a pagar/receber, caixa e DRE ficam disponíveis para a mesma empresa. Quando não, você vê um convite para conhecer o adicional — nada no EHS deixa de funcionar.',
  'Acoplado: o botão leva à Gestão Empresarial. Não acoplado: o botão leva à página que explica o adicional.',
  'Achar que precisa do Financeiro para usar o EHS — não precisa; ele é opcional.',
  'compliance', 15, 'publicado'
)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, status = EXCLUDED.status, atualizado_em = now();
