-- Painel de Codes · separar chamados de CLIENTES dos achados do Code-Auditor (CEO/Eng. Chefe 17/10, tarefa 1a13dc4f). Faixa 00. RD-97.
-- Achado do auditor = chamado da empresa DEMO (companies.is_demo) aberto pelo gilberto-produto na área hub_projetos (PDCA do Hub).
-- 1) Função NOVA só de leitura (equipe PS): bloco "Chamados de clientes" (meta 20 min) × bloco "Achados do auditor".
-- 2) v_chamado_code_responsavel (usada pelos acordadores chamados-plantao-5min, jordana-chamados-5min, rodrigo-chamados-5min via
--    esperando_ps) passa a EXCLUIR os achados do auditor: mesmas colunas, mesma ordem; só ganha o filtro. Não acorda Code à toa.
CREATE OR REPLACE FUNCTION public.fn_dev_codes_chamados_clientes_x_auditor()
RETURNS TABLE(clientes_abertos integer, clientes_acima_meta integer, clientes_mais_antigo_min integer,
              auditor_abertos integer, auditor_corrigidos integer, auditor_total integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT s.status, s.created_at,
           (s.agente = 'gilberto-produto' AND s.area = 'hub_projetos' AND COALESCE(c.is_demo, false)) AS achado
    FROM public.sugestoes s LEFT JOIN public.companies c ON c.id = s.company_id
    WHERE s.status <> 'arquivada' AND s.created_at >= now() - interval '90 days'
  )
  SELECT
    (count(*) FILTER (WHERE NOT achado AND status IN ('nova','em_analise','aceita','em_desenvolvimento')))::integer,
    (count(*) FILTER (WHERE NOT achado AND status IN ('nova','em_analise') AND created_at < now() - interval '20 minutes'))::integer,
    COALESCE(max(floor(extract(epoch FROM now() - created_at) / 60)) FILTER (WHERE NOT achado AND status IN ('nova','em_analise')), 0)::integer,
    (count(*) FILTER (WHERE achado AND status NOT IN ('concluida','aguardando_confirmacao')))::integer,
    (count(*) FILTER (WHERE achado AND status IN ('concluida','aguardando_confirmacao')))::integer,
    (count(*) FILTER (WHERE achado))::integer
  FROM base;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_dev_codes_chamados_clientes_x_auditor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_codes_chamados_clientes_x_auditor() TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_chamado_code_responsavel AS
 SELECT s.id AS sugestao_id,
    s.numero,
    s.status,
    s.company_id,
    COALESCE(c.nome_fantasia, c.razao_social) AS empresa,
    e.nome_curto AS socio_carteira,
        CASE e.agente
            WHEN 'code-jordana'::text THEN 'jordana-code'::text
            WHEN 'code-rodrigo'::text THEN 'rodrigo-code'::text
            ELSE 'gilberto-chamados'::text
        END AS code_responsavel,
        CASE
            WHEN e.agente = ANY (ARRAY['code-jordana'::text, 'code-rodrigo'::text]) THEN 'carteira do sócio'::text
            WHEN e.agente IS NOT NULL THEN 'carteira atendida pelo central'::text
            ELSE 'sem carteira (central)'::text
        END AS regra,
    s.status = ANY (ARRAY['nova'::text, 'em_analise'::text, 'aceita'::text, 'em_desenvolvimento'::text]) AS esperando_ps,
    s.created_at
   FROM sugestoes s
     LEFT JOIN companies c ON c.id = s.company_id
     LEFT JOIN LATERAL ( SELECT cr_1.responsavel_id
           FROM erp_carteira_responsavel cr_1
          WHERE cr_1.company_id = s.company_id AND (cr_1.vigencia_fim IS NULL OR cr_1.vigencia_fim >= CURRENT_DATE)
          ORDER BY cr_1.vigencia_inicio DESC NULLS LAST
         LIMIT 1) cr ON true
     LEFT JOIN erp_chamado_equipe e ON e.user_id = cr.responsavel_id AND e.ativo
  WHERE (s.status <> ALL (ARRAY['concluida'::text, 'arquivada'::text])) AND COALESCE(s.interno, false) = false
    AND NOT (s.agente = 'gilberto-produto' AND s.area = 'hub_projetos' AND COALESCE(c.is_demo, false));

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Codes', v.rotulo, v.o, v.p, v.ex, v.er, v.ordem, '/dashboard/dev/codes', 'dev', 'publicado'
FROM (VALUES
 ('dev.codes.graficos.chamados_clientes', 'Chamados de clientes', 'Nada a preencher: mostra os chamados de clientes ainda esperando a PS (novo, em análise, aceito, em desenvolvimento), quantos passaram da meta de 20 minutos sem primeira resposta e há quantos minutos o mais antigo espera.', 'Mede o atendimento real aos clientes, sem misturar os achados internos do auditor.', '12 abertos, 2 acima da meta, o mais antigo há 35 min.', 'Somar com os achados do auditor: eles têm bloco próprio e não têm SLA de cliente.', 19),
 ('dev.codes.graficos.achados_auditor', 'Achados do auditor (PDCA do Hub)', 'Nada a preencher: mostra os achados que o Code-Auditor abriu na empresa DEMO (abertos e corrigidos) no PDCA do Hub de Projetos.', 'Acompanha o ciclo de auditoria do Hub separado dos chamados de clientes.', '16 abertos, 7 corrigidos, 23 no total.', 'Achar que são clientes esperando resposta: são chamados internos de teste e não acordam os Codes de chamados.', 20)
) AS v(chave, rotulo, o, p, ex, er, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
