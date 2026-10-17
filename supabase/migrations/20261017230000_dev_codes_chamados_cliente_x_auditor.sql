-- Painel de Codes · chamados de CLIENTES × achados do Code-Auditor (CEO/Eng. Chefe 17/10, tarefa 1a13dc4f). Faixa 00. RD-97.
-- Os achados do auditor (empresa DEMO, área hub_projetos, agente gilberto-produto) inflavam os "chamados abertos" (30 -> 43) e
-- acordavam os Codes de chamados à toa. Auditor = interno OU (DEMO + hub_projetos + gilberto-produto).
-- 1) v_chamado_code_responsavel: mesmas colunas, mesma ordem; só ganha a exclusão do auditor (acordadores param de acordar).
-- 2) fn_dev_codes_chamados_cliente_x_auditor(): função NOVA só de leitura, dois blocos distintos para o painel.
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
  WHERE (s.status <> ALL (ARRAY['concluida'::text, 'arquivada'::text]))
    AND COALESCE(s.interno, false) = false
    AND NOT (s.agente = 'gilberto-produto' AND s.area = 'hub_projetos' AND s.company_id = 'b0700000-0000-4000-a000-000000000006'::uuid);

CREATE OR REPLACE FUNCTION public.fn_dev_codes_chamados_cliente_x_auditor()
RETURNS TABLE(cliente_abertos integer, cliente_esperando_ps integer, cliente_esperando_cliente integer,
              auditor_abertos integer, auditor_em_correcao integer, auditor_corrigidos integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  RETURN QUERY
  WITH b AS (
    SELECT s.status,
           (COALESCE(s.interno, false) OR (s.agente = 'gilberto-produto' AND s.area = 'hub_projetos'
              AND s.company_id = 'b0700000-0000-4000-a000-000000000006'::uuid)) AS auditor
    FROM public.sugestoes s
    WHERE s.status <> ALL (ARRAY['arquivada'::text])
      AND (s.status <> 'concluida' OR s.concluido_em >= now() - interval '30 days')
  )
  SELECT
    (count(*) FILTER (WHERE NOT auditor AND status <> 'concluida'))::integer,
    (count(*) FILTER (WHERE NOT auditor AND status IN ('nova','em_analise','aceita','em_desenvolvimento')))::integer,
    (count(*) FILTER (WHERE NOT auditor AND status = 'aguardando_confirmacao'))::integer,
    (count(*) FILTER (WHERE auditor AND status <> 'concluida'))::integer,
    (count(*) FILTER (WHERE auditor AND status IN ('em_analise','aceita','em_desenvolvimento')))::integer,
    (count(*) FILTER (WHERE auditor AND status IN ('aguardando_confirmacao','concluida')))::integer
  FROM b;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_dev_codes_chamados_cliente_x_auditor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_codes_chamados_cliente_x_auditor() TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Codes', v.rotulo, 'Nada a preencher: o painel conta sozinho.', v.para, v.ex, v.erro, v.ordem, '/dashboard/dev/codes', 'dev', 'publicado'
FROM (VALUES
 ('dev.codes.graficos.chamados_clientes', 'Chamados de clientes', 'Chamados abertos por clientes reais, sem os achados do auditor: quantos esperam a PS e quantos esperam o cliente confirmar.', '30 abertos: 12 esperando a PS e 18 esperando o cliente.', 'Somar os achados do auditor aos chamados de clientes: eles ficam no bloco ao lado.', 19),
 ('dev.codes.graficos.achados_auditor', 'Achados do auditor (PDCA do Hub)', 'Achados internos do Code-Auditor na empresa de demonstração: abertos, em correção e corrigidos nos últimos 30 dias. Não contam como chamado de cliente nem acordam os Codes de chamados.', '22 abertos, 3 em correção, 6 corrigidos.', 'Achar que há cliente esperando: são testes internos do Hub.', 20)
) AS v(chave, rotulo, para, ex, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
