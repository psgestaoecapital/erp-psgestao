-- =============================================================================
-- P&M V5 · Documento vivo + Ondas P0–P10 + Catálogo honesto das 23 telas
-- Pacote LEIA-ME_Code_Web_PM_V5 · Partes A e B (PR-1). Só dados de catálogo.
--
-- Regras honradas:
--   RD-52 idempotente (reaplica limpo no push da main).
--   RD-30 nada é dropado/apagado; pem_roadmap_ondas só recebe UPDATE (a FK
--         pem_roadmap_prs.onda_id é ON DELETE CASCADE — DELETE em onda apagaria PRs).
--   RD-38 tudo resolvido no dado real (CEO por e-mail, ids das ondas por número,
--         estado_real pelos valores do CHECK, badge pela lógica real de feature_catalog).
--   Total de PRs preservado (31): A3 só remapeia onda_id, nunca muda status nem apaga.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PARTE A1 · Documento vivo em erp_documento_vertical (vertical 'pm', versão 5)
-- criado_por/aprovado_por = CEO Gilberto, resolvido por e-mail (RD-38, não chutado):
--   users.email = 'gilberto.paravizi@gmail.com' → 4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb
-- -----------------------------------------------------------------------------
INSERT INTO public.erp_documento_vertical
  (vertical, titulo, conteudo_md, versao, vigente, origem_arquivos, resumo_mudanca, status, criado_por, aprovado_por, aprovado_em, criado_em)
SELECT
  'pm',
  'Produção & Marketing — Documento Mestre Vivo (V5)',
  $pmdoc$# 📣 PS GESTÃO ERP · PRODUÇÃO & MARKETING — **DOCUMENTO MESTRE VIVO V5**
## Tese · Estado real · Fluxo · Fronteira GE · Ondas P0–P10 · Gold · Visita PDOIS

**Vertical (chave no banco):** `pm` · **Rotas:** `/dashboard/pm/*`
**Piloto:** Agência PDOIS / Prigol (`36b69d77-b4ea-414b-8519-2ff6621c8de7`) · planos ativos `v15_pm_grande` + `v15_gestao_empresarial_pro`
**Versão:** V5 · 18/09/2026 · Engenheiro Chefe, com auditoria no banco e no código
**Substitui:** Blueprint V4.0 (14/08, Project Knowledge) **e** a tabela `pem_roadmap_ondas` (29/05). As duas divergiam. Esta V5 reconcilia ambas com o dado real.
**Onde vive:** `erp_documento_vertical` (vertical `pm`, versão 5, vigente). As ondas espelham em `pem_roadmap_ondas`.

> 🔒 Antes de qualquer criação na vertical, ler este documento e `erp_contexto_projeto` (RD-26). Nada aqui é hardcoded para a PDOIS: ela é o piloto, e a vertical é multi-tenant.

---

# 1. A TESE

A PS não compete com o Canva nem com o SIGA tela a tela. Ela **orquestra** o que a agência vende e **mostra o lucro real por cliente e por serviço**.

Para isso, três coisas que o SIGA não faz:
1. **Controle de escopo:** o que foi contratado × o que foi realizado, com alerta quando estoura.
2. **Medição de tempo em cada etapa**, configurável por cliente.
3. **Margem real** = receita − (tempo × custo-hora + custos diretos + despesas indiretas rateadas).

🎯 **A meta de negócio que valida a vertical:** a PDOIS **cancela o SIGA** (R$ 848/mês). Enquanto o SIGA estiver ligado, a P&M não substituiu nada, por mais telas que tenha.

## 1.1 As 5 regras invioláveis

1. **Multi-tenant.** Tudo por `company_id`; nada hardcoded PDOIS.
2. **Cadastro e financeiro são da GE.** Clientes = `erp_clientes`. Receitas e despesas = `erp_receber` / `erp_pagar`. **Contratos = `erp_contratos`** (diretriz do CEO de 25/08, contexto `a96abc37`). A P&M consome e irriga a GE via `lancamento_id`; nunca recria.
3. **Não dropar `agency_*`** (RD-30). Legado vira *soft*, nunca some.
4. **Só é entregue o que foi provado na tela, com dado real** (RD-38). "Não testado" ≠ "quebrado" (RD-64).
5. **3 Pilares:** Conformidade · Segurança/LGPD · Facilidade de uso. Linguagem CRIOU/ALTEROU/EXCLUIU.

## 1.2 🔒 A fronteira com a GE

| Assunto | Dono | A P&M faz |
|---|---|---|
| Cadastro de cliente | GE (`erp_clientes`) | autocomplete sempre em `erp_clientes`; `agency_clientes` é extensão (FK `erp_cliente_id`) |
| Contrato / fee mensal | GE (`erp_contratos` + motor de recorrência) | cria o contrato na GE a partir da proposta aprovada; a tela Contratos da P&M é atalho filtrado |
| Contas a receber / pagar | GE | nunca lança direto; sempre pelo motor da GE |
| NFS-e | Motor fiscal compartilhado | reusa; nunca um emissor próprio |
| Rateio de indiretas | GE (`rateio_*`) | consome para a margem por cliente |
| Funil, proposta, briefing, job, tempo, escopo, margem | **P&M** | é o que a vertical constrói |

---

# 2. OS PAPÉIS

| Papel | Faz | Mede / ganha |
|---|---|---|
| **Comercial** | vende o contrato ou o fee | comissão sobre a venda |
| **Responsável do fee** (gestor da conta) | orquestra o fee, encaminha jobs, cumpre o contrato | entrega e prazo |
| **Produção** (designer, social, mídia) | produz o job, etapa a etapa | tempo por etapa |

Na PDOIS: Karine e Edney (donos) · Luzardo (pedidos do comercial) · Juliano (comercial) · Marciana (ia cadastrar os contratos reais) · Julia (BPO financeiro PS).

---

# 3. ESTADO REAL (18/09/2026) — auditado no banco

## 3.0 🔴 A leitura que muda o documento

**O comercial foi construído e está sendo usado. E travou na proposta.**

| Etapa | O que o banco mostra (ativos) |
|---|---|
| Leads | **55** · proposta 25 · perdido 12 · negociação 7 · ganho 5 · reunião 4 · novo 2 · último cadastro 08/09 |
| Propostas | **23** · **rascunho 20 (R$ 40,9 mil parados)** · recusada 2 · aprovada 1 · **enviadas: 0** · última criada há 17 dias (01/09) |
| A única "aprovada" | "PAINEL DE LED DUPLO", **R$ 0,00**, sem número, criada e aprovada no mesmo dia → teste ou bug de total (verificar na visita) |
| Contratos | **0** em `erp_contratos` · **0** em `agency_contratos` (a demo foi apagada em 04/09 "antes da Marciana cadastrar o contrato real", e nada foi cadastrado depois) |
| Produção | **0** jobs · 0 briefings · 0 tarefas · 0 timesheet |
| NFS-e emitida pela PS | **0** |
| Financeiro GE (BPO) | em uso diário: 936 a receber · 1.175 a pagar · 760 clientes · último lançamento hoje |

**Conclusão:** nada depois da proposta existe na prática. Não é falta de tela, porque as telas de contrato, briefing, job, aprovação e margem já existem. **É a corrente que não fecha:** a proposta não sai do rascunho, então não há aprovação, contrato, faturamento nem produção para medir.

## 3.1 As 23 telas

| Classe | Telas | Leitura |
|---|---|---|
| ✅ **Reais e em uso** (8) | leads (1.024 linhas) · propostas (708) · serviços (350) · configurações (321) · agenda (307) · contratos (333) · comercial (136) · comissão (139) | carregam o comercial |
| 🟡 **Construídas, nunca usadas** (7) | briefings · apontamento-horas · aprovação · margem-job · portfólio · equipe · cobrança | existem, mas sem dado; o uso depende das ondas P3–P7 |
| ⚪ **Cascas** (7, 8 linhas cada) | benchmark · bot · eventos · health-score · ia-preco · ia-preditiva · integrações | previstas; não podem aparecer como "pronto" |
| Hub | `/dashboard/pm` | KPIs de moat "em cálculo" desde 14/08 |

**Catálogo:** só **9 das 23** rotas estão em `system_screens`, e **nenhuma** tem botão Gold. O mapa visual do Gold hoje enxergaria menos da metade da vertical.

## 3.2 O que da V4.0 já existe no banco

| Item V4.0 | Estado |
|---|---|
| Elos da espinha dorsal: `agency_clientes.erp_cliente_id` · `agency_jobs.contrato_id` / `fee_id` · `agency_contratos.responsavel_id` · `agency_timesheet.etapa_tipo` / `cliente_id` · `agency_propostas.lead_id` / `contrato_id` | ✅ todos existem |
| `agency_contrato_itens` (escopo quantificado) | ✅ tabela existe, 0 linhas |
| `agency_etapa_medicao_config` (liga/desliga por etapa e cliente) | ❌ não existe |
| `agency_campanhas` | ❌ não existe (opcional) |
| `fn_agency_contrato_consumo` · `fn_agency_contratado_vs_realizado` | ❌ não existem |
| `fn_pm_rentabilidade_cliente` · `fn_pm_margem_servico` | ❌ não existem |
| Envio da proposta ao cliente (link / PDF / aceite) | ❌ não existe função de envio |
| RPCs de BI `fn_pm_bi_*` · `fn_pm_kanban` | ✅ existem |

## 3.3 Por que a proposta não sai do rascunho — **hipóteses, não fatos** (RD-38)

- **(a) Não existe envio pelo sistema.** Não há função de envio, e o pedido #15 do Luzardo (24/08) reduziu o card da proposta a Editar/Excluir.
- **(b) A proposta sai por fora** (PDF do SIGA, Canva, WhatsApp), e o sistema virou rascunho de consulta.
- **(c) O fechamento acontece e ninguém registra.** São 5 leads ganhos contra 1 proposta aprovada de R$ 0.

➡️ **A visita de hoje decide** (roteiro no §7). A Onda P2 só é especificada depois dessa resposta.

## 3.4 Dívidas abertas conhecidas

| # | Dívida | Contexto |
|---|---|---|
| 1 | Leads novos sumiam do Kanban (`novo` × `novo_atendimento`). Hoje não há nenhum lead em `novo`: **provavelmente corrigido, falta confirmar o CHECK constraint** | `27d7c52c` |
| 2 | Dois kanbans distintos (pm/leads × OportunidadesKanban). Decisão QW4 pendente: unificar (RD-52) ou ajustar | `2cd8e760` |
| 3 | Texto do rótulo do valor do lead (QW5): o Luzardo não mandou o texto exato | `2cd8e760` |
| 4 | Backlog Luzardo: criador no card (#14) · KPIs por responsável · filtro por período · duplicar serviço (#25, RPC pronta) | `1f4f701c` · `a1c7413f` |
| 5 | Consolidar contratos na GE: aguarda decisões A e B do CEO | `c1148ce5` |
| 6 | Dois catálogos de serviço (`projetos_servicos` × `agency_servico`) | `0651f253` |
| 7 | Badges "pronto" em cascas | `57ad78c4` |

---

# 4. O FLUXO (mantido da V4.0)

```
  ── MEDIÇÃO DE TEMPO (cronômetro configurável em cada etapa · liga/desliga por cliente) ──

COMERCIAL   Lead → Reunião → Proposta → ENVIO → Aprovação do cliente → Contrato (GE, com escopo)
                                          ▲ P2 — o gargalo de hoje            │
FATURAMENTO                                               Fee recorrente → A receber + NFS-e + boleto (P4)
                                                                              │
PRODUÇÃO    Briefing → Planejamento → Job → Aprovação do cliente → Entrega/Publicação (P5)
                                        ★ alerta se ultrapassa o contratado (P6)
                                                                              │
CONTROLE    Tempo × custo-hora + diretos + indiretas rateadas → Margem por cliente e por serviço → BI (P7)
```

| Etapa | Tabela | Tela | Hoje |
|---|---|---|---|
| Lead / funil | `agency_leads` + `funil_etapa` | `/pm/leads` | ✅ em uso |
| Agenda / reunião | `erp_agendamento` | `/pm/agenda` | ✅ em uso |
| Catálogo | `agency_servico` | `/pm/servicos` | ✅ em uso |
| Proposta | `agency_propostas` + itens | `/pm/propostas` | 🟡 cria, não envia |
| Contrato | `erp_contratos` (+ `agency_contrato_itens`) | `/pm/contratos` → atalho GE | ❌ 0 |
| Faturamento | `erp_receber` + NFS-e | GE / fiscal | ❌ 0 pela P&M |
| Briefing | `agency_briefings` | `/pm/briefings` | ⚪ 0 |
| Job | `agency_jobs` | `/pm` (kanban) · `/pm/aprovacao` | ⚪ 0 |
| Tempo | `agency_timesheet` | `/pm/apontamento-horas` | ⚪ 0 |
| Margem / BI | RPCs `fn_pm_*` | `/pm/margem-job` · hub | ⚪ "em cálculo" |

---

# 5. AS ONDAS P0–P10

**Princípio (herdado da Oficina):** a ordem é ditada pelo **gargalo real do piloto**, não pelo catálogo de funcionalidades. **Uma onda só é "concluída" quando tem uso real provado na PDOIS**, não quando o PR é mergeado.

**Legenda:** ✅ concluída · 🎯 próxima · ⏳ backlog · 🔒 travada em condição

## ✅ P0 · Fundação
Menu P&M, RBAC com 7 papéis, o financeiro da GE aparecendo no menu P&M (`surface_in_groups`), gating dos planos `v15_pm_*`. Mergeado em 29/05, veredito GOLD.

## ✅ P1 · Comercial
Funil configurável de 6 etapas (`agency_leads`), agenda, origens, catálogo de serviços (recorrente, pontual e pacote), propostas (CRUD), cliente unificado em `erp_clientes` (#1017). Entregue entre agosto e setembro.
**Prova de uso:** 55 leads e 23 propostas reais. A onda está concluída; o gargalo agora está na P2.

## 🎯 P2 · A proposta sai da gaveta *(próxima — especificar só depois da visita)*
**Objetivo:** a proposta chega ao cliente e volta aprovada **pelo sistema**.
- **Enviar:** PDF com a identidade da agência + link público + botão WhatsApp; `data_envio` registrada; o lead avança sozinho para a etapa "proposta".
- **Aceite do cliente pelo link:** aprovar ou recusar, com nome, data e IP (trilha LGPD). A aprovação move o lead para "ganho".
- **Aprovada = gatilho da P3** (cria o contrato na GE). Nada de lançamento financeiro nesta onda.
- **Total da proposta sempre recalculado dos itens**, para acabar com a proposta aprovada de R$ 0 (a verificar).
- **Backlog Luzardo junto:** criador no card · KPIs por responsável · filtro por período · duplicar serviço.
- **Reusa:** `fn_agency_proposta_aprovar`, `fn_agency_lead_ganhar`, o padrão de link público do orçamento da GE/Oficina.
- **Aceite:** 1ª proposta real da PDOIS **enviada pelo sistema e aprovada pelo cliente no link**.
- **Gate:** a visita confirma como a PDOIS envia hoje e se o Luzardo aceita reintroduzir o botão Enviar.

## ⏳ P3 · Contrato na GE, com escopo
**Objetivo:** a proposta aprovada vira contrato recorrente **na GE**.
- A aprovação cria o registro em `erp_contratos` pelo motor de recorrência (`fn_contrato_recorrencia_criar`), com a origem P&M (decisão A).
- Os itens da proposta viram o escopo quantificado (`agency_contrato_itens`, ligado ao contrato da GE): quantidade, unidade, periodicidade e valor.
- A tela `/pm/contratos` vira atalho filtrado da área de Contratos Recorrentes da GE (decisão B).
- `agency_contratos` vira legado *soft* (RD-30).
- **Aceite:** os contratos reais da PDOIS cadastrados e visíveis na GE e no atalho da P&M.
- **Depende de:** P2 e das decisões A e B.

## ⏳ P4 · Faturamento do fee — **é aqui que o SIGA sai**
**Objetivo:** o fee mensal é cobrado e faturado pelo PS.
- A recorrência gera o contas a receber (motor da GE), a **NFS-e de serviço** (motor fiscal compartilhado; subitem a confirmar com o contador) e o **boleto Sicredi**, que já está integrado na PDOIS.
- Pré-requisitos: certificado A1 e Configuração Fiscal da PDOIS, e o contador da PDOIS validando o subitem e a tributação.
- **Aceite:** 1º fee faturado inteiro pelo PS (título + NFS-e + boleto) em vez do SIGA.
- **Depende de:** P3.

## ⏳ P5 · Produção
**Objetivo:** o job nasce do contrato e anda até a entrega.
- Briefing (IA opcional) → job em kanban próprio (`tipo_funil = jobs`, sem regredir o Workspace) → aprovação do cliente por link → entrega ou publicação.
- O job fica ligado a um item do contrato: automático por tipo, com ajuste manual.
- Reusa as telas que já existem: briefings, aprovação, portfólio e o kanban `fn_pm_kanban`.
- **Aceite:** um mês de jobs reais de um cliente da PDOIS percorrendo o fluxo inteiro.
- **Depende de:** P3.

## ⏳ P6 · Tempo & escopo
**Objetivo:** medir cada etapa e avisar quando o cliente estoura o contratado.
- Cronômetro por etapa (`etapa_tipo` e `cliente_id` já existem em `agency_timesheet`).
- `agency_etapa_medicao_config`: liga ou desliga por etapa; ordem de precedência cliente > agência > sistema.
- Alerta amarelo de ultrapassagem (`fn_agency_contrato_consumo`) e relatório contratado × realizado (`fn_agency_contratado_vs_realizado`).
- **Aceite:** o relatório contratado × realizado de um cliente real batendo com a percepção da equipe.
- **Depende de:** P5.

## ⏳ P7 · Rentabilidade real + BI
**Objetivo:** a margem por cliente e por serviço, o moat.
- Custo-hora da equipe (`agency_equipe`) × tempo medido + custos diretos + indiretas da GE **rateadas por horas** (decisão).
- `fn_pm_rentabilidade_cliente` e `fn_pm_margem_servico`, respeitando a configuração de medição.
- BI: MRR · MRA (margem real acumulada) · OTDR (entrega no prazo) · RHT (receita por hora) · HSC (health score) · margens. Os KPIs deixam de aparecer "em cálculo".
- **Aceite:** os donos reconhecem a margem por cliente como verdadeira.
- **Depende de:** P4 e P6.

## ⏳ P8 · Comissão *(transversal)*
Regras por papel (comercial e responsável do fee), com base no contrato ou no fee, piso, teto e aceleradores; histórico imutável depois de pago. Parte já existe (`agency_comissao`, `fn_agency_comissao_aprovar`).
- **Depende de:** P3 e da decisão sobre comissão recorrente × única.

## 🔒 P9 · Mídia
Plano de mídia, PI, BV, honorário, UTM, gasto do Google Ads e da Meta.
- **Travada até a PDOIS pedir.** Não é o core que tira o SIGA.

## 🔒 P10 · Diferenciais de IA
Briefing por áudio · IA de preço ótimo · Radar Competitivo · Health Score · bot WhatsApp · portfólio automático. Aqui entram as 7 cascas atuais.
- **Travada até haver uso real de P2–P7.** IA sem dado é demonstração.

### Mapa das ondas antigas (29/05) → V5
| Antiga | → V5 |
|---|---|
| 0 Fundação | P0 |
| 1 Hub PEM | P1 (comercial) + P7 (KPIs do hub) |
| 2 Briefing + Atendimento | P5 |
| 3 Propostas + Ponte Financeira | P2 (envio e aceite) + P3/P4 (a ponte vai pela GE) |
| 4 Jobs + Vínculos | P5 |
| 5 Tarefas Kanban + Pauta | P5 |
| 6 Timesheet + Margem | P6 + P7 |
| 7 Contratos Recorrentes Fee | P3 + P4 |
| 8 Mídia BV | P9 |
| 9 Comissionamento | P8 |
| 10 IA Produtiva | P10 |

---

# 6. 🔍 GOLD — como auditar a P&M sem sujar a PDOIS

**O problema, medido em 18/09:**
1. O robô de auditoria (`screenshot@`) **não é membro da PDOIS**. Fotografada por ele, a PDOIS aparece vazia (falso vazio, RD-64).
2. **Clicar em botão na PDOIS é criar dado real** (lead, proposta, agendamento) no ambiente de produção de um cliente. A limpeza da demo em 04/09 mostrou o custo disso.
3. **O bucket de prints (`system-screenshots`) é público.** Prints da PDOIS exporiam nomes e telefones de leads em URL pública, e ainda seriam enviados à IA para análise (Pilar 2 · LGPD).

**A solução, a mesma receita da Oficina (`[BOT] Oficina`, 14/09):**
- **Camada de clique → sandbox `[BOT] Agência`** (`ambiente_tenant = 'auditoria'`), com dados-semente idempotentes que espelham o fluxo da PDOIS: 1 lead por etapa, propostas em cada status, briefing, jobs e horas. O Gold clica à vontade ali.
- **Camada de foto da PDOIS real → somente leitura, somente com autorização do CEO**, depois de os prints de tenant de produção irem para um **bucket privado** com link assinado. Sem clique, nunca.
- **Custo estimado:** cerca de US$ 0,013 por rota (média do Gold nos últimos 30 dias), ou seja, uns US$ 0,30 para as 23 rotas. Cabe no teto de US$ 3/dia.

---

# 7. 🗣️ ROTEIRO DA VISITA À PDOIS

Cada pergunta destrava uma onda. Anotar a resposta **com as palavras deles**.

**Proposta (P2):**
1. Como a proposta chega ao cliente hoje: PDF do SIGA, Canva, WhatsApp, e-mail?
2. As 20 propostas em rascunho no sistema: são rascunhos de verdade, ou foram enviadas por fora?
3. Os 5 leads marcados como ganhos: viraram cliente? Com qual valor?
4. A proposta "PAINEL DE LED DUPLO" aprovada com R$ 0: foi teste ou o total saiu errado?
5. O Luzardo aceita a volta do botão **Enviar** no card? (O pedido #15 havia reduzido o card a Editar/Excluir.)

**Contrato e faturamento (P3/P4):**
6. Quantos clientes de fee mensal a agência tem, e de quanto? A Marciana vai cadastrar quando?
7. Quem emite a NFS-e hoje, por onde e com qual subitem? O certificado A1 está com quem?
8. Do SIGA, **o que ainda usam todo dia**? O que impede cancelar amanhã?

**Produção (P5–P7):**
9. Como controlam os jobs hoje: SIGA, planilha, Trello?
10. Querem medir tempo desde já, ou só depois de o contrato e o faturamento rodarem?

**Pendências antigas:**
11. QW4: unificar os dois kanbans num só, ou só ajustar os botões?
12. QW5: qual é o texto exato do rótulo do valor do lead?

---

# 8. DECISÕES ABERTAS (CEO)

| # | Decisão | Recomendação |
|---|---|---|
| A | Origem P&M em `erp_contratos`: colunas `proposta_id` / `responsavel_id` × metadados | ⭐ colunas |
| B | Tela Contratos da P&M: some × atalho filtrado da GE | ⭐ atalho filtrado |
| 1 | Rateio das indiretas por cliente | ⭐ por horas |
| 2 | Medição por padrão | ⭐ liga tudo |
| 3 | Níveis da configuração de medição | ⭐ agência + override por cliente |
| 4 | Quantidade do escopo | ⭐ periodicidade por item |
| 5 | Ultrapassar o contratado | ⭐ alerta amarelo (não bloqueia) |
| 6 | Vínculo job → item do contrato | ⭐ automático por tipo + ajuste manual |
| 7 | Comissão: recorrente × única; base contrato × fee | pendente, depois da visita |
| 8 | Fórmula do HSC · o que mede o TRI | pendente (P7) |
| 9 | Fotos Gold da PDOIS real (somente leitura, bucket privado) | ⭐ sim, depois do bucket privado |
| 10 | QW4: unificar os kanbans | ⭐ unificar (RD-52), na P2 |

---

# 9. INDICADORES & PROVAS HUMANAS

**As três provas que valem mais que qualquer PR:**
1. 🎯 A 1ª proposta real **enviada pelo sistema e aprovada pelo cliente no link** (P2).
2. 🎯 O 1º fee **faturado inteiro pelo PS**: título + NFS-e + boleto (P4).
3. 🏁 **O SIGA cancelado.**

**Indicadores a acompanhar (hoje):**
| Indicador | Hoje |
|---|---|
| Propostas rascunho → enviadas | 0 de 20 |
| Enviadas → aprovadas | — |
| Contratos ativos na GE | 0 |
| % do fee faturado pelo PS | 0% |
| Jobs por mês | 0 |
| Horas medidas por mês | 0 |
| Margem por cliente | em cálculo |

---

# 10. COMO ATUALIZAR ESTE DOCUMENTO

- Toda onda concluída atualiza o §3 (números reais), o §5 (status) e o §9 (indicadores). A versão sobe no `erp_documento_vertical` (nova linha, `vigente = true`, a anterior vira `vigente = false`).
- `pem_roadmap_ondas` espelha o §5: mesmo número, título e status.
- **Nunca** marcar uma onda como ✅ sem a prova de uso real descrita no aceite dela (RD-38).
$pmdoc$,
  5,
  true,
  ARRAY['PS_PM_Producao_Marketing_Blueprint_V4_0.md','PS_PM_DOCUMENTO_VIVO_V5.md']::text[],
  'V5: reconcilia Blueprint V4.0 (14/08) e pem_roadmap_ondas (29/05) com o dado real de 18/09. Gargalo = proposta não sai do rascunho (20 rascunhos, 0 enviadas). Ondas P0–P10 por gargalo. Gold via sandbox [BOT] Agência.',
  'aprovado',
  '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb',
  '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb',
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_documento_vertical WHERE vertical='pm' AND versao=5
);

-- Um só vigente por vertical 'pm': a V5 vigente, as demais viram false.
UPDATE public.erp_documento_vertical SET vigente=false WHERE vertical='pm' AND versao<>5 AND vigente=true;
UPDATE public.erp_documento_vertical SET vigente=true  WHERE vertical='pm' AND versao=5 AND vigente=false;

-- -----------------------------------------------------------------------------
-- PARTE A2 · pem_roadmap_ondas → V5 (UPDATE no lugar, por onda_numero)
-- notas preserva o histórico usando os valores ANTIGOS (titulo/notas) da própria
-- linha no lado direito do SET — sem hardcode do que veio antes (RD-38).
-- descricao_completa/criterios_aceitacao = texto da onda no §5 do documento vivo.
-- -----------------------------------------------------------------------------
UPDATE public.pem_roadmap_ondas SET
  titulo='✅ P0 · Fundação',
  descricao_curta='Menu P&M, RBAC 7 papéis, financeiro da GE no menu P&M, gating v15_pm_*.',
  descricao_completa='Menu P&M, RBAC com 7 papéis, o financeiro da GE aparecendo no menu P&M (surface_in_groups), gating dos planos v15_pm_*. Mergeado em 29/05, veredito GOLD.',
  status='concluido', objetivo_estrategico='foundational',
  dependencias_ondas=ARRAY[]::integer[],
  criterios_aceitacao=ARRAY['Menu P&M e RBAC ativos','Financeiro da GE visível no menu P&M','Gating dos planos v15_pm_* funcionando']::text[],
  notas='[V5 18/09] Mergeado 29/05, veredito GOLD | antes (29/05): '||titulo||' — '||COALESCE(notas,''),
  updated_at=now()
WHERE onda_numero=0;

UPDATE public.pem_roadmap_ondas SET
  titulo='✅ P1 · Comercial (funil, agenda, catálogo, propostas)',
  descricao_curta='Funil configurável, agenda, catálogo, propostas CRUD, cliente unificado em erp_clientes.',
  descricao_completa='Funil configurável de 6 etapas (agency_leads), agenda, origens, catálogo de serviços (recorrente, pontual e pacote), propostas (CRUD), cliente unificado em erp_clientes (#1017). Entregue entre agosto e setembro. Prova de uso: 55 leads e 23 propostas reais.',
  status='concluido', objetivo_estrategico='match',
  dependencias_ondas=ARRAY[0]::integer[],
  criterios_aceitacao=ARRAY['55 leads e 23 propostas reais no banco (uso provado 18/09)']::text[],
  notas='[V5 18/09] Uso provado 18/09: 55 leads + 23 propostas reais | antes (29/05): '||titulo||' — '||COALESCE(notas,''),
  updated_at=now()
WHERE onda_numero=1;

UPDATE public.pem_roadmap_ondas SET
  titulo='🎯 P2 · A proposta sai da gaveta (envio + aceite do cliente)',
  descricao_curta='A proposta chega ao cliente e volta aprovada pelo sistema. Gargalo real: 20 rascunhos, 0 enviadas.',
  descricao_completa='Objetivo: a proposta chega ao cliente e volta aprovada pelo sistema. Enviar PDF com identidade da agência + link público + botão WhatsApp; data_envio registrada; o lead avança sozinho para a etapa proposta. Aceite do cliente pelo link (nome, data, IP — trilha LGPD); a aprovação move o lead para ganho. Aprovada = gatilho da P3 (cria contrato na GE); nada de lançamento financeiro nesta onda. Total da proposta sempre recalculado dos itens. Reusa fn_agency_proposta_aprovar, fn_agency_lead_ganhar e o padrão de link público do orçamento GE/Oficina. Especificar só depois da visita à PDOIS.',
  status='proximo', objetivo_estrategico='match',
  dependencias_ondas=ARRAY[1]::integer[],
  criterios_aceitacao=ARRAY['1ª proposta real da PDOIS enviada pelo sistema e aprovada pelo cliente no link','Total da proposta recalculado dos itens (fim da proposta aprovada de R$ 0)']::text[],
  notas='[V5 18/09] Gargalo real: 20 rascunhos, 0 enviadas. SPEC só após a visita à PDOIS | antes (29/05): '||titulo||' — '||COALESCE(notas,''),
  updated_at=now()
WHERE onda_numero=2;

UPDATE public.pem_roadmap_ondas SET
  titulo='P3 · Contrato na GE com escopo (erp_contratos)',
  descricao_curta='A proposta aprovada vira contrato recorrente na GE, com escopo quantificado.',
  descricao_completa='Objetivo: a proposta aprovada vira contrato recorrente na GE. A aprovação cria o registro em erp_contratos pelo motor de recorrência (fn_contrato_recorrencia_criar), com origem P&M (decisão A). Os itens da proposta viram o escopo quantificado (agency_contrato_itens ligado ao contrato da GE): quantidade, unidade, periodicidade e valor. A tela /pm/contratos vira atalho filtrado da área de Contratos Recorrentes da GE (decisão B). agency_contratos vira legado soft (RD-30). Depende de P2 e das decisões A e B.',
  status='backlog', objetivo_estrategico='foundational',
  dependencias_ondas=ARRAY[2]::integer[],
  criterios_aceitacao=ARRAY['Contratos reais da PDOIS cadastrados e visíveis na GE e no atalho da P&M']::text[],
  notas='[V5 18/09] Diretriz 25/08 (a96abc37); aguarda decisões A/B (c1148ce5) | antes (29/05): '||titulo||' — '||COALESCE(notas,''),
  updated_at=now()
WHERE onda_numero=3;

UPDATE public.pem_roadmap_ondas SET
  titulo='P4 · Faturamento do fee (receber + NFS-e + boleto) — sai o SIGA',
  descricao_curta='O fee mensal é cobrado e faturado pelo PS (título + NFS-e + boleto).',
  descricao_completa='Objetivo: o fee mensal é cobrado e faturado pelo PS. A recorrência gera o contas a receber (motor da GE), a NFS-e de serviço (motor fiscal compartilhado; subitem a confirmar com o contador) e o boleto Sicredi (já integrado na PDOIS). Pré-requisitos: certificado A1 e Configuração Fiscal da PDOIS, e o contador validando o subitem e a tributação. É aqui que o SIGA sai. Depende de P3.',
  status='backlog', objetivo_estrategico='match',
  dependencias_ondas=ARRAY[3]::integer[],
  criterios_aceitacao=ARRAY['1º fee faturado inteiro pelo PS (título + NFS-e + boleto) em vez do SIGA']::text[],
  notas='[V5 18/09] Pré: A1 + config fiscal PDOIS + contador | antes (29/05): '||titulo||' — '||COALESCE(notas,''),
  updated_at=now()
WHERE onda_numero=4;

UPDATE public.pem_roadmap_ondas SET
  titulo='P5 · Produção (briefing → job → aprovação → entrega)',
  descricao_curta='O job nasce do contrato e anda até a entrega. Telas já existem, 0 uso.',
  descricao_completa='Objetivo: o job nasce do contrato e anda até a entrega. Briefing (IA opcional) → job em kanban próprio (tipo_funil = jobs, sem regredir o Workspace) → aprovação do cliente por link → entrega ou publicação. O job fica ligado a um item do contrato: automático por tipo, com ajuste manual. Reusa as telas que já existem: briefings, aprovação, portfólio e o kanban fn_pm_kanban. Depende de P3.',
  status='backlog', objetivo_estrategico='match',
  dependencias_ondas=ARRAY[3]::integer[],
  criterios_aceitacao=ARRAY['Um mês de jobs reais de um cliente da PDOIS percorrendo o fluxo inteiro']::text[],
  notas='[V5 18/09] Telas briefings/aprovação/portfólio já existem, 0 uso | antes (29/05): '||titulo||' — '||COALESCE(notas,''),
  updated_at=now()
WHERE onda_numero=5;

UPDATE public.pem_roadmap_ondas SET
  titulo='P6 · Tempo & escopo (medição configurável + contratado × realizado)',
  descricao_curta='Medir cada etapa e avisar quando o cliente estoura o contratado.',
  descricao_completa='Objetivo: medir cada etapa e avisar quando o cliente estoura o contratado. Cronômetro por etapa (etapa_tipo e cliente_id já existem em agency_timesheet). agency_etapa_medicao_config: liga ou desliga por etapa; precedência cliente > agência > sistema. Alerta amarelo de ultrapassagem (fn_agency_contrato_consumo) e relatório contratado × realizado (fn_agency_contratado_vs_realizado). Depende de P5.',
  status='backlog', objetivo_estrategico='lead',
  dependencias_ondas=ARRAY[5]::integer[],
  criterios_aceitacao=ARRAY['Relatório contratado × realizado de um cliente real batendo com a percepção da equipe']::text[],
  notas='[V5 18/09] agency_etapa_medicao_config a criar | antes (29/05): '||titulo||' — '||COALESCE(notas,''),
  updated_at=now()
WHERE onda_numero=6;

UPDATE public.pem_roadmap_ondas SET
  titulo='P7 · Rentabilidade real + BI (margem por cliente/serviço)',
  descricao_curta='A margem por cliente e por serviço, o moat. KPIs deixam de aparecer "em cálculo".',
  descricao_completa='Objetivo: a margem por cliente e por serviço, o moat. Custo-hora da equipe (agency_equipe) × tempo medido + custos diretos + indiretas da GE rateadas por horas. fn_pm_rentabilidade_cliente e fn_pm_margem_servico, respeitando a configuração de medição. BI: MRR, MRA, OTDR, RHT, HSC e margens; os KPIs deixam de aparecer em cálculo. Depende de P4 e P6.',
  status='backlog', objetivo_estrategico='lead',
  dependencias_ondas=ARRAY[4,6]::integer[],
  criterios_aceitacao=ARRAY['Os donos reconhecem a margem por cliente como verdadeira']::text[],
  notas='[V5 18/09] KPIs do hub "em cálculo" desde 14/08 | antes (29/05): '||titulo||' — '||COALESCE(notas,''),
  updated_at=now()
WHERE onda_numero=7;

UPDATE public.pem_roadmap_ondas SET
  titulo='P8 · Comissão (transversal)',
  descricao_curta='Regras por papel, base contrato/fee, piso/teto/aceleradores; histórico imutável após pago.',
  descricao_completa='Regras por papel (comercial e responsável do fee), com base no contrato ou no fee, piso, teto e aceleradores; histórico imutável depois de pago. Parte já existe (agency_comissao, fn_agency_comissao_aprovar). Depende de P3 e da decisão sobre comissão recorrente × única.',
  status='backlog', objetivo_estrategico='transversal',
  dependencias_ondas=ARRAY[3]::integer[],
  criterios_aceitacao=ARRAY['Regras de comissão por papel aplicadas, com histórico imutável após pago']::text[],
  notas='[V5 18/09] Decisão recorrente × única pendente | antes (29/05): '||titulo||' — '||COALESCE(notas,''),
  updated_at=now()
WHERE onda_numero=8;

UPDATE public.pem_roadmap_ondas SET
  titulo='🔒 P9 · Mídia (PI, BV, honorário, UTM, Ads)',
  descricao_curta='Plano de mídia, PI, BV, honorário, UTM, Google Ads e Meta. Travada até a PDOIS pedir.',
  descricao_completa='Plano de mídia, PI, BV, honorário, UTM, gasto do Google Ads e da Meta. Travada até a PDOIS pedir. Não é o core que tira o SIGA.',
  status='backlog', objetivo_estrategico='match',
  dependencias_ondas=ARRAY[4]::integer[],
  criterios_aceitacao=ARRAY['A PDOIS pede mídia e o plano de mídia roda com PI/BV/UTM/Ads']::text[],
  notas='[V5 18/09] Travada até a PDOIS pedir | antes (29/05): '||titulo||' — '||COALESCE(notas,''),
  updated_at=now()
WHERE onda_numero=9;

UPDATE public.pem_roadmap_ondas SET
  titulo='🔒 P10 · Diferenciais de IA (+ as 7 cascas)',
  descricao_curta='Briefing por áudio, IA de preço, Radar Competitivo, Health Score, bot WhatsApp, portfólio automático.',
  descricao_completa='Briefing por áudio, IA de preço ótimo, Radar Competitivo, Health Score, bot WhatsApp, portfólio automático. Aqui entram as 7 cascas atuais. Travada até haver uso real de P2–P7. IA sem dado é demonstração.',
  status='backlog', objetivo_estrategico='lead',
  dependencias_ondas=ARRAY[2,3,4,5,6,7]::integer[],
  criterios_aceitacao=ARRAY['Uso real de P2–P7 comprovado antes de qualquer diferencial de IA']::text[],
  notas='[V5 18/09] Travada até haver uso real de P2–P7 | antes (29/05): '||titulo||' — '||COALESCE(notas,''),
  updated_at=now()
WHERE onda_numero=10;

-- -----------------------------------------------------------------------------
-- PARTE A3 · pem_roadmap_prs — remapear onda_id (NUNCA apagar; status intacto).
-- Mapa antigas→V5 (§5) + conteúdo do PR quando a onda antiga se divide.
-- Total continua 31; só muda o onda_id de 15 PRs. Decisões de split no relatório.
-- -----------------------------------------------------------------------------
-- old 1 (Hub PEM) → split: 1.1 (Hub 6 KPIs) = P7 · 1.2 (agency_clientes) fica P1
UPDATE public.pem_roadmap_prs SET onda_id=(SELECT id FROM public.pem_roadmap_ondas WHERE onda_numero=7), updated_at=now() WHERE pr_codigo='PEM-1.1';
-- old 2 (Briefing + Atendimento) → P5
UPDATE public.pem_roadmap_prs SET onda_id=(SELECT id FROM public.pem_roadmap_ondas WHERE onda_numero=5), updated_at=now() WHERE pr_codigo IN ('PEM-2.1','PEM-2.2');
-- old 3 (Propostas + Ponte) → split: 3.1 (wizard/envio) = P2 · 3.2 (→erp_receber) = P4 · 3.3 (IA Preço Ótimo) = P10 (diferencial de IA; ver relatório)
UPDATE public.pem_roadmap_prs SET onda_id=(SELECT id FROM public.pem_roadmap_ondas WHERE onda_numero=2), updated_at=now() WHERE pr_codigo='PEM-3.1';
UPDATE public.pem_roadmap_prs SET onda_id=(SELECT id FROM public.pem_roadmap_ondas WHERE onda_numero=4), updated_at=now() WHERE pr_codigo='PEM-3.2';
UPDATE public.pem_roadmap_prs SET onda_id=(SELECT id FROM public.pem_roadmap_ondas WHERE onda_numero=10), updated_at=now() WHERE pr_codigo='PEM-3.3';
-- old 4 (Jobs + Vínculos) → P5
UPDATE public.pem_roadmap_prs SET onda_id=(SELECT id FROM public.pem_roadmap_ondas WHERE onda_numero=5), updated_at=now() WHERE pr_codigo IN ('PEM-4.1','PEM-4.2');
-- old 5 (Tarefas Kanban + Pauta) → P5 (já é onda_numero 5; no-op explícito p/ clareza)
UPDATE public.pem_roadmap_prs SET onda_id=(SELECT id FROM public.pem_roadmap_ondas WHERE onda_numero=5), updated_at=now() WHERE pr_codigo IN ('PEM-5.1','PEM-5.2','PEM-5.3');
-- old 6 (Timesheet + Margem) → P6 (ambos timesheet/tempo; já é onda 6; no-op explícito)
UPDATE public.pem_roadmap_prs SET onda_id=(SELECT id FROM public.pem_roadmap_ondas WHERE onda_numero=6), updated_at=now() WHERE pr_codigo IN ('PEM-6.1','PEM-6.2');
-- old 7 (Contratos Recorrentes Fee) → split: 7.1 (contrato recorrente) = P3 · 7.2 (cobrança por etapa) = P4
UPDATE public.pem_roadmap_prs SET onda_id=(SELECT id FROM public.pem_roadmap_ondas WHERE onda_numero=3), updated_at=now() WHERE pr_codigo='PEM-7.1';
UPDATE public.pem_roadmap_prs SET onda_id=(SELECT id FROM public.pem_roadmap_ondas WHERE onda_numero=4), updated_at=now() WHERE pr_codigo='PEM-7.2';
-- old 8 (Mídia BV) → P9
UPDATE public.pem_roadmap_prs SET onda_id=(SELECT id FROM public.pem_roadmap_ondas WHERE onda_numero=9), updated_at=now() WHERE pr_codigo IN ('PEM-8.1','PEM-8.2');
-- old 9 (Comissionamento) → P8
UPDATE public.pem_roadmap_prs SET onda_id=(SELECT id FROM public.pem_roadmap_ondas WHERE onda_numero=8), updated_at=now() WHERE pr_codigo IN ('PEM-9.1','PEM-9.2','PEM-9.3');
-- old 0 (Fundação) e old 10 (IA Produtiva) permanecem em P0 e P10 (sem remapeamento).

-- -----------------------------------------------------------------------------
-- PARTE B1 · Catálogo honesto em system_screens — as 14 rotas /dashboard/pm* ausentes.
-- estado_real pelos valores válidos do CHECK (pronto/parcial/placeholder/quebrada/desconhecida):
--   real em uso → 'pronto' · construída sem uso → 'parcial' · casca → 'placeholder'.
-- Idempotente por rota. NÃO rebaixa as 9 já cadastradas (RD-64).
-- -----------------------------------------------------------------------------
INSERT INTO public.system_screens (id, rota, area, titulo, estado_real, criado_em, atualizado_em)
SELECT gen_random_uuid()::text, v.rota, 'pm', v.titulo, v.estado, now(), now()
FROM (VALUES
  ('/dashboard/pm/agenda',        'P&M · Agenda',                  'pronto'),
  ('/dashboard/pm/comercial',     'P&M · Comercial',               'pronto'),
  ('/dashboard/pm/comissao',      'P&M · Comissão',                'pronto'),
  ('/dashboard/pm/configuracoes', 'P&M · Configurações',           'pronto'),
  ('/dashboard/pm/contratos',     'P&M · Contratos',               'pronto'),
  ('/dashboard/pm/servicos',      'P&M · Catálogo de Serviços',    'pronto'),
  ('/dashboard/pm/cobranca',      'P&M · Cobrança por Etapa',      'parcial'),
  ('/dashboard/pm/benchmark',     'P&M · Benchmark de Mercado',    'placeholder'),
  ('/dashboard/pm/bot',           'P&M · Bot WhatsApp/Slack',      'placeholder'),
  ('/dashboard/pm/eventos',       'P&M · Eventos & Produções',     'placeholder'),
  ('/dashboard/pm/health-score',  'P&M · Health Score Cliente',    'placeholder'),
  ('/dashboard/pm/ia-preco',      'P&M · IA Preço Ótimo',          'placeholder'),
  ('/dashboard/pm/ia-preditiva',  'P&M · IA Preditiva',            'placeholder'),
  ('/dashboard/pm/integracoes',   'P&M · Integrações Produtividade','placeholder')
) AS v(rota, titulo, estado)
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = v.rota);

-- -----------------------------------------------------------------------------
-- PARTE B2 · Selo honesto das cascas no menu (fn_modulos_sidebar_por_area).
-- O badge vem de feature_catalog agregado por module_catalog: se TODAS as features
-- são 'pronto' → badge "Pronto". Nenhuma das 7 cascas badgeia "pronto" hoje
-- (5 já computam 'previsto'; eventos e ia-preco não têm feature → badge nulo/vazio).
-- Aqui damos às 2 sem feature uma feature 'previsto' explícita, para que as 7 leiam
-- "Previsto" (e nunca "Pronto"). Idempotente por module_id. Área não é escondida (RD-33).
-- -----------------------------------------------------------------------------
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, prioridade, criado_em, atualizado_em)
SELECT gen_random_uuid(), v.module_id, 'pm', v.titulo, v.descricao, 'previsto', 'baixa', now(), now()
FROM (VALUES
  ('pm_eventos_producoes', 'Eventos & Produções (previsto)', 'Casca prevista: gestão de eventos e produções. Sem uso real; entra numa onda futura.'),
  ('pm_ia_preco_otimo',    'IA Preço Ótimo (previsto)',      'Casca prevista: sugestão de preço por job via IA (P10). Sem uso real ainda.')
) AS v(module_id, titulo, descricao)
WHERE NOT EXISTS (SELECT 1 FROM public.feature_catalog fc WHERE fc.module_id = v.module_id);
