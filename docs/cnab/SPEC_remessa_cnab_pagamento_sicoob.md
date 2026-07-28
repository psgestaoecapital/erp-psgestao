# SPEC — REMESSA CNAB 240 DE PAGAMENTO (motor genérico + perfil Sicoob)
Data: 27/07/2026 · Eng Chefe · Aplicação: **Code Web**
Contexto: `d2229e61` · Demanda da Jordana (BPO) · Insumos: 2 arquivos CNAB reais do Sicoob + print Omie

---

## 0. OBJETIVO
Permitir que a Jordana (BPO) faça **pagamentos em lote** gerando um arquivo de remessa CNAB 240 que ela
sobe no internet banking do Sicoob. Três formas: **boleto** (código de barras), **PIX** (chave/QR),
**transferência** (TED/crédito em conta). Depois, importar o **arquivo retorno** para baixar os títulos pagos.

🔴 É DINHEIRO SAINDO. Salvaguardas máximas: anti-duplicação (RD já existe: import_hash), aprovação antes
de gerar, teste em HOMOLOGAÇÃO antes de produção, backup/log de cada remessa (RD-54/55).

---

## 1. ARQUITETURA — 2 CAMADAS (decidida com o CEO)

**Camada 1 — MOTOR CNAB 240 (genérico, um só):** monta a estrutura padrão FEBRABAN — header de arquivo,
headers de lote, segmentos (J/O/A), trailers de lote e arquivo. Serve QUALQUER banco. Escreve-se uma vez.

**Camada 2 — PERFIL DO BANCO (configurável):** as particularidades de cada banco (código, versão de
layout, posições de uso exclusivo, formas suportadas). Sicoob primeiro; Sicredi/Bradesco depois = só um
perfil novo, NÃO um motor novo.

🔴 GENÉRICO (mesma filosofia do dia): motor não conhece "Sicoob" no código — lê o perfil. Banco é dado.

---

## 2. O QUE OS ARQUIVOS REAIS DO SICOOB ENSINARAM (medido, não suposto)

Dois arquivos `.rem` reais decodificados (EMPRESA EXEMPLO e outro). Um arquivo CNAB tem VÁRIOS LOTES, cada um
com uma forma de pagamento. Mapa Sicoob (posições do header de lote 10-11 serviço, 12-13 forma):

| Forma | tipo_serviço | forma_pgto | Segmento | Dado-chave | Fonte |
|---|---|---|---|---|---|
| Boleto (outro banco) | 03 | 31 | J | código de barras | erp_pagar.codigo_barras |
| Boleto/liquidação | 03 | 30 | J | código de barras | erp_pagar.codigo_barras |
| Tributo cód. barras | 22 | 11 | O | código de barras | erp_pagar.codigo_barras |
| PIX | 20 | 47 | J/próprio | chave PIX | erp_fornecedores.pix |
| Transferência/TED | 20 | 01/41 | A | banco/ag/conta | erp_fornecedores.banco/agencia/conta |

Header do arquivo (linha 1): banco 756 · CNPJ empresa (19-32) · **cooperativa na posição da agência
(03039)** · conta · convênio. Config Sicoob PS Gestão: coop 3039, conta 000000-0, convênio 0000000.

⚠️ Os exemplos têm segmentos **J** (boleto) e **O** (tributo) e um lote PIX. **Segmento A (TED/transferência
pura) NÃO aparece** — inferir do padrão FEBRABAN e VALIDAR EM HOMOLOGAÇÃO (ou pedir um exemplo real com TED
antes de liberar transferência em produção).

Layout de cada linha = 240 posições + CRLF. Encoding latin-1. Detalhes de posição no anexo (o Code Web
deve extrair dos 2 arquivos reais em /tmp — ou o CEO reenvia — posição a posição por segmento).

---

## 3. O QUE JÁ EXISTE (RD-26)
- `erp_pagar`: `forma_pagamento`, `codigo_barras`, `import_hash` (ANTI-DUP — salvaguarda), `status`, `valor`, `data_vencimento`, `fornecedor_id`
- `erp_fornecedores`: `banco`, `agencia`, `conta`, `pix`, `cnpj_cpf` (destino PIX/TED)
- `erp_banco_provider_config` (Sicoob prod): coop 3039, conta 000000-0, convênio 0000000, certificado no vault
- Modelo UX de referência: print Omie — aba "Integração Bancária e CNAB" por título, seletor de forma

---

## 4. O QUE FALTA CONSTRUIR

### 4.1 Perfil de forma de pagamento no título (espelha o Omie)
Em `erp_pagar`, garantir/usar `forma_pagamento` com os valores: `boleto`, `pix`, `transferencia`, `tributo`.
A tela do título ganha (ou usa) a escolha da forma — como a aba "Integração Bancária e CNAB" do Omie.
Cada forma exige um dado: boleto/tributo→código de barras; pix→chave; transferência→dados bancários do fornec.
🔴 Validar que o dado existe ANTES de incluir na remessa (RD-51: não gerar linha incompleta).

### 4.2 Tabela de remessa/lote (NOVA)
```
erp_remessa_pagamento:
  id, company_id, banco_provider_id, numero_sequencial (Sicoob exige numeração!),
  status ('rascunho'|'gerado'|'enviado'|'retorno_parcial'|'concluido'|'cancelado'),
  arquivo_nome, gerado_em, gerado_por, aprovado_por, total_titulos, valor_total,
  retorno_importado_em, created_at
erp_remessa_pagamento_item:
  id, remessa_id, erp_pagar_id, forma, valor, status_item, ocorrencia_retorno
```
Numeração sequencial por banco/empresa (o Sicoob rejeita remessa com número repetido).

### 4.3 Motor gerador CNAB 240 (genérico + perfil Sicoob)
- Função/edge que recebe a lista de títulos selecionados + o perfil do banco
- Agrupa por forma → um LOTE por forma (como nos arquivos reais)
- Monta header arquivo, header lote, segmentos (J boleto/tributo, A transferência), trailers
- Preenche do perfil Sicoob: banco 756, coop 3039, conta, convênio 0000000
- Saída: arquivo `.rem` (240 col, latin-1, CRLF) para download
- 🔴 Idempotente + trava anti-duplicação: um título já numa remessa 'gerado/enviado' NÃO entra em outra
  (usa import_hash / status). Nunca gerar o mesmo pagamento 2x.

### 4.3b CAMPOS DA TELA POR FORMA (espec. de UX pronta — prints do Omie que a Jordana enviou)
A aba "Integração Bancária e CNAB" de cada título mostra campos DIFERENTES conforme a forma escolhida:

**Forma = Pagamento de Boleto:**
- Código de Barras (de cobrança bancária, concessionária ou impostos)
- % de Juros ao mês do boleto · % de Multa por atraso

**Forma = Pagamento PIX QR-Code:**
- QRCode do Pix (Copia e Cola) — um único campo, o código copia-e-cola

**Forma = Transferência Bancária:**
- Banco · Agência · CNPJ/CPF do Titular · Nome do Titular (importados do cadastro do favorecido)
- Finalidade (lista): Impostos/Tributos/Taxas · Concessionárias · Dividendos · Salários · Fornecedores ·
  Honorários · Aluguéis/Condomínio · Duplicatas/Títulos · Mensalidade Escolar · Crédito em Conta ·
  Corretoras · Pensão Alimentícia · Transferência por Chave PIX · Transferência por Conta Corrente PIX

🔴 A "Finalidade" mapeia para o código de finalidade do CNAB (posição no segmento A/J). Cada opção tem
seu código FEBRABAN/Sicoob — extrair do manual ou de exemplos reais.

### 4.3c 🔴 QUESTÃO DE BANCO (Sicoob vs Sicredi) — DECISÃO DO CEO
Os arquivos `.rem` reais que temos são **Sicoob (756)**. Os prints do Omie mostram conta **Sicredi (748)**.
No sistema, Sicoob está completo (coop 3039, conta, convênio 0000000); Sicredi tem coop 0313 mas SEM
conta/convênio. O modelo de UX (formas/campos) é genérico e serve os dois. O que difere é o PERFIL (layout).
→ Temos o layout do **Sicoob** provado (2 arquivos reais). NÃO temos o do Sicredi.
→ Recomendação: **construir e provar o perfil SICOOB primeiro** (temos exemplos reais). Sicredi entra
depois, como novo perfil, quando tivermos um `.rem` real dele. Confirmar com o CEO em qual banco a
Jordana vai operar primeiro no PS (o print Omie é do sistema atual dela, não do nosso).

### 4.4 Tela de remessa
- Jordana (operador BPO) filtra títulos a pagar (por vencimento, fornecedor, forma)
- Seleciona os que quer pagar → vê total e contagem
- 🔴 CONFIRMAÇÃO DO PRÓPRIO OPERADOR (decisão do CEO — NÃO há segundo aprovador):
  o operador logado é a autoridade. Antes de gerar, o sistema mostra uma mensagem de confirmação
  ("Você está gerando uma remessa de N pagamentos, total R$ X, para a empresa Y. Confirmar?").
  Não é um fluxo de dois aprovadores — é o operador confirmando a própria ação, com rede de proteção.
- 🔴 RASTREABILIDADE TOTAL (o ponto central do CEO): TUDO fica registrado — quem gerou (usuário logado),
  quando (timestamp), quais títulos, qual valor, qual empresa, qual banco. Usar a infraestrutura de
  auditoria que JÁ EXISTE: `audit_log` / `audit_log_global` / `erp_lancamento_log` (RD-26 — reusar, não criar).
  A própria `erp_remessa_pagamento` guarda gerado_por + gerado_em; o audit_log registra o evento completo.
  Objetivo: responder sempre "quem fez esta remessa de R$ X?" com nome, data, hora e conteúdo.
- Gera o `.rem` → baixa → sobe no internet banking Sicoob
- Linguagem UX: "GEROU remessa", não "INSERT"

### 4.5 Importador do arquivo RETORNO
- Jordana sobe o arquivo retorno do Sicoob
- Sistema lê as ocorrências (pago / rejeitado / com pendência) por título
- Baixa (marca pago) os títulos confirmados; marca os rejeitados com o motivo
- Atualiza status da remessa

---

## 5. SALVAGUARDAS (RD-54/55/57 — dinheiro saindo)
- [ ] Anti-duplicação: título em remessa ativa não entra em outra (import_hash + status)
- [ ] CONFIRMAÇÃO do próprio operador antes de gerar (mensagem "confirma N pagamentos, R$ X?") — sem 2º aprovador
- [ ] RASTREABILIDADE TOTAL: registrar quem/quando/o quê/quanto/qual empresa em audit_log (já existe) +
      gerado_por/gerado_em na remessa. Responder sempre "quem fez esta remessa?"
- [ ] Numeração sequencial única por banco/empresa
- [ ] Testar em AMBIENTE DE HOMOLOGAÇÃO Sicoob antes de produção (a config homolog já existe)
- [ ] Segmento A (transferência) validado em homolog antes de liberar (não veio nos exemplos)
- [ ] Salvaguarda testada em todos os caminhos: manual, seleção em lote (RD-57)

---

## 6. FASES (DECISÃO DO CEO: Sicoob primeiro · as 3 formas de uma vez)

Banco: **SICOOB** (temos 2 arquivos `.rem` reais). Escopo: **boleto + PIX + transferência juntos.**

- **F1 — Fundação + Boleto + PIX + Tributo (as formas COM exemplo real).**
  Motor CNAB 240 genérico + perfil Sicoob + tabela de remessa + geração de: boleto (seg J, forma 31),
  tributo (seg O, forma 11), PIX (forma 47). 🔴 Prova byte a byte contra os 2 `.rem` reais do Sicoob.
- **F1-T — Transferência/TED (seg A) — CONSTRUÍDA porém TRAVADA para produção.**
  Monta o segmento A do padrão FEBRABAN. 🔴 NÃO temos `.rem` real de TED do Sicoob → marcar a forma
  "transferência" como **disponível só em HOMOLOGAÇÃO** até: (a) o CEO conseguir um `.rem` real de TED, OU
  (b) teste em homologação Sicoob confirmar aceite. Só então liberar para produção. (RD-38: prova real.)
- **F2 — Importador do arquivo RETORNO** (baixa automática dos títulos pagos).
- **F3 — Tela de remessa completa + aprovação** (seleção, total, gate de aprovação, download).

Motivo da trava só no TED: boleto/PIX/tributo têm layout provado por arquivo real; TED é inferido —
e é dinheiro saindo, não pode ir a produção sem prova (RD-38/54/55).

🔴 Cada fase: prova gerando arquivo e comparando com os `.rem` reais (byte a byte no que temos exemplo).
Homologação antes de produção. PR DRAFT (RD-56).

---

## 7. PERGUNTAS AO CEO/JORDANA
1. A ordem das fases (boleto→pix→tributo→ted→retorno→tela) faz sentido, ou prioriza outra forma?
2. Quem APROVA a remessa antes de gerar? (papel/pessoa — dinheiro saindo, precisa de gate)
3. Consegue um arquivo `.rem` real com TRANSFERÊNCIA/TED (segmento A) do Sicoob? Fecharia a lacuna do F3.
4. Começa só na PS Gestão LTDA (b26c19c0, que tem Sicoob configurado) ou já em outra empresa BPO?
5. A numeração sequencial da remessa: começa em 1, ou continua de onde o Sicoob/Omie parou? (evitar colisão)
