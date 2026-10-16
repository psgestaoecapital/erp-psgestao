-- Chamado #3281 (Gean, piloto; vale para todas as empresas) — relatórios longos em SEGUNDO PLANO com aviso quando ficam
-- prontos. ETAPA 1 (base): fila de pedidos de relatório por empresa + "Meus relatórios". Migration ADITIVA: 1 tabela
-- nova com RLS (empresa + solicitante) + RPCs com guarda + menu + ajuda (RD-95). Nada existente é alterado.
-- Próximas etapas: (2) gerador em segundo plano (Movimentação financeira 12 meses → Excel no storage privado, validade
-- 7 dias); (3) aviso no sino + e-mail "relatorio_pronto" com link temporário pelo provedor atual (sem custo novo, RD-42);
-- (4) botão "Gerar em segundo plano" nos relatórios pesados (Pagar/Receber, DRE, Fluxo).

-- ───────────────────────────── Tabela ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_relatorio_pedido (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  solicitante uuid NOT NULL REFERENCES auth.users(id),
  tipo text NOT NULL CHECK (tipo IN ('financeiro_movimentacao','financeiro_pagar','financeiro_receber','dre','fluxo_caixa')),
  formato text NOT NULL DEFAULT 'excel' CHECK (formato IN ('excel','pdf')),
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb,         -- período, filtros (o gerador valida)
  titulo text NOT NULL,                                  -- "Movimentação financeira — 01/10/2025 a 30/09/2026"
  status text NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila','gerando','pronto','erro','cancelado','expirado')),
  progresso int NOT NULL DEFAULT 0 CHECK (progresso BETWEEN 0 AND 100),
  tentativas int NOT NULL DEFAULT 0,
  erro text,
  arquivo_path text,                                     -- caminho no storage privado (etapa 2)
  tamanho_bytes bigint,
  linhas int,
  downloads int NOT NULL DEFAULT 0,
  expira_em timestamptz,                                 -- validade do arquivo (7 dias após pronto)
  avisado_em timestamptz,                                -- e-mail/sino enviados (etapa 3)
  criado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  concluido_em timestamptz
);
CREATE INDEX IF NOT EXISTS ix_relatorio_pedido_meus ON public.erp_relatorio_pedido (company_id, solicitante, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_relatorio_pedido_fila ON public.erp_relatorio_pedido (criado_em) WHERE status = 'na_fila';

-- ───────────────────────────── RLS + grants ─────────────────────────────
-- Cada pessoa vê só os PRÓPRIOS pedidos, e só de empresa a que tem acesso (admin PS vê todos).
ALTER TABLE public.erp_relatorio_pedido ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_relatorio_pedido_select ON public.erp_relatorio_pedido;
CREATE POLICY erp_relatorio_pedido_select ON public.erp_relatorio_pedido FOR SELECT TO authenticated
  USING ((solicitante = auth.uid() AND company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());
REVOKE ALL ON public.erp_relatorio_pedido FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.erp_relatorio_pedido FROM authenticated;   -- escrita só via RPC
GRANT SELECT ON public.erp_relatorio_pedido TO authenticated;
GRANT ALL ON public.erp_relatorio_pedido TO service_role;

-- ───────────────────────────── RPCs do usuário ─────────────────────────────
-- Pedir um relatório em segundo plano. Limite: 5 pedidos abertos (na fila/gerando) por pessoa, para ninguém lotar a fila.
CREATE OR REPLACE FUNCTION public.fn_relatorio_pedir(p_company_id uuid, p_tipo text, p_parametros jsonb DEFAULT '{}'::jsonb,
  p_formato text DEFAULT 'excel', p_titulo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid; v_abertos int;
  v_par jsonb := coalesce(p_parametros, '{}'::jsonb);
  v_ini date; v_fim date;
  v_titulo text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF p_tipo NOT IN ('financeiro_movimentacao','financeiro_pagar','financeiro_receber','dre','fluxo_caixa') THEN
    RETURN jsonb_build_object('ok',false,'erro','tipo_invalido');
  END IF;
  IF coalesce(p_formato,'excel') NOT IN ('excel','pdf') THEN RETURN jsonb_build_object('ok',false,'erro','formato_invalido'); END IF;
  IF jsonb_typeof(v_par) <> 'object' THEN RETURN jsonb_build_object('ok',false,'erro','parametros_invalidos'); END IF;

  -- período: padrão = últimos 12 meses fechados até hoje; no máximo 36 meses
  BEGIN
    v_ini := coalesce(nullif(v_par->>'data_inicio','')::date, (date_trunc('month', current_date) - interval '11 months')::date);
    v_fim := coalesce(nullif(v_par->>'data_fim','')::date, current_date);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok',false,'erro','periodo_invalido');
  END;
  IF v_fim < v_ini THEN RETURN jsonb_build_object('ok',false,'erro','periodo_invalido'); END IF;
  IF v_fim > v_ini + interval '36 months' THEN RETURN jsonb_build_object('ok',false,'erro','periodo_maior_que_36_meses'); END IF;
  v_par := v_par || jsonb_build_object('data_inicio', v_ini, 'data_fim', v_fim);

  SELECT count(*) INTO v_abertos FROM erp_relatorio_pedido
   WHERE solicitante = auth.uid() AND status IN ('na_fila','gerando');
  IF v_abertos >= 5 THEN RETURN jsonb_build_object('ok',false,'erro','limite_pedidos_abertos'); END IF;

  v_titulo := coalesce(nullif(btrim(p_titulo),''),
    CASE p_tipo
      WHEN 'financeiro_movimentacao' THEN 'Movimentação financeira'
      WHEN 'financeiro_pagar' THEN 'Contas a pagar'
      WHEN 'financeiro_receber' THEN 'Contas a receber'
      WHEN 'dre' THEN 'DRE'
      ELSE 'Fluxo de caixa' END
    || ' — ' || to_char(v_ini,'DD/MM/YYYY') || ' a ' || to_char(v_fim,'DD/MM/YYYY'));

  INSERT INTO erp_relatorio_pedido (company_id, solicitante, tipo, formato, parametros, titulo)
  VALUES (p_company_id, auth.uid(), p_tipo, coalesce(p_formato,'excel'), v_par, left(v_titulo, 200))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'id',v_id,'titulo',left(v_titulo,200));
END $$;
REVOKE ALL ON FUNCTION public.fn_relatorio_pedir(uuid,text,jsonb,text,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_pedir(uuid,text,jsonb,text,text) TO authenticated;

-- Meus relatórios (da empresa escolhida): os 50 mais recentes. "expirado" é calculado (arquivo vencido).
CREATE OR REPLACE FUNCTION public.fn_relatorio_meus(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  RETURN jsonb_build_object('ok', true, 'pedidos', coalesce((
    SELECT jsonb_agg(x ORDER BY x.criado_em DESC) FROM (
      SELECT p.id, p.tipo, p.formato, p.titulo, p.parametros, p.progresso, p.erro, p.linhas, p.tamanho_bytes,
             p.downloads, p.expira_em, p.criado_em, p.iniciado_em, p.concluido_em,
             CASE WHEN p.status = 'pronto' AND p.expira_em IS NOT NULL AND p.expira_em < now() THEN 'expirado' ELSE p.status END AS status
        FROM erp_relatorio_pedido p
       WHERE p.company_id = p_company_id AND p.solicitante = auth.uid()
       ORDER BY p.criado_em DESC
       LIMIT 50) x), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.fn_relatorio_meus(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_meus(uuid) TO authenticated;

-- Cancelar um pedido que ainda está na fila (só o próprio solicitante).
CREATE OR REPLACE FUNCTION public.fn_relatorio_cancelar(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int; v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  SELECT company_id INTO v_company FROM erp_relatorio_pedido WHERE id = p_id AND solicitante = auth.uid();
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_cancelavel'); END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE erp_relatorio_pedido SET status = 'cancelado', concluido_em = now()
   WHERE id = p_id AND solicitante = auth.uid() AND status = 'na_fila';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok',false,'erro','nao_cancelavel'); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.fn_relatorio_cancelar(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_cancelar(uuid) TO authenticated;

-- ───────────────────────────── RPCs do gerador (só service_role; etapa 2 usa) ─────────────────────────────
-- Pega o próximo pedido da fila (FIFO, SKIP LOCKED: dois geradores nunca pegam o mesmo). Pedido "gerando" há mais de
-- 30 min volta para a fila (até 3 tentativas; depois vira erro).
CREATE OR REPLACE FUNCTION public.fn_relatorio_fila_pegar()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record;
BEGIN
  UPDATE erp_relatorio_pedido SET status = CASE WHEN tentativas >= 3 THEN 'erro' ELSE 'na_fila' END,
         erro = CASE WHEN tentativas >= 3 THEN 'tempo esgotado ao gerar' ELSE erro END
   WHERE status = 'gerando' AND iniciado_em < now() - interval '30 minutes';
  SELECT * INTO v FROM erp_relatorio_pedido WHERE status = 'na_fila' ORDER BY criado_em, id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'pedido',NULL); END IF;
  UPDATE erp_relatorio_pedido SET status = 'gerando', iniciado_em = now(), tentativas = tentativas + 1, progresso = 0, erro = NULL
   WHERE id = v.id;
  RETURN jsonb_build_object('ok',true,'pedido', jsonb_build_object('id',v.id,'company_id',v.company_id,'solicitante',v.solicitante,
    'tipo',v.tipo,'formato',v.formato,'parametros',v.parametros,'titulo',v.titulo));
END $$;
REVOKE ALL ON FUNCTION public.fn_relatorio_fila_pegar() FROM anon, PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_fila_pegar() TO service_role;

-- Atualiza o andamento / conclui (pronto → validade de 7 dias) / registra erro.
-- ci-sem-guarda: fn_relatorio_fila_atualizar — só service_role (gerador da fila, sem usuário logado); o pedido já foi conferido na entrada (fn_relatorio_pedir).
CREATE OR REPLACE FUNCTION public.fn_relatorio_fila_atualizar(p_id uuid, p_status text, p_progresso int DEFAULT NULL,
  p_arquivo_path text DEFAULT NULL, p_tamanho_bytes bigint DEFAULT NULL, p_linhas int DEFAULT NULL, p_erro text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  IF p_status NOT IN ('gerando','pronto','erro') THEN RETURN jsonb_build_object('ok',false,'erro','status_invalido'); END IF;
  IF p_status = 'pronto' AND nullif(p_arquivo_path,'') IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','arquivo_obrigatorio'); END IF;
  UPDATE erp_relatorio_pedido SET
    status = p_status,
    progresso = CASE WHEN p_status = 'pronto' THEN 100 ELSE greatest(0, least(100, coalesce(p_progresso, progresso))) END,
    arquivo_path = coalesce(p_arquivo_path, arquivo_path),
    tamanho_bytes = coalesce(p_tamanho_bytes, tamanho_bytes),
    linhas = coalesce(p_linhas, linhas),
    erro = CASE WHEN p_status = 'erro' THEN left(coalesce(p_erro,'erro ao gerar'), 500) ELSE NULL END,
    expira_em = CASE WHEN p_status = 'pronto' THEN now() + interval '7 days' ELSE expira_em END,
    concluido_em = CASE WHEN p_status IN ('pronto','erro') THEN now() ELSE concluido_em END
  WHERE id = p_id AND status = 'gerando';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok',false,'erro','nao_esta_gerando'); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.fn_relatorio_fila_atualizar(uuid,text,int,text,bigint,int,text) FROM anon, PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_fila_atualizar(uuid,text,int,text,bigint,int,text) TO service_role;

-- ───────────────────────────── Menu / inventário ─────────────────────────────
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, layer, icone, rota, ordem, ativo, is_shared, descricao)
VALUES ('financeiro_meus_relatorios', 'Meus relatórios', 'gestao_empresarial', 'financeiro', 'shared', 'FileDown',
        '/dashboard/financeiro/meus-relatorios', 72, true, true,
        'Relatórios longos gerados em segundo plano: pedir, acompanhar (na fila, gerando, pronto, erro) e baixar; o arquivo vale 7 dias.')
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo,
  layer = EXCLUDED.layer, icone = EXCLUDED.icone, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true,
  is_shared = EXCLUDED.is_shared, descricao = EXCLUDED.descricao;

-- Visível para as mesmas empresas que já têm a Saúde Financeira (tela irmã do financeiro da Gestão Empresarial).
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'financeiro_meus_relatorios' FROM public.plan_modules pm
WHERE pm.module_id = 'financeiro_saude_ge'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'financeiro_meus_relatorios');

INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento,
  rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES ('dashboard.financeiro.meus-relatorios', '/dashboard/financeiro/meus-relatorios', 'gestao_empresarial', 'financeiro',
  'Meus relatórios',
  'Pedidos de relatório em segundo plano da pessoa logada na empresa escolhida: pedir (tipo + período), status (na fila, gerando, pronto, erro, expirado), cancelar o que está na fila e baixar o pronto (validade 7 dias).',
  'parcial', 'media',
  ARRAY['fn_relatorio_pedir','fn_relatorio_meus','fn_relatorio_cancelar']::text[],
  ARRAY['MeusRelatoriosPage']::text[], ARRAY[]::text[])
ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, descricao_funcional = EXCLUDED.descricao_funcional,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas, atualizado_em = now();

-- ───────────────────────────── Ajuda de campo (RD-95) ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Meus relatórios', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/financeiro/meus-relatorios', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('financeiro.meus_relatorios.tipo','Relatório','Escolha qual relatório gerar.','Define o conteúdo do arquivo (movimentação, contas a pagar/receber, DRE ou fluxo).','Movimentação financeira.','—',1),
 ('financeiro.meus_relatorios.data_inicio','De','Primeiro dia do período.','O relatório traz só o que cai a partir desta data.','01/10/2025.','Período maior que 36 meses não é aceito.',2),
 ('financeiro.meus_relatorios.data_fim','Até','Último dia do período.','O relatório traz só o que cai até esta data.','30/09/2026.','Data final antes da inicial.',3),
 ('financeiro.meus_relatorios.formato','Formato','Excel (planilha) ou PDF.','Excel para conferir e filtrar; PDF para imprimir ou enviar.','Excel.','—',4),
 ('financeiro.meus_relatorios.pedir','Gerar em segundo plano','Ação: coloca o pedido na fila. Pode fechar a tela que ele continua.','Não ficar esperando relatórios grandes na tela.','Pedir a movimentação dos últimos 12 meses e seguir trabalhando.','Pedir o mesmo relatório várias vezes (limite de 5 abertos por pessoa).',5),
 ('financeiro.meus_relatorios.status','Situação','Mostra em que ponto está cada pedido: na fila, gerando, pronto, erro ou expirado.','Saber quando o arquivo pode ser baixado.','"Pronto" — botão Baixar liberado.','Achar que "expirado" é erro: o arquivo vale 7 dias; peça de novo.',6),
 ('financeiro.meus_relatorios.baixar','Baixar','Ação: baixa o arquivo pronto (link vale 7 dias).','Pegar o relatório gerado.','Baixar o Excel da movimentação.','—',7),
 ('financeiro.meus_relatorios.cancelar','Cancelar','Ação: tira da fila um pedido que ainda não começou.','Desistir de um pedido feito por engano.','Cancelar um pedido duplicado.','Tentar cancelar um que já está gerando.',8),
 ('financeiro.meus_relatorios.atualizar','Atualizar','Ação: recarrega a lista de pedidos.','Ver a situação mais recente (a tela também atualiza sozinha).','—','—',9)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
