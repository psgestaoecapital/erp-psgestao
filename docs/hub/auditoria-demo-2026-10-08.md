# Hub de Projetos — auditoria para demonstração (Tryo / FC) · 08/10/2026

Code: gilberto-chamados · fonte: `erp_documento_vertical` vertical=hub V18.

Objetivo (msg eng_chefe 08/10 12:00): dizer, por tela, **o que já dá para mostrar
hoje** na demonstração à Tryo e à FC, e corrigir os bloqueios.

## Método (RD-38 — provado no dado, prova leve)

- Extraí todas as dependências de dado das 16 telas `/dashboard/projetos/*`
  (chamadas `.rpc(...)` e `.from(...)`) e conferi uma a uma no banco de produção
  com `statement_timeout` curto, sem varrer tabela grande.
- Confirmei a empresa de demonstração do Hub via `fn_demo_da_area('hub')`.

## Achado principal (muda o diagnóstico de 01/10)

1. **Os _bindings_ de dado das telas estão íntegros.** As 11 funções
   (`fn_obras_kpis`, `fn_mao_obra_listar`, `fn_simular_montagem`, `fn_projetos_*`…)
   e as 9 views/tabelas (`v_projetos_resumo_empresa`, `v_projetos_servicos_catalogo`,
   `v_projetos_insumos_ui`, `projetos_servicos`, `m16_insumos`, `erp_orcamentos`…)
   **existem e resolvem**. O painel hoje lê colunas reais de
   `v_projetos_resumo_empresa` + `fn_obras_kpis` — **não há mais os "6 campos
   inexistentes" do levantamento de 01/10**, e nenhuma das telas referencia símbolo
   ausente no banco.
2. **O bloqueio da demonstração é DADO, não tela.** A empresa de demonstração do Hub
   (`fn_demo_da_area('hub')` → `b0700000-0000-4000-a000-000000000006`) está
   **vazia**: 0 obras, 0 orçamentos, 0 serviços, 0 insumos, 0 oportunidades, 0 mão de
   obra. Por isso painel zera, catálogo vazio e obras 0/N — exatamente o que o
   auditor (run 476) fotografou.
3. **A correção já está em andamento** na PR **#2260** (rascunho) — "DEMO própria do
   Hub com dado realista". É o que destrava a demonstração; não dupliquei.

## O que dá para mostrar hoje, por tela

Enquanto a #2260 não entra, toda tela que depende de dado da empresa aparece
**vazia** (com empty state). Veredito assumindo a demo **seeded** (#2260 mergeada):

| Tela | Depende de dado seeded? | Veredito |
|---|---|---|
| `page.tsx` (painel) | sim (KPIs obras + orçamentos + financeiro) | funciona após #2260 |
| `obras` | sim (`fn_obras_kpis`/listagem) | funciona após #2260 |
| `oportunidades` | sim (`erp_crm_oportunidade`) | funciona após #2260 |
| `propostas` | redireciona p/ `/dashboard/orcamentos` (RD-52) | ressalva: sai do Hub (HB2 do produto trata) |
| `catalogo` | sim (`v_projetos_servicos_catalogo`) | funciona após #2260 |
| `insumos` | sim (`v_projetos_insumos_ui`/`m16_insumos`) | funciona após #2260 |
| `mao-obra` | sim (`fn_mao_obra_listar`) | funciona após #2260 |
| `simulador` | parcial (roda com serviço do catálogo) | funciona após #2260 |
| `configuracoes` (BDI) | sim (`v_projetos_resumo_empresa`/preset BDI) | funciona após #2260 |
| `desempenho` | sim (`fn_produtividade_por_linha_obter`) | funciona após #2260 |
| `engenharia` / `takeoff` | HB2 (produto) | não mostrar nesta rodada (produto) |
| `acompanhamento` | sim | funciona com ressalva (vazio até seed) |
| `clientes` | sim | funciona após #2260 |
| `visitas` | sim | funciona após #2260 |
| `instalar-app` | não (PWA) | funciona hoje |

## Correções fora da HB2 do produto (lista do eng_chefe, run 476)

Estas são do Code de chamados (não da HB2): obras "—" sem CTA, oportunidade ganha
que não abre obra, painel sem dado, admin/acessos mostrando UUID, menu cortando
"Mão de obra", abas × menu lateral divergentes. **Todas dependem primeiro da demo
seeded (#2260)** para serem reproduzidas e fotografadas de novo pelo auditor — sem
dado, o auditor não distingue "tela quebrada" de "empresa vazia". Sequência:
seed (#2260) → re-rodar `fn_auditor_matriz_disparar('hub', …, 'pós-demo')` → corrigir
os defeitos que sobrarem em PRs pequenas.

> Takeoff/Engenharia/Simulador de engenharia/Insumos da GE/Propostas que saem do
> Hub ficam com o gilberto-produto (HB2).
