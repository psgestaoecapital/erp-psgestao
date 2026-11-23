-- Hub · §334 Importador de planilha de orçamento (xlsx) · RD-95 "?" (parte 2)
-- Completa o "?" padrão (AjudaCampo) nos demais indicadores da prévia da importação que
-- hoje só têm tooltip nativo (title): aba lida, linhas ignoradas, unidades padronizadas e
-- linhas de estrutura (agrupadores). O "?" abre inline, também no celular, seguindo o design
-- system — o title nativo não faz isso.
--
-- Aditivo e idempotente: só insere linhas de ajuda que ainda não existem (WHERE NOT EXISTS).
-- Não toca código, estrutura, RLS, grants nem dado de cliente.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT * FROM (VALUES
  (
    'projetos.orcamento_eap.importar_aba',
    '/dashboard/projetos/obras/[id]/orcamento/importar',
    'Importador do orçamento',
    'Aba usada da planilha',
    'Nada a preencher: é informativo. Mostra qual aba da planilha foi usada quando o arquivo tem mais de uma.',
    'A planilha do orçamento costuma ter várias abas (EAP, "Outros Custos", "Análise", "Resumo", "Capa"). O sistema procura a aba que tem a EAP (código + descrição + quantidade) e usa só ela; as abas de "Outros Custos"/"Análise" não entram no orçamento (vão para a viabilidade).',
    'Arquivo com 4 abas; o sistema usa a aba "Orçamento" por ser a que tem a EAP.',
    'Esperar que "Outros Custos"/"Análise" entrem na EAP: elas não entram — são estudo do empreendimento, não itens do orçamento.',
    'projetos',
    22
  ),
  (
    'projetos.orcamento_eap.importar_ignoradas',
    '/dashboard/projetos/obras/[id]/orcamento/importar',
    'Importador do orçamento',
    'Linhas ignoradas',
    'Nada a preencher: é informativo. Conta as linhas sem código e sem descrição (em branco ou de formatação).',
    'Deixa claro que essas linhas não viraram item nem contaram como erro — são linhas vazias/de formatação que a planilha tem entre as seções e que o sistema simplesmente pula.',
    '3 linhas em branco entre blocos da planilha são ignoradas.',
    'Confundir linha ignorada (vazia) com linha de estrutura (agrupador, que tem código) ou com linha com erro (que tem dado mas inválido).',
    'projetos',
    23
  ),
  (
    'projetos.orcamento_eap.importar_unidades',
    '/dashboard/projetos/obras/[id]/orcamento/importar',
    'Importador do orçamento',
    'Unidades padronizadas',
    'Nada a preencher: é informativo. Conta as unidades que foram ajustadas para a grafia do orçamento.',
    'A planilha pode escrever a unidade de vários jeitos; o sistema padroniza para a grafia única do orçamento, sem mudar o valor. Assim itens iguais somam e comparam certo.',
    'UND→un, M2→m², peça→pç, hr→h.',
    'Achar que a padronização mudou a quantidade ou o custo: ela só troca a grafia da unidade; os números seguem iguais.',
    'projetos',
    24
  ),
  (
    'projetos.orcamento_eap.importar_estrutura',
    '/dashboard/projetos/obras/[id]/orcamento/importar',
    'Importador do orçamento',
    'Linhas de estrutura',
    'Nada a preencher: é informativo. Conta as linhas de estrutura da EAP (têm código mas não têm unidade/quantidade/custo).',
    'São os títulos/agrupadores da EAP (ex.: "1 SERVIÇOS PRELIMINARES"). Organizam a árvore, mas não são item: não entram no total do orçamento nem contam como erro.',
    '"1 SERVIÇOS PRELIMINARES" e "1.1 Canteiro de obra" são linhas de estrutura; o item com custo é "1.1.1 Barracão de obra — m² — R$ ...".',
    'Esperar que o agrupador tenha valor: o valor fica nos itens-folha abaixo dele; o agrupador só soma os filhos.',
    'projetos',
    25
  )
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo a WHERE a.chave = v.chave);
