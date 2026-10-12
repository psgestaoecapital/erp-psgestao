-- Carteira Pdois/Gean (caixa jordana-code 25fac6b6, Eng. Chefe 08/10): cliente salvo com cidade + UF e SEM o código IBGE
-- do município — a NFS-e trava ("tomador sem IBGE"). Prova no dado (RD-38): o "Laboratório Costa Rosa" (Pdois) foi salvo
-- às 19:18 UTC pela tela Cadastros › Clientes com CEP 79950000, cidade "Naviraí", UF "MS" e codigo_ibge_municipio NULL,
-- embora a tabela oficial tenha Naviraí/MS = 5005707. A tela (PessoaForm) nunca enviava o IBGE; o backfill #1880 (merge 08/10)
-- só corrigiu o passado. Este gatilho fecha a porta para tela, importação e sincronização.
--
-- Regra do gatilho (aditivo, SÓ preenche vazio):
--   * dispara em INSERT e UPDATE de erp_clientes; se codigo_ibge_municipio já tem valor, não faz nada;
--   * casa (UF, cidade) na tabela oficial erp_gov_nfse_municipios com a MESMA normalização do backfill #1880/#2134:
--     sem acento (f_unaccent), minúsculas, espaços colapsados e sem o sufixo " (UF)" que vem de importação
--     ("CHAPECO (SC)"); também tira um "/UF" ou "- UF" final igual à UF do cadastro ("Naviraí/MS");
--   * não acha → deixa vazio (RD-51: não inventa); a emissão continua avisando;
--   * não mexe em IE/contribuinte nem em nenhuma outra coluna.
-- Custo: uma busca pelo índice ix_municipios_uf_nome_unaccent (uf, lower(f_unaccent(nome_municipio))) por linha, e só
-- quando o IBGE está vazio — nunca varre a tabela de clientes.
-- SECURITY INVOKER: a tabela oficial já é legível por authenticated (policy de leitura geral); sem SECURITY DEFINER.

CREATE OR REPLACE FUNCTION public.fn_clientes_ibge_auto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uf   text;
  v_nome text;
  v_cod  text;
BEGIN
  IF coalesce(btrim(NEW.codigo_ibge_municipio), '') <> '' THEN
    RETURN NEW;
  END IF;
  v_uf := upper(btrim(coalesce(NEW.uf, '')));
  IF length(v_uf) <> 2 OR coalesce(btrim(NEW.cidade), '') = '' THEN
    RETURN NEW;
  END IF;
  v_nome := regexp_replace(NEW.cidade, '\s*\(.*\)\s*$', '');                         -- "CHAPECO (SC)" -> "CHAPECO"
  v_nome := regexp_replace(v_nome, '\s*[/-]\s*' || v_uf || '\s*$', '', 'i');        -- "Naviraí/MS" -> "Naviraí"
  v_nome := btrim(regexp_replace(lower(public.f_unaccent(v_nome)), '\s+', ' ', 'g'));
  IF v_nome = '' THEN
    RETURN NEW;
  END IF;

  SELECT g.codigo_ibge INTO v_cod
    FROM public.erp_gov_nfse_municipios g
   WHERE g.uf = v_uf
     AND lower(public.f_unaccent(g.nome_municipio)) = v_nome
   ORDER BY g.codigo_ibge
   LIMIT 1;

  IF v_cod IS NOT NULL THEN
    NEW.codigo_ibge_municipio := v_cod;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.fn_clientes_ibge_auto() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_clientes_ibge_auto ON public.erp_clientes;
CREATE TRIGGER trg_clientes_ibge_auto
  BEFORE INSERT OR UPDATE ON public.erp_clientes
  FOR EACH ROW EXECUTE FUNCTION public.fn_clientes_ibge_auto();

COMMENT ON FUNCTION public.fn_clientes_ibge_auto() IS
  'Preenche erp_clientes.codigo_ibge_municipio VAZIO a partir de cidade+UF na tabela oficial (erp_gov_nfse_municipios). Só preenche vazio; não acha = deixa vazio.';

-- RD-95: "?" dos campos da tela Cadastros › Clientes/Fornecedores (PessoaForm). Rota própria do formulário (ele abre nas
-- duas telas). Aditivo: só INSERT de textos (ON CONFLICT DO NOTHING).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cadastro de cliente/fornecedor', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/cadastros/pessoa', 'cadastros', 'publicado'
FROM (VALUES
 ('cadastros.pessoa.tipo', 'Tipo de pessoa', 'Escolha Pessoa Jurídica (empresa, com CNPJ) ou Pessoa Física (pessoa, com CPF).', 'Define se o documento é CNPJ ou CPF e o que a nota e o boleto pedem do cadastro.', 'Pessoa Jurídica', 'Cadastrar uma empresa como Pessoa Física: a nota sai com CPF no lugar do CNPJ.', 10),
 ('cadastros.pessoa.documento', 'CNPJ / CPF', 'O CNPJ da empresa ou o CPF da pessoa. Com CNPJ, clique em Buscar: razão social e endereço vêm da Receita.', 'Identifica o cliente na nota fiscal, no boleto e na conferência de duplicidade.', '12.345.678/0001-90', 'Digitar o CNPJ de outra filial: confira os 4 dígitos depois da barra.', 11),
 ('cadastros.pessoa.nome', 'Nome / Apelido', 'Como você chama esse cliente ou fornecedor no dia a dia. Obrigatório.', 'É o nome que aparece nas listas, nos lançamentos e nas buscas.', 'Costa Rosa', 'Deixar só a razão social longa: fica difícil achar na busca.', 12),
 ('cadastros.pessoa.razao_social', 'Razão Social', 'O nome oficial da empresa, como está no CNPJ.', 'Vai na nota fiscal e no boleto.', 'Laboratório Costa Rosa Ltda', 'Usar o nome fantasia: a nota sai com nome diferente do CNPJ.', 13),
 ('cadastros.pessoa.ie', 'Inscrição Estadual', 'Só números da IE de quem é contribuinte de ICMS. Isento ou não contribuinte deixa em branco.', 'Vai na NF-e do destinatário; sem ela a SEFAZ rejeita nota para contribuinte.', '254123456', 'Escrever "ISENTO" aqui: marque Isento em Contribuinte de ICMS.', 14),
 ('cadastros.pessoa.im', 'Inscrição Municipal', 'A inscrição do cliente na prefeitura, se ele tiver.', 'Pode ir na NFS-e do tomador, quando a prefeitura pede.', '12345', 'Copiar a inscrição estadual para cá.', 15),
 ('cadastros.pessoa.contribuinte', 'Contribuinte de ICMS', 'Diga se o cliente é contribuinte (tem IE), isento de inscrição ou não contribuinte.', 'Define o indicador do destinatário na NF-e (indIEDest).', 'Não contribuinte', 'Deixar sem marcar: a NF-e sai sem o indicador e pode ser rejeitada.', 16),
 ('cadastros.pessoa.email', 'E-mail', 'O e-mail de quem recebe nota e boleto.', 'É para onde vão a nota e o boleto enviados pelo sistema.', 'financeiro@cliente.com.br', 'Usar um e-mail pessoal de quem já saiu da empresa.', 17),
 ('cadastros.pessoa.telefone', 'Telefone', 'Telefone fixo ou celular de contato.', 'Contato do cadastro; aparece na ficha do cliente.', '(49) 3622-0000', 'Colocar dois números no mesmo campo.', 18),
 ('cadastros.pessoa.whatsapp', 'WhatsApp', 'O celular com WhatsApp, com DDD.', 'Usado pelo botão "Enviar boleto pelo WhatsApp".', '(49) 99999-0000', 'Esquecer o DDD: a mensagem não chega.', 19),
 ('cadastros.pessoa.cep', 'CEP', 'Os 8 números do CEP. Clique em Buscar (ou só salve): cidade, UF, rua e bairro vêm sozinhos.', 'Com o CEP o sistema acha a cidade, a UF e o código IBGE do município, que a nota fiscal exige.', '79950-000', 'Salvar com CEP de outra cidade: confira a cidade que aparece depois da busca.', 20),
 ('cadastros.pessoa.logradouro', 'Logradouro', 'Rua, avenida ou estrada, sem o número.', 'Endereço do tomador na nota e do pagador no boleto.', 'Rua Bertila Friedrich', 'Colocar o número aqui: use o campo Número.', 21),
 ('cadastros.pessoa.numero', 'Número', 'O número do endereço. Sem número, escreva S/N.', 'Obrigatório no boleto e na nota.', '31', 'Deixar vazio: o boleto pode ser recusado pelo banco.', 22),
 ('cadastros.pessoa.bairro', 'Bairro', 'O bairro do endereço (vem do CEP quando o CEP é de rua).', 'Endereço da nota e do boleto.', 'Centro', 'CEP de cidade inteira não traz bairro: digite à mão.', 23),
 ('cadastros.pessoa.complemento', 'Complemento', 'Sala, andar, bloco — se houver.', 'Completa o endereço da nota e do boleto.', 'Sala 2', 'Repetir o bairro aqui.', 24),
 ('cadastros.pessoa.cidade', 'Cidade', 'O nome da cidade. Vem do CEP; se digitar, escreva o nome oficial.', 'Com a UF, define o código IBGE do município que a nota fiscal exige.', 'Naviraí', 'Escrever abreviado ("S. Miguel"): o sistema não acha o código IBGE.', 25),
 ('cadastros.pessoa.uf', 'UF', 'A sigla do estado, com 2 letras.', 'Com a cidade, define o código IBGE do município.', 'MS', 'Trocar a UF da cidade: o código IBGE não é encontrado.', 26),
 ('cadastros.pessoa.ibge', 'Código IBGE do município', 'Preenche sozinho pelo CEP ou pela cidade + UF. Se quiser, digite os 7 números do código oficial.', 'A NFS-e e a NF-e exigem o município do tomador pelo código IBGE; sem ele a emissão para.', '5005707 (Naviraí/MS)', 'Digitar o CEP aqui ou um código com menos de 7 números: o sistema recusa.', 27),
 ('cadastros.pessoa.busca', 'Buscar cadastro', 'Digite parte do nome ou do CNPJ/CPF.', 'Filtra a lista na hora, só entre os cadastros ativos.', 'Costa Rosa', 'Procurar um cadastro inativado: ele não aparece na lista.', 9),
 ('cadastros.pessoa.tags', 'Tags', 'Palavras para agrupar o cadastro. Clique numa sugestão ou digite e tecle Enter.', 'Servem para filtrar e separar clientes nas listas.', 'Mensalista', 'Criar a mesma tag com grafias diferentes ("VIP" e "vip").', 28)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
