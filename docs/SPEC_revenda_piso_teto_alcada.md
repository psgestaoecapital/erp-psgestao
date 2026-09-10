# SPEC · Revenda de veículo — piso/teto de preço definidos pelo dono + 1ª alçada

> **Origem:** chamado #46 (Fábio). Marcado como bug, mas é **regra nova**. Conecta com o
> "motor de alçada" que ainda **não existe** no sistema.
> **Status:** SPEC para decisão do CEO. **NÃO construir antes de decidir** o modo de
> enforcement (§4).

---

## 1. O problema (o que o Fábio pediu)

O dono quer **definir um piso e um teto de preço** para a venda de um veículo, e que o
sistema **respeite** esse limite quando o vendedor registra a venda. Hoje isso não existe:
qualquer valor de venda é aceito sem confronto com um limite comercial do dono.

## 2. O que JÁ existe (RD-38 — provado no schema)

- `veic_veiculo.preco_venda` — preço de venda definido na precificação.
- `veic_veiculo.preco_minimo` — **piso TÉCNICO** (break-even): custo total + encargos.
  É calculado (`fn_veic_precificacao_obter/_salvar`), **não** é um piso comercial do dono.
- `veic_veiculo.margem_alvo_pct`, `veic_config.{impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct}`.
- `veic_venda.valor_venda` + `veic_venda.desconto_embutido_troca` — o preço efetivo da venda.
- RPCs: `fn_veic_venda_registrar` (grava a venda), `_entregar`, `_cancelar`, `_composicao`.
- O simulador (`fn_veic_precificacao_simular`) **já** devolve `abaixo_do_piso` e
  `prejuizo_no_piso` contra o piso técnico — mas ninguém **impede** nada com isso.

**Conclusão:** falta (a) um piso/teto **COMERCIAL** definido pelo dono, distinto do piso
técnico; (b) um ponto de **enforcement** na hora de registrar a venda; (c) a **alçada** —
quem pode furar o limite e como.

## 3. Modelo proposto (aditivo, sem recriar)

### 3.1 Onde guardar o piso/teto do dono
Recomendação: **por veículo**, com _fallback_ opcional por config da empresa.

```
ALTER TABLE veic_veiculo
  ADD COLUMN piso_venda_dono  numeric,   -- NULL = não definido (não zero)
  ADD COLUMN teto_venda_dono  numeric,   -- NULL = não definido
  ADD COLUMN limite_definido_por uuid,
  ADD COLUMN limite_definido_em  timestamptz;
```

- **NULL = não configurado** → nenhum limite comercial é aplicado àquele veículo (segue
  como hoje). Regra-mãe: **aperta só onde foi configurado.**
- O piso do dono é **independente** do piso técnico. A tela mostra os dois; se o dono
  colocar piso abaixo do técnico, avisa ("seu piso dá prejuízo com o custo de hoje").
- `desconto_embutido_troca` conta: o preço confrontado é **`valor_venda` líquido**
  (a decidir se o teto/piso incide sobre `valor_venda` ou sobre `valor_venda − desconto`;
  proposta: sobre `valor_venda`, que é o preço de tabela da venda).

### 3.2 Enforcement no `fn_veic_venda_registrar`
No registro (e em edição de valor), o servidor recalcula e confronta `valor_venda` com
`[piso_venda_dono, teto_venda_dono]`. O que acontece quando fura → **decisão do §4**.
O servidor é a autoridade (o front não mente o número), no mesmo padrão de
`fn_veic_precificacao_salvar`.

### 3.3 A 1ª alçada (o motor que não existe)
Este é o **primeiro caso concreto de alçada** do sistema. Proposta de mínimo viável, sem
generalizar cedo demais:

- **Quem furа o limite:** só o **dono** (papel_gestao=`CLIENT_OWNER`) ou **admin PS**
  (`is_admin`) — o mesmo par que já usamos no bypass da OS (#1364), mantendo consistência.
- **Trilha:** toda venda fora do limite grava **quem autorizou, quando e o motivo**
  (nunca apagável — RD-30/RD-55), em `veic_venda` (colunas novas
  `fora_limite boolean, limite_justificativa text, limite_aprovado_por uuid`) ou numa
  `veic_venda_excecao` dedicada.
- **Não** criar um "motor de alçada" genérico agora. Registrar este caso de forma que
  um motor futuro possa herdar (limite + quem aprova + trilha).

## 4. DECISÃO DO CEO — modo de enforcement

Qual comportamento quando `valor_venda` fura o piso (ou o teto)?

| Opção | Comportamento | Prós | Contras |
|---|---|---|---|
| **A · Trava dura** | Bloqueia o registro. Ninguém vende fora do limite; nem o vendedor, nem o dono, sem antes mudar o limite. | Máxima proteção. Impossível "vazar". | Rígido: o dono precisa reeditar o limite pra fechar um negócio legítimo fora dele. Atrito no balcão. |
| **B · Aviso** | Deixa registrar, mas marca a venda como "fora do limite" e alerta. | Sem atrito. Transparência total no relatório. | Não impede prejuízo; confia na disciplina de quem registra. |
| **C · Aprovação do dono** *(recomendada)* | Vendedor não fecha fora do limite; a venda fica **pendente de aprovação**; só o **dono/admin** libera, com justificativa registrada. | Protege **e** permite exceção legítima com trilha. É a semente correta da alçada. | Mais peça de UI (fila de aprovação) e um estado a mais na venda. |

**Recomendação: C.** É o que o Fábio descreve na prática ("definido pelo dono") e é a
fundação natural do motor de alçada — limite + exceção aprovada + trilha. A. e B. são
degraus de C (A = aprovação nunca liberável sem reeditar; B = aprovação automática).

### Sub-decisões (dependem do §4)
1. Piso/teto **por veículo** (recomendado) ou também **por modelo/categoria** como default?
2. O teto é confronto **duro** (raro furar teto) ou só o **piso** tem alçada? (Fábio citou os dois.)
3. Enforcement incide sobre `valor_venda` ou `valor_venda − desconto_embutido_troca`?

## 5. Fora de escopo (agora)
- Motor de alçada genérico multi-domínio (só o caso da venda de veículo aqui).
- Alçada por faixa de valor / por vendedor (só dono/admin fura, no V1).

## 6. Plano de prova (quando construir)
- ROLLBACK, dado real: venda no limite → passa; abaixo do piso por vendedor → conforme §4;
  dono/admin libera com justificativa → grava trilha; teto idem.
- Sem regressão: veículo sem piso/teto configurado → registro segue idêntico ao de hoje.
