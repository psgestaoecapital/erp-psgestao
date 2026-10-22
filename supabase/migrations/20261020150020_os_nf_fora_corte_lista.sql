-- Chamado #2167 (complemento · Gean, vale para todas as mecânicas): situação da NF-e/NFS-e em cada OS da LISTA,
-- marcação "NF fora da OS" e data de corte do controle por empresa. Aditivo: 2 tabelas novas (RLS por empresa,
-- leitura só da própria empresa, gravação só pelas funções com guarda), 5 funções novas e os "?" (RD-95).
-- Não altera nenhuma nota (erp_nfe_emitidas / erp_nfse_emitidas): o vínculo com nota do sistema fica nesta tabela.

-- ── "NF fora da OS": a nota desta OS foi emitida fora dela (antes do vínculo automático, pelo OMIE, avulsa…) ──────────
CREATE TABLE IF NOT EXISTS public.erp_os_nf_fora (
  os_id        uuid PRIMARY KEY REFERENCES public.erp_os(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tipo         text CHECK (tipo IN ('nfe', 'nfse')),
  numero       text,
  data_nota    date,
  chave        text,
  pdf_url      text,
  observacao   text,
  nfe_id       uuid REFERENCES public.erp_nfe_emitidas(id) ON DELETE SET NULL,
  nfse_id      uuid REFERENCES public.erp_nfse_emitidas(id) ON DELETE SET NULL,
  marcado_por  uuid,
  marcado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_erp_os_nf_fora_company ON public.erp_os_nf_fora (company_id);

-- ── Data de corte por empresa: OS concluída antes dela fica "anterior ao controle" (sem alerta de NF pendente) ───────
CREATE TABLE IF NOT EXISTS public.erp_os_nf_controle (
  company_id     uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  data_corte     date,
  atualizado_por uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.erp_os_nf_fora ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_os_nf_controle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_os_nf_fora, public.erp_os_nf_controle FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.erp_os_nf_fora, public.erp_os_nf_controle TO authenticated;
DROP POLICY IF EXISTS erp_os_nf_fora_ler ON public.erp_os_nf_fora;
CREATE POLICY erp_os_nf_fora_ler ON public.erp_os_nf_fora FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS erp_os_nf_controle_ler ON public.erp_os_nf_controle;
CREATE POLICY erp_os_nf_controle_ler ON public.erp_os_nf_controle FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
-- Escrita: nenhuma policy → só pelas funções abaixo (SECURITY DEFINER com guarda de empresa).

-- ── Situação da NF de TODAS as OS da empresa numa chamada só (lista rápida: agregação por empresa, sem 1 consulta/OS) ─
CREATE OR REPLACE FUNCTION public.fn_os_nf_situacao(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;

  WITH nfe AS (
    SELECT n.os_id,
           jsonb_agg(jsonb_build_object('id', n.id, 'numero', n.numero) ORDER BY n.criado_em) FILTER (WHERE n.status = 'autorizada') AS aut,
           bool_or(n.status IN ('processando', 'pendente', 'enviada')) AS proc,
           bool_or(n.status IN ('rejeitada', 'erro')) AS rej
      FROM erp_nfe_emitidas n
     WHERE n.company_id = p_company_id AND n.os_id IS NOT NULL
     GROUP BY n.os_id
  ), nfse AS (
    SELECT n.os_id,
           jsonb_agg(jsonb_build_object('id', n.id, 'numero', n.numero) ORDER BY n.criado_em) FILTER (WHERE n.status = 'autorizada') AS aut,
           bool_or(n.status IN ('processando', 'pendente', 'enviada')) AS proc,
           bool_or(n.status IN ('rejeitada', 'erro')) AS rej
      FROM erp_nfse_emitidas n
     WHERE n.company_id = p_company_id AND n.os_id IS NOT NULL
     GROUP BY n.os_id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'data_corte', (SELECT c.data_corte FROM erp_os_nf_controle c WHERE c.company_id = p_company_id),
    'itens', COALESCE(jsonb_agg(jsonb_build_object(
      'os_id', o.id,
      -- data que vale para o corte: entrega; sem entrega, conclusão; sem as duas, abertura
      'data_ref', COALESCE((o.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date, o.data_conclusao, o.data_abertura, o.created_at::date),
      'tem_valor', (COALESCE(o.total, 0) > 0 OR COALESCE(o.valor_servico, 0) > 0 OR COALESCE(o.valor_materiais, 0) > 0),
      'nfe', COALESCE(a.aut, '[]'::jsonb),
      'nfse', COALESCE(b.aut, '[]'::jsonb),
      'processando', COALESCE(a.proc, false) OR COALESCE(b.proc, false),
      'rejeitada', COALESCE(a.rej, false) OR COALESCE(b.rej, false),
      'fora', CASE WHEN f.os_id IS NULL THEN NULL ELSE jsonb_build_object(
        'tipo', f.tipo, 'numero', f.numero, 'data_nota', f.data_nota, 'chave', f.chave, 'pdf_url', f.pdf_url,
        'observacao', f.observacao, 'nfe_id', f.nfe_id, 'nfse_id', f.nfse_id, 'marcado_em', f.marcado_em) END
    )), '[]'::jsonb)
  ) INTO v
  FROM erp_os o
  LEFT JOIN nfe a ON a.os_id = o.id
  LEFT JOIN nfse b ON b.os_id = o.id
  LEFT JOIN erp_os_nf_fora f ON f.os_id = o.id
  WHERE o.company_id = p_company_id
    AND NOT COALESCE(o.excluida, false)
    AND (o.status IN ('pronta', 'entregue') OR a.os_id IS NOT NULL OR b.os_id IS NOT NULL OR f.os_id IS NOT NULL);

  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.fn_os_nf_situacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_nf_situacao(uuid) TO authenticated, service_role;

-- ── Notas autorizadas do CLIENTE da OS ainda sem OS (para vincular na marcação "NF fora da OS") ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_os_nf_notas_sem_os(p_os_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_doc text; v jsonb;
BEGIN
  SELECT o.company_id, NULLIF(regexp_replace(COALESCE(c.cpf_cnpj, ''), '\D', '', 'g'), '')
    INTO v_company, v_doc
    FROM erp_os o LEFT JOIN erp_clientes c ON c.id = o.cliente_id
   WHERE o.id = p_os_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF v_doc IS NULL THEN RETURN jsonb_build_object('ok', true, 'notas', '[]'::jsonb); END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'data_emissao' DESC NULLS LAST), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object('tipo', 'nfe', 'id', n.id, 'numero', n.numero, 'data_emissao', n.data_emissao) AS x
      FROM erp_nfe_emitidas n
     WHERE n.company_id = v_company AND n.os_id IS NULL AND n.status = 'autorizada'
       AND regexp_replace(COALESCE(n.destinatario_cnpj, n.destinatario_cpf, ''), '\D', '', 'g') = v_doc
    UNION ALL
    SELECT jsonb_build_object('tipo', 'nfse', 'id', n.id, 'numero', n.numero, 'data_emissao', n.data_emissao)
      FROM erp_nfse_emitidas n
     WHERE n.company_id = v_company AND n.os_id IS NULL AND n.status = 'autorizada'
       AND regexp_replace(COALESCE(n.tomador_cnpj, n.tomador_cpf, ''), '\D', '', 'g') = v_doc
    LIMIT 60
  ) s;
  RETURN jsonb_build_object('ok', true, 'notas', v);
END $$;
REVOKE ALL ON FUNCTION public.fn_os_nf_notas_sem_os(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_nf_notas_sem_os(uuid) TO authenticated, service_role;

-- ── Marcar / desmarcar "NF fora da OS" (campos todos opcionais; registra quem marcou e quando) ──────────────────────
CREATE OR REPLACE FUNCTION public.fn_os_nf_fora_marcar(p_os_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_tipo text; v_nfe uuid; v_nfse uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_os WHERE id = p_os_id AND NOT COALESCE(excluida, false);
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT is_admin() AND public.fn_oficina_papel(v_company) = 'OFICINA_MECANICO' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só a gestão da oficina marca a nota fora da OS.');
  END IF;

  v_tipo := NULLIF(p_dados->>'tipo', '');
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('nfe', 'nfse') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Tipo da nota inválido (NF-e ou NFS-e).');
  END IF;
  -- vínculo com nota do sistema: só nota AUTORIZADA da MESMA empresa e ainda sem OS
  v_nfe := NULLIF(p_dados->>'nfe_id', '')::uuid;
  v_nfse := NULLIF(p_dados->>'nfse_id', '')::uuid;
  IF v_nfe IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_nfe_emitidas WHERE id = v_nfe AND company_id = v_company AND status = 'autorizada' AND os_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'NF-e não encontrada nesta empresa (ou já ligada a uma OS).');
  END IF;
  IF v_nfse IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_nfse_emitidas WHERE id = v_nfse AND company_id = v_company AND status = 'autorizada' AND os_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'NFS-e não encontrada nesta empresa (ou já ligada a uma OS).');
  END IF;

  INSERT INTO erp_os_nf_fora (os_id, company_id, tipo, numero, data_nota, chave, pdf_url, observacao, nfe_id, nfse_id, marcado_por, marcado_em)
  VALUES (p_os_id, v_company, v_tipo, NULLIF(btrim(p_dados->>'numero'), ''), NULLIF(p_dados->>'data_nota', '')::date,
          NULLIF(btrim(p_dados->>'chave'), ''), NULLIF(btrim(p_dados->>'pdf_url'), ''), NULLIF(btrim(p_dados->>'observacao'), ''),
          v_nfe, v_nfse, auth.uid(), now())
  ON CONFLICT (os_id) DO UPDATE SET
    tipo = EXCLUDED.tipo, numero = EXCLUDED.numero, data_nota = EXCLUDED.data_nota, chave = EXCLUDED.chave,
    pdf_url = EXCLUDED.pdf_url, observacao = EXCLUDED.observacao, nfe_id = EXCLUDED.nfe_id, nfse_id = EXCLUDED.nfse_id,
    marcado_por = EXCLUDED.marcado_por, marcado_em = EXCLUDED.marcado_em;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_os_nf_fora_marcar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_nf_fora_marcar(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_os_nf_fora_desmarcar(p_os_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_os_nf_fora WHERE os_id = p_os_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', true); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT is_admin() AND public.fn_oficina_papel(v_company) = 'OFICINA_MECANICO' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só a gestão da oficina desfaz a marcação.');
  END IF;
  DELETE FROM erp_os_nf_fora WHERE os_id = p_os_id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_os_nf_fora_desmarcar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_nf_fora_desmarcar(uuid) TO authenticated, service_role;

-- ── Data de corte do controle (NULL = sem corte: toda OS pronta/entregue com valor entra no controle) ───────────────
CREATE OR REPLACE FUNCTION public.fn_os_nf_corte_definir(p_company_id uuid, p_data_corte date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT is_admin() AND public.fn_oficina_papel(p_company_id) = 'OFICINA_MECANICO' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só a gestão da oficina muda a data de corte.');
  END IF;
  INSERT INTO erp_os_nf_controle (company_id, data_corte, atualizado_por, atualizado_em)
  VALUES (p_company_id, p_data_corte, auth.uid(), now())
  ON CONFLICT (company_id) DO UPDATE SET data_corte = EXCLUDED.data_corte, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now();
  RETURN jsonb_build_object('ok', true, 'data_corte', p_data_corte);
END $$;
REVOKE ALL ON FUNCTION public.fn_os_nf_corte_definir(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_nf_corte_definir(uuid, date) TO authenticated, service_role;

-- Gean Auto Mecânica: controle de NF pela OS a partir de 01/10/2026 (pedido da Jordana no chamado #2167)
INSERT INTO public.erp_os_nf_controle (company_id, data_corte)
SELECT id, DATE '2026-10-01' FROM public.companies WHERE id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
ON CONFLICT (company_id) DO NOTHING;

-- ── "?" (RD-95) ──────────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Ordens de Serviço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/os', 'oficina', 'publicado'
FROM (VALUES
  ('os.lista.nota_fiscal', 'Nota fiscal da OS (etiquetas da lista)',
   'Não precisa preencher: a etiqueta aparece sozinha em cada OS.',
   'Mostra, sem abrir a OS, se ela já tem nota: verde = NF-e/NFS-e autorizada (toque para abrir o PDF); azul = nota emitida fora da OS; amarelo = NF pendente; vermelho = nota rejeitada; cinza = processando ou anterior ao controle.',
   '"NF-e 656 ✓" e "NFS-e 132 ✓" = as duas notas autorizadas. "NF pendente" = OS pronta/entregue com valor e sem nota.',
   'OS concluída antes da data de corte da empresa aparece como "anterior ao controle" e não entra em NF pendente.',
   42),
  ('os.filtro.nf_pendente', 'Filtro: NF pendente',
   'Toque em "NF pendente" para ver só as OS que ainda precisam de nota.',
   'Lista as OS prontas ou entregues, com valor, sem nota autorizada ligada e sem a marcação "NF fora da OS", concluídas a partir da data de corte.',
   'Abra cada OS da lista e emita a nota, ou marque "NF fora da OS" se ela já foi emitida por outro caminho.',
   'Nota rejeitada continua pendente até ser autorizada.',
   43),
  ('os.nf_corte', 'Controle de NF desde',
   'A data a partir da qual as OS concluídas entram no controle de nota. Deixe vazio para controlar todas.',
   'Evita alerta de "NF pendente" para OS antigas, faturadas antes do vínculo automático da nota com a OS.',
   'Gean: 01/10/2026 — OS entregues antes disso aparecem como "anterior ao controle".',
   'Colocar uma data futura esconde as pendências de hoje.',
   44),
  ('os.nf_fora.marcar', 'NF fora da OS',
   'Use quando a nota desta OS foi emitida por outro caminho (outro sistema, nota avulsa, antes do vínculo). Todos os campos são opcionais.',
   'Tira a OS do "NF pendente" e mostra a etiqueta azul "NF fora da OS" na lista. Fica registrado quem marcou e quando.',
   'Nota 1234 emitida pelo OMIE em 20/09: marque, informe tipo NF-e, número 1234 e a data.',
   'Se a nota foi emitida aqui no sistema, escolha-a em "Vincular nota do sistema" para o PDF abrir pela lista.',
   45),
  ('os.nf_fora.tipo', 'Tipo da nota',
   'NF-e (peças/produtos) ou NFS-e (serviços). Opcional.',
   'Mostra na etiqueta qual nota foi emitida fora da OS.',
   'NFS-e para a mão de obra cobrada.',
   'Deixar em branco não impede a marcação.',
   46),
  ('os.nf_fora.numero', 'Número da nota',
   'O número impresso na nota. Opcional.',
   'Aparece na etiqueta: "NF fora da OS · nº 1234".',
   '1234',
   'Não confundir com o número da OS.',
   47),
  ('os.nf_fora.data', 'Data da nota',
   'Data de emissão da nota. Opcional.',
   'Ajuda a conferir a nota depois, na auditoria.',
   '20/09/2026',
   'Não é a data da OS.',
   48),
  ('os.nf_fora.chave', 'Chave de acesso',
   'Os 44 números da chave da NF-e (ou o código de verificação da NFS-e). Opcional.',
   'Permite localizar a nota no portal da SEFAZ ou da prefeitura.',
   '4326 1012 3456 7800 0190 5500 1000 0012 3410 0000 1234',
   'Colar com espaços não tem problema.',
   49),
  ('os.nf_fora.pdf', 'Link do PDF',
   'Endereço (link) do PDF da nota, se ele estiver guardado em algum lugar. Opcional.',
   'Na lista, tocar na etiqueta azul abre este PDF.',
   'Link do PDF no portal da prefeitura.',
   'Link que exige login de outro sistema não abre para os colegas.',
   50),
  ('os.nf_fora.observacao', 'Observação',
   'Qualquer informação útil sobre a nota. Opcional.',
   'Fica gravada junto com quem marcou e quando.',
   'Faturada no OMIE junto com a OS-2026-0150.',
   '—',
   51),
  ('os.nf_fora.vincular', 'Vincular nota do sistema',
   'Escolha uma nota autorizada deste cliente que ainda não está ligada a nenhuma OS. Opcional.',
   'Liga a nota a esta OS: a etiqueta mostra o número e o toque abre o PDF.',
   'NF-e 640 emitida em Notas Fiscais, sem passar pela OS.',
   'Só aparecem notas autorizadas do mesmo CPF/CNPJ do cliente da OS.',
   52)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- o filtro "Nota fiscal" (#3242) agora vale para todas as OS da lista, com "NF pendente" e "NF fora da OS"
UPDATE public.erp_ajuda_campo SET
  rotulo = 'Nota fiscal (filtro da lista)',
  o_que_preencher = 'Escolha: Todas, NF pendente, NF emitida ou NF fora da OS. Combina com o filtro de status.',
  para_que_serve = 'Mostra quais OS já têm nota fiscal autorizada (NF-e de peças ou NFS-e de serviços), quais foram faturadas fora da OS e quais ainda precisam da nota.',
  exemplo = 'Toque em "NF pendente" para ver as OS prontas/entregues sem nota e emitir uma a uma pela ficha da OS.',
  erro_comum = 'Nota rejeitada ou cancelada não conta como emitida. Nota emitida por outro caminho: marque "NF fora da OS" na ficha.'
WHERE chave = 'os.filtro.nota_fiscal';
