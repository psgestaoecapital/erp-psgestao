-- Canal PS jordana-chat 4762a526 + 60675777 (OK de núcleo do CEO, caixa 1f53e40f, 13/10): o cadastro da EMPRESA só tinha
-- "Endereço" (texto livre) e "Cidade/Estado" (texto livre). Prova no dado (RD-38, 13/10): das 24 empresas reais, 5 sem
-- uf_fiscal (FCR, Triches, Troian, Estância Umuarama/PY e Nueva Energia/AR), 15 sem endereço e a FCR só com
-- "RUA BERTILA FRIEDRICH" (sem número, bairro, CEP) — a NF-e da FCR travou em "UF fiscal do emitente não cadastrada".
--
-- O que muda (aditivo; nada é apagado):
--   1) companies ganha cep, logradouro, numero, complemento, bairro, cidade e codigo_ibge_municipio (mesmos nomes do
--      cadastro de clientes, #2290/#2292). A UF continua sendo companies.uf_fiscal (fonte de verdade da NF-e).
--   2) Backfill SÓ de coluna vazia: cidade e IBGE a partir de cidade_estado pela regra única fn_municipio_por_nome_uf
--      (#2366: sem acento/apóstrofo/hífen + sinônimos); UF de cidade_estado quando uf_fiscal está vazia; logradouro,
--      número, bairro, complemento e CEP separados do texto de endereco onde dá. Não acha → fica vazio (RD-51).
--      Empresa estrangeira (pais <> Brasil) fica de fora.
--      Antes do backfill, a foto das colunas de endereço de TODAS as empresas vai para
--      companies_endereco_bkp_20261017 (só service_role lê; volta com UPDATE ... FROM a foto).
--   3) (revisão 16/10) sem UPDATE fixo na FCR: a UF SC dela já foi gravada à parte em 14/10; o endereço completo
--      (número, galpão, CEP) a Jordana grava pela tela nova, que valida e confere o IBGE.
--   4) fn_empresa_obter_dados devolve os campos novos (+ uf_fiscal e pais). Lida a versão viva em 13/10 com
--      pg_get_functiondef: mesma guarda (get_user_company_ids), mesmo search_path.
--   5) fn_empresa_salvar_endereco (nova; só sócio/dono/administrador da empresa ou administrador PS): valida CEP, logradouro, número, bairro, cidade, UF e IBGE (empresa brasileira),
--      confere o IBGE na tabela oficial e que a UF bate com a do município, grava uf_fiscal e MONTA endereco e
--      cidade_estado a partir dos campos (o cabeçalho da OS, a remessa CNAB e a NFS-e continuam lendo esses textos).
--   6) "?" (RD-95) de todos os campos da tela Configurações › Dados da Empresa.

-- 1) Colunas -------------------------------------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS logradouro text,
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS complemento text,
  ADD COLUMN IF NOT EXISTS bairro text,
  ADD COLUMN IF NOT EXISTS cidade text,
  ADD COLUMN IF NOT EXISTS codigo_ibge_municipio text;

COMMENT ON COLUMN public.companies.cep IS 'CEP do emitente, só dígitos (8). Endereço da NF-e/NFS-e.';
COMMENT ON COLUMN public.companies.logradouro IS 'Rua/avenida do emitente, sem o número.';
COMMENT ON COLUMN public.companies.numero IS 'Número do endereço do emitente (S/N quando não houver).';
COMMENT ON COLUMN public.companies.complemento IS 'Complemento do endereço do emitente (sala, galpão, bloco).';
COMMENT ON COLUMN public.companies.bairro IS 'Bairro do emitente.';
COMMENT ON COLUMN public.companies.cidade IS 'Município do emitente (nome). A UF fica em uf_fiscal.';
COMMENT ON COLUMN public.companies.codigo_ibge_municipio IS 'Código IBGE (7 dígitos) do município do emitente, conferido em erp_gov_nfse_municipios.';

-- 2) Backfill (só coluna vazia; 24 empresas reais — sem varredura de tabela grande) -------------------------------
-- foto de antes (revisão 16/10): endereço, cidade/UF e uf_fiscal de todas as empresas, para desfazer se preciso
CREATE TABLE IF NOT EXISTS public.companies_endereco_bkp_20261017 AS
  SELECT id, endereco, cidade_estado, uf_fiscal, now() AS copiado_em FROM public.companies WITH NO DATA;
INSERT INTO public.companies_endereco_bkp_20261017 (id, endereco, cidade_estado, uf_fiscal, copiado_em)
  SELECT c.id, c.endereco, c.cidade_estado, c.uf_fiscal, now() FROM public.companies c
   WHERE NOT EXISTS (SELECT 1 FROM public.companies_endereco_bkp_20261017 b WHERE b.id = c.id);
ALTER TABLE public.companies_endereco_bkp_20261017 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.companies_endereco_bkp_20261017 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.companies_endereco_bkp_20261017 TO service_role;
COMMENT ON TABLE public.companies_endereco_bkp_20261017 IS
  'Backup (migration companies_endereco_campos) de endereco/cidade_estado/uf_fiscal antes do backfill. Só service_role.';

DO $$
DECLARE
  r record;
  v_uf text; v_cid text; v_ibge text; v_nome_of text;
  v_partes text[]; v_p text; v_i int; v_num_idx int;
  v_cep text; v_log text; v_num text; v_bai text; v_comp text;
BEGIN
  FOR r IN
    SELECT id, endereco, cidade_estado, uf_fiscal, cep, logradouro, numero, complemento, bairro, cidade, codigo_ibge_municipio
      FROM public.companies
     WHERE coalesce(pais, 'Brasil') = 'Brasil'
  LOOP
    -- cidade + UF a partir de "Cidade/UF", "Cidade, UF" ou só "Cidade" (UF cai na uf_fiscal)
    v_uf  := upper((regexp_match(upper(coalesce(r.cidade_estado, '')), '[/,]\s*([A-Z]{2})\s*$'))[1]);
    v_cid := nullif(btrim(regexp_replace(coalesce(r.cidade_estado, ''), '\s*[/,]\s*[A-Za-z]{2}\s*$', '')), '');
    v_uf  := coalesce(r.uf_fiscal, v_uf);
    v_ibge := NULL; v_nome_of := NULL;
    IF v_cid IS NOT NULL AND length(coalesce(v_uf, '')) = 2 THEN
      -- achou o município → grava o nome OFICIAL ("SAO MIGUEL DO OESTE" → "São Miguel do Oeste")
      SELECT m.codigo_ibge, m.nome_municipio INTO v_ibge, v_nome_of FROM public.fn_municipio_por_nome_uf(v_cid, v_uf) m LIMIT 1;
      v_cid := coalesce(v_nome_of, v_cid);
    END IF;

    -- endereço livre → partes por vírgula ("RUA, WILLY BARTH, 4300, CENTRO, 89900000", "Rua X, 968, Bairro Y")
    v_cep := NULL; v_log := NULL; v_num := NULL; v_bai := NULL; v_comp := NULL; v_num_idx := NULL;
    v_partes := array_remove(array(
      SELECT btrim(x) FROM unnest(string_to_array(regexp_replace(coalesce(r.endereco, ''), '\.\s*$', ''), ',')) WITH ORDINALITY u(x, o) ORDER BY o
    ), '');
    -- CEP solto numa parte
    FOR v_i IN 1 .. coalesce(array_length(v_partes, 1), 0) LOOP
      IF v_partes[v_i] ~ '^\d{5}-?\d{3}$' THEN
        v_cep := regexp_replace(v_partes[v_i], '\D', '', 'g');
        v_partes := v_partes[1:v_i-1] || v_partes[v_i+1:];
        EXIT;
      END IF;
    END LOOP;
    -- a 1ª parte que é número ("968", "Nº 1470", "S/N", "KM 71") separa logradouro de bairro/complemento
    FOR v_i IN 1 .. coalesce(array_length(v_partes, 1), 0) LOOP
      IF v_i > 1 AND v_partes[v_i] ~* '^((n[ºo°]\.?\s*)?\d+[a-z]?|s/?n|km\s*\d+([.,]\d+)?)$' THEN
        v_num_idx := v_i; EXIT;
      END IF;
    END LOOP;
    IF v_num_idx IS NOT NULL THEN
      v_num := btrim(regexp_replace(v_partes[v_num_idx], '^n[ºo°]\.?\s*', '', 'i'));
      -- "RUA, WILLY BARTH" (tipo do logradouro numa parte só) → "RUA WILLY BARTH"
      v_log := array_to_string(v_partes[1:v_num_idx-1], CASE WHEN v_partes[1] ~* '^(rua|r\.|avenida|av\.?|rodovia|estrada|travessa|alameda|linha)$' THEN ' ' ELSE ', ' END);
      IF array_length(v_partes, 1) > v_num_idx THEN
        v_bai := nullif(btrim(regexp_replace(v_partes[v_num_idx+1], '^bairro\s+', '', 'i')), '');
      END IF;
      IF array_length(v_partes, 1) > v_num_idx + 1 THEN
        v_comp := array_to_string(v_partes[v_num_idx+2:], ', ');
      END IF;
    ELSIF array_length(v_partes, 1) = 1 THEN
      v_log := v_partes[1];   -- "RUA BERTILA FRIEDRICH" sem número: só o logradouro
    END IF;

    -- só UF brasileira válida entra em uf_fiscal (fora da lista → fica vazio, RD-51)
    IF NOT coalesce(v_uf = ANY (ARRAY['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
                                       'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']), false) THEN
      v_uf := NULL;
    END IF;

    UPDATE public.companies SET
      cidade                = coalesce(cidade, v_cid),
      uf_fiscal             = coalesce(uf_fiscal, v_uf),
      codigo_ibge_municipio = coalesce(codigo_ibge_municipio, v_ibge),
      cep                   = coalesce(cep, v_cep),
      logradouro            = coalesce(logradouro, v_log),
      numero                = coalesce(numero, v_num),
      bairro                = coalesce(bairro, v_bai),
      complemento           = coalesce(complemento, v_comp)
    WHERE id = r.id;
  END LOOP;
END $$;

-- 4) Leitura da tela (mesma guarda e search_path da versão viva) ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_empresa_obter_dados(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  SELECT jsonb_build_object(
    'sucesso', true, 'id', id,
    'razao_social', razao_social, 'nome_fantasia', nome_fantasia, 'cnpj', cnpj,
    'inscricao_estadual', inscricao_estadual, 'inscricao_municipal', inscricao_municipal,
    'cidade_estado', cidade_estado, 'endereco', endereco, 'cnae', cnae,
    'regime_tributario', regime_tributario, 'logo_url', logo_url,
    'pais', pais, 'uf_fiscal', uf_fiscal, 'cep', cep, 'logradouro', logradouro, 'numero', numero,
    'complemento', complemento, 'bairro', bairro, 'cidade', cidade, 'codigo_ibge_municipio', codigo_ibge_municipio
  ) INTO v FROM public.companies WHERE id = p_company_id;
  RETURN COALESCE(v, jsonb_build_object('sucesso', false, 'erro', 'nao_encontrada'));
END $function$;

REVOKE ALL ON FUNCTION public.fn_empresa_obter_dados(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_empresa_obter_dados(uuid) TO authenticated, service_role;

-- 5) Gravação do endereço em campos ----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_empresa_salvar_endereco(
  p_company_id uuid, p_cep text, p_logradouro text, p_numero text, p_complemento text, p_bairro text,
  p_cidade text, p_uf text, p_codigo_ibge text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pais text; v_br boolean;
  v_cep text := nullif(regexp_replace(coalesce(p_cep, ''), '\D', '', 'g'), '');
  v_log text := nullif(btrim(p_logradouro), '');
  v_num text := nullif(btrim(p_numero), '');
  v_comp text := nullif(btrim(p_complemento), '');
  v_bai text := nullif(btrim(p_bairro), '');
  v_cid text := nullif(btrim(p_cidade), '');
  v_uf text := nullif(upper(btrim(p_uf)), '');
  v_ibge text := nullif(regexp_replace(coalesce(p_codigo_ibge, ''), '\D', '', 'g'), '');
  v_uf_mun text; v_nome_mun text;
  v_falta text[] := ARRAY[]::text[];
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  -- endereço do emitente sai na NF-e: só quem administra a empresa grava (revisão 16/10)
  IF NOT (public.is_admin() OR EXISTS (
        SELECT 1 FROM public.user_companies uc
         WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
           AND uc.role IN ('owner', 'socio', 'admin', 'adm', 'acesso_total', 'diretor'))) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_permissao',
      'mensagem', 'Só o dono, um sócio ou o administrador da empresa pode alterar o endereço fiscal.');
  END IF;
  SELECT pais INTO v_pais FROM public.companies WHERE id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrada');
  END IF;
  v_br := coalesce(v_pais, 'Brasil') = 'Brasil';

  IF v_br THEN
    -- IBGE vazio → mesma regra única do cadastro de clientes (cidade + UF, sinônimos oficiais)
    IF v_ibge IS NULL AND v_cid IS NOT NULL AND length(coalesce(v_uf, '')) = 2 THEN
      SELECT m.codigo_ibge INTO v_ibge FROM public.fn_municipio_por_nome_uf(v_cid, v_uf) m LIMIT 1;
    END IF;
    IF v_cep IS NULL OR length(v_cep) <> 8 THEN v_falta := array_append(v_falta, 'CEP (8 números)'); END IF;
    IF v_log IS NULL THEN v_falta := array_append(v_falta, 'logradouro'); END IF;
    IF v_num IS NULL THEN v_falta := array_append(v_falta, 'número (ou S/N)'); END IF;
    IF v_bai IS NULL THEN v_falta := array_append(v_falta, 'bairro'); END IF;
    IF v_cid IS NULL THEN v_falta := array_append(v_falta, 'cidade'); END IF;
    IF v_uf IS NULL OR length(v_uf) <> 2 THEN v_falta := array_append(v_falta, 'UF'); END IF;
    IF v_ibge IS NULL THEN v_falta := array_append(v_falta, 'código IBGE do município'); END IF;
    IF array_length(v_falta, 1) > 0 THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'endereco_incompleto', 'faltando', to_jsonb(v_falta),
        'mensagem', 'A NF-e e a NFS-e exigem o endereço completo. Falta: ' || array_to_string(v_falta, ', ') || '.');
    END IF;
    SELECT m.uf, m.nome_municipio INTO v_uf_mun, v_nome_mun FROM public.erp_gov_nfse_municipios m WHERE m.codigo_ibge = v_ibge;
    IF v_uf_mun IS NULL THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'ibge_invalido',
        'mensagem', 'O código IBGE ' || v_ibge || ' não existe na tabela oficial de municípios.');
    END IF;
    -- UF derivada do município: o código manda; UF digitada diferente é erro (não grava nota com UF trocada)
    IF v_uf_mun <> v_uf THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'uf_divergente',
        'mensagem', 'O município ' || v_nome_mun || ' é de ' || v_uf_mun || ', não de ' || v_uf || '. Confira a cidade e a UF.');
    END IF;
    v_cid := v_nome_mun;   -- grava o nome oficial do município
  END IF;

  UPDATE public.companies SET
    cep = v_cep, logradouro = v_log, numero = v_num, complemento = v_comp, bairro = v_bai, cidade = v_cid,
    codigo_ibge_municipio = CASE WHEN v_br THEN v_ibge ELSE codigo_ibge_municipio END,
    uf_fiscal = CASE WHEN v_br THEN v_uf ELSE uf_fiscal END,
    -- textos que o cabeçalho da OS, a remessa CNAB e a NFS-e já leem — montados dos campos
    endereco = coalesce(nullif(concat_ws(', ',
                 v_log || coalesce(', ' || v_num, '') || coalesce(' - ' || v_comp, ''),
                 v_bai,
                 CASE WHEN v_cep IS NOT NULL AND length(v_cep) = 8 THEN 'CEP ' || substr(v_cep, 1, 5) || '-' || substr(v_cep, 6) END
               ), ''), endereco),
    cidade_estado = CASE WHEN v_br THEN v_cid || '/' || v_uf ELSE cidade_estado END,   -- estrangeira: mantém "Buenos Aires/AR"
    updated_at = now()
  WHERE id = p_company_id;
  RETURN jsonb_build_object('sucesso', true, 'mensagem', 'Endereço da empresa salvo.', 'codigo_ibge_municipio', v_ibge);
END $function$;

REVOKE ALL ON FUNCTION public.fn_empresa_salvar_endereco(uuid, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_empresa_salvar_endereco(uuid, text, text, text, text, text, text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_empresa_salvar_endereco(uuid, text, text, text, text, text, text, text, text) IS
  'Grava o endereço da empresa em campos (CEP, logradouro, número, complemento, bairro, cidade, UF→uf_fiscal, IBGE). Empresa brasileira: todos obrigatórios menos complemento; IBGE conferido na tabela oficial e UF = UF do município. Monta endereco e cidade_estado.';

-- 6) RD-95: "?" da tela Configurações › Dados da Empresa ---------------------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Dados da empresa', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/configuracoes/empresa', 'geral', 'publicado'
FROM (VALUES
 ('empresa.dados.empresa', 'Empresa', 'Escolha a empresa que você quer editar. Normalmente já vem a do seletor do topo.', 'Garante que você está mudando o cadastro da empresa certa.', 'FCR Materiais', 'Editar uma empresa achando que é outra: confira o selo "Editando" no alto.', 1),
 ('empresa.dados.razao_social', 'Razão social', 'O nome oficial da empresa, igual ao cartão do CNPJ. Obrigatório.', 'Sai como emitente na NF-e, na NFS-e, no boleto e no cabeçalho da OS.', 'FCR Materiais de Construção Ltda', 'Usar o nome fantasia: a nota sai com nome diferente do CNPJ.', 2),
 ('empresa.dados.nome_fantasia', 'Nome fantasia', 'O nome pelo qual a empresa é conhecida.', 'É o nome que aparece em destaque no cabeçalho da OS e nas listas do sistema.', 'FCR Materiais', 'Deixar vazio: o sistema usa a razão social, que costuma ser longa.', 3),
 ('empresa.dados.cnpj', 'CNPJ', 'Os 14 números do CNPJ da empresa (os pontos entram sozinhos).', 'Identifica o emitente na nota fiscal e no boleto.', '35.413.817/0001-76', 'Digitar o CNPJ de outra filial: confira os 4 números depois da barra.', 4),
 ('empresa.dados.ie', 'Inscrição estadual', 'Só os números da IE da empresa. Se ela for isenta, marque "Isento".', 'A NF-e de produto exige a IE do emitente; sem ela a SEFAZ rejeita.', '257123456', 'Escrever "ISENTO" no campo: use a caixa de isento.', 5),
 ('empresa.dados.im', 'Inscrição municipal', 'O número de inscrição da empresa na prefeitura.', 'Identifica o prestador na NFS-e.', '12345', 'Copiar a inscrição estadual para cá.', 6),
 ('empresa.dados.cnae', 'CNAE', 'O código da atividade principal, como está no cartão do CNPJ.', 'Ajuda a definir a tributação dos serviços e aparece nos relatórios.', '4744-0/01', 'Usar o CNAE de uma atividade secundária como principal.', 7),
 ('empresa.dados.regime', 'Regime tributário', 'Simples Nacional, Lucro Presumido, Lucro Real ou MEI — o que o contador informou.', 'Define como os impostos da nota são calculados (CSOSN no Simples, CST nos outros).', 'Simples Nacional', 'Deixar diferente da Configuração Fiscal: a nota sai com o regime errado.', 8),
 ('empresa.dados.cep', 'CEP', 'Os 8 números do CEP da empresa. Clique em Buscar: rua, bairro, cidade, UF e código IBGE vêm sozinhos.', 'Com o CEP o sistema acha o município e o código IBGE que a NF-e e a NFS-e exigem do emitente.', '89899-000', 'CEP de cidade inteira não traz rua nem bairro: complete à mão.', 10),
 ('empresa.dados.logradouro', 'Logradouro', 'Rua, avenida ou estrada, sem o número. Obrigatório.', 'Endereço do emitente na nota e no cabeçalho da OS.', 'Rua Bertila Friedrich', 'Colocar o número aqui: use o campo Número.', 11),
 ('empresa.dados.numero', 'Número', 'O número do endereço. Sem número, escreva S/N. Obrigatório.', 'A NF-e exige o número do endereço do emitente.', '47', 'Deixar vazio: o sistema não salva.', 12),
 ('empresa.dados.complemento', 'Complemento', 'Sala, galpão, andar, bloco — se houver.', 'Completa o endereço da nota e da OS.', 'Galpão', 'Repetir o bairro aqui.', 13),
 ('empresa.dados.bairro', 'Bairro', 'O bairro da empresa. Obrigatório.', 'Endereço do emitente na nota.', 'Centro', 'Escrever "Bairro Centro": basta "Centro".', 14),
 ('empresa.dados.cidade', 'Cidade', 'O município da empresa. Vem do CEP; se digitar, use o nome oficial.', 'Com a UF, define o código IBGE do município do emitente.', 'Iporã do Oeste', 'Escrever abreviado ("S. Miguel"): o sistema não acha o código IBGE.', 15),
 ('empresa.dados.uf', 'UF', 'A sigla do estado, com 2 letras. Precisa ser a UF do município.', 'É a UF fiscal da empresa: define se a venda é dentro ou fora do estado (CFOP 5xxx ou 6xxx).', 'SC', 'UF de outro estado: o sistema avisa que o município não é dessa UF.', 16),
 ('empresa.dados.ibge', 'Código IBGE do município', 'Preenche sozinho pelo CEP ou por "Buscar IBGE por cidade/UF". Não é digitado.', 'A NF-e e a NFS-e identificam o município do emitente por este código; sem ele a nota não sai.', '4207650 (Iporã do Oeste/SC)', 'Cidade escrita errada: o código não é encontrado — corrija a cidade e busque de novo.', 17),
 ('empresa.dados.logo', 'Logomarca', 'Envie a logo em PNG, JPG, WEBP ou SVG, até 2 MB.', 'Aparece nos orçamentos, nas ordens de serviço e no topo do sistema.', 'logo-fcr.png', 'Imagem muito grande ou com fundo escuro: fica ilegível no papel.', 20)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
