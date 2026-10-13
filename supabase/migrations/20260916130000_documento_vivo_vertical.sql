-- Documento Vivo por Vertical (RD-41) — o markdown vive em coluna TEXT no banco,
-- porque a Claude só faz SELECT no banco (não lê arquivo de bucket).
-- ① a tabela  ② o documento vivo da OFICINA (MASTER V4 consolidado).
-- Uma versão vigente por vertical (índice único parcial). Rascunho→aprovação, como os chamados.
-- RD-30: não apaga histórico; versões antigas ficam com vigente=false.

CREATE TABLE IF NOT EXISTS public.erp_documento_vertical (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical        text NOT NULL,                       -- area_menu_config.area_slug
  titulo          text NOT NULL,
  conteudo_md     text NOT NULL,                        -- o markdown inteiro
  versao          int  NOT NULL DEFAULT 1,
  vigente         boolean NOT NULL DEFAULT true,
  origem_arquivos text[],                               -- quais .md foram consolidados
  resumo_mudanca  text,                                 -- o que mudou nesta versão
  status          text NOT NULL DEFAULT 'rascunho',     -- rascunho | aprovado
  criado_por      uuid,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  aprovado_por    uuid,
  aprovado_em     timestamptz
);
ALTER TABLE public.erp_documento_vertical ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS ux_doc_vertical_vigente
  ON public.erp_documento_vertical (vertical) WHERE vigente;

COMMENT ON TABLE public.erp_documento_vertical IS
  'Documento vivo (um por vertical): o que DEVERIA existir. Markdown consolidado em TEXT. Um vigente por vertical.';

-- ② OFICINA — MASTER V4 (consolidado). Guardado para ser idempotente: só insere se ainda não há vigente.
INSERT INTO public.erp_documento_vertical (vertical, titulo, conteudo_md, versao, vigente, origem_arquivos, resumo_mudanca, status)
SELECT 'oficina',
       'Oficina — Documento Mestre Vivo (MASTER V4)',
       $docmd$# 🔧 PS GESTÃO ERP · OFICINA — **MASTER V4**
## Documento único e vivo da vertical · Tese · Benchmark · Estado real · Ondas · Riscos

**Atualizado:** 14/09/2026 · **Autor:** Engenheiro Chefe · **Aprovação:** CEO Gilberto Paravizi
**Validador:** Gean Auto Mecânica / KGF (`a462e13f-0f51-4c54-abe8-4474b591633b`)
**Estado:** ✅ **fechada em código** — 10 ondas, ~55 PRs, migration final `20260914120000`

> ## ⚠️ ÚNICO ARQUIVO VIVO DA VERTICAL
> **Substitui:** ❌ `PS_Oficina_MASTER_V3.md` · ❌ `PS_Oficina_MASTER_V2.md` · ❌ `OFICINA_ondas_operacao.md` · ❌ `OFICINA_andamento_implantacao.md` · ❌ a seção "OFICINA" do `MD_manutencao_estado_sistema.md` *(o resto do arquivo continua — é transversal)*
> **Apagar todos do Project Knowledge.**

| Versão | Data | O que mudou |
|---|---|---|
| V1 | — | Benchmark oficina mecânica/elétrica/tornearia |
| V2 | 01/08/2026 | Benchmark mundial + tempário + estado (23 OS) + diferenciais + roadmap |
| V3 | 12/09/2026 | KGF virou operação (166 OS) · benchmark reauditado · funil medido · ondas do dado |
| **V4** | **14/09/2026** | **Vertical fechada em código.** 10 ondas · Onda 9 adiada com gatilho · 5 e 8 gated em gente · achados transversais · **D5 resolvida: o custo-hora vem do `erp_pagar` real** |

---

# PARTE I — A TESE

## 1.1 O que todo sistema de oficina faz
Abre OS, lança peça e mão de obra, imprime, recebe.

## 1.2 O que quase nenhum faz
> *"Esse serviço de 1h30 deu lucro? Quanto custou a hora daquele mecânico de verdade — com salário, encargos, energia, aluguel e o tempo que ele ficou parado esperando peça?"*

## 1.3 A janela da PS
**Excelência técnica sobre o motor financeiro real.** O concorrente ou é só técnico (Tempario, Oficina.app) ou é ERP genérico adaptado (GestãoClick). A PS entrega OS, diagnóstico, tempário e DVI **com** DRE, conciliação, CNAB, NFS-e e BPO por baixo — **mesmo dado, uma verdade**.

**Ninguém no Brasil junta tempário + IA que valida o tempo + custo homem-hora vindo do financeiro real num sistema só.**

✅ **Confirmado no código (14/09):** `fn_oficina_custo_hora` **lê `erp_pagar`**. O custo-hora não é digitado — nasce da despesa real da empresa. *(Resolve a D5, aberta desde o V2.)*

## 🔒 1.4 A FRONTEIRA INVIOLÁVEL
**Financeiro é monopólio da Gestão Empresarial.** A Oficina faz o técnico/operacional e **dispara evento**. Nenhuma tela de contas, DRE, fluxo de caixa ou estoque dentro da Oficina. Funções financeiras dos concorrentes são marcadas **[→GE]** — acopla, não recria.

⚠️ **Refinamento de 12/09 (`c2869c85`):** a Oficina **LÊ** dado financeiro da GE — aceitável. O que ela **não faz é ESCREVER**. E a fronteira é definida por **quem chama** (a tela), não pelo nome da RPC: funções `fn_os_*` que escrevem em `erp_receber` rodam de `/dashboard/os` e `/commerce/otc`, **fora** da vertical.
**Não re-alarmar ao ver a Oficina lendo `erp_receber`.**

## 🔒 1.5 R4 — O MECÂNICO NUNCA VÊ DINHEIRO
Regra do CEO, inegociável. Vale para RPC, view e tela — **não basta esconder na interface, a RPC não pode devolver**.
**Regra operacional (`655bb74b`):** *contagem é operação (todos veem) · valor é dinheiro (só dono/admin).*

---

# PARTE II — BENCHMARK MUNDIAL *(auditado set/2026 — não refazer)*

## 2.1 Os sistemas que definem o teto

| Sistema | Posição | Preço/mês | O que faz de melhor |
|---|---|---|---|
| **Shopmonkey** | melhor geral | ~US$ 179 | SMS bidirecional, pagamentos e DVI em todos os planos; leve + pesado |
| **Tekmetric** | multi-loja | US$ 179–249 | Relatório entre lojas, **matriz de peça e MO**, inspeção por técnico |
| **Shop-Ware** | aprovação digital | ~US$ 199 | DVI avançado, portal do cliente, quadro de fluxo |
| **AutoLeap** | visão do dono | ~US$ 179 | Painéis, campanhas, CRM |
| **Fullbay** | **pesado/diesel** | ~US$ 188 | ver 2.2 |
| Mitchell 1 / ALLDATA | informação técnica | — | Tempos de reparo, diagramas, procedimentos |
| Garage360 | IA-first | US$ 79+ | UI moderna, DVI, insights por IA |
| AutoVitals / Bolt On | só DVI | — | Origem da maioria dos números duros |

## 2.2 🚛 Fullbay Next (ago/2026) — para onde o mercado foi
Wrench mode (tela só do técnico) · Kanban · Quick Work Order · **voz para texto** · IA que limpa a anotação crua · análise de imagem · Fleet Center · registro universal da unidade · integração **MOTOR** (tempos de MO) · DVIR → OS automática · conformidade DOT · API com 50+ plataformas de peça.

> 🎯 O líder mundial em pesado reescreveu a plataforma **inteira** em torno de *"o técnico não digita"*.

## 2.3 🇧🇷 O mercado brasileiro

| Sistema | Preço/mês |
|---|---|
| OnMotor | R$ 32 |
| GestãoClick | R$ 59–309 |
| **Wüst** | **R$ 79,90** — OS + NFS-e + financeiro + estoque + CRM |
| OficinaOS | R$ 97 |
| Oficina Integrada | R$ 99 |
| Ultracar | R$ 189 |
| AutoPro · Oficina.app | preço fechado |
| **PS Oficina** | **R$ 197–497** |

> ⚠️ **O fato desconfortável:** a PS cobra **2,5× a 6×** o preço de quem já faz OS, NFS-e e financeiro. **O diferencial precisa estar visível na primeira semana de uso**, ou o dono compara só o preço.

## 2.4 📊 Os números do DVI

| Medida | Impacto |
|---|---|
| DVI com boas práticas | **+27% no ticket** |
| 20+ fotos vs ≤5 | **+30,4%** |
| 40+ fotos | **+45%** |
| foto **anotada** vs crua | **+19%** |
| DVI+SMS vs telefone | **+50%** |
| reparo > US$ 1.000 | aprovação de 20–25% → **55–65%** |
| sem DVI → foto → foto+vídeo+SMS | US$ 385 → 465 → **520** |

**Metas da indústria:** 90%+ das OS com inspeção · 80% inspeção→orçamento · 55%+ aprovação em itens amarelos/segurança · 1,5–3,0 itens adicionais por veículo · **< 3 min** até enviar.
**Adoção real:** 52% das oficinas (Ratchet+Wrench 2026); 78% entre as com contabilidade especializada.

## 2.5 As três medidas que não são a mesma coisa
**Produtividade** (do total de horas presentes, quantas foram faturáveis) · **Eficiência** (vendidas ÷ gastas) · **Proficiência** (qualidade, retrabalho).

> Um técnico pode ser muito eficiente e a oficina improdutiva — rápido, mas metade do dia esperando peça. **Só o apontamento separa as duas.**

⚠️ **Distinção jurídica:** o relógio da OS mede eficiência, **não é relógio de ponto para folha**. Misturar gera passivo trabalhista.

## 2.6 🧠 Por que o técnico não usa
1. **"Uma ferramenta que leva mais de dois toques para trocar de trabalho será abandonada nos dias mais cheios — exatamente quando o dado importa mais."**
2. Técnico lê apontamento como **vigilância**. Quem acha que o número será usado contra ele registra errado.
3. Entrada manual consome quase **um dia de trabalho por semana**.

---

# PARTE III — ESTADO REAL (14/09/2026)

## 3.1 A KGF deixou de ser piloto

| Mês | OS |
|---|---|
| Junho | 4 |
| Julho | 19 |
| **Agosto** | **105** |
| Setembro (14 dias) | 38 |

**143 OS ativas · 130 entregues · R$ 133.503,50 · ciclo médio 4,3 dias**
**4 mecânicos:** Gean · Alisson · Jefe · `mecanicageandiagnosticos`

| Status | Qtd |
|---|---|
| entregue | 147 |
| aberta | 6 |
| aguardando aprovação | 5 |
| aguardando peça | 4 |
| pronta | 3 |
| em execução | 1 |

## 3.2 O funil que definiu as ondas

```
143 OS
 ├─ recepção ......... 141   99%
 ├─ diagnóstico ...... 134   94%
 ├─ aprovação ........ 126   88%
 ├─ mecânico ......... 125   87%
 ├─ foto .............  88   62%
 └─ APONTAMENTO .....   26   18%   ← o buraco que a Onda 1 atacou
```

## 3.3 🔴 O QUE A AUDITORIA DESCOBRIU (e ninguém sabia)

| Achado | Realidade |
|---|---|
| **O apontamento não media nada** | 37 de 38 duravam **menos de 1 minuto** — o tempo era **digitado**; o cronômetro era decorativo |
| **`mecanico_id` era o clicador** | gravava `auth.uid()` — o balcão apontava pelo mecânico |
| **721 de 724 itens eram texto livre** | `servico_id` nulo em 100% → o tempário **nunca recebeu um dado real** |
| **543 dos 724 itens são PEÇA, não serviço** | tudo no mesmo campo; `filtro óleo` em 5 grafias |
| **A margem gravada era 100% — falsa** | zero OS com custo de peça; o snapshot lia tabela vazia |
| **O mecânico via R$ 55.814,89** | `fn_oficina_home_metricas` devolvia faturamento a qualquer usuário |
| **3 mecânicos viraram 9 grafias** | `alisson`/`ALISSON`/`Alisson`, e `Geab` = Gean |
| **A assinatura nunca foi usada** | 2 em 183 — e **234 de 235 aprovações são presenciais** |
| **O Gold nunca clicou na Oficina** | `gold_screen_buttons` vazio nas 11 telas — só print estático |

## 3.4 ⭐ O TEMPÁRIO — o diferencial · passos 1–3 de 7

**Funcionando e confirmado no código:**

```
custo homem-hora ......... R$ 89,78/h   ← calculado de custos REAIS (lê erp_pagar)
serviço de 1h30 .......... R$ 175,07    (1,5 × 89,78 + 30%)
```

**Parâmetros da KGF (`erp_oficina_parametros`):**

| Parâmetro | Valor |
|---|---|
| `ramo` | automotiva |
| `margem_alvo_mao_obra_pct` | 30 |
| `margem_alvo_peca_pct` | 40 |
| `horas_produtivas_mes` | 160 |
| `markup_piso_pct` / `markup_teto_pct` | 0 / 100 |
| `pos_venda_janela_dias` | 90 🆕 |
| `custo_hora_manual` | **null** ✅ *(vem do real)* |
| `imposto_venda_pct` · `comissao_venda_pct` · `custo_fixo_pct` | **null** ⚠️ |
| **`usar_matriz_peca`** | **`false`** ⚠️ |

**Matriz de margem de peça — preenchida e DESLIGADA:**

| Até | Markup |
|---|---|
| R$ 20 | 100% |
| R$ 100 | 70% |
| R$ 500 | 50% |
| R$ 2.000 | 40% |
| acima | 30% |

⚠️ **Duas pendências de configuração (RD-25 — decisão do CEO/Gean):**
1. `usar_matriz_peca = false` — a matriz existe, está correta e **não é usada**
2. imposto, comissão e custo fixo **nulos** — o preço sai sem eles

**`categorias_custo_fixo`** aponta para o plano de contas: `2.04.01` · `2.03.01` · `2.03.10` · `2.04.04` · `2.04.10` · `2.05.04`

## 3.5 Qualidade do dado

| Problema | Qtd |
|---|---|
| OS sem KM | 19 *(Onda 6 ataca na origem)* |
| OS sem mecânico | 18 |
| OS sem placa | 2 |
| `erp_os.equipamento` | **vazio em 142 de 143** — campo morto |

## 3.6 O que está no ar

**15 tabelas:**
`erp_os` · `erp_os_recepcao` · `erp_os_diagnostico_item` · `erp_os_aprovacao` · `erp_os_apontamento` · `erp_os_mecanico` · `erp_os_peca_solicitacao` · `erp_os_registro_foto` · `erp_os_assinatura` · **`erp_os_link_publico`** 🆕 · `erp_oficina_servicos` · `erp_oficina_servico_execucao` · `erp_oficina_comissao_regra` · `erp_oficina_parametros` · **`erp_oficina_contato`** 🆕

**88 RPCs** `fn_oficina_*` e `fn_os_*` *(eram 78 no V3)*
✅ **Os 4 overloads gêmeos foram eliminados** (Onda 7)

**13 telas, todas catalogadas:**

| Rota | Selo |
|---|---|
| `/oficina/recepcao` | ✅ pronto |
| `/oficina/diagnostico` | ✅ pronto |
| `/oficina/aprovacao` | ✅ pronto |
| `/oficina/apontamento` | ✅ pronto |
| `/oficina/entregues` | ✅ pronto |
| `/oficina/veiculos` | ✅ pronto |
| `/oficina/agenda` | ✅ pronto *(60 agendamentos — o V2 dizia "parqueado", estava errado)* |
| `/oficina/solicitacoes` | ✅ pronto |
| `/oficina/usuarios` | ✅ pronto |
| `/oficina/comissao` | 🟡 parcial *(0 regras — selo correto)* |
| **`/oficina/pos-venda`** 🆕 | ✅ pronto |
| **`/os/[token]`** 🆕 | pública · `auditavel_robo=false` |
| **`/veiculo/[token]`** 🆕 | pública · `auditavel_robo=false` |

## 3.7 A cadeia original (13 PRs, 18–19/07/2026)

Base sobre a qual tudo foi construído:

| Tela | PR | O que faz |
|---|---|---|
| Recepção | #697 | Check-in: busca por placa → prefill · km · queixa · checklist (combustível, pneus, estepe, faróis, retrovisores, vidros, documentos, tapetes) · avarias · objetos · fotos → cria OS. Bucket privado `oficina-recepcao` |
| Diagnóstico | #698 | Laudo por item: causa, serviço do tempário, peça, severidade |
| Aprovação/Orçamento | #699 · #701 | Valor do tempário, editável · WhatsApp · aprovar **item a item** · trilha |
| Apontamento | #700 | Iniciar/Concluir · previsto × real |
| Veículos | #702 | Busca por placa/cliente + histórico ("N passagens") |
| Peças | #703 | Peças estruturadas na OS |
| Comissão | #704 | Período · horas × regra *(o pagamento é da GE)* |
| Editar/Excluir/Restaurar | #713 | **Soft delete sempre** · trilha `EDITOU/EXCLUIU/RESTAUROU` em `audit_log_global` · "Ver excluídas" + ♻️ Restaurar · **guard: não altera valores de OS faturada** |
| Menu · 404 · fila · acabamentos | #705–#712 | acender cadeia · fix 404 PT-BR · fix menu · fila por etapa + placa inline · fotos |

---

# PARTE IV — AS ONDAS

## ✅ ONDA 0 · OS entregue → contas a receber
A fila vive **na GE** (`/dashboard/financeiro/faturar-os`), nunca na Oficina.
`fn_os_faturar_lote` com **subtransação por OS** *(falha isolada não derruba o lote)* · gate por papel (`is_admin` ou `CLIENT_OWNER`; **OFICINA_\* bloqueado**) · vincular/criar cliente com dedup · relatório do que passou e pulou · sem seletor de conta *(a KGF tem 0 contas — título sai sem conta, define no recebimento)*.
**Estado:** 82 prontas · 21 sem cliente · 10 sem valor *(backlog de 31/07 a 28/08)*
**Pendente:** RD-53 — a Jordana fatura 2–3 e confere antes de liberar o lote.
*PRs 1436 · 1437 · 1439 · 1440 · 1441 · 1442*

## ✅ ONDA 1 · Apontamento na mão do mecânico
Cronômetro virou a fonte (`tempo_cronometro_h` gravado sempre; ajuste manual fica **marcado**, não sobrepõe em silêncio) · `mecanico_id` = **executor**, `criado_por` = quem clicou · diagnóstico liga ao catálogo com toggle Serviço/Peça · `fn_oficina_servico_criar` com dedup normalizado · tela do mecânico com fila própria, dois toques, botão 48px, **voz na observação**.
*PRs 1406–1414*

## ✅ ONDA 2 · DVI — a foto vira dinheiro
Foto ligada ao **item** de diagnóstico · `anotacao` em jsonb (**nunca queimada na imagem** — o original é documento) · link público `/os/[token]` com signed URL **server-side**, TTL 1h, noindex, página neutra em token inválido · envio por `wa.me` (RD-42, custo zero).
*PRs 1422–1426 · 1428 · 1433*

## ✅ ONDA 3 · Assinatura na aprovação
**Inline** em `erp_os_aprovacao.assinatura`, ligada ao valor, aos itens, ao aprovador e ao canal exatos. Assina **por último**; mudar item limpa a assinatura (mudar custo não).
🔒 **Não usa `erp_os_assinatura`** (`checklist_ciente`) — ciência de estado e autorização de gasto são atos jurídicos diferentes.
*PR 1427*

## ✅ ONDA 4 · Margem verdadeira
Custo vem de `erp_os_diagnostico_item` *(a fonte antiga, `erp_os_peca_solicitacao`, tinha 0 linhas)* · `custo_unitario` como snapshot lido **no servidor** · **custo desconhecido → margem NULL + `custo_incompleto` + `motivo_custo`, nunca 100%** · `entregues_listar` reconcilia com `qtd_custo_incompleto` *(senão o lucro NULL sumiria da soma em silêncio)*.
*PRs 1429–1432 · 1434*

## ✅ ONDA 6 · Qualidade do dado na entrada
KM em destaque na recepção · **`km_indisponivel`** separa "esqueceu" de "não deu pra ler" · mecânico por seleção · escopo por **placa**, não por ramo.
*PRs 1420 · 1421*

## ✅ ONDA 7 · Selos e dívida técnica
4 selos corrigidos · **4 overloads gêmeos eliminados** · agenda confirmada como tela real.
*PRs 1415–1419*

## ✅ ONDA 10 · Pós-venda e portal
**Contagem regressiva**, não lista de vencidos — a KGF opera há 3 meses e nenhuma placa passou de 90 dias; o primeiro contato cai em 46 dias. Central de mensagens (`wa.me` + desfecho; **quem recusa sai da fila**) · portal `/veiculo/[token]` **sem valores** · telefone na recepção com **consentimento separado** (operacional × pós-venda).
⚠️ **Pivô de 13/09:** a inferência de intervalo de revisão provou-se inconfiável (0 de 19 placas com confiança alta) → trocada por "sem voltar há X tempo", que é verdade.
*PRs 1443–1446 · 1448 · 1449*

## ✅ R4 · Mecânico não vê dinheiro
4 portas fechadas: home, `a_faturar`, `entregues_listar`, `entregue_sem_nota`.
`fn_oficina_custo_hora` **fica sem gate** — é cálculo interno do snapshot e do precificar; gatear quebraria. Controle por rota. **Dívida conhecida, não omissão.**
*PRs 1435 · 1438*

## ✅ REGRA 0e580f96 · avisos de dado faltante
6 telas já atendiam · 4 parciais corrigidas: comissão sem-regra **fora do total** (não R$ 0,00 somado) · aprovação com item sem preço fora do total · empty states de Veículos e Usuários.
*PR 1447*

## ✅ BOT DE AUDITORIA
Empresa `[BOT] Oficina` com **`ambiente_tenant='auditoria'`** *(não `restrita_ps_admin` — essa flag é sigilo CVM e esconderia do próprio robô)* · seed idempotente **provado: 1ª cria 5, 2ª cria 0** · 4 `gold_screen_buttons` por `has-text` *(padrão da revenda)*.
**A Camada 2 do Gold passou a clicar.** Antes só tirava print.
*PRs 1451 · 1452*

---

## ❌ ONDA 9 · Mecânica pesada — ADIADA
**O dado não sustenta:** 2 de 143 OS são pesado (**1,4%**) · 1 frota real (FC Pisos, 7 placas) · `erp_os.equipamento` vazio em 142 de 143 · `veic_veiculo_id` preenchido em **0 de 143**.

⚠️ A frase do V3 *"a KGF já atende caminhão"* **era suposição, não dado**.

⚠️ E `veic_veiculo` **não serve** — é o módulo de **venda** de veículos (estoque da loja, com `valor_aquisicao`, `preco_venda`, `margem_alvo`). Não é cadastro de frota de cliente.

🔔 **Gatilho para reavaliar:** uma oficina de pesado entrar como cliente **OU** o pesado da KGF passar de ~20% das OS.
**O benchmark do Fullbay segue válido — não refazer a pesquisa.**

## 🔒 ONDA 5 · Comissão — gated no Gean
Tela e RPCs prontas, **0 regras cadastradas**. A regra é decisão dele (RD-25), chamado **#64**.
⚠️ Depende da Onda 1 em uso · e da normalização de nome (3 mecânicos em 9 grafias pagariam 9 comissões).
⚠️ `fn_oficina_comissao_calcular` agrupa por **`mecanico_nome`**, não por id — a solução definitiva é migrar para `mecanico_id`, que já existe desde o #1410.

## 🔒 ONDA 8 · Tempário passos 4–7 — gated no uso
Sem tempo real apontado, a IA não tem contra o que comparar.
*Referência: o Fullbay integra a base MOTOR. No Brasil não há equivalente aberto — o tempário próprio, alimentado pelo histórico real da oficina, é a resposta.*

---

# PARTE V — PRINCÍPIOS DE DESENHO

> **"Super intuitivo" não é tela bonita. É contar toques.**

1. **Dois toques.** Mais que isso no box = abandonado no dia cheio.
2. **Nada que possa ser calculado deve ser digitado.**
3. **O técnico tem uma tela só dele** (*wrench mode*).
4. **A foto substitui o argumento.**
5. **Falar em vez de digitar.**
6. **O sistema nunca afirma o que não sabe** (RD-51). Margem 100% sem custo é mentira.
7. **Avisar, não bloquear.** Software que trava é contornado, e o dado some.
8. **Enquadrar como proteção, não vigilância.**
9. 🆕 **Toda tela diz o que falta E o impacto** (`0e580f96`) — *"falta X"* + *"sem X você não consegue Y"*. Regra do CEO, todas as verticais.

---

# PARTE VI — ACHADOS QUE VALEM ALÉM DA OFICINA

| Achado | Registro |
|---|---|
| Adicionar parâmetro com DEFAULT via `CREATE OR REPLACE` **cria overload**, não substitui. O antigo fica vivo e os chamadores caem nele em silêncio | `ca93f795` |
| `gold_screen_buttons` vazio = Camada 2 não exercita. **179 de 214 telas do sistema** estão assim — o placar Gold de jornada mede print estático em 84% | `c52f320b` |
| **PR só-frontend não aparece no ledger de migrations.** Conferir merge pelo ledger esconde metade | `c6d4fd3b` |
| `ambiente_tenant` é o filtro real de dado sintético — `is_demo` era rótulo | RD-44 |
| Fronteira definida por **quem chama**, não pelo nome da RPC | `c2869c85` |
| Contagem é operação · valor é dinheiro | `655bb74b` |
| Toda tela avisa o que falta e o impacto | `0e580f96` |
| Assinatura inline, não em tabela separada, quando o ato é autorização de gasto | `a23f82e9` |

**Checklist de entrega de tela — os três, sempre:**
`system_screens` + `module_catalog` + `gold_screen_buttons` (seletor `has-text`)

---

# PARTE VII — RISCOS E CONFORMIDADE

**Fiscal** ⚠️ ICMS-ST de autopeça e óleo lubrificante em SC pode exigir **CSOSN 500 / CFOP 5405 / CEST** — validar com o contador *(pendência KGF conhecida, ainda aberta)*.

**Trabalhista** ⚠️ Comissão de mecânico (CLT/PJ/autônomo) — regra configurável; o pagamento vira `erp_pagar` **[→GE]**.
🔒 **Relógio de OS ≠ relógio de ponto.** Um mede eficiência do serviço; o outro é folha. Misturar gera passivo.

**LGPD** ⚠️ Placa e chassi são dado pessoal. Foto de veículo mostra placa. RLS multi-tenant · bucket privado · signed URL com TTL · **consentimento separado** para pós-venda *(operacional é legítimo interesse; campanha exige opt-in)* · portal público com noindex e sem PII.

**Preço** ⚠️ R$ 197–497 num mercado que começa em R$ 32. **O diferencial precisa estar visível na primeira semana**, ou o dono compara só o preço.

---

# PARTE VIII — O QUE FALTA, E NÃO É CÓDIGO

## 🔴 As duas provas humanas (RD-59)

**1. A Jordana fatura 1 OS** em `/dashboard/financeiro/faturar-os`, confere o título em Contas a Receber, e então libera o lote. Destrava **106 OS entregues sem título**.

**2. A KGF roda o roteiro** (`KGF_roteiro_teste_oficina.pdf`, entregue 14/09): recepção → diagnóstico → orçamento por WhatsApp → aprovação com custo e assinatura → apontamento no celular.

## 📊 Indicadores — todos em zero após 4 dias de construção

| Indicador | Hoje | Meta |
|---|---|---|
| OS abertas desde 11/09 | **0** | — |
| Adesão do apontamento | 18% | 60%+ |
| Apontamentos com executor | **0** | 90%+ |
| Itens ligados ao catálogo | **0** de 724 | 70%+ |
| Itens com custo | **0** | 90%+ |
| Fotos ligadas ao item | **0** | — |
| Links públicos gerados | **0** | — |
| Tempário aprendendo | **0** linhas | > 100 |
| Entregues sem título | **106** | 0 |
| Catálogo de serviços | **3** | ~13 |

> **A vertical está construída e não foi exercitada uma vez.** A diferença entre pronta e provada não é código — é uso.

## ❓ Decisões abertas

| # | Pergunta | Em quem |
|---|---|---|
| D1 | Os serviços de mão de obra **com o tempo padrão** ← destrava Ondas 5 e 8 | **Gean** #64 |
| D2 | Separar os 105 itens lançados como "serviço" — quais são peça? | **Gean** #64 |
| D3 | Peça comprada na hora: cadastra direto ou solicita ao dono? | **Gean** #64 |
| D4 | Qual a regra de comissão? | **Gean** #64 (RD-25) |
| D5 | Liberar o Jefe como operador *(acesso vem do tenant; `users.role` divergente é higiene)* | **Gean** #64 |
| D6 | Quem usa `mecanicageandiagnosticos`? *(é `CLIENT_VIEWER` e criou 6 apontamentos)* | **Gean** #64 |
| D7 | "Geab" é typo de Gean ou quarta pessoa? | **Gean** #64 |
| **D8** | **Ligar `usar_matriz_peca`?** A matriz está preenchida e desligada | **CEO/Gean** (RD-25) |
| **D9** | **Imposto, comissão e custo fixo estão nulos** nos parâmetros — o preço sai sem eles | **CEO/Gean** (RD-25) |
| D10 | ICMS-ST de autopeça em SC — CSOSN/CFOP/CEST | **contador** |

✅ **Resolvidas no V4:** o custo-hora vem do `erp_pagar` real *(D5 do V3)* · a agenda é tela real com 60 agendamentos *(D6 do V3)* · mecânica pesada não entra agora *(D7 do V3)*.

**Todas as perguntas ao Gean vão pelo chamado, nunca por mensagem avulsa** (decisão do CEO, 12/09).

---

*Documento-mestre vivo V4 · 14/09/2026. Benchmark: pesquisa web set/2026 — Shopmonkey, Tekmetric, Shop-Ware, AutoLeap, Fullbay/Fullbay Next, Mitchell 1, ALLDATA, Garage360, AutoVitals, Bolt On, Torque360, Xtime, PartsTech (752 oficinas), Ratchet+Wrench 2026 (430+ oficinas), Paar Melis 2025, mercado BR (Wüst, Ultracar, OficinaOS, Oficina Integrada, OnMotor, GestãoClick, AutoPro, Oficina.app). Estado real: auditoria do banco de produção 14/09/2026. Números de terceiros são direção, não promessa.*
$docmd$,
       4, true,
       ARRAY['PS_Oficina_MASTER_V4.md']::text[],
       'Consolidação inicial no banco (RD-41): MASTER V4 vira o documento vivo da vertical Oficina.',
       'rascunho'
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_documento_vertical WHERE vertical='oficina' AND vigente
);
