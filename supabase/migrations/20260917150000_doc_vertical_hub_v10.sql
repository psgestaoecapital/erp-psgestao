-- Documento Mestre Vivo do Hub de Projetos (V10) — item D: baliza p/ o auditor comparar (blueprint).
-- vertical='hub' (mesma grafia dos outros 4; system_screens.area usa hub_construcao, mapear rota->area->vertical).
-- status='rascunho' (o CEO aprova na Central). conteudo_md gravado byte-a-byte (md5 99537aa6b7002113aa73f5b9d60ed18e).
-- Idempotente: só insere se ainda não houver hub v10.
INSERT INTO public.erp_documento_vertical
  (vertical, titulo, conteudo_md, versao, vigente, status, origem_arquivos, resumo_mudanca, criado_em)
SELECT 'hub',
  'Hub de Projetos — Documento Mestre Vivo (V10)',
  $hubv10$# 🏗️ PS GESTÃO ERP · HUB DE PROJETOS — **DOCUMENTO MESTRE VIVO V10**
## Tese · Estado real · Fluxo · A frente Construtora · Ondas

**Atualizado:** 17/09/2026 · **Autor:** Engenheiro Chefe · **Aprovação:** CEO Gilberto Paravizi
**Validadores:** Tryo Gessos · Tryo Acabamentos · FC Pisos · FCR · **R. R Serviços** (o mais ativo hoje)

> ## ⚠️ ÚNICO ARQUIVO VIVO DA VERTICAL
> **Consolida:** `PS_Hub_Projetos_Estado_da_Arte_V8.md` · `FC_PISOS_documento_vivo_V1.md`
> **Diretriz-mãe (inviolável):** o Hub é produto para **QUALQUER empresa de construção civil**.
> **Nada hardcoded por ramo.** Os validadores são prova empírica, nunca o escopo.

| Versão | Data | O que mudou |
|---|---|---|
| V8 | 08/09 | fluxo de 12 etapas validado · 13 ondas H0-H12 · benchmark de 11 sistemas |
| V9 | 17/09 | a frente Construtora (§7) · cluster de obra na NFS-e · CRM e agenda decididos |
| **V10** | **17/09 (noite)** | 🔴 **REVELAÇÃO DO CEO: o TAKEOFF NUNCA FUNCIONOU e o Hub é CASCA DE CONSTRUÇÃO, não vertical em uso (§3.0)** · a causa real do "orçamento não cria", dita pelo usuário (§3.3) · o que foi entregue hoje (§4.3) |

---

# 1. A TESE

> **O que atravessa a obra não é "o orçamento" nem "a obra". É o ITEM DE ESCOPO** — serviço + quantidade. Uma linha, sete leituras:
> orçamento → contrato → cronograma → medição → fatura → custo → margem.
>
> **Quando o item não atravessa, cada tela vira uma ilha.**

## 1.1 As 5 regras invioláveis

1. **Nada hardcoded** por empresa, ramo ou especialidade
2. Percentual, índice e regra nascem de **cálculo ou cadastro** — nunca digitação fixa
3. **Vocabulário genérico** da construção — nunca "forro/chapa/sanca"
4. Funciona com cadastro **vazio** e **grande** (10 serviços e 87 mil composições SINAPI)
5. **Fácil não é o oposto de completo** — profundidade disponível, não obrigatória

## 1.2 🔒 A fronteira [→GE]

**Financeiro, fiscal e estoque são monopólio da Gestão Empresarial.** O Hub faz **o operacional** e **dispara evento**.
⚠️ **Refinamento (`c2869c85`):** o Hub **LÊ** dado financeiro da GE — isso é aceito. O que não faz é **ESCREVER**.

---

# 2. 🎯 OS TRÊS MODELOS DE NEGÓCIO

| Modelo | Perfil | Ciclo | Decisão |
|---|---|---|---|
| 🅰️ **Empreiteira de especialidade** | entra na obra de outro, faz uma parte, sai | dias/semanas | ⭐ **CARRO-CHEFE** |
| 🅱️ **Construtora / incorporadora** | toca a obra inteira, contrata subs | meses/anos | 🔴 **DEMANDA NOVA — §7** |
| 🅲️ **Reforma residencial** | arquiteto, alto padrão | semanas/meses | vem quase de graça |

**Por que 🅰️:** é o que Tryo, FC Pisos e R.R **são**. E o levantamento acontece **na visita com trena e foto**, não com planta limpa.

⚠️ **Consequência de desenho assumida no V8:** o fluxo v1 **não tem** cronograma, curva S, aditivo, medição de subempreiteiro nem RDO.
➡️ **E é exatamente isso que a construtora precisa.** Ver §7.

---

# 3. ESTADO REAL (17/09/2026)

## 3.0 🔴 A REVELAÇÃO QUE MUDA A LEITURA DO DOCUMENTO INTEIRO

> **Palavras do CEO, 17/09:** *"O take-off nunca funcionou. Nós não conseguimos fazer ele funcionar. Tudo que você auditou foi construído, mas nunca foi testado. Tudo isso foi cadastrado de forma a criar um sistema, mas nada foi preenchido de forma adequada."*

🔒 **O HUB É CASCA DE CONSTRUÇÃO, NÃO VERTICAL EM USO.**

| O que os números pareciam | O que são |
|---|---|
| 11 plantas · 10 ambientes | cadastro de teste da construção |
| 60 serviços · 390 BOM | seed e fork do catálogo público |
| 1.384 produtos (Tryo) | importação do Omie, não uso do Hub |
| "em uso: 1 empresa" | a R.R usa a emissão fiscal, não o Hub |

⚠️ **Nenhuma leitura de progresso deste documento deve ser tratada como adoção.** As barras medem o que existe em código, não o que alguém usa.

➡️ **E isso reordena tudo:** o problema do Hub não é o que falta construir. É que **o que foi construído nunca passou por um usuário real.**

```
construído  ████░░░░░░░░░░░░░░░░  21% (estimado)
auditado    █░░░░░░░░░░░░░░░░░░░   7%  (1 de 14 telas)
em uso      ░░░░░░░░░░░░░░░░░░░░  ZERO uso real ⚠️
```

**14 telas:** 5 parciais · 6 desconhecidas · 2 placeholder · 1 sem selo

⚠️ **A barra "em uso" da Central conta 1 empresa (R.R).** Mas a R.R escreve em `projetos_obras` por causa da NFS-e com obra — não porque usa o Hub. **Ninguém usa o Hub para o que ele foi feito.**

⚠️ **O "21% construído" está SUBESTIMADO.** Duas telas marcadas como incompletas estão prontas e em uso:
- `/projetos/visitas` diz **placeholder** — tem 261 linhas, 3 visitas reais
- `/projetos/oportunidades` diz **desconhecida** — é Kanban completo com 15 oportunidades

🔒 **Foi o catálogo que mentiu, não a tela.** Corrigido no PR de higiene (17/09).

## 3.1 Os volumes

| Item | Qtd |
|---|---|
| Obras | **5** *(todas da R.R)* |
| Oportunidades | **15** *(FC Pisos, FCR, Tryo Gesso)* |
| Visitas técnicas | 3 |
| Serviços do catálogo | 60 |
| **BOM (composições)** | **390** |
| Funções de mão de obra | 60 |
| Plantas | 10 |

## 3.2 A cadeia existe inteira e nunca foi percorrida

| Elo | Existe? | Usado? |
|---|---|---|
| Oportunidade → Orçamento | ✅ | 1 de 15 |
| Visita → Orçamento | ✅ | **0 de 3** |
| Take-off → Orçamento | ✅ | **0** |
| Orçamento → Obra | ✅ trigger | 5 |
| **Obra → Medição** | ❌ | — |
| **Obra → Custo real** | ❌ | — |

## 3.3 🎯 POR QUE "NENHUM ORÇAMENTO TEM ITEM" — a causa, dita pelo usuário

**O V8 chamou isso de "a trava única" como se fosse bug de motor. Não é.** A investigação de 17/09 achou **dois caminhos e dois motivos diferentes, nenhum deles motor quebrado:**

### ① O orçamento direto não tem o que oferecer

```
erp_servicos da Tryo Gesso ......... ZERO
  1.384 produtos ..................... ✅
  10 serviços de engenharia .......... ✅
  🔴 0 serviços no catálogo comercial
```

**O seletor de serviço do orçamento lê `erp_servicos`.** Não há nada para escolher — **numa empresa que vende mão de obra.**

> **Palavras do validador (Wesley, Tryo Gesso):** *"ainda fora, pois **não conseguimos criar** — por isso pedi a área de anexos do PDF dentro da tela de orçamentos."*

🔒 **Os 8 orçamentos vazios não são desleixo. São tentativas que falharam.**

### ② O take-off parou no meio

```
11 plantas · 10 ambientes
  confirmados .............. 0
  com serviço vinculado .... 0
  prontos para gerar ....... 0
```

**O `fn_takeoff_gerar_orcamento` nunca foi alcançado.** Existe uma trava — *"confirme ao menos 1 ambiente com serviço vinculado"* — e o fluxo é de **seis passos**:

```
criar planta → adicionar ambiente → vincular serviço →
confirmar → escolher orçamento destino → gerar
```

⚠️ **É adoção e UX, não bug de motor.** São muitos passos e não está óbvio onde continuar.

### ③ E a pista que falta confirmar

O V8 registrou *"erro cru de Postgres no Catálogo"* — `null value in column unidade violates not-null constraint` exibido ao usuário final.

🔴 **Se for isso, o bug é duplo:** falta default em `unidade` **e** o erro vaza cru para a tela. **É onde o "não consegue criar" vira erro de verdade.**

🔒 **A correção real tem duas partes:** consertar o cadastro de serviço no catálogo, e tornar o fluxo do takeoff guiado.

# 4. O QUE FOI ENTREGUE EM SETEMBRO

## 🎯 O cluster de obra na NFS-e — 5 PRs, 16 e 17/09

**O problema:** a NFS-e de construção exige o grupo de obra (regra **E0370**, subitens 07.02.01 a 14.14.04). Sem CNO ou endereço, **a prefeitura rejeita**.

| Parte | O que ficou no ar |
|---|---|
| **Persistir** | `erp_orcamentos` e `erp_pedidos` ganham 10 campos `obra_*` (id, CNO, endereço granular, UF, IBGE) |
| **Emitir** | o payload lê do pedido · **`cLocIncid` = município da OBRA**, não da sede |
| **A tela** | 3 opções na venda: apontar obra · informar agora · informar e criar no Hub |
| **Vincular depois** | NFS-e já emitida pode receber obra — gerencial, sem reemitir |
| **O elo** | `fn_converter_orcamento_em_pedido` passou a copiar os campos |

🎯 **O `cLocIncid` da obra é o achado que ninguém teria visto:** a nota 18 da R.R tem obra em **Porto Belo** e ISS retido lá, com a empresa sediada em São Miguel do Oeste. **Se sair da sede, o imposto vai para o município errado.**

⚠️ **E um erro real foi pego no caminho:** a obra `OBR-2026-0004` estava com IBGE **4217204 → era 4127700 (Toledo/PR)**. O ISS iria para o Paraná.

## ✅ CEP → IBGE automático
O componente `<CepEndereco>` preenche logradouro, bairro, cidade, UF e **IBGE** pelo CEP. 🔒 **O IBGE nunca é digitado.**
**Validado pelo operador da R.R:** *"já testei e está de acordo"*.

## ✅ Decisões de CRM e agenda (16/09)
- 🔒 **Base da agenda = `erp_agendamento`** (65 registros, genérica, já usada por Oficina e Comercial). Não criar outra.
- `erp_crm_visita` fica como o **registro rico de campo** (GPS, foto, áudio), ligado a um agendamento
- **Etapas migram para `funil_etapa` configurável** — cada construtora tem funil próprio
- ⚠️ E o CRM do Hub é **mais completo** que o do P&M: 26 colunas × 21, 23 RPCs × 7, com `obra_*` e `veic_*`

---

## 4.3 ✅ O que subiu em 17/09 — e por que

| O que | Para quê |
|---|---|
| **Anexo de PDF no orçamento** | o Wesley monta o orçamento FORA do sistema. O orçamento do Hub vira o **envelope** do PDF, com campo de valor. Bucket `crm-anexos`, RPC com guarda de empresa |
| **Contador honesto no funil** | "14 oportunidades · 8 em aberto · 5 ganhas · 1 perdida". Antes dizia só "em aberto 8" e parecia que sumiram |
| **Obra nomeada pelo endereço** | `fn_hub_criar_obra_rapida` nomeia pela obra, não pelo cliente. Acabou com as 5 obras homônimas |
| **CEP → IBGE** | validado pelo operador da R.R: *"está de acordo"* |
| **Emissão com endereço** | a validação duplicada que exigia CNO foi apagada; tudo delega a `fn_nfse_obra_pendente` |

⚠️ **E o que foi DESCARTADO com motivo:** criar orçamento ao arrastar o card *(geraria mais casca vazia)* e o botão "criar obra" no card ganho *(as 5 ganhas da Tryo somam R$ 225.534 e nenhuma tem orçamento vinculado — a obra nasceria vazia)*.

---

# 5. O FLUXO DE 12 ETAPAS *(validado com o cliente, V8)*

```
① demanda      ② levantamento   ③ proposta      ④ contratação
⑤ escopo vigente ⑥ recursos     ⑦ execução      ⑧ registro diário
⑨ medição      ⑩ faturamento    ⑪ revisão de escopo  ⑫ encerramento
```

**Testado contra:** empreiteira · construtora · reforma · incorporadora.

🔒 **CONTRATAÇÃO:** o contrato pode ser **da contratante**, e os itens medíveis continuam sendo **os da nossa proposta**. Três caminhos de assinatura.
🔒 **ENCERRAMENTO:** com retenção e garantia.

---

# 6. AS ONDAS H0–H12

| Onda | O que é | Estado |
|---|---|---|
| H0 | higiene · rotas · drift do catálogo | 🟡 parcial |
| H1 | **item de escopo atravessa** — a trava única | 🔴 **não começou** |
| H2 | orçamento com item | 🔴 depende de H1 |
| H3 | CRM + agenda + visitas | 🟡 decidido, em construção |
| H4 | obra na NFS-e (E0370) | ✅ **entregue 17/09** |
| H5 | medição | 🔴 |
| H6 | custo real na obra | 🔴 |
| H7 | contratação e assinatura | 🔴 |
| H8 | revisão de escopo (aditivo/supressão) | 🔴 |
| H9-H12 | encerramento · retenção · garantia · portal | 🔴 |

---

# 7. 🔴 A FRENTE CONSTRUTORA — demanda nova (17/09)

> **Uma construtora procurou a PS.** O V8 previu o modelo 🅱️ como *"evolução futura"* e **listou exatamente o que faltaria**: cronograma, curva S, aditivo, medição de subempreiteiro e RDO.

## 7.1 O que a construtora precisa e o Hub NÃO tem

| Frente | O que é | No Hub hoje |
|---|---|---|
| 🔴 **RDO** — Relatório Diário de Obra | avanço físico, mão de obra presente, equipamentos, clima, ocorrências, fotos, paralisações | ❌ nada |
| 🔴 **Cronograma físico-financeiro** | tarefas com prazo, dependências, marco | ❌ `hub_cronograma` ativo e **sem tabela** |
| 🔴 **Curva S** | previsto × realizado acumulado | ❌ |
| 🔴 **Medição de subempreiteiro** | a construtora contrata subs e mede o que eles fazem | ❌ |
| 🔴 **Aditivo / revisão de escopo** | acréscimo e supressão contratual | ❌ (H8) |
| 🔴 **Compras e suprimentos** | cotação, ordem de compra, recebimento | 🟡 existe na GE, não ligado à obra |
| 🟡 **Almoxarifado de canteiro** | estoque **por obra**, não por empresa | 🟡 `erp_estoque_locais` existe |
| 🟡 **Apontamento de equipe** | quem trabalhou, quanto tempo, em qual obra | 🟡 existe na Oficina |
| 🟡 **Portal do cliente final** | acompanhar avanço, fotos, dashboards | 🟡 padrão existe (`/os/[token]`) |

## 7.2 📊 Benchmark — o mercado brasileiro de construtora *(set/2026)*

| Sistema | Posição | O que se destaca |
|---|---|---|
| **Sienge** | o ERP de referência | orçamento, suprimentos, RDO, financeiro integrado — pesado e caro |
| **Obra Prima** | popular em construtora média | RDO completo com clima · **Previsto × Realizado** *("não espere o fim da obra para saber se teve lucro")* |
| **RDOWEB** | especialista em RDO | RDO e RDC · **BMM (boletim de medição)** · curva S · histogramas · pluviometria · **fluxo de assinaturas** · portal do cliente final · catracas e relógio de ponto |
| **VIGHA** | IA aplicada | orçamento com IA · lançamentos financeiros automatizados · centro de custo · medição física |
| **ConstruXion** | operação de canteiro | compras em **Kanban** · medição com curva S · estoque com **alerta de ruptura** · **IDC, IDP e Burn Rate** |
| **Digital Obra** | ERP completo | do orçamento à curva S · conciliação bancária |
| **Mais Controle** | integração | **API com foco em BI** · medições e evolução para dashboards |
| **Foco** | monitoramento | **timelapse automático** · alerta de desvio · integração BIM |
| **Gestão de Obra Fácil** | entrada | RDO em minutos · 2.400 profissionais · **R$ 0 a 89,90** |
| *Procore · Autodesk Construction Cloud* | global | BIM, campo, documentação |

### 💰 O que o mercado cobra

```
plataforma integrada por obra ..... R$ 500 a 2.500 / mês / obra
RDO leve por usuário .............. R$ 50 a 200 / usuário / mês
entrada (Gestão de Obra Fácil) .... R$ 0 a 89,90
```

⚠️ **Modelo POR OBRA é o padrão da categoria** — diferente do nosso, que é por empresa. **É decisão comercial, não técnica.**

### 🎯 Os indicadores que a categoria usa

**IDC** (desempenho de custo) · **IDP** (desempenho de prazo) · **Burn Rate** · **curva S** · **histograma de mão de obra** · **pluviometria**
⚠️ **Nenhum existe no Hub hoje.** São o vocabulário de quem toca obra grande.

## 7.3 O que o Hub JÁ TEM e serve à construtora

```
✅ catálogo de serviços com BOM (390 composições)
✅ BDI com fórmula ABC do TCU, conferida
✅ dois motores de preço (montagem e composição)
✅ take-off de planta com IA (extração de ambientes)
✅ obra como centro de custo
✅ CRM com campos de obra
✅ visita técnica com GPS, foto e áudio
✅ NFS-e com grupo de obra e ISS no município certo
✅ alçada de aprovação
```

> 🎯 **A construtora não precisa de outro sistema — precisa das 6 frentes que faltam.** A fundação está construída.

## 7.4 ⚠️ A decisão que o CEO precisa tomar

**Atender construtora muda o produto.** Três caminhos:

| | O que significa | Risco |
|---|---|---|
| 🅰️ **Não atender agora** | segue o carro-chefe empreiteira | perde o cliente |
| 🅱️ **Atender com o que tem** | vende o Hub como está, sem RDO nem cronograma | 🔴 **frustra o cliente** — falta o que a categoria considera básico |
| 🅲️ **Abrir a frente construtora** | H13-H18: RDO, cronograma, curva S, medição de sub, aditivo, compras | 6 ondas · muda o roadmap |

⚠️ **E há um caminho intermediário que o benchmark sugere:** **o RDO é a porta de entrada da categoria.** *"Frequentemente o primeiro software adotado em empresas que saem do papel."*
➡️ **Começar por RDO + cronograma** atende 70% da dor e é a metade do trabalho.

## 7.5 🔒 E a régua não muda

**A construtora é validador, não escopo.** Tudo o que for construído precisa servir a qualquer construtora — e continuar servindo à empreiteira que já usa.

> **Se o RDO só funcionar para quem toca obra inteira, é bug de produto.**

---

# 8. DÍVIDAS ABERTAS

## 🔴 Críticas
- 🔴 **O catálogo de serviços da Tryo está em ZERO** — é o que impede criar orçamento (§3.3)
- 🔴 **O erro cru de Postgres no Catálogo** — `null value in column unidade`, exibido ao usuário
- 🔴 **O take-off nunca foi percorrido até o fim** — 0 ambientes confirmados
- `hub_medicao` e `hub_cronograma` **ativos e sem nenhuma tabela**
- **Rotas exigem `?area=hub`** — sem o parâmetro, 404
- **404 como resposta a "módulo fora do plano"** — deveria ser mensagem explícita

## 🟡 Higiene
- `bdi_pct` × `bdi_aplicado_pct` — fallback de cache calado
- 9 de 11 plantas são duplicatas; existe `arquivo_hash` e o dedup não é aplicado
- 5 PDFs pararam em `enviada` **sem erro** — parada silenciosa
- **Sem bucket de storage para o CRM** — `erp_crm_visita.fotos` é jsonb e não há onde guardar
- Duas telas sem RPC de criação — **insert direto do frontend**, sem guarda de servidor
- **Hub nunca ligado para FC Pisos e FCR** — é onboarding, não engenharia
- As 5 obras se chamam **"Rodrigo Jantsch"** — nome de quem cadastrou, não da obra

## 📌 Do cluster de obra
- Campos de obra **faltam no "Corrigir e Reenviar"** de nota rejeitada
- 3 das 5 obras estão **sem CNO e sem endereço**

---

# 9. PITCH

> *"Todo sistema de obra faz orçamento e diário. O que ninguém faz é levar o item de escopo do orçamento até a margem — a mesma linha virando contrato, medição, fatura e custo.*
>
> *E a nota sai com o ISS no município da obra, não no da sua sede. Porque quem já emitiu errado sabe o que custa."*

---

*Documento mestre vivo · 17/09/2026. Consolida o Estado da Arte V8 e o documento vivo da FC Pisos. Benchmark de construtora: pesquisa web set/2026 — Sienge, Obra Prima, RDOWEB, VIGHA, ConstruXion, Digital Obra, Mais Controle, Foco, Gestão de Obra Fácil, Procore, Autodesk. Estado real: auditoria do banco de produção 17/09/2026.*
$hubv10$,
  10, true, 'rascunho',
  ARRAY['PS_Hub_Projetos_Estado_da_Arte_V8.md','FC_PISOS_documento_vivo_V1.md']::text[],
  $resumo$O Hub é casca de construção, não vertical em uso (§3.0, revelação do CEO). A causa real do 'orçamento não cria', dita pelo usuário (§3.3). A frente Construtora com benchmark de 10 sistemas (§7). O que subiu em 17/09 (§4.3).$resumo$,
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.erp_documento_vertical WHERE vertical='hub' AND versao=10);
