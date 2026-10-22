# Seed Frioeste — Produtos (Produtividade Indústria · Fatia 1)

Seed **versionado** dos 211 produtos da Frioeste para a tela
**Produtos (árvore)** da Produtividade Indústria (`/dashboard/produtividade/produtos`).

Conforme a SPEC (RD-41), o seed **não entra por migration** — é carregado **pela tela "Colar lista"**,
pré-preenchido e **editável** (o CEO/Cleverton ajusta o `papel` de palpite na tela). Este arquivo fica
no repo para a carga ser **reproduzível e auditável**.

## Arquivo
- `frioeste_produtos_colar.csv` — 211 produtos, no formato que a tela consome:
  colunas separadas por `;` na ordem `codigo;nome;papel;linha;secao;peso;conservacao`
  (a 1ª linha é o cabeçalho `codigo_externo;…`, reconhecido e ignorado na importação).

## Como importar (passo operacional do dono da empresa)
1. No topo, selecione a **empresa Frioeste** e a **planta** industrial.
2. Abra **Produtividade › Produtos (árvore)** e clique em **Colar lista**.
3. Cole o conteúdo de `frioeste_produtos_colar.csv`, clique **Prévia** (confere 211 válidas,
   sem linhas que não casaram) e depois **Gravar**.
4. A tela chama `fn_prod_produto_colar` (idempotente por `company_id,plant_id,codigo` — reimportar
   só atualiza, não duplica). O código de linha 332 aparece duplicado na planilha de origem;
   a importação é idempotente, então a 2ª ocorrência apenas reescreve a 1ª.

## Distribuição esperada (conferência do aceite §8)
produto_final_sem_osso 89 · produto_final_com_osso 38 · entrada_desossa 23 · subproduto 18 ·
miudo 16 · carcaca_quarto 11 · entrada_animal 8 · carcaca 5 · ignorar 3 = **211**.

> Observação: alguns nomes têm quirk de seção (ex.: "PEITO BOV. C/OSSO" está na seção S/OSSO) —
> por isso o `papel` é palpite **editável** na tela.
