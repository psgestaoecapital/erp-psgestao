-- Documento Vivo por Vertical (RD-41) — compliance. Markdown em coluna TEXT; um vigente por vertical.
-- Gerado do arquivo de origem; md5 conferido. Idempotente (só insere se ainda não há vigente).

INSERT INTO public.erp_documento_vertical (vertical, titulo, conteudo_md, versao, vigente, origem_arquivos, resumo_mudanca, status)
SELECT 'compliance', 'Compliance & SST — Documento Mestre Vivo', $docmd$# 🦺 PS GESTÃO ERP · COMPLIANCE & SST — **DOCUMENTO MESTRE VIVO**
## Tese · Benchmark · Estado real · Ondas · Riscos

**Atualizado:** 16/09/2026 · **Autor:** Engenheiro Chefe · **Aprovação:** CEO Gilberto Paravizi
**Validador:** FRIOESTE — Frigorífico e Distribuidora de Carnes Magia (`975365cc-9e5a-4251-9022-68c6bfde10d8`)
**Responsável de SST no cliente:** a usuária mais engajada da base — 9 chamados abertos, 5 confirmados

> ## ⚠️ ÚNICO ARQUIVO VIVO DA VERTICAL
> **Consolida:** `PS_SST_Compliance_Blueprint_Estado_da_Arte_V1.md` · `PS_SST_Compliance_Blueprint_V2.md` · `PS_Blueprint_Motor_Infracoes_por_Escala.md`
> Os três permanecem no Project Knowledge até haver segurança (RD-30), mas **este é o documento de referência**.

---

# PARTE I — A TESE

## 1.1 A régua

> **PS SST = a plataforma que INTEGRA o que hoje é fragmentado** (PGR ↔ PCMSO ↔ LTCAT ↔ eSocial ↔ EPI ↔ treinamentos ↔ CAT), extremamente intuitiva, com IA que cruza os dados e **previne o passivo antes da fiscalização** — e mobile-first para o chão de fábrica.

## 1.2 O que a pesquisa confirmou (set/2026)

**No Brasil o mercado é fragmentado.** Cada sistema é forte em uma parte; **ninguém entrega o todo bem integrado.** E a fiscalização digital cruza automaticamente PGR × PCMSO × LTCAT × eventos S-2220/S-2240 — documento desalinhado virou **risco jurídico concreto**.

**No mundo**, as suítes EHS (Cority, Intelex, VelocityEHS, Enablon, Sphera) são poderosas mas **caras (US$ 50-100k/ano), lentas (9-18 meses) e pouco intuitivas**.

**A janela da PS:** integrar tudo + IA nativa + intuitividade + mobile-first, a custo viável.

## 1.3 🎯 O diferencial real — mais estreito e mais fundo

> **A PS mede a pausa térmica com o que a empresa já tem, cruza com o relógio de ponto, e separa o que é infração legal do que é falha de registro. E isso vive dentro de um ERP onde o custo aparece no resultado.**

**Nenhum concorrente faz o cruzamento com ponto.** O Ionguard resolve melhor **com hardware**; os demais **nem tentam**.

---

# PARTE II — BENCHMARK *(auditado set/2026 — não refazer)*

## 2.1 Os quatro do mercado brasileiro

| Sistema | Porte | Posição |
|---|---|---|
| **SOC** (AGE Technology) | **17 milhões de vidas** · 25 anos · 300+ funcionalidades | líder absoluto |
| **RSData** | **100 mil empresas** · 21 anos | referência técnica |
| **SGG** | médio | clínicas e SESMT |
| **Agrat** | pequeno | padronização e laudos |

### O modelo comercial do SOC define a expectativa

> *"Solução completa, sem necessidade de comprar módulos."* · *"Usuários ilimitados."* · *"Upgrades e atualizações de lei sem custo extra."*

⚠️ **Nada de módulo à parte. Nada de cobrança por usuário.**
➡️ **Quem cobra por módulo parece caro mesmo sendo mais barato.**

### O que eles têm e nós não

| Lacuna | Quem tem | Dificuldade |
|---|---|---|
| **eSocial SST completo** (S-2210/2220/2240/2230) | todos | 🔴 alta — **é obrigatório, não opcional** |
| **Base de agentes nocivos** (NR-15/16, ACGIH, Anexo 4) | RSData | 🔴 alta — **é conteúdo, não código** |
| PCMSO, ASO, exames, prontuário | todos | 🔴 alta |
| **Contestação de FAP** | SOC | média — **paga o sistema sozinho** |
| Rede credenciada de prestadores | SOC | 🔴 efeito de rede, não se constrói |
| App do funcionário | SOC | média |
| PPP e LTCAT emitidos | SGG, SOC | média |
| CIPA (eleição, atas) · EPC | SGG | baixa |

## 2.2 🔴 O concorrente direto no nicho

**Ionguard (Iongrade)** — plataforma dedicada a pausa térmica, com sensor **BLE**. O trabalhador carrega um dispositivo e o sistema mede a permanência **automaticamente**.

| | **Ionguard** | **PS** |
|---|---|---|
| Como mede | sensor BLE automático | planilha do relógio + ponto |
| Precisão | tempo real, sem esquecimento | **53% dos registros sem hora de saída** |
| Custo | hardware por câmara | **zero — usa o que existe** |
| Escopo | só pausa térmica | dentro de um ERP completo |

➡️ **Quem tem verba para BLE resolve melhor com eles. Quem não tem usa planilha — e é esse o nosso cliente.**

## 2.3 📌 Um dado técnico que muda o motor

> *"Em regimes de até **-4°C**, são 1h40 de trabalho seguidos de 20 min de descanso."*
> *A NR-15 Anexo 9 define os limites **por regime de temperatura**.*

🔴 **O gatilho de 100 minutos não é fixo — varia com a temperatura da câmara.**
➡️ `gatilho_min` precisa ser parâmetro **por ambiente**, não por empresa.

---

# PARTE III — ESTADO REAL (16/09/2026)

## 3.1 As três barras

```
construído  ████████░░░░░░░░░░░░  48% (estimado)
auditado    ██░░░░░░░░░░░░░░░░░░  10%  (2 de 20 telas)
em uso      ████████████████████  4 empresas
```

**Em uso:** FRIOESTE · R.R Serviços · Tryo Acabamentos · Tryo Gesso
*(e M.M Serviços com funcionários cadastrados)*

## 3.2 Volumes reais

| Item | Qtd |
|---|---|
| Funcionários | **228** |
| Setores | 46 |
| Documentos exigidos | 188 |
| **Catálogo de EPI** | **234** |
| Fichas de EPI | 2 ⚠️ |
| Assinaturas de EPI | 1 ⚠️ |
| Tipos de treinamento NR | 10 |
| Turmas · presenças | 16 · 68 |
| **Marcações de ponto** | **92.683** |
| **Pausas importadas** | **1.028** |
| Pausas apuradas | 354 |
| Consentimentos LGPD | 25 |

⚠️ **O EPI é a contradição da vertical:** 234 itens no catálogo, **2 fichas e 1 assinatura**. O módulo mais completo é o menos usado.

## 3.3 As 20 telas

**1 pronta** *(pausas térmicas)* · **17 parciais** · **2 desconhecidas** *(empresa, setores)*

---

# PARTE IV — AS ONDAS

## ✅ O2.5 · PAUSAS TÉRMICAS — **entregue, e é o diferencial**

**O que estava errado:** o motor somava os minutos do dia e comparava com o total devido. **Não olhava quanto tempo a pessoa ficava exposta sem parar.** Intervalos de 453, 473 e 433 minutos passavam como "cumprida".

**A régua**, definida pela responsável de SST:

| Classe | Faixa | Natureza | Conta como infração? |
|---|---|---|---|
| `pausa_insuficiente` | < 20 min | 🔴 **legal** | **SIM** |
| `pausa_normal` | 20-22 min | ✅ conforme | não |
| `pausa_excesso` | 23-45 min | 🟡 **produtividade** | **NÃO** |
| `pausa_nao_fechada` | > 45 min | ⚠️ **dado** | não até confirmar |
| `pausa_aberta` | sem fim | ⚠️ **dado** | não até confirmar |

> 🎯 **Entre 32 e 52 minutos não existe um único registro.** A régua caiu no vale entre dois grupos.

**🔗 A amarração com o ponto** — o que a responsável pediu:
> *"Precisamos do sistema para, junto com o ponto, amarrar isso e resolver."*

**546 pausas sem fim → ZERO lacunas:** 317 confirmadas pela batida do ponto, 229 estimadas e marcadas como tal.

🔴 **A calibração de fuso — sem ela a amarração erra por 3 horas:**
```
ind_ponto_pausa .... +00 é UTC REAL → converter para America/Sao_Paulo
ind_ponto_marcacao . hora LOCAL rotulada como +00 → já vem local
```
**As duas tabelas têm convenções opostas.** *(registrado em `a4a440da`)*

**Três saídas do mesmo motor, três públicos:**
- **fiscal** — relatório com hash, base legal e origem de cada marcação *(para o MTE)*
- **gestão** — onde está o problema, tendência, por setor
- **supervisor** — o caso curto, para conversar com o colaborador

**Veredito atual:** 52 desvios provados · 156 pendentes · 146 conformes *(eram 189 inflados)*

🔒 **O documento que o colaborador assina declara a origem de cada horário** — "confirmado pelo ponto" e "estimado" nunca parecem "registrado".

## ✅ BASE NO AR
EPI completo com **assinatura por WhatsApp** (Lei 14.063) · funcionários · prestadores · setores · matriz de conformidade · LGPD com gate de consentimento

## 🟡 PARCIAIS
eSocial S-2200/S-2206 (60%) · CAT S-2210 (60%) · validação automática (70%) · matriz de treinamentos (50%) · calendário legal por IA (60%)

## ⚪ CATALOGADO, NÃO CONSTRUÍDO
Copiloto IA · Computer Vision PPE · forecast de incidentes · JSA · higiene industrial · químicos/SDS/GHS · ergonomia NR-17 · app mobile offline · eSocial S-2220/2240/2230

---

# PARTE V — O MOTOR DE INFRAÇÕES POR ESCALA *(blueprint, não construído)*

## 5.1 O problema

`fn_ponto_infracoes` usa **limites globais fixos** (jornada 10h, extra 2h, interjornada 11h) iguais para todos. Sabe *quantas horas* a escala prevê, mas **não usa os HORÁRIOS** para comparar previsto × realizado.

⚠️ **Só a Frioeste tem 132 escalas distintas.** `07:00-11:30 13:30-17:48` · `04:00-08:30 09:40-13:50` · `10:30-15:00 16:15-20:33`

**O que não consegue hoje:** atraso na entrada · saída antecipada · intervalo incorreto · falta em dia de escala · trabalho em folga.

## 5.2 Como deve funcionar

Parsear a escala em eventos previstos e comparar batida a batida:

| Evento | Regra | Base legal |
|---|---|---|
| Atraso na entrada | 1ª batida > prevista + tolerância | CLT |
| Saída antecipada | última batida < prevista − tolerância | CLT |
| Intervalo insuficiente | volta − saída < mínimo legal | **Art. 71** |
| Sem intervalo | jornada > 6h sem batida | **Art. 71 §4** |
| Falta | escala previa e não houve batida | DSR |
| Trabalho em folga | batida em dia sem escala | DSR / feriado |

**Faltam ainda:** adicional noturno (Art. 73) · DSR (Lei 605/49) · feriado sem compensação (Art. 70)

## 5.3 Os sete princípios

1. **Escala individual sempre** — nunca limite uniforme
2. **Regras configuráveis por empresa** — cada uma calibra
3. 🔒 **Indício, não sentença** — o RH valida antes de virar oficial
4. **Motivo + base legal em cada infração** — nunca só "infração"
5. **Jornada externa excluída** (Art. 62)
6. **Auditável** — cada cálculo no audit log
7. **Genérico para qualquer escala** — 6x1, 12x36, noturno, móvel

⚠️ **RD-26: não jogar fora o motor atual.** Ele já cita CLT, trata jornada externa e é auditável. **Evoluir em 4 fases**, cada uma testável contra dias reais.

---

# PARTE VI — PRINCÍPIOS DE DESENHO

1. **O sistema nunca afirma o que não sabe** (RD-51) — dia sem dado aparece como sem dado, nunca como conforme
2. **Toda tela diz o que falta E o impacto** (`0e580f96`)
3. **Separar as naturezas** — infração legal ≠ problema de gestão ≠ falha de dado
4. **O sistema sugere, o responsável confirma** — fim de pausa inventado não sustenta fiscalização
5. **Declarar a origem** — "confirmado pelo ponto" nunca parece "registrado"
6. **Mobile-first para o chão de fábrica**
7. **Avisar, não bloquear**

---

# PARTE VII — RISCOS E CONFORMIDADE

**eSocial é prazo legal** ⚠️ erro de evento gera multa. A validação anti-inconsistência tem que ser sólida.

**Dado de saúde (LGPD Art. 11)** ⚠️ ASO e exames são sensíveis — RLS + trilha de acesso. O documento de ciência tem CPF, PIS e matrícula: base legal é **Art. 7º, II** (obrigação legal), bucket privado.

**Computer Vision** ⚠️ privacidade do trabalhador (face blurring), consentimento e relação sindical.

**O relógio de OS ≠ relógio de ponto** 🔒 um mede eficiência, o outro é folha. Misturar gera passivo.

**⚖️ E a nuance que muda o argumento comercial:** há entendimento de que **a lei não obriga a registrar as pausas** — a obrigação é concedê-las. Mas **o ônus da prova em juízo é do empregador**.
➡️ **O sistema não vende obrigação; vende prova.** Não é *"você é obrigado a registrar"*, é *"sem registro, você perde a ação"*.

---

# PARTE VIII — O QUE FALTA

## 🔴 Chamados abertos da responsável de SST

| # | O que pede | Estado |
|---|---|---|
| **#86** | Pausas térmicas *(novo, hoje)* | 🆕 sem resposta |
| #77 | LTCAT — aba de riscos, EPI e treinamentos | respondido, **ela entrou e faltou** |
| #74 | Relatório mensal com **assinatura do colaborador** | backend no ar, falta a aba |
| #76 | Régua de tolerância — 44 casos entre 23 e 24 min | aguarda ela |
| #75 | Layout da Matriz | respondido |
| #67 | Dashboard de gerenciamento | entregue |
| #53 | LTCAT na tela SST | **aguarda ela: risco por setor ou por função?** |
| #51 | Treinamento na lista de documentos | sai do #53 |

## 🔴 As perguntas que travam

**Para a responsável de SST:**
- as **59 funções** em texto livre: `AJUDANTE DE PRODUÇÃO I`, `(DESOSSA)`, `(ABATE)` — funções diferentes ou a mesma em setores diferentes? ⚠️ **não agrupar sozinho: faca de desossa ≠ serra de abate**
- a partir de quantos minutos um evento vira exposição? *(hoje 60, foi chute nosso)*
- os **87 conflitos** de batida dentro da exposição, caso a caso ou por janela?

**Para o advogado trabalhista:**
- J1 · a redação da declaração de ciência
- J2 · ciência mensal basta, ou por evento?
- J3 · pausa reconstruída pelo ponto tem valor probatório?
- J4 · a recusa de assinar precisa de testemunha?

⚠️ **Nenhuma trava a construção** — o sistema entrega com o default e a resposta vira parâmetro.

## 📊 Backlog vindo do benchmark

- 🔴 **`gatilho_min` por AMBIENTE** *(regime muda com a temperatura)*
- **Contestação de FAP** — paga o sistema sozinho numa indústria
- **EPC** (proteção coletiva) — o SGG tem, ninguém mais fala
- **App do funcionário** — ver o próprio ASO, exame e ficha de EPI
- **CIPA** — eleição online, atas

## ⚠️ E o que nenhum sistema resolve

**O passado.** Se em agosto metade das pausas não foi registrada, **nenhum software conserta retroativamente.** A confirmação pelo ponto é reconstrução, não registro original.

➡️ **O valor do sistema é a partir de agora:** registro correto, prova mensal assinada, e desvio aparecendo no dia seguinte em vez de na fiscalização.

---

# PARTE IX — PITCH

> *"Todo sistema de SST faz PGR, ASO e eSocial. Nenhum consegue provar que a pausa térmica foi concedida.*
>
> *A PS pega o relógio de pausa que você já tem, cruza com o seu ponto eletrônico, e mostra dia a dia quem ficou exposto além do limite — separando o que é infração da lei, o que é falha de registro e o que é só gestão.*
>
> *E emite o relatório que o fiscal pede, com o colaborador assinando que recebeu.*
>
> *Sem sensor, sem instalação, sem projeto de doze meses."*

---

*Documento mestre vivo · 16/09/2026. Consolida os blueprints V1 e V2 de SST/Compliance e o Blueprint do Motor de Infrações por Escala. Benchmark: pesquisa web set/2026 — SOC/AGE, RSData, SGG, Agrat, Ionguard/Iongrade, Sistema Metra, ESO, Madu, Apollus, OnSafety, e as suítes EHS mundiais. Estado real: auditoria do banco de produção 16/09/2026. Números de terceiros são direção, não promessa.*
$docmd$, 1, true, ARRAY['PS_Compliance_DOCUMENTO_VIVO.md']::text[],
       'Consolidação inicial no banco (RD-41).', 'rascunho'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_documento_vertical WHERE vertical='compliance' AND vigente);
