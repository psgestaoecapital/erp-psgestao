# Painel comercial v5 — especificação aprovada pelo CEO (07/11/2026)

Protótipo aprovado: `tela.dc.html` (marcação) + `logica.js` (todo o cálculo). É a referência de leiaute, cálculo e
textos para `/dashboard/comercial/meu-painel` (desktop e celular). Os números do protótipo foram provados contra o banco
(Frioeste, 01/10–06/11/2026: R$ 13.983.740 · 6.285 itens · 482 clientes · 127 produtos · R$ 30,61/kg na análise padrão).

## Pacote de dados que a lógica espera (`__BASE__`)

Fonte: `fn_com_venda_item(company, de, ate)` + `ind_atak_fato` (domínios `comercial_venda_item` e `comercial_devolucao`).
No sistema, isso vem de uma **RPC nova de leitura** com a mesma guarda de escopo do BI (`fn_bi_comercial_scope` /
`com_vendedor_acesso`): o vendedor recebe só as linhas dele.

| chave | forma | origem |
|---|---|---|
| `items` | `[dia, nota, vendedor, cliente, produto, kg, valor, valor_tabela, carga, transportador]` (índices nas listas abaixo; `dia` = dias desde o início; `carga` = -1 sem carga) | `fn_com_venda_item` |
| `cli` | `[nome, cidade, grupo_economico]` (`grupo` = -1 sem grupo; pessoa física → "Pessoa física") | `NOME_CADASTRO`, `CIDADE/UF`, raiz de 8 dígitos do `CPF_CGC` com mais de uma loja |
| `grp` | nomes dos grupos econômicos | maior loja do grupo |
| `prod` | `[nome, linha, carne(0/1)]` | `DESC_PRODUTO_NF`, `DESC_DIVISAO`, regra `carne` da função |
| `cid`, `tr` | nomes | `CIDADE/UF`, `NOME_TRANSPORTADOR` |
| `ven` | `[codigo, nome]` | `COD_VEND_COMP`, `NOME_COMP` |
| `notas` | `[prazo_medio, condicao]` | `PRAZO_MEDIO`, `DESC_COND_PGTO` |
| `dev` | `[dia, vendedor, cliente, produto, valor, kg, documento, nome_produto]` | `comercial_devolucao` |

Orçamento para o celular: payload ≤ 1,5 MB e primeira tela em ≤ 2 s em 4G. Até 90 dias vai item a item (cerca de
400 KB por mês, com compressão bem menos); acima disso, agregue no servidor por dia × produto × cliente.

## Regras de cálculo (as que importam)

- **Produtos na análise** (engrenagem): padrão = só carne e miúdos; o despojo fica fora. Há dois escopos: "fora só do
  preço/R$ por kg" (padrão) ou "fora de todo o painel". Salvo **por empresa** em `bi_comercial_produto_classificacao`
  (hoje vazia); só a diretoria ou o admin altera. Há 3 cortes de carne na linha "Inativos" (Patinho, Coxão mole,
  Músculo): é exatamente o caso que a engrenagem resolve.
- **Índice de preço** = Σ valor ÷ Σ (kg × preço médio da empresa **no mesmo produto**) × 100. O índice compara produto a
  produto, nunca linha a linha: por linha aparecia "17% abaixo", que era efeito de mix.
- **Metade 1 × metade 2**: normalizar por dias corridos de cada metade, não por dias com venda.
- **Projeção do mês**: ritmo por dia útil (segunda a sexta, menos feriados) × dias úteis do mês.
- **Segmentos de clientes**: Campeões (≤7 dias e ≥8 dias de compra), Fiéis (≤14 e ≥4), Novos (1ª compra nos últimos
  17 dias), Ocasionais (≤14), Em risco (≤30 e ≥3), Sumindo (o resto).
- **Metas**: o sistema de origem manda as cotas zeradas. A sugestão é mês anterior + 5%; o cadastro vai em `erp_meta`.
- Nada é pré-selecionado: as tabelas listam tudo, ordenam pelo cabeçalho, pelo seletor e pelo botão de inverter, e todo
  gráfico mostra o detalhe ao passar o mouse ou tocar.
