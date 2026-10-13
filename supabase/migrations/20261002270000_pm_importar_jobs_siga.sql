-- PM-J · Importador de jobs do SIGA (CEO 02/10: a Pdois vai mandar a exportação; entra assim que o arquivo chegar).
-- Sem tabela nova. A tela lê a planilha, aplica a regra (60 dias + em aberto, sem os "em aprovação" antigos) e manda as
-- linhas para esta função, que primeiro só CONFERE (p_gravar = false: quantos entram, quantos já existem, clientes e
-- responsáveis que não achou) e só grava quando a pessoa confirma (p_gravar = true).
--
--   · só gestor da empresa importa (fn_acessos_pode_gerir); até 5.000 linhas por vez;
--   · número do SIGA vira agency_jobs.numero (a letra da rodada vira rodada_ajuste) — número que já existe na empresa
--     NÃO é importado de novo (rodar duas vezes não duplica);
--   · cliente: pelo nome exato no cadastro (erp_clientes, nome fantasia ou razão social, só se for único) → perfil P&M
--     por fn_pm_cliente_garantir; senão pelo nome do perfil P&M; senão o job entra sem cliente e o nome vai para a lista;
--   · responsável: usuário da empresa com o nome completo (ou o primeiro nome, se único); senão fica o nome em texto;
--   · peça: pelo nome no catálogo (agency_servico); o texto vai para "tipo";
--   · todo job importado leva a etiqueta "siga". Nada é apagado.

CREATE OR REPLACE FUNCTION public.fn_pm_importar_jobs_siga(p_company_id uuid, p_linhas jsonb, p_gravar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  l jsonb; v_num text; v_cli uuid; v_erp uuid; v_resp uuid; v_resp_nome text; v_srv uuid; v_n int;
  v_total int := 0; v_novos int := 0; v_existem int := 0; v_gravados int := 0;
  v_sem_cli text[] := ARRAY[]::text[]; v_sem_resp text[] := ARRAY[]::text[]; v_sem_peca text[] := ARRAY[]::text[];
  v_status text;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF auth.uid() IS NOT NULL AND NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RAISE EXCEPTION 'Só o gestor da empresa importa jobs' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_linhas) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'erro', 'linhas_invalidas'); END IF;
  IF jsonb_array_length(p_linhas) > 5000 THEN RETURN jsonb_build_object('ok', false, 'erro', 'muitas_linhas', 'mensagem', 'Importe no máximo 5.000 jobs por vez.'); END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(p_linhas) LOOP
    v_total := v_total + 1;
    v_num := NULLIF(btrim(l->>'numero'), '');
    CONTINUE WHEN v_num IS NULL OR v_num !~ '^\d{1,12}$' OR NULLIF(btrim(l->>'titulo'), '') IS NULL;
    IF EXISTS (SELECT 1 FROM agency_jobs WHERE company_id = p_company_id AND numero = v_num) THEN
      v_existem := v_existem + 1; CONTINUE;
    END IF;
    v_novos := v_novos + 1;

    -- cliente
    v_cli := NULL; v_erp := NULL;
    IF NULLIF(btrim(l->>'cliente'), '') IS NOT NULL THEN
      SELECT count(*), min(id::text)::uuid INTO v_n, v_erp FROM erp_clientes
       WHERE company_id = p_company_id AND ativo IS NOT FALSE
         AND (lower(btrim(nome_fantasia)) = lower(btrim(l->>'cliente')) OR lower(btrim(razao_social)) = lower(btrim(l->>'cliente')));
      IF v_n <> 1 THEN
        v_erp := NULL;
        SELECT id INTO v_cli FROM agency_clientes WHERE company_id = p_company_id
           AND lower(COALESCE(NULLIF(btrim(nome_fantasia), ''), btrim(nome))) = lower(btrim(l->>'cliente'))
         ORDER BY erp_cliente_id IS NULL, created_at NULLS LAST LIMIT 1;
        IF v_cli IS NULL AND NOT (btrim(l->>'cliente') = ANY (v_sem_cli)) THEN v_sem_cli := v_sem_cli || btrim(l->>'cliente'); END IF;
      END IF;
    END IF;

    -- responsável
    v_resp := NULL; v_resp_nome := NULLIF(btrim(l->>'responsavel'), '');
    IF v_resp_nome IS NOT NULL THEN
      SELECT count(*), min(u.id::text)::uuid INTO v_n, v_resp FROM user_companies uc JOIN users u ON u.id = uc.user_id
       WHERE uc.company_id = p_company_id AND lower(btrim(u.full_name)) = lower(v_resp_nome);
      IF v_n <> 1 THEN
        SELECT count(*), min(u.id::text)::uuid INTO v_n, v_resp FROM user_companies uc JOIN users u ON u.id = uc.user_id
         WHERE uc.company_id = p_company_id AND lower(split_part(btrim(u.full_name), ' ', 1)) = lower(split_part(v_resp_nome, ' ', 1));
        IF v_n <> 1 THEN
          v_resp := NULL;
          IF NOT (v_resp_nome = ANY (v_sem_resp)) THEN v_sem_resp := v_sem_resp || v_resp_nome; END IF;
        END IF;
      END IF;
    END IF;

    -- peça
    v_srv := NULL;
    IF NULLIF(btrim(l->>'peca'), '') IS NOT NULL THEN
      SELECT id INTO v_srv FROM agency_servico WHERE company_id = p_company_id AND lower(btrim(nome)) = lower(btrim(l->>'peca')) LIMIT 1;
      IF v_srv IS NULL AND NOT (btrim(l->>'peca') = ANY (v_sem_peca)) THEN v_sem_peca := v_sem_peca || btrim(l->>'peca'); END IF;
    END IF;

    IF p_gravar THEN
      IF v_erp IS NOT NULL THEN v_cli := public.fn_pm_cliente_garantir(p_company_id, v_erp); END IF;
      v_status := CASE WHEN l->>'situacao' IN ('nao_iniciada', 'em_producao', 'aguardando', 'em_aprovacao', 'concluida', 'publicado')
                       THEN l->>'situacao' ELSE 'em_producao' END;
      INSERT INTO agency_jobs (company_id, numero, titulo, descricao, tipo, status, cliente_id, servico_id, responsavel_id, responsavel_nome,
                               rodada_ajuste, data_prazo, data_entrega, aguardando_desde, tags, created_at)
      VALUES (p_company_id, v_num, left(btrim(l->>'titulo'), 300), NULLIF(btrim(l->>'briefing'), ''), NULLIF(btrim(l->>'peca'), ''),
              v_status, v_cli, v_srv, v_resp, CASE WHEN v_resp IS NULL THEN v_resp_nome END,
              GREATEST(COALESCE((l->>'rodada')::int, 0), 0),
              CASE WHEN l->>'prazo' ~ '^\d{4}-\d{2}-\d{2}$' THEN (l->>'prazo')::date END,
              CASE WHEN v_status IN ('concluida', 'publicado') AND l->>'prazo' ~ '^\d{4}-\d{2}-\d{2}$' THEN (l->>'prazo')::date END,
              CASE WHEN v_status = 'aguardando' THEN now() END,
              ARRAY['siga'],
              COALESCE(CASE WHEN l->>'criacao' ~ '^\d{4}-\d{2}-\d{2}$' THEN ((l->>'criacao')::date + time '12:00') AT TIME ZONE 'America/Sao_Paulo' END, now()));
      v_gravados := v_gravados + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'gravou', p_gravar, 'total', v_total, 'novos', v_novos, 'ja_existem', v_existem,
    'gravados', v_gravados,
    'clientes_nao_encontrados', to_jsonb(v_sem_cli[1:50]), 'n_clientes_nao_encontrados', COALESCE(array_length(v_sem_cli, 1), 0),
    'responsaveis_nao_encontrados', to_jsonb(v_sem_resp[1:50]), 'n_responsaveis_nao_encontrados', COALESCE(array_length(v_sem_resp, 1), 0),
    'pecas_nao_encontradas', to_jsonb(v_sem_peca[1:50]));
END $$;
REVOKE ALL ON FUNCTION public.fn_pm_importar_jobs_siga(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_importar_jobs_siga(uuid, jsonb, boolean) TO authenticated, service_role;

-- "?" da tela de importação
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Importar do SIGA', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/pm/importar-siga', 'pm', 'publicado'
FROM (VALUES
 ('pm.siga.arquivo', 'Planilha do SIGA', 'Escolha a exportação de jobs do SIGA (Excel ou CSV).', 'Traz para a Pauta os jobs dos últimos 60 dias e todos os que estão em aberto.', 'jobs-siga-outubro.xlsx', 'Mandar a planilha de clientes ou de financeiro: só a de jobs serve.', 70),
 ('pm.siga.mapa', 'Coluna da planilha', 'Confira qual coluna da planilha corresponde a cada campo — o sistema já sugere pelo nome do cabeçalho.', 'Garante que número, título, cliente, responsável e prazo caiam no lugar certo.', '"Nº Job" → Número do job.', 'Trocar Prazo por Data de criação: a janela de 60 dias fica errada.', 71),
 ('pm.siga.previa', 'Prévia', 'Confira os números antes de importar: quantos entram, quantos ficam de fora (e por quê), quantos já existem.', 'Nada é gravado até você confirmar; rodar de novo não duplica.', '312 entram · 58 concluídos há mais de 60 dias ficam fora.', 'Importar sem olhar os clientes não encontrados: esses jobs entram sem cliente.', 72)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
