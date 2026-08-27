-- SPEC F1 · DESTRAVAR O TAKE-OFF (Hub de Projetos) · fluxo de obra v1.
-- Objetivo: produzir o primeiro orçamento COM ITENS a partir da planta processada.
-- Genérico (RD-51): base de cálculo vem da UNIDADE do serviço; sugestão por palavra-chave por empresa.
-- Auditado 27/08 (RD-44/45): erp_orcamentos NÃO tem natureza_operacao_hint (removida do INSERT);
-- unaccent instalado; bdi_percentual/preco_custo existem em erp_orcamentos_itens; trigger de número existe.

-- ─────────────────────────────────────────────────────────────────────────────
-- ENTREGA 2a · base de cálculo derivada da unidade do serviço (nada hardcoded p/ gesso)
CREATE OR REPLACE FUNCTION public.fn_takeoff_base_por_unidade(p_unidade text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE lower(btrim(coalesce(p_unidade,'')))
           WHEN 'm'  THEN 'perimetro'
           WHEN 'ml' THEN 'perimetro'
           WHEN 'm2' THEN 'area'
           WHEN 'm²' THEN 'area'
           ELSE 'area'
         END;
$fn$;

-- ENTREGA 2b · ao vincular/trocar o serviço, sugere a base pela unidade (usuário ainda pode trocar depois)
CREATE OR REPLACE FUNCTION public.tg_ambiente_base_por_servico()
RETURNS trigger LANGUAGE plpgsql
AS $fn$
DECLARE v_un text;
BEGIN
  IF NEW.servico_id IS NOT NULL
     AND (TG_OP='INSERT' OR NEW.servico_id IS DISTINCT FROM OLD.servico_id) THEN
    SELECT unidade INTO v_un FROM projetos_servicos WHERE id = NEW.servico_id;
    NEW.base_calculo := public.fn_takeoff_base_por_unidade(v_un);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_ambiente_base_por_servico ON public.erp_obra_planta_ambiente;
CREATE TRIGGER trg_ambiente_base_por_servico
BEFORE INSERT OR UPDATE ON public.erp_obra_planta_ambiente
FOR EACH ROW EXECUTE FUNCTION public.tg_ambiente_base_por_servico();

-- ─────────────────────────────────────────────────────────────────────────────
-- ENTREGA 3 · sugestão de serviço por palavra-chave (cadastro por empresa)
CREATE TABLE IF NOT EXISTS public.projetos_servico_palavra_chave (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  servico_id  uuid NOT NULL REFERENCES public.projetos_servicos(id) ON DELETE CASCADE,
  palavra     text NOT NULL,
  prioridade  int  NOT NULL DEFAULT 100,
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.projetos_servico_palavra_chave ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projetos_servico_palavra_chave_rw ON public.projetos_servico_palavra_chave;
CREATE POLICY projetos_servico_palavra_chave_rw
  ON public.projetos_servico_palavra_chave FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE INDEX IF NOT EXISTS ix_psp_company_palavra
  ON public.projetos_servico_palavra_chave (company_id, lower(palavra));

-- Sugere (não confirma) o serviço de cada ambiente ainda sem serviço, casando o nome do ambiente
-- com as palavras-chave da empresa. unaccent instalado (auditado). O trigger da Entrega 2b ajusta a base.
CREATE OR REPLACE FUNCTION public.fn_takeoff_sugerir_servicos(
  p_company_id uuid, p_planta_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE v_n int := 0; a record; v_serv uuid;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  FOR a IN
    SELECT id, nome FROM erp_obra_planta_ambiente
     WHERE planta_id = p_planta_id AND company_id = p_company_id AND servico_id IS NULL
  LOOP
    SELECT k.servico_id INTO v_serv
      FROM projetos_servico_palavra_chave k
      JOIN projetos_servicos s ON s.id = k.servico_id AND s.ativo
     WHERE k.company_id = p_company_id AND k.ativo
       AND unaccent(lower(a.nome)) LIKE '%' || unaccent(lower(k.palavra)) || '%'
     ORDER BY k.prioridade ASC, length(k.palavra) DESC
     LIMIT 1;
    IF v_serv IS NOT NULL THEN
      UPDATE erp_obra_planta_ambiente SET servico_id = v_serv, updated_at = now() WHERE id = a.id;
      v_n := v_n + 1;
    END IF;
    v_serv := NULL;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'sugeridos', v_n);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_takeoff_sugerir_servicos(uuid,uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_takeoff_sugerir_servicos(uuid,uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENTREGA 4 · correções na RPC existente (sem mudar assinatura):
--  (1) grava bdi_percentual no item (rastreabilidade); preco_custo já era gravado;
--  (3) quando não há ambiente elegível, registra o motivo em ia_erro (não marca 'confirmada').
CREATE OR REPLACE FUNCTION public.fn_takeoff_gerar_orcamento(
  p_company_id uuid, p_planta_id uuid, p_orcamento_id uuid)
RETURNS integer LANGUAGE plpgsql
AS $fn$
DECLARE v_count int := 0; a record; v_qtd numeric; v_ordem int; v_bdi numeric; v_preco numeric;
BEGIN
  SELECT COALESCE(bdi_total_pct,0) INTO v_bdi FROM projetos_modulo_config WHERE company_id=p_company_id;
  v_bdi := COALESCE(v_bdi,0);
  SELECT COALESCE(max(ordem),0) INTO v_ordem FROM erp_orcamentos_itens WHERE orcamento_id=p_orcamento_id;
  FOR a IN
    SELECT amb.*, s.nome AS s_nome, s.codigo AS s_codigo, s.unidade AS s_unidade, s.custo_unitario_total
      FROM erp_obra_planta_ambiente amb
      JOIN projetos_servicos s ON s.id=amb.servico_id
     WHERE amb.planta_id=p_planta_id AND amb.company_id=p_company_id
       AND amb.confirmado=true AND amb.servico_id IS NOT NULL
  LOOP
    v_qtd := CASE a.base_calculo
               WHEN 'perimetro' THEN COALESCE(a.perimetro_ml,0)
               WHEN 'pe_direito_parede' THEN COALESCE(a.perimetro_ml,0)*COALESCE(a.pe_direito_m,0)
               ELSE COALESCE(a.area_m2,0) END;
    v_preco := ROUND(COALESCE(a.custo_unitario_total,0) * (1 + v_bdi/100), 2);
    v_ordem := v_ordem + 1;
    INSERT INTO erp_orcamentos_itens(orcamento_id,company_id,ordem,tipo_item,servico_id,servico_codigo,servico_descricao,
      produto_nome,unidade,quantidade,preco_custo,preco_unitario,subtotal,bdi_percentual,observacoes)
    VALUES (p_orcamento_id,p_company_id,v_ordem,'servico',a.servico_id,a.s_codigo,a.s_nome,
      a.s_nome||' - '||a.nome, a.s_unidade, v_qtd, a.custo_unitario_total, v_preco,
      ROUND(v_qtd*v_preco,2), v_bdi, 'Gerado por takeoff IA - '||a.nome);
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    UPDATE erp_obra_planta
       SET ia_erro='Nenhum ambiente elegível: confirme os ambientes e escolha o serviço de cada um.', updated_at=now()
     WHERE id=p_planta_id AND company_id=p_company_id;
  ELSE
    UPDATE erp_obra_planta SET status='confirmada', ia_erro=NULL, updated_at=now()
     WHERE id=p_planta_id AND company_id=p_company_id;
  END IF;
  RETURN v_count;
END $fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENTREGA 1 · cria um orçamento rascunho a partir da planta e injeta os itens (mata o "beco").
CREATE OR REPLACE FUNCTION public.fn_takeoff_criar_orcamento(
  p_company_id uuid, p_planta_id uuid, p_cliente_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_planta record; v_orc_id uuid; v_numero text;
  v_cli_id uuid; v_cli_nome text; v_validade int; v_qtd int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  SELECT * INTO v_planta FROM erp_obra_planta WHERE id=p_planta_id AND company_id=p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'planta_nao_encontrada');
  END IF;
  SELECT count(*) INTO v_qtd FROM erp_obra_planta_ambiente
   WHERE planta_id=p_planta_id AND company_id=p_company_id AND confirmado=true AND servico_id IS NOT NULL;
  IF v_qtd = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nenhum_ambiente_pronto',
      'mensagem', 'Confirme os ambientes e escolha o serviço de cada um antes de gerar o orçamento.');
  END IF;
  v_cli_id := COALESCE(p_cliente_id, v_planta.cliente_id);
  v_cli_nome := v_planta.cliente_nome;
  IF v_cli_nome IS NULL AND v_cli_id IS NOT NULL THEN
    SELECT COALESCE(nome_fantasia, razao_social) INTO v_cli_nome FROM erp_clientes WHERE id=v_cli_id;
  END IF;
  SELECT COALESCE(validade_proposta_dias, 30) INTO v_validade FROM projetos_modulo_config WHERE company_id=p_company_id;
  v_validade := COALESCE(v_validade, 30);
  -- numero é gerado pelo trigger tg_orcamento_set_numero (não passar). natureza_operacao_hint NÃO existe (removida).
  INSERT INTO erp_orcamentos (company_id, cliente_id, cliente_nome, status,
      data_emissao, data_validade, observacoes_internas, created_by)
  VALUES (p_company_id, v_cli_id, v_cli_nome, 'rascunho',
      CURRENT_DATE, CURRENT_DATE + v_validade,
      'Gerado do take-off: ' || COALESCE(v_planta.nome,'planta'), auth.uid())
  RETURNING id, numero INTO v_orc_id, v_numero;
  PERFORM public.fn_takeoff_gerar_orcamento(p_company_id, p_planta_id, v_orc_id);
  UPDATE erp_obra_planta SET orcamento_id=v_orc_id, updated_at=now()
   WHERE id=p_planta_id AND company_id=p_company_id;
  RETURN jsonb_build_object('ok', true, 'orcamento_id', v_orc_id, 'numero', v_numero,
    'itens', (SELECT count(*) FROM erp_orcamentos_itens WHERE orcamento_id=v_orc_id));
END $fn$;
REVOKE ALL ON FUNCTION public.fn_takeoff_criar_orcamento(uuid,uuid,uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_takeoff_criar_orcamento(uuid,uuid,uuid) TO authenticated;
