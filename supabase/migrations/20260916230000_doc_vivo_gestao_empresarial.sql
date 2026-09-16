-- Documento Vivo por Vertical (RD-41) — gestao_empresarial. Markdown em coluna TEXT; um vigente por vertical.
-- Gerado do arquivo de origem; md5 conferido. Idempotente (só insere se ainda não há vigente).

INSERT INTO public.erp_documento_vertical (vertical, titulo, conteudo_md, versao, vigente, origem_arquivos, resumo_mudanca, status)
SELECT 'gestao_empresarial', 'Gestão Empresarial — Documento Mestre Vivo', $docmd$# 🏢 PS GESTÃO ERP · GESTÃO EMPRESARIAL — **DOCUMENTO MESTRE VIVO**
## Tese · Fronteira · Estado real · Ondas · Riscos

**Criado:** 16/09/2026 · **Autor:** Engenheiro Chefe · **Aprovação:** CEO Gilberto Paravizi
**Validadores:** as 22 empresas em produção — **toda empresa do sistema passa por aqui**

> ## ⚠️ PRIMEIRO DOCUMENTO DA VERTICAL
> A GE **nunca teve blueprint**. É a vertical mais usada do sistema e a única sem documento —
> este é o primeiro, escrito a partir da auditoria do banco em 16/09/2026.

---

# PARTE I — A TESE

## 1.1 A GE não é uma vertical. É o núcleo.

> **Toda vertical de produto (Oficina, Revenda, Compliance, Hub, Industrial) faz o trabalho técnico e dispara evento. A GE recebe o evento e transforma em dinheiro, imposto e resultado.**

**A prova disso está no dado:** a GE é a única vertical **sem tabela própria**. Ela vive em `erp_pagar`, `erp_receber`, `erp_clientes`, `erp_plano_contas` — o **núcleo transversal** que todas as outras escrevem.

⚠️ **Por isso a barra "em uso" dela é `sem dado`**, e não zero. Medir uso da GE por tabela específica não se aplica — ela é a tabela específica de todo mundo.

## 1.2 🔒 A fronteira inviolável

> **Financeiro é monopólio da Gestão Empresarial.**

Nenhuma vertical constrói tela de contas, DRE, fluxo de caixa ou estoque. Elas **disparam evento**.

⚠️ **Refinamento (`c2869c85`):** as verticais **LEEM** dado financeiro da GE — isso é aceitável. O que não fazem é **ESCREVER**. E a fronteira é definida por **quem chama** (a tela), não pelo nome da RPC.

**Casos reais de 2026:**
- a Oficina entrega a OS → a fila de faturamento vive em `/dashboard/financeiro/faturar-os`, **na GE**
- a Revenda lança custo do veículo → dispara `erp_pagar`, **não cria contas próprias**
- o Compliance calcula o custo do EPI → entra no resultado pela GE

## 1.3 O diferencial

**O concorrente é ERP genérico** (Omie, ContaAzul, Bling, Tiny). Eles fazem financeiro bem e **não entendem de operação**.

**A PS entrega o financeiro com a operação por baixo:** a hora do mecânico vira custo real, o carro parado no pátio vira capital empatado, a pausa térmica vira passivo trabalhista — **tudo no mesmo DRE.**

---

# PARTE II — ESTADO REAL (16/09/2026)

## 2.1 As três barras

```
construído  ██████████░░░░░░░░░░  49% (estimado)
auditado    ████████████████████  43% (20 de 46 telas)
em uso      ░░░░░░░░░░░░░░░░░░░░  sem dado (é o núcleo)
```

**46 telas** — a maior vertical do sistema.

## 2.2 O volume — e ele é grande

| Item | Qtd |
|---|---|
| **Empresas em produção** | **22** |
| Clientes | **5.567** |
| Fornecedores | **3.288** |
| Produtos | **4.189** |
| **Contas a pagar** | **11.199** |
| **Contas a receber** | **4.019** |
| Plano de contas | **1.533** |
| Contas bancárias | 64 |
| Movimentos conciliados | 1.567 |
| NFS-e emitidas | 102 |
| NF-e emitidas · recebidas | 19 · **569** |
| Contratos recorrentes | 20 |

> **É a vertical com mais dado real do sistema.** E aparece com 49% construído.

## 2.3 🔴 O achado grave — `erp_lancamentos` está em ZERO

**A fonte única do DRE não tem um registro.**

```
erp_lancamentos ... 0
```

⚠️ **Consequência:** o DRE, o fluxo de caixa e a saúde financeira **leem de uma tabela vazia**, ou leem de outro lugar que ninguém documentou.

🔴 **Isto precisa ser investigado antes de qualquer onda nova.** Se o DRE funciona hoje, ele lê de `erp_pagar`/`erp_receber` direto — e então `erp_lancamentos` é estrutura morta ou promessa não cumprida. **As duas hipóteses importam.**

## 2.4 As 46 telas

| Estado | Qtd |
|---|---|
| **pronto** | **8** — Conciliação · Conciliação Lote · Configurar DRE · Dados da Empresa · Hub Fiscal · NF-es Emitidas · NFS-es Emitidas · Plano de Contas |
| **parcial** | **29** |
| placeholder | 4 *(3 legados + NFS-e Nacional)* |
| desconhecida | 3 *(Rateio · Viabilidade · Configurar Linhas)* |
| 🔴 **quebrada** | **1 — Onboarding Gestão Empresarial** |
| sem selo | 1 *(Remessa de Pagamento)* |

🔴 **A tela de onboarding está QUEBRADA.** É por onde toda empresa nova entra.

## 2.5 As integrações — 13 em produção

```
BANCOS ...... Sicoob (prod + homolog) · Bradesco · Pluggy
FISCAL ...... Focus NFe
CONTÁBIL .... Omie
PONTO ....... IOPoint
IA .......... Anthropic
MERCADO ..... Brapi
INFRA ....... Supabase · registro.br · APS · auditor Gold
```

---

# PARTE III — AS ONDAS

## 3.1 ⚠️ O que `ge_roadmap_ondas` realmente é

**As 11 "ondas" cadastradas são INTEGRAÇÕES FUTURAS, não entregas fechadas.**

| # | Onda | Status |
|---|---|---|
| 1 | Fundação Fiscal · NFe/NFSe/MDe | em andamento |
| 2 | Cobrança Automatizada · Asaas | planejada |
| 3 | Open Finance · Pluggy | planejada |
| 4 | Governança · Alçadas + Auditoria | planejada |
| 5 | 3-Way Matching + SPED | planejada |
| 6 | Cadastros 100% Operacionais | planejada |
| 7 | Financeiro Operacional Completo | planejada |
| 8 | Onboarding + Wizards Setup | planejada |
| 9 | Importação Massiva · Universal Importer v2 | planejada |
| 10 | Consultor IA + Relatórios Premium | planejada |
| 11 | Gaps vs ContaAzul/Omie | backlog |

🔴 **NÃO usar como medida de progresso.** Zero concluídas daria "GE 0% construída" — sendo a vertical mais pronta e mais usada. *(provado em 16/09)*

⚠️ **E os gatilhos de custo importam:** Asaas e Pluggy têm gatilho de MRR (R$ 25k), Focus tem gatilho de R$ 35k. **RD-42: custo zero até cliente bancar.**

## 3.2 O que já está no ar e opera

**Financeiro:** contas a pagar e receber com baixa parcial, juros e desconto · fluxo de caixa previsto × realizado · plano de contas hierárquico · centro de custo · rateio · inadimplentes agrupados · renegociação · contratos recorrentes

**Bancos:** conciliação com sugestão automática · OFX · CNAB remessa e retorno · extrato · conexões guiadas

**Fiscal:** NF-e e NFS-e · NF-e recebida e escriturada · ISS por município · certificado A1 no Vault · hub fiscal

**Cadastros:** clientes e fornecedores por CNPJ (BrasilAPI) · produtos com custo médio · contas bancárias · divisões

**Resultado:** DRE por competência e caixa · DRE divisional · saúde financeira com drill-down

---

# PARTE IV — PRINCÍPIOS DE DESENHO

1. 🔒 **Linguagem UX inviolável:** CRIOU / ALTEROU / EXCLUIU — **nunca** INSERT/UPDATE/DELETE na interface
2. **Toda tela diz o que falta E o impacto** (`0e580f96`)
3. **O sistema nunca afirma o que não sabe** (RD-51) — margem sem custo aparece como "não informado", nunca como 100%
4. **Mobile-first** — o dono olha o resultado no celular
5. **Linguagem do usuário:** *"Quanto custa?"* em vez de *"Valor"* · *"Para quem você paga?"* em vez de *"Fornecedor"*
6. **Avisar, não bloquear**

---

# PARTE V — RISCOS E CONFORMIDADE

**Reforma Tributária 2026-2032** ⚠️ 2026 é ano-teste. **Alíquota nunca fixa em código** — sempre parâmetro por empresa e por competência.

**Lei 12.741/2012** ⚠️ o valor aproximado dos tributos é obrigatório na nota. **102 NFS-e saíram sem ele** — corrigido em 15/09, mas o histórico permanece.
➡️ Simples Nacional usa o percentual único **por competência** *(a alíquota efetiva muda mês a mês)*; Lucro Real precisa da tabela IBPT.

**LGPD** ⚠️ 5.567 clientes e 3.288 fornecedores com CNPJ, endereço e contato. RLS multi-tenant · trilha de auditoria · consentimento versionado.

**Certificado A1** 🔒 no Vault, nunca em coluna aberta. **E são dois certificados diferentes:** o A1 fiscal e o de comunicação bancária. *(confundir os dois custou 12 dias num chamado)*

**Conciliação** ⚠️ dinheiro conciliado errado é erro que ninguém percebe. Sugestão automática **sugere**; o operador confirma.

---

# PARTE VI — O QUE FALTA

## 🔴 Crítico

**`erp_lancamentos` em zero** — investigar de onde o DRE lê hoje

**A tela de onboarding quebrada** — é a porta de entrada de toda empresa nova

**3 telas desconhecidas** — Rateio, Viabilidade, Configurar Linhas

## 🟡 Chamados abertos

Da Jordana — a operadora do BPO, que usa a GE todo dia:
- **#38** erro de conciliação *(alta, 7 dias)*
- **#63** registro de dificuldades
- **#61** tela de chamados perde texto
- **#20** NF na OS *(11 dias)*

Da FC Pisos — **prazo 01/10:**
- **#32** ISS por município · **#35** faturamento de serviço

## 📊 Backlog vindo do mercado

- **Asaas** (PIX + boleto) — gatilho MRR R$ 25k
- **Pluggy Open Finance** — gatilho MRR R$ 25k
- **3-Way Matching + SPED**
- **Alçadas e governança**
- **Consultor IA** — o diferencial não construído

---

# PARTE VII — DECISÕES ABERTAS

| # | Decisão | Com quem |
|---|---|---|
| **D1** 🔴 | De onde o DRE lê hoje, se `erp_lancamentos` está vazia? | **Engenharia** |
| **D2** 🔴 | Consertar a tela de onboarding | **Engenharia** |
| **D3** | Tabela IBPT para empresa do Lucro Real *(a FC Pisos)* | **CEO / contador** |
| **D4** | Redação da Lei 12.741 nas notas | **advogado/contador** |
| **D5** | Quando ligar Asaas e Pluggy *(gatilho de MRR)* | **CEO** |
| **D6** | O plano de contas gerencial × contábil — vínculo imutável *(`bda75838`)* | ✅ decidido |

---

# PARTE VIII — GENERICIDADE

🔒 **A GE atende 22 empresas de ramos diferentes** — frigorífico, oficina, revenda, gesseira, agência, clínica, consultoria.

**Nenhum objeto pode ter nome de empresa.** Plano de contas, centro de custo, categoria e parametrização fiscal são **cadastro por empresa**.

> **Se um dia só funcionar para uma, é bug de produto.**

---

*Documento mestre vivo · 16/09/2026. Primeiro blueprint da vertical — escrito a partir da auditoria do banco de produção, sem documento anterior. Concorrência: Omie, ContaAzul, Bling, Tiny, Conta Azul.*
$docmd$, 1, true, ARRAY['PS_GestaoEmpresarial_DOCUMENTO_VIVO.md']::text[],
       'Consolidação inicial no banco (RD-41).', 'rascunho'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_documento_vertical WHERE vertical='gestao_empresarial' AND vigente);
