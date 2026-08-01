# Padrão único de "erro de salvamento" — RASCUNHO (RD-26)

> **Status: rascunho, NÃO ligado a nenhuma tela.** Base pro Eng Chefe escrever o
> SPEC do piloto (Nova Despesa / Nova Receita) em cima de código real, não no vácuo.
> Nada aqui é importado por telas existentes — zero risco de regressão.

Origem: demanda da Jordana — hoje cada tela reage de um jeito (ou não avisa)
quando o salvamento é negado. Auditoria (RD-26) confirmou: **não existe** toast
nem field-error compartilhado; há `setErro` espalhado em ~137 telas, 18 telas com
`alert()` cru, e só ~16 leem o contrato `{sucesso, erro}` das RPCs. Tokens de cor:
`src/lib/psgc-tokens.ts` (fonte única).

## As 3 peças

| Arquivo | Papel |
|---|---|
| `contratoSalvar.ts` | Tipos + dicionário código→mensagem da casa + cores (100% de psgc-tokens). |
| `FeedbackSalvar.tsx` | Mensagem em **local fixo idêntico** em toda tela (erro persistente / sucesso). |
| `Campo.tsx` | Label + asterisco + mensagem "Faltou preencher X" com destaque vermelho. |
| `useSalvar.ts` | Hook que faz o cast do contrato, mapeia erro→mensagem+campo, monta CRIOU/ALTEROU/EXCLUIU. |

## Contrato de erro (o coração)

Toda RPC de salvamento devolve:

```jsonc
{ "sucesso": false, "erro": "parcela_incompleta", "campo": "valor", "orientacao": "opcional: texto pronto" }
```

- `erro` — **código curto** da regra (nunca texto técnico). Cadastrado em `MENSAGEM_ERRO`.
- `campo` — nome do input a **destacar em vermelho** (habilita o `erroCampo` do hook).
- `orientacao` — quando presente, é o texto exibido (tem prioridade sobre o dicionário).
- Sucesso: `{ "sucesso": true, ... }`. Falta de plano: `{ "sem_plano": true }` (já usado na base).

O `mensagemDeResultado()` garante a **linguagem da casa** e **nunca vaza `error.message`**
do Postgres/PostgREST pro usuário.

## Fluxo previsto no piloto

```tsx
const { salvar, salvando, feedback, erroCampo } = useSalvar()

async function onSalvar() {
  // 1) validação no cliente ANTES da RPC → "Faltou preencher X"
  if (!valor) { setErroCampoLocal('valor'); return }

  // 2) RPC via hook (faz cast + mapeia + monta CRIOU/ALTEROU/EXCLUIU)
  const r = await salvar(
    () => supabase.rpc('fn_pagar_criar_com_parcelas_v2', { ...params }),
    { acao: 'criar', label: `${parcelas} parcelas · ${brl(total)}` },
  )
  if (r.sucesso) router.push('/dashboard/financeiro/pagar')
}

// no JSX — SEMPRE no mesmo ponto (acima dos botões):
<FeedbackSalvar estado={feedback} />

// no input do campo com erro:
<Campo label="Quanto vou pagar?" obrigatorio erro={erroCampo === 'valor' ? 'Faltou preencher o valor.' : null}>
  <input style={{ ...inputBase, ...estiloBordaInput(erroCampo === 'valor' ? 'x' : null) }} ... />
</Campo>
```

## Decisões em aberto pro SPEC (Eng Chefe)

1. **Vermelho de erro estende a "lei" dos tokens.** O comentário em `psgc-tokens.ts`
   diz "Verde/Amarelo/Vermelho exclusivos para semáforo de performance". Aqui o
   vermelho passa a valer também pra **validação** (pedido explícito da Jordana).
   Reusei o variant `critical` (mesmo `alta`/`vermelhoSoft` já usado em `critico`),
   então não inventa cor — mas **precisa ser abençoado** no SPEC.
2. **Sucesso = Espresso (não verde)**, justamente pra não quebrar a lei acima. Se o
   SPEC preferir verde de sucesso, é trocar 2 tokens em `CORES_FEEDBACK`.
3. **Toast vs banner fixo.** `FeedbackSalvar` é banner fixo (a dor da Jordana é
   "local fixo"). O toast efêmero CRIOU/ALTEROU que várias telas já têm pode
   coexistir (o hook devolve o texto pronto) ou ser aposentado — decisão do SPEC.
4. **Borda do input.** Deixei desacoplado: `estiloBordaInput()` é spread no `<input>`
   (o `Campo` não estiliza o filho). Se o SPEC quiser que o `Campo` injete a borda
   automaticamente, dá pra clonar o child — mas aí exige contrato de props no input.
5. **Rollout.** Piloto 1:1 em Nova Despesa/Nova Receita (já têm bloco de erro +
   `Campo()` inline + toast). Depois as ~100 telas, priorizando as 18 do `alert()`.
