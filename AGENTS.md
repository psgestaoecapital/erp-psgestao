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
