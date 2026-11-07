-- Chamado #5167 (CRÍTICO · fiscal) · NF-e de REMESSA de bem do ATIVO IMOBILIZADO — ETAPA (b)
-- ====================================================================================================================
-- Etapa (a) (#3986, já na main) acrescentou os CFOP de SAÍDA 5.554/6.554 + o tipo de remessa "Ativo imobilizado
-- (uso fora do estabelecimento)" ao catálogo global, reusando o emissor de NF-e existente — a empresa já consegue
-- EMITIR a remessa de saída pela tela /dashboard/fiscal/nfe/remessa.
--
-- ETAPA (b) fecha o ciclo da operação:
--   3) RETORNO (quando o bem volta): CFOP de ENTRADA 1.554 (dentro do estado) / 2.554 (fora do estado).
--      O retorno é uma operação de ENTRADA — ou o detentor emite a nota de volta (chega como NF-e recebida, sem
--      campo de referência à chave da remessa), ou a própria empresa emite uma NOTA DE ENTRADA referenciando a
--      chave da remessa. Para fechar o ciclo de forma auditável nos dois casos, esta etapa cria o REGISTRO DE
--      RETORNO: o operador informa a chave/numero da nota de volta e o CFOP 1.554/2.554; o registro fica ligado à
--      remessa de saída. Quem emite a nota de entrada referenciando a chave da remessa é detectado automaticamente.
--   4) CONTROLE "em remessa" (saiu e não voltou): RPC de leitura que, em Notas Emitidas, lista as remessas de ativo
--      imobilizado emitidas (autorizadas) e marca cada uma como "em remessa" ou "retornada", com os dias fora.
--
-- SEGURANÇA / RD-38:
--   · ADITIVA: cria 1 tabela NOVA (erp_fiscal_remessa_ativo_retorno) + 2 funções NOVAS. Não altera/apaga tabela,
--     função, RLS, grant ou dado de cliente existente. Não toca o emissor nem o financeiro.
--   · RLS por company_id (get_user_company_ids()/is_admin()), sem policy permissiva; REVOKE anon; GRANT só
--     authenticated. Escrita só pela RPC SECURITY DEFINER com guarda de empresa fail-closed (sem acesso → exceção).
--   · Nenhum campo de custo/margem/preço de custo. O controle é só leitura do que já existe em erp_nfe_emitidas.
--   · Homologação: não liga produção fiscal real; só registra e exibe o ciclo da operação já emitida pelo emissor.

-- --------------------------------------------------------------------------------------------------------------------
-- 1) Tabela de REGISTRO DE RETORNO da remessa de ativo imobilizado
-- --------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_fiscal_remessa_ativo_retorno (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  remessa_nfe_id   uuid NOT NULL REFERENCES public.erp_nfe_emitidas(id) ON DELETE CASCADE,
  remessa_chave    text,
  retorno_cfop     text NOT NULL CHECK (retorno_cfop IN ('1554', '2554')),
  retorno_chave    text,
  retorno_numero   text,
  data_retorno     date NOT NULL,
  observacao       text,
  criado_por       uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_fiscal_remessa_ativo_retorno_unq UNIQUE (company_id, remessa_nfe_id)
);

CREATE INDEX IF NOT EXISTS ix_remessa_ativo_retorno_company
  ON public.erp_fiscal_remessa_ativo_retorno (company_id, remessa_nfe_id);

ALTER TABLE public.erp_fiscal_remessa_ativo_retorno ENABLE ROW LEVEL SECURITY;

-- Isolamento multi-tenant: só a própria empresa (ou admin). Sem policy permissiva (qual=true).
DROP POLICY IF EXISTS remessa_ativo_retorno_rls ON public.erp_fiscal_remessa_ativo_retorno;
CREATE POLICY remessa_ativo_retorno_rls ON public.erp_fiscal_remessa_ativo_retorno
  FOR ALL
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

REVOKE ALL ON public.erp_fiscal_remessa_ativo_retorno FROM anon;
GRANT SELECT ON public.erp_fiscal_remessa_ativo_retorno TO authenticated;

COMMENT ON TABLE public.erp_fiscal_remessa_ativo_retorno IS
  'Chamado #5167 etapa (b): registro do RETORNO de uma remessa de ativo imobilizado (CFOP 1554/2554), ligado à NF-e de saída. Fecha o controle "saiu e não voltou". Escrita só por fn_fiscal_remessa_ativo_retorno_registrar.';

-- --------------------------------------------------------------------------------------------------------------------
-- 2) CONTROLE "em remessa" — leitura (Notas Emitidas): o que saiu (5554/6554) e se já voltou (1554/2554)
-- --------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_fiscal_remessa_ativo_em_aberto(
  p_company_id uuid,
  p_de date DEFAULT NULL,
  p_ate date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
  v_abertas int;
  v_retornadas int;
BEGIN
  -- Guarda de empresa FAIL-CLOSED: sem login ou sem acesso à empresa → nada.
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  WITH remessas AS (
    SELECT e.id,
           e.chave,
           e.numero,
           COALESCE(e.data_emissao, e.criado_em) AS data_emissao,
           e.destinatario_razao_social,
           e.valor_total,
           -- CFOP de saída da remessa (primeiro item 5554/6554, se houver)
           (SELECT it->>'cfop' FROM jsonb_array_elements(COALESCE(e.itens, '[]'::jsonb)) it
             WHERE it->>'cfop' IN ('5554','6554') LIMIT 1) AS cfop_saida
      FROM public.erp_nfe_emitidas e
     WHERE e.company_id = p_company_id
       AND e.status = 'autorizada'
       AND (
            e.natureza_operacao ILIKE '%ativo imobilizado%'
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(e.itens, '[]'::jsonb)) it
                        WHERE it->>'cfop' IN ('5554','6554'))
           )
       AND (p_de  IS NULL OR COALESCE(e.data_emissao, e.criado_em) >= p_de::timestamptz)
       AND (p_ate IS NULL OR COALESCE(e.data_emissao, e.criado_em) <  (p_ate + 1)::timestamptz)
  ),
  avaliada AS (
    SELECT r.*,
      -- retornada se: (a) registro manual de retorno OU (b) nota de ENTRADA emitida referenciando a chave da remessa
      (
        EXISTS (SELECT 1 FROM public.erp_fiscal_remessa_ativo_retorno t
                 WHERE t.company_id = p_company_id AND t.remessa_nfe_id = r.id)
        OR EXISTS (SELECT 1 FROM public.erp_nfe_emitidas re
                    WHERE re.company_id = p_company_id
                      AND re.status = 'autorizada'
                      AND r.chave IS NOT NULL
                      AND re.chave_referenciada = r.chave
                      AND (re.natureza_operacao ILIKE '%retorno%'
                           OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(re.itens, '[]'::jsonb)) it
                                       WHERE it->>'cfop' IN ('1554','2554'))))
      ) AS retornada,
      (SELECT to_jsonb(t) FROM public.erp_fiscal_remessa_ativo_retorno t
        WHERE t.company_id = p_company_id AND t.remessa_nfe_id = r.id) AS retorno
      FROM remessas r
  )
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'nfe_id', a.id,
        'chave', a.chave,
        'numero', a.numero,
        'data_emissao', a.data_emissao,
        'destinatario', a.destinatario_razao_social,
        'valor_total', a.valor_total,
        'cfop_saida', a.cfop_saida,
        'retornada', a.retornada,
        'dias_fora', CASE WHEN a.retornada THEN NULL
                          ELSE GREATEST(0, (CURRENT_DATE - a.data_emissao::date)) END,
        'retorno', a.retorno
      )
      ORDER BY a.retornada ASC, a.data_emissao DESC
    ),
    count(*) FILTER (WHERE NOT a.retornada),
    count(*) FILTER (WHERE a.retornada)
    INTO v_rows, v_abertas, v_retornadas
  FROM avaliada a;

  RETURN jsonb_build_object(
    'ok', true,
    'em_aberto', COALESCE(v_abertas, 0),
    'retornadas', COALESCE(v_retornadas, 0),
    'remessas', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_fiscal_remessa_ativo_em_aberto(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_remessa_ativo_em_aberto(uuid, date, date) TO authenticated, service_role;

-- --------------------------------------------------------------------------------------------------------------------
-- 3) Registrar o RETORNO de uma remessa de ativo imobilizado (CFOP 1554/2554) — fecha "saiu e não voltou"
-- --------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_fiscal_remessa_ativo_retorno_registrar(
  p_company_id    uuid,
  p_remessa_nfe_id uuid,
  p_retorno_cfop  text,
  p_data_retorno  date,
  p_retorno_chave text DEFAULT NULL,
  p_retorno_numero text DEFAULT NULL,
  p_observacao    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_remessa record;
  v_id uuid;
BEGIN
  -- Guarda de empresa CANÔNICA (conferidor reconhecido pelo gate check-fn-guards, regra 4):
  -- fail-closed, levanta 42501 quando o usuário logado não tem acesso à empresa.
  PERFORM public.fn__guarda_empresa(p_company_id);
  -- Guarda de empresa FAIL-CLOSED (mantida p/ o contrato 'sem_acesso' que o componente e o gate esperam)
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- CFOP de entrada do retorno: só 1554 (dentro) / 2554 (fora)
  IF COALESCE(p_retorno_cfop, '') NOT IN ('1554', '2554') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cfop_retorno_invalido',
      'mensagem', 'O retorno de ativo imobilizado usa CFOP 1.554 (dentro do estado) ou 2.554 (fora do estado).');
  END IF;

  IF p_data_retorno IS NULL OR p_data_retorno > CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'data_invalida',
      'mensagem', 'Informe a data em que o bem voltou (não pode ser futura).');
  END IF;

  -- A remessa tem de ser desta empresa, autorizada e de ativo imobilizado
  SELECT e.id, e.chave, e.status, e.natureza_operacao, e.itens
    INTO v_remessa
    FROM public.erp_nfe_emitidas e
   WHERE e.id = p_remessa_nfe_id AND e.company_id = p_company_id
   LIMIT 1;

  IF v_remessa.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'remessa_nao_encontrada',
      'mensagem', 'A remessa não foi encontrada nesta empresa.');
  END IF;
  IF v_remessa.status <> 'autorizada' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'remessa_nao_autorizada',
      'mensagem', 'Só é possível registrar o retorno de uma remessa autorizada.');
  END IF;
  IF NOT (v_remessa.natureza_operacao ILIKE '%ativo imobilizado%'
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_remessa.itens, '[]'::jsonb)) it
                      WHERE it->>'cfop' IN ('5554','6554'))) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_remessa_ativo',
      'mensagem', 'Esta nota não é uma remessa de ativo imobilizado (CFOP 5.554/6.554).');
  END IF;

  INSERT INTO public.erp_fiscal_remessa_ativo_retorno
    (company_id, remessa_nfe_id, remessa_chave, retorno_cfop, retorno_chave, retorno_numero, data_retorno, observacao, criado_por)
  VALUES
    (p_company_id, p_remessa_nfe_id, v_remessa.chave, p_retorno_cfop,
     NULLIF(btrim(p_retorno_chave), ''), NULLIF(btrim(p_retorno_numero), ''), p_data_retorno,
     NULLIF(btrim(p_observacao), ''), auth.uid())
  ON CONFLICT (company_id, remessa_nfe_id) DO UPDATE SET
     retorno_cfop   = EXCLUDED.retorno_cfop,
     retorno_chave  = EXCLUDED.retorno_chave,
     retorno_numero = EXCLUDED.retorno_numero,
     data_retorno   = EXCLUDED.data_retorno,
     observacao     = EXCLUDED.observacao,
     atualizado_em  = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'retorno_id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_fiscal_remessa_ativo_retorno_registrar(uuid, uuid, text, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_remessa_ativo_retorno_registrar(uuid, uuid, text, date, text, text, text) TO authenticated, service_role;

-- --------------------------------------------------------------------------------------------------------------------
-- 4) Ajuda de campo (RD-95) — "?" dos indicadores/ações do controle (tela /dashboard/fiscal/nfe)
-- --------------------------------------------------------------------------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('fiscal.remessa_ativo.painel','/dashboard/fiscal/nfe','Remessa de ativo imobilizado','Em remessa (saiu e não voltou)','Nada a preencher: é a lista das remessas de ativo imobilizado (CFOP 5.554/6.554) que saíram e ainda não tiveram o retorno registrado.','Mostra o que está fora do estabelecimento para você cobrar o retorno e não perder o controle do bem.','Furadeira de bancada enviada para a obra em 10/10 — 28 dias fora.','Achar que a nota de saída some sozinha: ela só sai da lista quando o retorno é registrado (CFOP 1.554/2.554) ou a nota de entrada referencia a chave da remessa.','fiscal',10,'publicado'),
 ('fiscal.remessa_ativo.dias_fora','/dashboard/fiscal/nfe','Remessa de ativo imobilizado','Dias fora','Nada a preencher: é a diferença entre hoje e a data da remessa de saída.','Prioriza o que está fora há mais tempo.','28 dias.','Confundir com prazo fiscal: é só um indicador de controle, não um vencimento legal.','fiscal',20,'publicado'),
 ('fiscal.remessa_ativo.registrar_retorno','/dashboard/fiscal/nfe','Remessa de ativo imobilizado','Registrar retorno','Informe o CFOP do retorno (1.554 dentro do estado, 2.554 fora), a data em que o bem voltou e, se houver, a chave/numero da nota de entrada.','Fecha o ciclo: a remessa sai de "em remessa" e passa a "retornada", com histórico de quando e por quem.','CFOP 1.554, voltou em 07/11, nota de entrada 000.123.','Usar CFOP de saída (5.554/6.554) no retorno — o retorno é entrada: 1.554/2.554.','fiscal',30,'publicado'),
 ('fiscal.remessa_ativo.retorno_cfop','/dashboard/fiscal/nfe','Remessa de ativo imobilizado','CFOP do retorno','1.554 quando o bem volta de dentro do estado; 2.554 quando volta de fora do estado.','Classifica a entrada do retorno conforme a origem.','1.554 — o equipamento voltou de uma obra no mesmo estado.','Repetir o CFOP da remessa (5.554/6.554): aqui é o CFOP de ENTRADA.','fiscal',40,'publicado'),
 ('fiscal.remessa_ativo.data_retorno','/dashboard/fiscal/nfe','Remessa de ativo imobilizado','Voltou em','A data em que o bem efetivamente voltou para o estabelecimento.','Fecha o período em que o bem ficou fora e marca a remessa como retornada.','07/11/2026','Informar a data de hoje por hábito quando o bem voltou noutro dia — ou uma data futura (o sistema recusa).','fiscal',50,'publicado'),
 ('fiscal.remessa_ativo.nota_entrada','/dashboard/fiscal/nfe','Remessa de ativo imobilizado','Nota de entrada do retorno','Opcional: o número e/ou a chave de 44 dígitos da nota de entrada que acompanhou o retorno do bem.','Liga o retorno ao documento fiscal da entrada, para auditoria.','Nº 000.123 · chave 3526...0001.','Preencher com a chave da própria remessa de saída — aqui é a nota de ENTRADA do retorno.','fiscal',60,'publicado'),
 ('fiscal.remessa_ativo.observacao','/dashboard/fiscal/nfe','Remessa de ativo imobilizado','Observação','Opcional: uma nota curta sobre o retorno (de onde voltou, condição do bem).','Dá contexto ao histórico do retorno.','Voltou da obra Canteiro Norte, sem avarias.','—','fiscal',70,'publicado')
ON CONFLICT (chave) DO NOTHING;

-- --------------------------------------------------------------------------------------------------------------------
-- 5) Seed DEMO — REMOVIDO (conserto-main, gilberto-esteira 07/11)
-- --------------------------------------------------------------------------------------------------------------------
-- O seed original inseria uma NF-e de remessa fictícia na empresa DEMO Indústria
-- (b0700000-0000-4000-a000-000000000005). Essa empresa tem companies.ambiente_tenant='auditoria',
-- e o guard fiscal fn_bloqueia_emissao_nao_produtiva (trigger trg_bloqueia_emissao_demo em
-- erp_nfe_emitidas) BLOQUEIA qualquer linha de NF-e emitida para empresa não-produção
-- ("Operacao real bloqueada: esta empresa e de auditoria", SQLSTATE 23514). O seed por isso
-- NUNCA aplica e derrubava o deploy-migrations (run 42409935665, commit f7a1f10).
-- Por design fiscal nenhuma empresa DEMO/auditoria tem NF-e emitida, então a tela de controle
-- mostra o estado vazio em DEMO (RD-95). O guard NÃO é alterado. Só o seed foi removido:
-- o corpo aditivo acima (tabela + 2 funções + ajuda RD-95) é o mesmo da PR #4041 revisada.
