-- Documento Vivo por Vertical (RD-41) — revenda_veiculos. Markdown em coluna TEXT; um vigente por vertical.
-- Gerado do arquivo de origem; md5 conferido. Idempotente (só insere se ainda não há vigente).

INSERT INTO public.erp_documento_vertical (vertical, titulo, conteudo_md, versao, vigente, origem_arquivos, resumo_mudanca, status)
SELECT 'revenda_veiculos', 'Revenda de Veículos — Documento Mestre Vivo (V6)', $docmd$# 🚗 PS GESTÃO ERP · REVENDA DE VEÍCULOS — **DOCUMENTO MESTRE VIVO**
## Tese · Motor · Ondas · Estado real · Decisões

**Atualizado:** 16/09/2026 · **Autor:** Engenheiro Chefe · **Aprovação:** CEO Gilberto Paravizi
**Validador:** Alliance Veículos LTDA (`5ab9cfd2` · CNPJ 51.858.456/0001-28)
**Operador no cliente:** Fábio — **10 chamados abertos, 9 sem confirmação**

> ## ⚠️ ÚNICO ARQUIVO VIVO DA VERTICAL
> **Consolida e substitui:** `PS_Revenda_Veiculos_MASTER_V5.md` · `PS_Revenda_Veiculos_Blueprint_V1.md` · `SPEC_ficha_completa_veiculo_veicProd.md` · `QUESTIONARIO_CONTADOR_revenda_veiculos.md` · `TESTE_focus_veicprod_homologacao.md` · `Alliance_o_que_precisamos_para_emitir_nota.md`
> *(o `ps_revenda_veiculos.html` continua — é peça de venda, não documentação)*

| Versão | Data | O que mudou |
|---|---|---|
| V1–V4 | 04–06/09 | blueprint · benchmark Autoconf · 17 telas · consolidação |
| V5 | 08/09 | 14 PRs, 8 ondas entregues e validadas |
| **V6** | **16/09** | **Estado reauditado: 21 veículos, R$ 1.235.000 parados. As vistorias começaram (3). Os 10 chamados do Fábio mapeados. `veic_config` continua vazia — é a trava central.** |

---

# PARTE I — A TESE

> **PS Revenda = cada veículo com o lucro que ele realmente deu.**

## Os três diferenciais, e nenhum é óbvio

**1 · O custo que some.** Despachante, funilaria e IPVA assumido viram despesa do mês e desaparecem do veículo. **Amarrados ao chassi, mudam qual carro vale a pena comprar.**

**2 · 🏆 A troca supervalorizada.** A loja avalia o usado em R$ 35 mil e "dá" R$ 40 mil para fechar. **Os R$ 5 mil são desconto disfarçado.** Gravados como custo do usado, **duas margens ficam erradas ao mesmo tempo** — e uma compensa a outra no total, então ninguém percebe.
> **Nenhum sistema de revenda que conhecemos separa isso.**

**3 · No financiamento, quem deve é o banco.** O cliente não é devedor da loja. Entrada é do cliente, repasse é do banco, retorno do banco é receita — não parte do preço.

## O que nenhum sistema responde

> *"Comprei por 60. Fiquei 94 dias com ele. Gastei em funilaria, documentação e o pátio ocupado. Vendi por 85 — mas dei R$ 5 mil a mais na troca. **Ganhei quanto, mesmo?**"*

---

# PARTE II — ESTADO REAL (16/09/2026)

## 2.1 As três barras

```
construído  ░░░░░░░░░░░░░░░░░░░░  sem dado ⚠️
auditado    ████████████████████  100% (4 de 4 telas)
em uso      ████████████████████  1 empresa · Alliance
```

⚠️ **"Construído sem dado" não é zero.** As 4 telas existem, funcionam e têm botões auditáveis — **mas nenhuma foi marcada como pronta ou parcial.** Estão `desconhecida`.
➡️ **Chamado #85 aberto:** o Fábio valida e marca as 4.

## 2.2 🔴 O placar que importa

| Métrica | 08/09 | **16/09** |
|---|---|---|
| Veículos ativos | 17 | **21** |
| **Capital parado** | R$ 1.101.000 | **R$ 1.235.000** |
| **Sem preço de venda** | — | **21 de 21** 🔴 |
| Sem potência | — | 15 de 21 |
| **`veic_config`** | 0 | **0** 🔴 |
| Vistorias | 0 | **3** ✅ |
| Respostas de vistoria | 0 | **87** ✅ |
| Eventos de veículo | — | 51 ✅ |
| Custos · Fotos · Propostas | 0 | **0** 🔴 |

> **O ciclo está completo e quase ninguém passou por ele.** A vistoria começou a andar — 3 veículos, 87 respostas. **O resto continua vazio.**

## 2.3 🔴 A trava central — `veic_config` vazia

**Quatro percentuais não configurados travam a vertical inteira:**

```
impostos sobre a venda ...... ___%
comissão de venda ........... ___%
provisão de garantia ........ ___%
margem alvo ................. ___%  (default 20 na tabela)
```

**Sem eles:**
- ❌ o preço sugerido não calcula → **21 veículos sem preço**
- ❌ a margem não sai
- ❌ o simulador reverso não funciona
- ❌ **o chamado #50 do Fábio** *("valores não batem")* — era isto
- ❌ **o #46** *("valor mínimo e máximo pelo proprietário")* depende disto

⚠️ **É decisão do CEO/Alliance (RD-25), não da engenharia.** É a menor ação com o maior efeito na vertical.

---

# PARTE III — AS ONDAS

## ✅ ENTREGUES — 14 PRs, 8 ondas *(validadas no banco, não por relato)*

| Onda | O que ficou no ar | PRs |
|---|---|---|
| **0** | Completude fiscal na ficha e no pátio · 11 botões Gold | #1290 · #1291 |
| **1** | Composição real da venda · `fn_veic_venda_composicao` | #1285 |
| **5A** | Motor de vistoria `insp_*` — 6 tabelas, 8 RPCs, 7 regiões, **80 itens** | #1286 |
| **5B** | Tela mobile da vistoria · fotos · cobertura honesta | #1287 |
| **6A** | Precificação · simulador reverso · `fn_veic_config_salvar` | #1288 · #1289 |
| **9** | Preparação reusando `erp_os` · custo volta ao chassi | #1292 · #1293 |
| **10** | CRM estendendo `erp_crm_oportunidade` · "O que comprar" | #1294 |
| **7** | Painel do dono · **COAF com vigência e fracionamento** | #1297 |

## 🔴 TRAVADAS — nenhuma por engenharia

| Onda | Espera | Em quem |
|---|---|---|
| **2 · Fiscal** | questionário do contador | **CEO** — há carro entregue sem nota desde 04/09 |
| **3 e 4 · Carrego** | plano de contas da Alliance na GE — **zero contas** | **CEO / Jordana** |
| **6B · FIPE** | contratar ou não | **CEO** |
| **8 · Garantia** | depende da Onda 4 | — |
| 11 · 12 · 13 | contratos · consignação · anúncios | ordem do CEO |

## 🔴 A NF-e com `veicProd` — o bloqueio duro

A NF-e de veículo exige **chassi, cor, potência, cilindradas, combustível, ano de fabricação e modelo, restrição**. Sem isso **a loja não fatura.**

> **O teste `TESTE_focus_veicprod_homologacao` existe desde 27/08 e NUNCA RODOU.**
>
> A emissão de NF-e 55 funciona — 13 notas da KGF via Focus, com resposta do Fisco. **Mas nenhuma tem veículo** — são de óleo. **O `veicProd` segue sem prova.**
>
> ⚠️ **Se o Focus ignorar o grupo em silêncio, a nota autoriza errada.** Só o XML prova (RD-38). **E a Alliance tem 21 carros no pátio.**

---

# PARTE IV — OS CHAMADOS DO FÁBIO

**10 abertos, 9 sem confirmação.** Ele é o único operador da Alliance e o usuário que mais reporta.

| # | O que é | Estado |
|---|---|---|
| #50 | **"Valores não batem"** | ✅ concluído — causa: `veic_config` vazia |
| #46 | Preço mín/máx pelo proprietário | depende dos 4 percentuais |
| #49 | Campo detalhes / potência não grava | **reincidência** — 15 de 21 sem potência |
| #48 | Não baixa foto | **reincidência** |
| #31 | Itens da vistoria | 7 dos 9 já existiam · lataria acrescentada |
| #34 | Consignados | a opção existe · **falta saber se precisa de tratamento financeiro próprio** |
| #33 | Vistoria | — |
| #26 | Mudança | — |
| #22 | Erro | — |
| #21 | Foto não salva | **o mais antigo** |

⚠️ **Três chamados sobre foto e um sobre campo que não grava.** É o padrão que apareceu em toda parte hoje: **a tela confirma, o banco não recebe.**

---

# PARTE V — RISCOS E CONFORMIDADE

**COAF** 🔴 revenda de veículos é setor **obrigado** a comunicar operação em espécie acima do limite. **É risco legal do cliente, não recurso do produto.**
⚠️ **Limite cadastrado hoje: 0. Nenhuma operação monitorada.**

**`veicProd`** ⚠️ se o emissor ignorar em silêncio, a nota autoriza errada. **Só o XML prova.**

**Reforma Tributária** ⚠️ 2026 é ano-teste; bens usados de não-contribuinte têm tratamento próprio no IBS/CBS. **Alíquota nunca fixa em código.**

**Base do PIS/COFINS** ⚠️ errar para mais é pagar imposto indevido; para menos é autuação.
🔴 **O questionário do contador cobre o regime vigente (Lei 9.716/98 · Convênio ICMS 15/81) e falta a seção da Reforma antes de enviar.**

**Dado do cliente** ⚠️ foto de veículo tem placa e chassi. **Bucket privado.**

---

# PARTE VI — A FRONTEIRA COM A GESTÃO EMPRESARIAL

🔒 **Financeiro é monopólio da GE.** A revenda **dispara evento**, não constrói tela de contas.

Contas a pagar e receber, boleto, conciliação e resultado do mês **já existem e operam**. A vertical **usa, não recria**.

---

# PARTE VII — DECISÕES ABERTAS

| # | Decisão | Com quem |
|---|---|---|
| **D1** 🔴 | **Os 4 percentuais da `veic_config`** — destravam 21 veículos | **CEO / Alliance** |
| **D2** 🔴 | **Rodar o teste do `veicProd`** — único bloqueio da nota | **CEO / Code Web** |
| **D3** | Acrescentar a seção da **Reforma** ao questionário antes de enviar | CEO |
| **D4** | A Alliance opera **consignação**? Precisa de tratamento financeiro próprio? | **Fábio — #34** |
| **D5** | Vende novo, usado ou os dois? | Alliance |
| **D6** | Trabalha com financiamento — precisa de repasse de banco? | Alliance |
| **D7** | **Contratar FIPE?** | CEO |
| **D8** | Preço do plano `v15_revenda` está em branco | CEO |
| **D9** | Faixas do semáforo — 30/60 dias serve? | Alliance |
| **D10** | **Validar e marcar as 4 telas** (#85) | **Fábio** |

---

# PARTE VIII — GENERICIDADE, A RÉGUA

🔒 **Esta vertical não é da Alliance.** Ela é validador empírico.

**Nenhum objeto do banco pode ter nome de fornecedor ou de cliente.** Categoria de custo, faixa de semáforo, margem alvo e parametrização fiscal são **cadastro por empresa**.

> **Se um dia só funcionar para a Alliance, é bug de produto.**

---

*Documento mestre vivo · 16/09/2026. Consolida o MASTER V5 e os cinco documentos auxiliares da vertical. Benchmark: Autoconf (51 telas auditadas, loja Autocar/SMO). Estado real: auditoria do banco de produção 16/09/2026.*
$docmd$, 1, true, ARRAY['PS_Revenda_DOCUMENTO_VIVO.md']::text[],
       'Consolidação inicial no banco (RD-41).', 'rascunho'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_documento_vertical WHERE vertical='revenda_veiculos' AND vigente);
