<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:protocolo-sessao -->
# Protocolo de sessão OBRIGATÓRIO (Claude) — o CEO exige, não é opcional

Este bloco é carregado em TODA sessão. Ele existe porque o handoff e as regras vivem
no banco, e sessões anteriores esqueciam de lê-los/gravá-los. Não repita esse erro.

## No INÍCIO de toda sessão, ANTES de qualquer ação
Rode no banco (Supabase MCP `execute_sql`, project `horsymhsinqcimflrtjo`):

```sql
SELECT fn_briefing_sessao();
```

E leia, no JSON retornado:
- `checklist_obrigatoria_claude` — as **regras inegociáveis** (RDs, Estrela Polar, Saneamento V1, Contrato V1);
- `rd38_doutrina_verdade_absoluta` — **auditar e provar no dado, nunca supor** (RD-38);
- `ultimo_handoff` — o que a sessão anterior fez e o que ficou pendente;
- `alertas_pendentes_para_ceo` — decisões que dependem do CEO.

## No FIM de toda sessão (e ao concluir cada bloco relevante)
Grave o handoff — é a memória entre sessões. Se não gravar, a próxima Claude recomeça no escuro:

```sql
SELECT fn_registrar_handoff(
  p_ultima_acao        := '...o que foi feito...',
  p_proxima_acao       := '...o que a próxima Claude precisa fazer / o que aguarda decisão do CEO...',
  p_ultimo_pr          := '#NNNN',
  p_alertas_criticos   := ARRAY['...']::text[],
  p_links_importantes  := jsonb_build_object('pr_NNNN','...'),
  p_estado_emocional_ceo := '...leitura honesta do momento do CEO...',
  p_rd35_violacoes     := NULL::text[]
);
```

Tabela: `public.erp_handoff_sessao`. Writer: `public.fn_registrar_handoff(...)`.
<!-- END:protocolo-sessao -->

<!-- BEGIN:disciplina-migrations -->
# Disciplina de migrations — NÃO quebre o `deploy-migrations` (o CEO exige)

O pipeline `.github/workflows/deploy-migrations.yml` roda `supabase db push --include-all`
em todo push na `main`. Ele é o que faz a migration chegar à produção. Se ele fica
vermelho, **todo merge daqui pra frente vira dívida invisível** — o schema do PR não
entra em produção e só se descobre por auditoria manual, um caso de cada vez.

## A regra (RD-52 — o ledger não pode mentir nem divergir)

**NUNCA aplique via MCP `apply_migration` uma migration que tem arquivo no repo.**
O `apply_migration` carimba `supabase_migrations.schema_migrations` com uma versão de
**horário de aplicação** (ex.: `20260901105139`), que **não bate** com o nome do arquivo
(`20260901120000_...sql`). Aí o `db push` vê "Remote migration versions not found in local
migrations directory" e **aborta** — o pipeline fica vermelho. Foi exatamente isso que o
quebrou em 31/08–01/09/2026 (10 órfãos de SIC-F1/DEMO-F1/NF-e/estoque).

## Como aplicar migration, então

1. **Padrão (preferido):** escreva o arquivo em `supabase/migrations/`, abra PR, **mergeie**.
   O `deploy-migrations` aplica sozinho no push da `main`. Não toque no banco antes do merge.
2. **Se precisar aplicar à mão** (hotfix urgente antes do merge): rode o corpo via
   `execute_sql` e **registre a EXATA versão-de-arquivo** no ledger
   (`INSERT INTO supabase_migrations.schema_migrations(version,name,statements)` com o
   timestamp do NOME DO ARQUIVO). **Nunca** deixe o carimbo de horário do `apply_migration`.
3. **Nada é marcado como aplicado sem ter rodado de verdade.** Um ledger que mente sobre o
   que foi aplicado é pior que um desalinhado.

## Se o pipeline já estiver vermelho (reconciliação dos órfãos)

Confira antes e depois (o que o `db push` compara), tocando **só** os órfãos recentes —
nunca as ~800 linhas históricas:
- **órfão com conteúdo já no banco** e cuja versão-de-arquivo NÃO está no ledger →
  `UPDATE ... SET version=<versão-do-arquivo> WHERE version=<carimbo-órfão>` (renomeia, preserva o que rodou);
- **órfão que é duplicata pura** (versão-de-arquivo já registrada) → `DELETE` só do órfão;
- **verifique no dado que o conteúdo existe** (RD-38) antes de marcar qualquer coisa como aplicada.

O `deploy-migrations` está vermelho? É trabalho AGORA — ele sustenta o processo inteiro.
<!-- END:disciplina-migrations -->
