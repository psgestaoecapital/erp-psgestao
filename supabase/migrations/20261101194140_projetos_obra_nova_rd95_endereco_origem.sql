-- RD-95 + RD-98 p3 · /dashboard/projetos/obras/nova (Nova obra · assistente). Auditor PDCA auditor_pdca_1 (90<95).
-- (1) RD-95: "?" (AjudaCampo) nos campos de endereço. O componente CepEndereco já renderiza o "?" por campo quando
--     recebe a prop `ajuda`; a tela passou a informar ajuda="projetos.obra_nova.endereco", então semeamos as chaves
--     projetos.obra_nova.endereco.<campo> (+ a chave-base que o gate estático lê do literal da prop).
-- (2) RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas (estava NULL).
-- Aditivo, idempotente, só texto/metadado (sem tabela, sem RLS, sem dado de cliente).

-- (1) textos de ajuda ---------------------------------------------------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/projetos/obras/nova', 'projetos', 'publicado'
FROM (VALUES
 ('projetos.obra_nova.endereco', 'Nova obra · Endereço', 'Endereço da obra',
  'Preencha o endereço do canteiro: comece pelo CEP, que completa rua, bairro, cidade e UF automaticamente.',
  'O endereço nomeia a obra (quando você não dá um nome) e define o município (IBGE) usado na nota fiscal.',
  'Digitar o CEP 88010-000 preenche o endereço de Florianópolis/SC.',
  'Deixar o endereço vazio quando não há nome nem cliente: informe ao menos um dos três.',
  10),
 ('projetos.obra_nova.endereco.cep', 'Nova obra · Endereço', 'CEP',
  'Digite o CEP do canteiro (8 dígitos); ao sair do campo, buscamos rua, bairro, cidade, UF e o código IBGE.',
  'É o atalho que preenche o endereço inteiro e garante o município certo para o fiscal, sem digitação manual.',
  '88010-000 preenche o Centro de Florianópolis/SC.',
  'Inventar um CEP: se não achar, informe cidade e UF e use "Buscar IBGE por cidade/UF".',
  11),
 ('projetos.obra_nova.endereco.logradouro', 'Nova obra · Endereço', 'Logradouro',
  'Rua/avenida do canteiro; vem preenchido pelo CEP, mas pode ajustar.',
  'Compõe o endereço e, na falta de nome, ajuda a nomear a obra.',
  'Av. Rio Branco.',
  'Colocar o número junto: o número tem campo próprio ao lado.',
  12),
 ('projetos.obra_nova.endereco.numero', 'Nova obra · Endereço', 'Número',
  'Número do imóvel/canteiro; digite "S/N" quando não houver.',
  'Completa o endereço para localização e documentos.',
  '1200 ou S/N.',
  'Deixar em branco achando que o CEP traz: o número não vem do CEP.',
  13),
 ('projetos.obra_nova.endereco.complemento', 'Nova obra · Endereço', 'Complemento',
  'Informação extra do local (bloco, sala, km, referência). Opcional.',
  'Ajuda a equipe a chegar ao canteiro e consta no endereço.',
  'Bloco B · Galpão 2.',
  'Repetir aqui o bairro ou a cidade, que já têm campo próprio.',
  14),
 ('projetos.obra_nova.endereco.bairro', 'Nova obra · Endereço', 'Bairro',
  'Bairro do canteiro; vem do CEP, pode ajustar.',
  'Compõe o endereço da obra.',
  'Centro.',
  'Trocar bairro por cidade: são campos diferentes.',
  15),
 ('projetos.obra_nova.endereco.cidade', 'Nova obra · Endereço', 'Cidade',
  'Município do canteiro; vem do CEP. Se o CEP não achou, digite e use "Buscar IBGE por cidade/UF".',
  'Define o município — base do código IBGE usado na nota fiscal.',
  'Florianópolis.',
  'Abreviar o nome (ex.: "Floripa"): o IBGE é resolvido pelo nome oficial do município.',
  16),
 ('projetos.obra_nova.endereco.uf', 'Nova obra · Endereço', 'UF',
  'Sigla do estado (2 letras). Vem do CEP; informe junto da cidade quando buscar o IBGE manualmente.',
  'Com a cidade, resolve o código IBGE do município para o fiscal.',
  'SC, SP, RJ.',
  'Escrever o nome do estado por extenso: use a sigla de 2 letras.',
  17),
 ('projetos.obra_nova.endereco.ibge', 'Nova obra · Endereço', 'Código do município (IBGE)',
  'Não é digitável: é preenchido pelo CEP (ou por cidade/UF). Mostra o código oficial do município.',
  'Garante o município correto na emissão de nota fiscal de serviço (NFS-e) da obra.',
  '4205407 (Florianópolis).',
  'Tentar digitar um código: ele é sempre derivado, para nunca gravar IBGE chutado.',
  18)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;

-- (2) origem do dado da tela --------------------------------------------------------------------------------------
UPDATE public.system_screens
SET views_consumidas = ARRAY['erp_clientes','erp_gov_nfse_municipios']::text[],
    rpcs_chamadas = ARRAY['fn_hub_criar_obra_rapida','fn_municipio_por_nome_uf']::text[]
WHERE rota = '/dashboard/projetos/obras/nova';
