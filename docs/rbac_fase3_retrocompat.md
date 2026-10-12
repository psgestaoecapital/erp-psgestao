# RBAC Industrial · Correção da Fase 3 — retrocompatibilidade obrigatória

**Autor:** Claude (sessão) · **Data:** 2026-09-09
**Origem:** revisão do CEO sobre o SPEC "RBAC Industrial — completo, as 5 fases" (09/09).
**Status:** correção aprovada pelo CEO. Substitui o §14 do SPEC como escrito.

> **Decisão do CEO (09/09):** *"Sobre a Fase 3: você está certo e o erro é meu. Corrija o SPEC —
> retrocompatibilidade, preservar os campos que os 10 RPCs leem, migrar os consumidores junto, e
> só depois limpar. Deixe escrito no documento por quê."*

---

## 0 · Por que a Fase 3 existe — o caso de negócio (reposicionamento aprovado pelo CEO, 09/09)

> **A Fase 3 deixa de ser "a tela para de decidir" e passa a ser "o banco começa a decidir".**
> É a fase que justifica o RBAC inteiro.

**O achado que reposiciona a fase (varredura 09/09, origem chamado O4 do KGF):** o enforcement de
papel **no write path praticamente não existe hoje**. Das **580 RPCs de escrita `SECURITY DEFINER`**
(que ignoram a RLS — o guard interno é a única defesa):

| Checagem | Qtd | % |
|---|---:|---:|
| Checam `tenant_user_roles.role` | **14** | 2,4% |
| Só pertencimento à empresa (`get_user_company_ids`/`user_company_ids`) | **253** | 44% |
| Só `is_admin` | 26 | 4,5% |
| Sem guard reconhecível (teto por heurística) | 287 | 49% |

**Consequência:** `fn_os_criar` e `fn_oficina_recepcao_criar` não checarem papel **não é bug de
oficina** — é a regra. Qualquer `CLIENT_VIEWER` de qualquer empresa (revenda, hub, industrial,
financeiro) provavelmente **escreve onde o papel dele diria "só leitura"**. As 253 que checam
explicitamente **só pertencimento** já provam sozinhas que é sistêmico (a amostra dos 287 muda o
número, não a decisão — fica para dimensionar a migração quando a Fase 3 estiver desenhada).

**Por que a correção mora na Fase 3, não em 580 patches:** corrigir função a função é
inmanutenível e diverge com o tempo. A decisão de acesso tem que **morar num lugar só** —
`fn_acesso_efetivo` (que a Fase 3 transforma em decisor, §1–§4 abaixo) — e os write paths
**consultarem essa decisão** (diretamente, ou via RLS keyed nela). O `acessos` (subgrupo × nível,
com `nivel` como teto) é exatamente o contrato que um write path precisa para perguntar
"este usuário pode `editar`/`aprovar` neste subgrupo?" antes de gravar.

> **Ordem, então:** primeiro `fn_acesso_efetivo` vira decisor **de forma aditiva** (§1–§4), e
> **só depois** os write paths passam a consultá-lo — o mesmo princípio de "migrar antes de
> remover" que rege toda esta fase. A migração dos ~580 write paths para consultar a decisão é
> trabalho da Fase 3 (ou de uma sub-onda dela), dimensionado com a amostra guardada.

### 0.1 · Menu escondido não é acesso negado — a mesma família do write path

O gating de telas da Oficina (esconder Aprovação/Comissão/WhatsApp do `OFICINA_MECANICO` no
`fn_modulos_sidebar_por_area`) tira as telas do **menu**, mas **não bloqueia a navegação direta
pela URL**: quem sabe a rota ainda abre a tela, e a RPC que a alimenta ainda responde.

**Isto é o mesmo problema do write path, do lado da leitura.** Bloqueio de **rota** e bloqueio de
**RPC** por papel são a mesma família: hoje dependem da tela decidir, e a tela pode ser contornada.
A cura é a mesma — a decisão mora em `fn_acesso_efetivo` (§1–§4), e **tanto os writes quanto as
rotas/telas consultam essa decisão** em vez de decidir por conta própria.

> 🔑 **Regra a gravar:** *menu escondido ≠ acesso negado.* Gating de menu é conveniência de UX;
> a negação de verdade (rota + RPC) é enforcement, e enforcement é Fase 3. Enquanto ela não existe,
> todo gating de tela carrega o resíduo declarado de que a rota direta ainda alcança.

---

## 1 · O erro do §14 como estava escrito

O §14 reescreve `fn_acesso_efetivo(user, company)` para **DECIDIR** (retornar `acessos` + `decidido`)
e, ao fazê-lo, **remove do retorno** os campos que a versão atual expõe:

```
role · papel_gestao · nivel · papel_rotulo · dominios · areas · org_unidade_id
```

**Esses campos são lidos AGORA por código vivo.** Trocar a forma do retorno num único passo
**quebra todo leitor em silêncio** — e este é o coração da camada de acesso (RLS + telas).

### Consumidores confirmados que leem os campos legados (auditar TODOS antes de mexer)

| Consumidor | Lê | Efeito se sumir |
|---|---|---|
| `fn_oficina_papel(company)` | `->> 'papel_gestao'` | trava de valor da Oficina (OFICINA_MECANICO) para de funcionar |
| `useAcesso.ts` (front) | `papel_gestao` (`isOperator`/`isGerencial`/`isViewer`) | gating de tela quebra |
| `fn_acessos_pode_gerir` | `tenant_user_roles.role` (via a mesma fonte) | quem pode gerir acesso |
| `fn_acessos_definir_papel_gestao` / `fn_acessos_convidar_pessoa` | idem | convite/atribuição de papel |
| RLS e demais RPCs (o SPEC cita ~10) | `role`/`papel_gestao`/`areas`/`dominios` | **vazamento entre empresas ou perda de acesso** |

> ⚠️ O SPEC §14 já avisa: *"user_scope alimenta fn_acesso_efetivo e dez RPCs. Ler todas com
> `pg_get_functiondef` antes de mexer."* A correção abaixo é como honrar esse aviso na prática.

---

## 2 · A correção — em três passos, nunca um

O mesmo princípio que o SPEC aplica em `dominios[]` (RD-30: não apagar, derivar) e no ledger
(RD-52): **migrar antes de remover; a remoção é sempre o último passo.**

### Fase 3a · `fn_acesso_efetivo` ADITIVO (retrocompatível)
Adiciona `acessos` (o pacote decidido, com `nivel` como teto — `LEAST_NIVEL`) e `decidido`
ao retorno, **SEM remover** nenhum campo legado. `papel_gestao`, `role`, `nivel`, `papel_rotulo`,
`dominios`, `areas`, `org_unidade_id` **continuam no JSON**.

- Consumidores antigos: intocados (leem os campos de sempre).
- Consumidores novos: passam a ler `acessos` / `decidido`.
- A lógica nova de `acesso_valido_ate` (expiração do terceiro do SST) entra aqui, também aditiva.

### Fase 3b · migrar os consumidores, um a um
Para cada um dos ~10 RPCs + `useAcesso` + RLS: trocar a leitura dos campos legados pela leitura
de `acessos`/`decidido`. **Cada migração provada em rollback** (o consumidor decide igual antes e
depois). Só passa adiante quando o consumidor migrado bate com o comportamento anterior.

### Fase 3c · só então limpar (RD-30)
Depois que **todos** os consumidores foram auditados e migrados (prova no dado de que ninguém
mais lê os campos legados), aí sim remover os campos legados do retorno de `fn_acesso_efetivo`.
Antes disso, marcá-los deprecados por comentário — nunca sumir de surpresa.

---

## 3 · Por que assim (o "por quê" que o CEO pediu escrito)

1. **Uma função de segurança que muda a forma do retorno em um passo quebra todo leitor de uma
   vez, e em silêncio.** Não há erro de compilação — o campo só vira `NULL`/ausente, e a RLS ou a
   tela decide errado. Em RBAC, "decidir errado" é vazar dado entre empresas ou dar poder indevido.
2. **É a camada da qual TUDO depende.** `fn_acesso_efetivo` alimenta RLS e telas. O raio de
   explosão de um retorno incompatível é o sistema inteiro, não uma tela.
3. **A ordem correta é a inversa da intuição:** primeiro somar o novo (aditivo), depois mover os
   leitores, e só no fim tirar o velho. Remover primeiro é otimizar a limpeza à custa da segurança.
4. **Já há dependência viva desta sessão:** a trava de valor da Oficina (`fn_oficina_papel` →
   `papel_gestao`) subiu hoje. Aplicar o §14 literal a derrubaria — prova concreta de que o
   retrocompat não é teórico.

---

## 4 · Efeito no SPEC

Substituir o §14 ("fn_acesso_efetivo v2: DECIDE, não lista") por:
- **§14a** — `fn_acesso_efetivo` aditivo (novo `acessos`/`decidido`, campos legados preservados).
- **§14b** — migração dos consumidores (lista auditada dos ~10 RPCs + `useAcesso` + RLS), um a um, cada um provado.
- **§14c** — remoção dos campos legados, só após 14b completo (RD-30).

A ordem de execução do §20 continua: Fase 3 permanece o passo de risco 🔴 e depende das Fases 1 e 2 —
mas internamente ela mesma é 3a → 3b → 3c, nunca um passo só.
