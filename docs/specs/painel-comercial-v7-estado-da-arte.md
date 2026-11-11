# SPEC — Painel Comercial v7 "Estado da Arte"
**PS Gestão ERP · vertical Comercial (Frioeste piloto) · 10/11/2026**

> Documento único de construção. Funde o **storytelling moderno** do protótipo com **TODA a análise** do v5. O dev constrói a partir daqui, uma vez, sem retrabalho. Rota nova `/dashboard/comercial/meu-painel-v6` (não toca o v5 até validado; ao validar, vira a rota principal).

---

## 0. Princípios invioláveis (valem para o painel inteiro)

1. **Fonte única e correta:** `fn_bi_comercial_base` / motor-v5 sobre `bi_comercial_venda_item_mv` (= `fn_com_venda_item`). Aceite provado: **R$ 13.983.740 / 6.285 itens / 482 clientes / 127 produtos / R$ 30,61 R$/kg** no período 01/10–06/11. NUNCA a MV inflada (`bi_comercial_item_mv`). Toda seção fecha o aceite.
2. **R$/kg sem despojo:** carne + miúdo, exclui INATIVOS + SUBPRODUTOS/despojo. Configurável pelo modal (ver §3). Padrão = 109 de 127 produtos → R$ 30,61.
3. **Honestidade (RD-38):** nunca inventar número. Lucro/margem só com custo confiável do ERP de origem → enquanto não houver, mostra o aviso "não mostramos número estimado", não um chute. Metas idem (só com meta cadastrada).
4. **Mostrar TUDO:** nenhuma tabela esconde linhas atrás de scroll interno pequeno. Toda tabela lista todos os registros (cresce verticalmente). Ordenação por cabeçalho e busca são permitidas; paginação só para listas enormes (>200) e sempre com "ver todos" explícito. O dono tem que ver o quadro completo.
5. **Mobile-first + fail-closed:** 390px first. Papel `COMMERCIAL_SELLER` vê só os próprios dados (filtro "Visão vendedor" trava no vendedor logado). Diretoria vê "Toda a empresa".
6. **RD-95 "?":** todo card, indicador e coluna tem o "?" de ajuda contextual.
7. **Linguagem do dono:** títulos narrativos ("Como a Frioeste está vendendo", "Onde o dinheiro ficou na mesa", "Quem vende mais caro e mais barato"). Nada de jargão técnico cru.
8. **Identidade visual PS:** Espresso `#3D2314` (estrutura, painéis escuros), Off-white `#FAF7F2` (fundo), Dourado `#C8941A` (ícones/barras). Verde/Amarelo/Vermelho **só** semáforo de performance, nunca decorativo.

---

## 1. Chassi (estrutura comum a todas as abas)

### 1.1 Cabeçalho
- Migalha: `FRIOESTE · COMERCIAL · MEU PAINEL DE VENDAS`
- Título narrativo grande: **"Como a Frioeste está vendendo"**
- Linha-resumo dinâmica: "De {de} a {até}: faturou **R$ {total}** em {volume}t. **{%abaixo}%** dos itens saíram abaixo do preço de tabela, somando **R$ {desconto}** de desconto."

### 1.2 Barra de filtros (recalcula todo o painel)
- **Período:** Hoje · Semana · 30 dias · Este mês · Ano · **Tudo (desde {início})** · **De–Até** (date pickers). Usa `p_de`/`p_ate` do motor.
- **Visão (vendedor):** dropdown — "Toda a empresa" + os vendedores por `nome · código` (ex: "Valcir · 80002"). Fail-closed: vendedor logado trava no próprio.
- **Linha:** dropdown — Todas · Desossados · Com osso · Miúdos · Subprodutos e outros.
- **Produtos na análise · {N} de {total}:** abre o modal de análise (§3).
- **Ver código:** toggle (mostra código do vendedor/produto/cliente ao lado do nome).

### 1.3 Navegação — 8 abas (consolidação inteligente das 12 do v5)
`Visão geral · Vendedores · Clientes · Cidades · Produtos · Preço e desconto · Logística · Metas`

Mapa de consolidação (nada se perde):
- **Indicadores** (v5) → cards de resumo no topo de cada aba + Visão geral.
- **Ranking** (v5) → dentro de Vendedores (pódio) + ordenação do placar.
- **Cortes** (v5) → dentro de Produtos (a tabela de produtos JÁ é por corte, com "itens abaixo", linha, semáforo).
- **Concentração** (v5, Curva ABC multidimensional) → dentro de Clientes ("Quanto dependemos de poucos" = Pareto) + seletor de dimensão.

### 1.4 Layout
- Container centralizado `max-w-7xl mx-auto` + padding lateral. Grid de cards responsivo (1 col mobile → 2 tablet → 3-4 desktop). Sem overflow lateral; tabelas largas rolam só dentro do próprio container com indicação clara, mas **mostram todas as linhas**.

---

## 2. Aba a aba

### 2.1 VISÃO GERAL
**8 cards KPI** (grid): Faturamento (R$ 13,98mi) · Volume na análise (441t) · Preço médio (R$ 30,61/kg sem despojo) · Ticket por nota (R$ 5.851) · Desconto na tabela (1,47% / R$) · Devoluções (2,9% / R$) · Clientes que compraram (482) · Prazo médio (21,1 dias, ponderado pelo valor). Cada card com variação vs período anterior (↑/↓ %) onde fizer sentido.

**🎯 "Diagnóstico do período"** — painel escuro (Espresso), 3 colunas de insight automático (gerado do dado, não IA externa paga — regra calculada; se usar IA, via `aiGuardedCall` com budget):
- **⚠️ RISCOS:** ex. "Vendas a inativos: R$ X"; "Desconto do {vendedor} acima do normal"; "Concentração: {N} clientes = {%} do faturamento".
- **💡 OPORTUNIDADES:** ex. "{vendedor} subindo"; "Cliente novo recapturável"; "Linha {X} ganhando espaço".
- **✅ AÇÕES:** ex. "Ligar para {cliente} (em risco)"; "Revisar desconto de {vendedor}"; "Cuidar das devoluções de {produto}".
Cada item é uma frase curta e acionável, com o número. Regras determinísticas a partir do motor (quem está fora da média, quem caiu, quem concentra).

**Gráficos:**
- **"Do que vive a Frioeste":** donut por linha de produto + toggle Faturamento/Volume (kg). Legenda com % e R$.
- **"Para onde vai {mês}":** 2 barras — realizado + projetado (média por dia com venda × dias do mês). Rótulo honesto: "estimativa no ritmo do período, não previsão contábil".
- **"Preço médio do kg":** gráfico de **linhas temporais** (evolução), séries Toda a análise / Desossados / Com osso, toggle Por dia / Por semana / Por produto.
- **"Faturamento por dia":** barras (valor líquido; toque numa barra → volume e notas do dia).
- **"Ritmo da semana":** barras por dia da semana (Seg–Sáb; destaca o pico).
- **"As linhas de produto":** tabela — Linha · Faturamento (barra) · Participação · Volume · R$/kg · Desconto · Clientes. Ordenável.

### 2.2 VENDEDORES
- **Leitura:** "{N} vendedores no período. Maior: {X} (R$ Y). Mais desconto: {Z} ({%})."
- **"Quem vende quanto":** donut por vendedor + legenda com %.
- **"Desconto × devolução":** **scatter** (eixo X desconto %, eixo Y devolução %) — cada vendedor um ponto; quadrante de alerta (muito desconto + muita devolução) destacado em vermelho. Acha quem "vaza" nos dois.
- **"Placar dos vendedores":** tabela completa, **ordenável por qualquer coluna**, seletor "ordenar por": Vendedor (nome·código) · Faturamento (barra) · Participação · Clientes · Ticket · R$/kg · **Índice de preço** (100 = média; bolinha de semáforo) · Desconto (semáforo verde/amarelo/vermelho, vermelho >2%) · Devolução · Prazo. Inclui linha "Sem vendedor". Nota: "Índice de preço = quanto o preço praticado difere da média da empresa no mesmo produto."
- **"O que cada um vende":** barras **empilhadas horizontais** por vendedor, segmentadas por linha (Desossados/Com osso/Miúdos/Subprodutos) — mostra o mix de cada um.
- Rodapé honesto: "Lucro e margem por vendedor só com custo confiável — não estimamos."

### 2.3 CLIENTES
- **Leitura:** "{N} clientes no período. A curva A ({X} clientes) concentra {%} do faturamento. Em risco e sumindo precisam de atenção."
- **"Os {N} clientes em 6 grupos"** (RFM) — 6 cards: **Campeões · Fiéis · Novos recapturáveis · Ocasionais · Em risco · Sumindo**. Cada um: nº clientes · faturamento · R$/kg · **ação sugerida** ("ligar hoje", "oferecer X") · link "Ver os {n} clientes". Botão "Ver todos os {N} clientes".
- **"Quanto dependemos de poucos":** **curva de Pareto** (acumulado) + tabela Curva A/B/C (A=até 80%, B=até 95%, C=resto) com clientes · faturamento · R$/kg · compra média. **Seletor de dimensão** (herda a Concentração do v5): olhar por Cliente / Produto / Cidade / Vendedor.
- **"Quem compra mais linhas gasta mais":** cross-sell — faturamento médio por nº de linhas compradas (4 linhas R$ X, 3 linhas R$ Y...). Insight de venda cruzada.
- **"Tamanho das notas":** distribuição por faixa de valor de nota (até 1k, 1-2k, 2-5k, 5-10k, +10k).
- **"Grupos econômicos":** tabela por CPF raiz (Grupo · Lojas · Clientes · Faturamento · R$/kg · Devolução). Ordenável.
- **"Saúde da carteira":** barra de recência (até 7 dias · 8-14 · 15-30 · +30 dias) — quão "quente" está a carteira.
- **Tabela "Clientes"** (todos, ordenável): Cliente (nome+cidade) · Segmento (badge) · Curva (A/B/C) · Faturamento (barra) · Participação · R$/kg · Desconto (semáforo) · **Recência** · **Frequência** · Devolução.

### 2.4 CIDADES
- **Leitura:** "{N} cidades (praças) no período; a maior é {X}. Toque numa cidade para ver os clientes dela."
- **"Onde a Frioeste vende":** donut por cidade + cards (cidades atendidas, % concentração top, top cidade + clientes, expansão/novas cidades + faturamento).
- **Tabela "Todas as cidades"** (todas as ~81, ordenável): Cidade · UF · Faturamento (barra) · Participação · % clientes · Volume (kg) · R$/kg · Devolução · Prazo. Nomes normalizados (sem duplicar por maiúscula/acento). Drill-down: clicar → clientes da cidade.

### 2.5 PRODUTOS (inclui Cortes)
- **4 cards:** Produtos vendidos (127) · Cortes · % do maior produto · Mais vendido ({nome}).
- Botão **"Excluir produtos da análise"** (abre o modal §3, integrado).
- **Tabela "Todos os produtos"** (todos os 127, ordenável): Produto (nome+código) · **Linha/classificação** (Carne S/Osso Resf, Com osso, Miúdos, Subprodutos) · Faturamento (barra) · Participação · Volume (kg) · R$/kg · **Índice de preço** (semáforo) · Desconto (semáforo) · **% itens abaixo da tabela** · Clientes. "Fora da análise = marcado; não entra no preço médio."
- Rodapé honesto: "Sem margem: custo do ERP vem zerado — não inventamos número."

### 2.6 PREÇO E DESCONTO
- **Leitura:** "No período, R$ {X} de desconto concedido ({%} sobre a tabela), em {%} dos itens. Onde o preço mais cai — por vendedor, produto e cliente."
- **"Onde o preço cai":** distribuição do faturamento por **faixa de desconto** (Acima da tabela · Na tabela · 0,01-2% · 2-5% · 5-10% · +10%) — barras; mostra quanto do faturamento está em cada faixa.
- **"Quem vende mais caro e mais barato":** ranking de vendedores por índice de preço — **barras divergentes** (acima/abaixo da média).
- **"Desconto por cliente":** tabela (todos, ordenável) — Cliente · Cidade · Vendedor · **% abaixo da tabela** (barra vermelha) · Desconto · Faturamento · R$/kg. "Onde está o dinheiro que ficou na mesa."

### 2.7 LOGÍSTICA
- **Leitura:** "{N} cargas montadas no período, {X} kg por carga em média."
- **4 cards:** Cargas montadas · Peso médio por carga · Clientes por carga (entregas em média) · Notas sem carga (+ kg retirados/sem romaneio).
- **"Peso das cargas":** histograma de distribuição por faixa de peso.
- **"Cargas por dia da semana":** barras por dia (ritmo logístico).
- **Tabela "Transportadoras"** (todas, ordenável): Transportador · Cargas (barra) · Participação · Volume (kg) · Notas · Clientes. Seletor de dimensão.

### 2.8 METAS (construir no nosso sistema)
- **Aviso + CTA:** "As metas ainda não estão cadastradas. O sistema de origem manda as cotas zeradas. Abaixo, uma sugestão para a diretoria: mês anterior + 5%. Ajuste e salve; o painel passa a medir realizado × meta." Botão **"Cadastrar metas de {mês}"**.
- **Cadastro:** tela/modal para definir meta por **vendedor** (e dimensão: produto/cidade), em R$ e/ou kg, mensal. Pré-preenche com **mês anterior + 5%** (editável). Grava em `erp_meta` (tabela própria do nosso sistema — ADITIVA, RLS por company_id).
- **Tabela "{mês} por vendedor":** Vendedor (nome·código) · {mês anterior} realizado · **Meta sugerida** · Já vendido · **Projeção × meta** (barra de progresso % com semáforo: verde ≥100%, amarelo 85-99%, vermelho <85%) · Projeção (R$). Ex: Valcir 114% verde, Volmar 98% amarelo, Adriano 0% vermelho. Seletor "ordenar por" + dimensão.
- Honesto: enquanto não cadastrar, não mostra meta fake — mostra a sugestão como ponto de partida.

---

## 3. Modal "Configurar a análise" (Quais produtos entram)
- Texto: "Despojo, couro, osso, sebo e itens inativos baixam o preço médio. Escolha o que entra; o painel recalcula na hora."
- **Escopo da exclusão** (2 opções): "Só do preço médio e R$/kg (faturamento continua com tudo)" [padrão] · "De todo o painel (faturamento, volume, clientes e preço)".
- **4 cards ao vivo** (recalculam ao marcar): Produtos dentro ({N} de {total}) · Preço médio com a escolha (R$/kg) · Volume dentro (t) · Faturamento dentro (R$).
- **Presets:** "Padrão: só carne" · "Todos os produtos" · "Tirar também os inativos" · busca de produto.
- **Lista agrupada por linha** (ex: "Carne Bovina S/osso Resfriada · 39 de 39 dentro"), cada produto: checkbox · nome · faturamento · kg · R$/kg. Botões "Marcar todos" / "Tirar todos" por grupo.
- Botão "Pronto" fecha e aplica.
- A escolha do usuário persiste (por usuário/empresa).

---

## 4. Dados e RPCs
- Base: `fn_bi_comercial_base` (motor-v5) — já faz a leitura correta e o cálculo client-side (totais, por vendedor/produto/cidade/linha/dia, curva ABC, R$/kg sem despojo, índice de preço, desconto, devolução, prazo).
- RPCs auxiliares existentes a reusar: `fn_bi_comercial_kpis/pareto/produtos/ranking_vendedores/serie/totais/analise` — **todas já migradas para a fonte certa** (#4338/#4344).
- **Cálculos novos (criar RPC ou no motor, sempre na fonte certa, provando o número):** 6 segmentos RFM (Campeões/Fiéis/Novos/Ocasionais/Em risco/Sumindo); saúde da carteira (recência); cross-sell (faturamento × nº de linhas); tamanho das notas; grupos econômicos (CPF raiz); diagnóstico do período (regras de risco/oportunidade/ação); projeção do mês; metas (`erp_meta` + realizado×meta).
- **Prova obrigatória (RD-38):** cada seção fecha o aceite (R$ 13.983.740 / 482 / 127 / R$ 30,61) no período 01/10–06/11, provado em ROLLBACK ou leitura direta contra `bi_comercial_venda_item_mv`.

---

## 5. Ordem de construção (uma PR por bloco, READY, cada uma provando os números)
1. **Chassi** — filtros (período/vendedor/linha/análise) + navegação 8 abas + layout centralizado + modal de análise. (A Visão geral blocos 1-2 já feitos entram aqui.)
2. **Visão geral** — completar: Diagnóstico do período (3 colunas) + linha temporal R$/kg + projeção do mês.
3. **Vendedores** — donut + scatter + placar + barras empilhadas.
4. **Clientes** — 6 grupos RFM + Pareto/ABC multidimensional + cross-sell + tamanho notas + grupos econômicos + saúde carteira + tabela.
5. **Cidades** — donut + cards + tabela completa + drill-down.
6. **Produtos** — cards + tabela 127 + índice preço + % itens abaixo + modal integrado.
7. **Preço e desconto** — faixas + divergente + tabela cliente.
8. **Logística** — histograma + cargas/dia + transportadoras.
9. **Metas** — cadastro (`erp_meta`) + sugestão +5% + realizado×meta com semáforo.
10. **Validação final** — entra no menu (`module_catalog`), vira a rota principal substituindo o v5, nota aud8 ≥95, CEO valida na tela.

---

## 6. Checklist de aceite (o CEO valida antes do v7 virar principal)
- [ ] Todos os números fecham o aceite (R$ 13,98M / 482 / 127 / R$ 30,61) no período certo.
- [ ] Filtros recalculam tudo (período, vendedor, linha, análise).
- [ ] Modal de análise funciona (recalcula ao vivo, persiste).
- [ ] Todas as tabelas mostram TODAS as linhas (sem scroll escondendo).
- [ ] Mobile 390px redondo; fail-closed por vendedor.
- [ ] Diagnóstico do período gera insights reais e acionáveis.
- [ ] Metas: cadastra, sugere +5%, mede realizado×meta.
- [ ] Lucro/margem e metas sem dado = aviso honesto, nunca número inventado.
- [ ] Identidade PS (espresso/off-white/dourado; semáforo só performance).
