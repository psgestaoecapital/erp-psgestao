# Fase 1 — levantamento das verticais mortas commerce + services (12/10, gilberto-desenv)
Só leitura. Nada aplicado. `DIVIDA_TECNICA_verticais_mortas.md` e `SPEC_limpeza_verticais_mortas.md` NÃO existem no repo (main 3cf1bab).

## Baseline (módulos ATIVOS em module_catalog, antes)
commerce 9 ativos / 8 inativos (17) · services 10 ativos (10) · gestao_empresarial 72 ativos. Total a migrar: 27 (19 ativos).
`plan_modules`: 161 linhas apontam módulos commerce, 44 apontam services. `system_screens.area='commerce'`: 5 telas (GE: 71).
`user_scope.dominios` com commerce/services: 0. `module_subgrupos` do grupo commerce: 1 (`revenda_veiculos`); services: nenhum.

## Módulos — grupo/subgrupo/rota/ativo → destino em GE
| id | grupo/subgrupo | rota | ativo | destino GE | colisão |
|---|---|---|---|---|---|
| commerce_fichas_tecnicas | commerce/cadastros | /dashboard/commerce/fichas | sim | cadastros | COLISÃO (GE.cadastros 16 ativos) |
| commerce_margem_negativa | commerce/compras | /dashboard/compras/margem-negativa | sim | compras (não existe em GE) | subgrupo novo ou fundir em estoque/analises |
| commerce_compras | commerce/compras | /dashboard/commerce/compras | sim | compras | idem |
| commerce_reforma_tributaria | commerce/compras | /dashboard/commerce/reforma | NÃO | notas_fiscais | duplica reforma_tributaria_2026 |
| reforma_tributaria_2026 | commerce/compras | /dashboard/commerce/reforma | sim | notas_fiscais | COLISÃO (mesma rota do item acima) |
| commerce_livro_entradas | commerce/compras | /dashboard/commerce/livro-entradas | sim | notas_fiscais | COLISÃO (7 ativos) |
| commerce_precificacao | commerce/compras | /dashboard/compras/precificacao | sim | compras / estoque | decidir |
| commerce_custo_config | commerce/compras | /dashboard/compras/custo-config | sim | compras / estoque | decidir |
| commerce_mutirao | commerce/compras | /dashboard/compras/mutirao | sim | compras | decidir |
| commerce_estoque_movimento | commerce/estoque | /dashboard/commerce/estoque | sim | estoque | COLISÃO (GE.estoque 3 ativos) |
| commerce_nfe / nfce / nfse / mdfe / cte / sped / inventario | commerce/null | /dashboard/commerce/* | NÃO (7) | notas_fiscais / estoque | só marcar legacy; sem subgrupo hoje |
| services_contratos_recorrentes | services/contratos_vendas | /dashboard/contratos | sim | contratos_vendas | COLISÃO (GE: 2 ativos) |
| services_onboarding_ia, services_portal_cliente, services_pesquisa_nps, services_cancelamento_workflow, services_atendimento_chat | services/crm_atendimento | /dashboard/services/{onboarding,portal,nps,cancelamento,chat} | sim (5) | crm_atendimento | GE não tem o subgrupo → criar |
| services_dashboard_saas, services_mensalidade_gestao, services_cobranca_recorrente, services_nfse | services/financeiro_recorrente | /dashboard/services/{dashboard-saas,mensalidades,cobranca-recorrente,nfse} | sim (4) | financeiro_recorrente ou financeiro | GE não tem o subgrupo → criar ou fundir em financeiro (19 ativos) |

Observações: vários módulos já têm `surface_in_groups` com `gestao_empresarial` (aparecem lá hoje por esse campo) — a migração é principalmente mudar o dono (`grupo`) e `legacy`. As rotas de `commerce_*` sob `/dashboard/compras/*` já são de GE na prática. `reforma_tributaria_2026` e `commerce_reforma_tributaria` têm a MESMA rota.

## Fontes que referenciam commerce/services
- `module_catalog.grupo` (CHECK `module_catalog_grupo_check` lista 24 valores, inclui commerce e services — manter até o fim; não remover valor).
- `module_subgrupos` (grupo commerce/revenda_veiculos), `rbac_subgrupo_catalogo.grupo`.
- `plan_modules` (205 linhas via module_id), `system_screens.area` (5 em commerce), `system_screens_taxonomia.area`, `area_menu_config`, `rbac_papel.area`, `feature_catalog.area`, `demo_por_area.area`, `agency_servico.area`.
- `module_catalog.surface_in_groups` / `vertical_specific` (arrays com 'commerce'/'services').
- `fn_modulos_sidebar_por_area` (corpo não conferido nesta fase; só `fn_investigacao_previa` e `fn_briefing_sessao` citam os literais no corpo).
- Não verificado ainda: `screen_route_features` (liga por screen_id, sem module_id), `src/` (grep por filtro de grupo), `user_scope.dominios` (0 linhas).

## Colisões a decidir (Eng. Chefe/CEO — como fundir sem vazar RBAC)
1. cadastros (fichas_tecnicas), estoque (estoque_movimento), notas_fiscais (livro_entradas, reforma), contratos_vendas (contratos_recorrentes): subgrupo já existe em GE com RBAC próprio → módulo herdaria o papel do subgrupo.
2. compras, crm_atendimento, financeiro_recorrente: NÃO existem em GE → criar subgrupo (e linhas de rbac_subgrupo_catalogo) ou fundir.
3. Reforma tributária duplicada (mesma rota, 2 ids).
Prova da Fase 2: `fn_acesso_efetivo` antes/depois para KGF e PS (services primeiro).
