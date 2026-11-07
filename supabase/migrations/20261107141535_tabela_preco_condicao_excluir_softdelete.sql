-- PDCA Hub · /dashboard/projetos/tabelas-preco · AJUSTE RD-98 pilar 2 (Incluir/Editar/EXCLUIR visíveis).
-- As CONDIÇÕES (turnos/adicionais) tinham criar/editar ("Salvar condição") mas NÃO tinham EXCLUIR.
-- Adiciona exclusão RASTREÁVEL (soft-delete + quem/quando + audit_log_global), no padrão de
-- fn_tabela_preco_faixa_excluir, guardando a condição referenciada por código/preço-fixo de cliente
-- (impedir/avisar órfão, nunca apagar à força). Aditiva e idempotente. Code: code-desenvolvedor-3

-- 1) Soft-delete na condição (aditivo, idempotente)
ALTER TABLE public.erp_tabela_preco_condicao
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- 2) Salvar passa a REVIVER uma condição soft-deletada quando o mesmo nome é re-cadastrado
--    (a chave única é (tabela_id, condicao); sem reviver, a linha excluída ficaria presa e escondida).
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_condicao_salvar(p_tabela_id uuid, p_condicao text, p_percentual numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_c text := btrim(coalesce(p_condicao,''));
BEGIN
  SELECT company_id INTO v_company FROM public.erp_tabela_preco_cliente WHERE id = p_tabela_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Tabela não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF v_c = '' OR v_c = 'normal' THEN RAISE EXCEPTION 'Informe o nome da condição (a normal já existe)'; END IF;
  UPDATE public.erp_tabela_preco_condicao
     SET percentual = p_percentual, deleted_at = NULL, deleted_by = NULL
   WHERE tabela_id = p_tabela_id AND condicao = v_c;
  IF NOT FOUND THEN
    INSERT INTO public.erp_tabela_preco_condicao (company_id, tabela_id, condicao, percentual) VALUES (v_company, p_tabela_id, v_c, p_percentual);
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- 3) Exclusão rastreável da condição (soft-delete + audit + guarda de referência)
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_condicao_excluir(p_tabela_id uuid, p_condicao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_c text := btrim(coalesce(p_condicao,'')); v_pct numeric; v_id uuid; v_refs int;
BEGIN
  IF v_c = '' OR v_c = 'normal' THEN RAISE EXCEPTION 'A condição normal não pode ser excluída'; END IF;
  SELECT company_id, id, percentual INTO v_company, v_id, v_pct
    FROM public.erp_tabela_preco_condicao
   WHERE tabela_id = p_tabela_id AND condicao = v_c AND deleted_at IS NULL;
  IF v_company IS NULL THEN
    -- já excluída (idempotente) ou inexistente: não é erro para o fluxo da tela
    IF EXISTS (SELECT 1 FROM public.erp_tabela_preco_condicao WHERE tabela_id = p_tabela_id AND condicao = v_c) THEN
      RETURN jsonb_build_object('ok', true);
    END IF;
    RAISE EXCEPTION 'Condição não encontrada';
  END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  -- guarda: não apaga à força se houver código/preço fixo de cliente usando a condição
  SELECT count(*) INTO v_refs FROM public.erp_tabela_preco_codigo
   WHERE tabela_id = p_tabela_id AND condicao = v_c
     AND (coalesce(btrim(codigo_externo),'') <> '' OR preco_fixo IS NOT NULL);
  IF v_refs > 0 THEN
    RAISE EXCEPTION 'A condição "%" tem % código(s)/preço(s) fixo(s) de cliente vinculado(s). Remova-os antes de excluir a condição.', v_c, v_refs;
  END IF;
  UPDATE public.erp_tabela_preco_condicao
     SET deleted_at = now(), deleted_by = auth.uid()
   WHERE id = v_id AND company_id = v_company;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'erp_tabela_preco_condicao', v_id, 'excluir',
            jsonb_build_object('condicao', v_c, 'percentual', v_pct, 'deleted_at', NULL),
            jsonb_build_object('condicao', v_c, 'percentual', v_pct, 'deleted_at', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- 4) Segurança: sem anon, só usuário logado / serviço
REVOKE ALL ON FUNCTION public.fn_tabela_preco_condicao_excluir(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_tabela_preco_condicao_salvar(uuid, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_condicao_excluir(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_condicao_salvar(uuid, text, numeric) TO authenticated, service_role;

-- 5) Origem do dado (RD-98): registra a RPC nova na tela (coluna text[]; idempotente)
UPDATE public.system_screens
   SET rpcs_chamadas = array_append(rpcs_chamadas, 'fn_tabela_preco_condicao_excluir')
 WHERE rota = '/dashboard/projetos/tabelas-preco'
   AND NOT ('fn_tabela_preco_condicao_excluir' = ANY(coalesce(rpcs_chamadas, '{}')));

-- 6) RD-95: "?" da ação Excluir condição
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'hub.tabela_preco.condicao_excluir',
  '/dashboard/projetos/tabelas-preco',
  'Contrato de preços',
  'Excluir condição',
  'Nada a preencher: é a ação de remover esta condição (turno/adicional) do contrato.',
  'Tira a condição do contrato: ela deixa de ser oferecida no cálculo e na medição. A exclusão é rastreável — o registro não é apagado do banco, fica guardado com quem excluiu e quando (trilha de auditoria) e some das listas. Se o mesmo nome for cadastrado de novo, a condição volta.',
  'Cadastrou "sabado" por engano em vez de "sábado": exclua a errada — ela sai da grade e do seletor na hora.',
  'A condição não é excluída se houver código de cliente ou preço fixo usando ela: remova esses códigos antes. Para só mudar o adicional (%), use Salvar condição; Excluir remove a condição inteira.',
  'hub_projetos',
  338,
  1,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
