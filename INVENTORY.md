# PS Gestão ERP — Inventário do Sistema Atual

**Versão:** 1.0
**Data:** 10/05/2026
**Autor:** Claude Code (PR #92)
**Cumprimento de:** RD-26 (Auditoria antes de criar)
**Sha base:** `6eac8ab` (após revert PR #91)

---

## 0. Contexto e propósito

Em 10/05/2026 (sessão 6), o PR #90 (M.A.8.1) criou rota `/admin/planos` paralela ao `/dashboard/admin` que **já existia** no sistema. A duplicação foi detectada pelo CEO, revertida no PR #91, e a regra **RD-26** foi cristalizada:

> **Auditar antes de criar.** Não criar paralelo a existente. Antes de propor nova rota/área/feature, mapear o que existe, avaliar extensão vs paralelo e apresentar opções ao CEO.

Este documento cumpre a RD-26 mapeando exaustiva e honestamente o sistema atual antes do replanejamento de M.A.8 (UI Admin).

---

## 1. Estrutura de Rotas Next.js (App Router)

**Stack:** Next.js 16.2.2 + React 19.2.4 + TypeScript strict + Tailwind v4 (PostCSS) + Turbopack
**Path alias:** `@/*` → `./src/*`
**Total de páginas:** 122 `page.tsx`
**Total de API routes:** 119 `route.ts`
**Layouts:** 4 (`/`, `/dashboard`, `/dashboard/projetos`, `/wealth`)

### 1.1 Rotas Públicas (sem auth obrigatória)

| Rota | Arquivo | Descrição |
|---|---|---|
| `/` | `src/app/page.tsx` | Landing |
| `/cliente/[company_id]/[token]` | `src/app/cliente/...` | Acesso autenticado por token (cliente externo) |
| `/convite` | `src/app/convite/page.tsx` | Aceitar convite via email |
| `/orcamento/[hash]` | `src/app/orcamento/[hash]/page.tsx` | Orçamento público (link com hash) |
| `/privacidade` | `src/app/privacidade/page.tsx` | Política de privacidade |
| `/termos` | `src/app/termos/page.tsx` | Termos de uso |

### 1.2 Rotas Autenticadas — `/dashboard/*`

#### Área comum / Núcleo
| Rota | Arquivo | Descrição |
|---|---|---|
| `/dashboard` | `dashboard/page.tsx` | Home padrão (Visão Geral) |
| `/dashboard/home` | `dashboard/home/page.tsx` | Painel Geral |
| `/dashboard/visao-mensal` | `dashboard/visao-mensal/page.tsx` | Visão Mensal |
| `/dashboard/classico` | `dashboard/classico/page.tsx` | Painel Clássico (legado) |
| `/dashboard/dados` | `dashboard/dados/page.tsx` | Dados (cadastros gerais) |
| `/dashboard/conectores` | `dashboard/conectores/page.tsx` | Conectores (Omie/SIGA/Nibo) |
| `/dashboard/importar` | `dashboard/importar/page.tsx` | Importação simples |
| `/dashboard/importar-universal` | `dashboard/importar-universal/page.tsx` | Importer Universal CSV/Excel ✅ |
| `/dashboard/ajuda` | `dashboard/ajuda/page.tsx` | Centro de ajuda |
| `/dashboard/tutorial` | `dashboard/tutorial/page.tsx` | Tutorial |

#### Cadastros (Comércio & Serviços)
- `/dashboard/clientes`, `/dashboard/fornecedores`, `/dashboard/produtos`
- `/dashboard/contratos` ✅ (consome `v_contratos_*`)

#### Operação
- `/dashboard/orcamentos`, `/dashboard/orcamento` (singular?)
- `/dashboard/pedidos`, `/dashboard/cotacoes`, `/dashboard/compras`, `/dashboard/estoque`

#### Financeiro & Análises
- `/dashboard/analises` — Análises financeiras
- `/dashboard/dre-divisional` ✅ (consome `v_dre_divisional_completo`)
- `/dashboard/operacional` — Operacional unificado (6 tabs ✅)
- `/dashboard/contas` ✅ (RPCs `batch_baixa_titulos`, `batch_cancelar_titulos`, `batch_alterar_vencimento`)
- `/dashboard/conciliacao`, `/dashboard/conciliacao/[lote_id]`
- `/dashboard/rateio`, `/dashboard/orcamento`
- `/dashboard/viabilidade`

#### Inteligência IA
- `/dashboard/score`, `/dashboard/previsao`
- `/dashboard/consultor-ia`, `/dashboard/anti-fraude` ✅
- `/dashboard/sugestoes`

#### Projetos / Hub Construção (subdiretório com layout próprio)
- `/dashboard/projetos` (e variantes: `acompanhamento`, `catalogo`, `catalogo/[id]`, `clientes`, `configuracoes`, `engenharia`, `insumos`, `mao-obra`, `obras`, `propostas`, `visitas`)

#### Industrial
- `/dashboard/industrial`, `/dashboard/industrial/apontamento`, `/dashboard/industrial/ceo`
- `/dashboard/custo`, `/dashboard/custo-industrial`, `/dashboard/custeio`
- `/dashboard/ficha-tecnica`, `/dashboard/producao`

#### BPO Financeiro (área completa)
- `/dashboard/bpo` — Painel BPO
- `/dashboard/bpo/meu-dia`, `/dashboard/bpo/conversas`, `/dashboard/bpo/conversas/[id]`, `/dashboard/bpo/conversas/nova`
- `/dashboard/bpo/foco`, `/dashboard/bpo/foco/[company_id]`
- `/dashboard/bpo/inbox`, `/dashboard/bpo/automacao`, `/dashboard/bpo/rotinas`
- `/dashboard/bpo/supervisao`, `/dashboard/bpo/supervisor`
- `/dashboard/bpo/empresas`, `/dashboard/bpo/fechamento`, `/dashboard/bpo/fechamento/[fechamento_id]`
- `/dashboard/bpo/admin`, `/dashboard/bpo/admin/contratos`, `/dashboard/bpo/admin/empresas`, `/dashboard/bpo/admin/onboarding`, `/dashboard/bpo/admin/operadores`

#### Compliance
- `/dashboard/compliance` ✅ (matriz funcionários)
- `/dashboard/compliance/empresa`, `compliance/funcionarios`, `compliance/funcionarios/[id]`
- `compliance/prestadores`, `compliance/prestadores/[id]`, `compliance/setores`
- `compliance/matriz`, `compliance/validacao-automatica`
- **EPI** (sub-área): `compliance/epi`, `compliance/epi/alertas`, `compliance/epi/catalogo`, `compliance/epi/estoque`, `compliance/epi/ficha/[funcionario_id]`, `compliance/epi/fichas`

#### Wealth MFO
- `/dashboard/wealth` (CEO/Consultor)
- `/dashboard/wealth/clientes/[id]`
- Rotas separadas em `/wealth/*` (público?): `/wealth`, `/wealth/clientes`, `/wealth/carteira/[id]`, `/wealth/mercado`

#### Linhas de Negócio (custom)
- `/dashboard/linhas-negocio`, `/dashboard/linhas-negocio/configurar`

#### Assessor / Contador (Portais)
- `/dashboard/assessor` (e variantes: `clientes`, `dashboard-ceo`, `diagnosticos`, `onboarding`, `plano-acao`)
- `/dashboard/contador`, `/dashboard/contador/registrar`, `/dashboard/contador/empresa/[id]/reforma`

#### NOC & Misc
- `/dashboard/noc` ✅ (Auto-refresh 60s, uptime dashboard)
- `/dashboard/relatorio` — Relatório IA
- `/dashboard/dev` — Painel dev interno
- `/dashboard/contaazul-callback` — OAuth callback
- `/dashboard/admin` — **Painel Administrativo** (ver 1.3)
- `/dashboard/admin/sync`, `/dashboard/admin/sync/empresa/[id]`, `/dashboard/admin/sync/historico`, `/dashboard/admin/sync/payloads`

### 1.3 Painel Administrativo `/dashboard/admin/*` ⭐ ATENÇÃO ESPECIAL

#### `/dashboard/admin/page.tsx` — Painel principal (530 linhas)

Implementado como **single-page app com tabs internas** (state `tab`). Auth: `role IN ('adm', 'acesso_total', 'adm_investimentos')`.

| Tab | ID | Linha aprox | Estado |
|---|---|---:|---|
| **Empresas** | `empresas` | 198 | ✅ Funcional. Lista companies, cria nova, atribui plano, agrupa em groups |
| **Usuários & Níveis** | `usuarios` | 301 | ✅ Funcional. Lista users, edita role, atribui empresas |
| **Convites** | `convites` | 360 | ✅ Funcional. Cria invite com role + empresa, gera link, copia |
| **Mapa de Permissões** | `niveis` | — | ✅ Renderiza tabela ROLES × MODULES (planos.ts) |
| **Horários & Segurança** | `seguranca` | — | ⚠️ Não confirmei conteúdo no grep — necessita inspecionar |
| **Sessões & Auditoria** | `auditoria` | 502 | ✅ Lista sessões + audit log filtráveis |

**Dependências de dados:** queries diretas a `companies`, `users`, `invites`, `company_groups`, `user_companies`, `accessConfigs`, `auditLogs`, `sessions`. **Não consome views `v_admin_*` do PR #89.**

**Cores:** usa CSS variables `--ps-gold #C8941A`, `--ps-bg #FAF7F2`, `--ps-text #3D2314`. Match exato com Estrela Polar.

**ROLES catalogadas (17):** `adm_investimentos`, `adm`, `socio`, `diretor_industrial`, `gerente_planta`, `financeiro`, `comercial`, `supervisor`, `coordenador`, `operacional`, `consultor`, `conselheiro`, `contador`, `atendimento`, `designer`, `visualizador`, `acesso_total`.

#### Sub-rotas `/dashboard/admin/sync/*`

| Rota | Descrição | Estado |
|---|---|---|
| `sync/page.tsx` | Health check Omie + ações por provider (RPC `fn_sync_*`) | ✅ |
| `sync/empresa/[id]/page.tsx` | Detalhe sync por empresa | ✅ |
| `sync/historico/page.tsx` | Histórico de syncs | ✅ |
| `sync/payloads/page.tsx` | Payloads shadow | ✅ |

### 1.4 Rotas legadas `/admin/*` (FORA de `/dashboard/admin`)

⚠️ **Estas rotas NÃO compartilham layout com `/dashboard`** — são standalone, sem sidebar comum. Identificadas como "legadas" porque o padrão atual é `/dashboard/admin/*`.

| Rota | Arquivo | Descrição | Estado |
|---|---|---|---|
| `/admin/operadores` | `src/app/admin/operadores/page.tsx` | Operadores BPO + escopo | ✅ |
| `/admin/projeto` | `src/app/admin/projeto/page.tsx` | Painel meta-projeto (panorama, contexto, arquivos, mudanças) | ✅ Consome `fn_projeto_panorama`, `fn_contexto_*`, `fn_catalogo_*`, `fn_mudancas_*` |
| `/admin/psgc/linhas-negocio` | `src/app/admin/psgc/linhas-negocio/page.tsx` | Configuração PSGC linhas de negócio | ⚠️ inspecionar |
| `/admin/psgc/revisao` | `src/app/admin/psgc/revisao/page.tsx` | Revisão de mapeamentos PSGC (consome `v_psgc_depara_revisao`) | ✅ |
| `/admin/sync-status` | `src/app/admin/sync-status/page.tsx` | Sync status geral (RPC `fn_sync_status_geral`, `fn_sync_ultimos`, `fn_sync_resumo_empresas`, `fn_sync_controle`) | ✅ |

**Recomendação:** essas 5 rotas legadas devem ser **migradas para tabs sob `/dashboard/admin`** ou explicitamente declaradas como áreas independentes no replanejamento M.A.8.

### 1.5 API Routes `/api/*` (119 endpoints)

#### Por área (resumo)
- **dashboard** (10): `home`, `dfc`, `periodos`, `raiox`, `raiox-assessor`, `universal`, `atalhos`, `grupos`
- **assessor** (8): consultor, diagnostico, clientes, empresas-erp, analisar-erp, import, onboarding
- **bpo** (3): classify, executar, retroalimentar
- **compliance** (12): consultas, dispensas, documentos, funcionarios, matriz, matriz-prestadores, prestadores, status, worker, zip
- **conciliacao** (3): inbox, match, saude
- **connectors** (2): reconcile, batch
- **contaazul** (3): callback, sync, token
- **contador** (7): calendario, clientes, empresas, escritorio, dre, fiscal, reforma
- **dre/dre-divisional/financeiro/fluxo-caixa** (4): endpoints DRE
- **dev** (4): chat, context, deploy, sql ⚠️ (deploy protegido por DEPLOY_SECRET_TOKEN no middleware)
- **industrial** (7): analyze, bovinos/{apontamento,kpis,lote-animal}, custos, unidades
- **omie** (5): detail, process, promote, route, sync
- **psgc** (3): corrigir, linha-negocio, revisao
- **sync/omie** (4): clientes, fornecedores, full, produtos
- **wealth** (2): import/csv, quotes
- **demais** (~40): cep-lookup, cnpj-lookup, agente, ai, audit, fornecedores, settings, etc.

---

## 2. Sistema de Navegação

### 2.1 Sidebar Principal — `src/app/dashboard/layout.tsx` (950 linhas)

**Tipo:** Client Component
**Estrutura central:** `MENU: Record<PlanoTipo, MenuGroup[]>` — sidebar muda conforme **plano selecionado** pelo usuário.

**6 áreas/planos (`PlanoTipo`):**
1. `comercio` — Comércio & Serviços (ícone `<Building />`)
2. `industrial` — Industrial (`<Factory />`)
3. `agro` — Agro (`<Leaf />`)
4. `bpo` — BPO Financeiro (`<Briefcase />`)
5. `wealth` — Wealth MFO (`<Gem />`)
6. `producao` — Produção & Marketing (`<Palette />`)

**Comportamento:**
- Sidebar fixa esquerda no desktop, drawer no mobile
- `sidebarCollapsed` toggle (state)
- `mobileMenuOpen`, `showCompanyMenu`, `showUserMenu`, `showPlanoMenu`, `showCompanyMenu`
- Usuário troca plano via `showPlanoMenu` (persistido no localStorage `currentPlano`)
- Tem variável `temProjetos` que injeta menu Projetos condicionalmente
- Tem `demoMode` toggle (não documentado no escopo)

**Auth + dados:** loadAuth() carrega `user`, `userRole`, `companies`, `groups`, `selCompany`. **Não usa `useAuth()` do `AuthProvider.tsx`** — duplica a lógica diretamente. Inconsistência arquitetural identificada.

**Multi-empresa:** seletor `showCompanyMenu` permite escolher empresa OU "Todas as Empresas / N empresas · Consolidado". Persiste via Zustand store em algum lugar (a confirmar).

### 2.2 Sub-layout `/dashboard/projetos/layout.tsx`

Layout específico para área de projetos (Hub Construção). Não auditado em detalhe nesta passagem.

### 2.3 Layout `/wealth`

Existe `src/app/wealth/layout.tsx` mas as rotas `/wealth/*` (3 page.tsx) parecem público/separado das `/dashboard/wealth/*` (autenticadas). **Possível duplicação.**

### 2.4 Header / Top bar

Embutido no `dashboard/layout.tsx` (não componente separado):
- Avatar usuário + dropdown (`showUserMenu`)
- Seletor de empresa + dropdown
- Seletor de plano + dropdown
- Botão sidebar collapse

---

## 3. Componentes UI

### 3.1 Design System — Estado: SEM SISTEMA FORMAL

**Não existe `components/ui/`.** Não há shadcn/ui, Radix, ou biblioteca primitiva.

**Padrão de fato:** cada página é Client Component com **estilos inline** (`style={{ }}`) e tokens definidos localmente como objeto `COR` ou via CSS variables `--ps-*` em `dashboard/admin/page.tsx`.

**Bibliotecas instaladas que poderiam virar UI:**
- `lucide-react@1.14.0` (ícones — usado parcialmente)
- `recharts@3.8.1` (gráficos — usado nos componentes RaioX*)
- `react-signature-canvas@1.1.0-alpha.2` (assinatura digital — EPI)
- `react-pluggy-connect@2.12.0` (Open Finance — Wealth)

### 3.2 Componentes de domínio em `src/components/`

#### Top-level (3)
- `HelpWidget.tsx` — widget de ajuda flutuante
- `ImportadorUniversal.tsx` — uploader CSV/Excel
- `LgpdConsentModal.tsx` — modal LGPD

#### `bpo/` (5)
- `AdminGuard.tsx` (BPO admin), `AssignmentBadge.tsx`, `BPODashboard.tsx`, `BpoLandingRedirect.tsx`, `FiltroEmpresas.tsx`, `SkillsEditor.tsx`

#### `conciliacao/` (1)
- `UploadFaturaExtrato.tsx`

#### `dashboard/` (8) — componentes RaioX (DRE/Análises)
- `ConsultorInsights.tsx`, `PainelExecutivo.tsx`, `PeriodoSelector.tsx`
- `RaioXABCProfundo.tsx`, `RaioXAssessor.tsx`, `RaioXDFC.tsx`
- `RaioXDREExpandida.tsx`, `RaioXFluxoCaixa.tsx`, `RaioXIndicadores.tsx`
- `RaioXProfundo.tsx`, `ToggleRegime.tsx`

#### `linhas-negocio/` (5)
- `BudgetVsRealizado.tsx`, `DREPorLinha.tsx`, `HealthScore.tsx`, `LinhasConfig.tsx`, `WaterfallChart.tsx`

#### `projetos/` (7)
- `BdiPreview.tsx`, `BdiSlider.tsx`, `BomEditor.tsx`, `CatalogoForm.tsx`, `CatalogoTable.tsx`, `EmptyStateImportar.tsx`, `SeletorItemModal.tsx`

#### `psgc/` (4)
- `PSGCBadge.tsx`, `PSGCButton.tsx`, `PSGCCard.tsx`, `PSGCMetric.tsx`

#### `wealth/` (12)
- `cliente-conexoes-section.tsx`, `cliente-detalhe-view.tsx`, `cliente-kpis.tsx`, `cliente-positions-table.tsx`
- `ofx-upload-modal.tsx`, `pluggy-widget-wrapper.tsx`, `sync-history-section.tsx`
- `termo-consent-modal.tsx`, `wealth-cliente-card.tsx`, `wealth-cliente-view.tsx`
- `wealth-consultor-view.tsx`, `wealth-kpi-card.tsx`, `wealth-mode-toggle.tsx`

### 3.3 Componentes hand-rolled do PR #90 revertido

**Resgatáveis via** `git show d0516aa^2:src/components/admin/<arquivo>`:

| Arquivo | Linhas | Reaproveitável? |
|---|---:|---|
| `colors.ts` | 61 | ✅ Paleta Estrela Polar + helpers `formatBRL`, `corSemaforo` |
| `StatusBadge.tsx` | 89 | ✅ Badge reutilizável (7 tones) — útil em qualquer tab admin |
| `PlanoCard.tsx` | 208 | ⚠️ Específico para listagem de planos — reaproveita só se houver tab Planos |
| `PlanosFiltrosGrid.tsx` | 212 | ⚠️ Mesmo |
| `ModuloAccordion.tsx` | 224 | ⚠️ Específico de planos×módulos |
| `Sidebar.tsx` | 212 | ❌ **Não reusar** — duplicaria sidebar existente |
| `AdminGuard.tsx` | 45 | ❌ **Não reusar** — `/dashboard/admin/page.tsx` já tem `checkAuth()` próprio |

**Recomendação:** resgatar `colors.ts` e `StatusBadge.tsx` como base de design tokens e badge primitive. Demais ficam para nova tab Planos quando integrada.

### 3.4 Cores reais usadas hoje

Há **dois temas inconsistentes**:

#### Tema escuro (definido em `globals.css`)
```css
--gold: #C6973F          /* ⚠️ DIFERE de Estrela Polar #C8941A */
--bg-primary: #0C0C0A    /* Quase preto */
--bg-card: #161614
--text-primary: #F0ECE3
--green: #34D399
--red: #F87171
```
Aplicado ao `body`, mas não usado pelas páginas admin.

#### Tema claro (Estrela Polar) — usado em `/admin/projeto`, `/dashboard/admin`
```css
--ps-gold: #C8941A       /* Dourado Estrela Polar */
--ps-bg: #FAF7F2         /* Off-white */
--ps-bg2: #FFFFFF
--ps-bg3: #F0ECE3
--ps-text: #3D2314       /* Espresso */
--ps-border: #E0D8CC
```
Espresso/Off-white/Dourado aparecem como CSS vars **sem fonte centralizada** — cada página redefine inline.

**Débito:** unificar tokens em `globals.css` ou `tailwind.config.ts`.

---

## 4. Conexões Supabase

### 4.1 Cliente Supabase

| Arquivo | Tipo | Uso |
|---|---|---|
| `src/lib/supabase.ts` | Browser client (`createClient` from `@supabase/supabase-js`) | **Único** cliente em uso |
| `src/lib/supabaseAdmin.ts` | Service role client | Server-side em API routes |
| **`@supabase/ssr@0.10.2`** | Instalado mas não configurado | Sem `createServerClient` em uso |
| **`@supabase/auth-helpers-nextjs@0.15.0`** | Deprecated (ver warning npm) | Importado mas não usei grep para confirmar uso |

**Limitação atual:** Server Components não conseguem fazer queries autenticadas. Toda query autenticada é Client Component via `useEffect`.

### 4.2 Views consumidas pela UI (10 views)

| View | Consumida por |
|---|---|
| `v_dre_divisional_completo` | `api/dre-divisional/route.ts` (3×) |
| `v_compliance_matriz_prestadores` | `api/compliance/prestadores/[id]`, `api/compliance/prestadores`, `api/compliance/matriz-prestadores` |
| `v_compliance_status_consultas` | `api/compliance/status` |
| `v_compliance_matriz_funcionarios` | `api/compliance/matriz`, `api/compliance/funcionarios/[id]`, `api/compliance/funcionarios`, `dashboard/compliance/page.tsx` (2×) |
| `v_psgc_depara_revisao` | `api/psgc/revisao` |
| `v_conciliacao_saude` | `api/conciliacao/saude` |
| `v_bpo_clientes_ativos` | `dashboard/layout.tsx`, `dashboard/bpo/supervisor` |
| `v_epi_dashboard` | `dashboard/compliance/epi/page.tsx` |
| `v_epi_funcionarios_consolidado` | `dashboard/compliance/epi/fichas` |
| `v_contratos_dashboard`, `v_contratos_mrr_por_tipo`, `v_contratos_top_clientes` | `dashboard/contratos/page.tsx` |

### 4.3 Views órfãs (existem no banco, NÃO consumidas)

⚠️ **Backend M.A.8.0 (PR #89) — todas órfãs:**
- `v_admin_planos_completo`, `v_admin_plano_modulos`, `v_admin_modulo_features`
- `v_admin_truth_dashboard`, `v_admin_roadmap_completo`

⚠️ **Outras views potencialmente órfãs (a confirmar com inventário banco completo):**
- `v_modulo_status_consolidado`, `v_plano_features_completas`, `v_features_pendentes_caminho_critico`, `v_catalogo_executivo` (Manual Vivo V1)
- `v_roadmap_snapshot`, `v_roadmap_proximos_marcos` (Roadmap V1)
- `v_categorias_sem_depara`, `v_categorias_padrao_por_sistema`, `v_depara_sugestoes_pendentes` (Truth Auditor)
- `v_lgpd_status_compliance` (LGPD)

### 4.4 RPCs chamadas pela UI (lista parcial — não exaustivo)

| Família | RPCs |
|---|---|
| **dashboard** | `fn_dashboard_home`, `fn_dashboard_home_periodo`, `fn_periodos_disponiveis`, `fn_dashboard_kpis` |
| **psgc** | `fn_psgc_dre_consolidada`, `fn_psgc_saude_consolidada`, `fn_psgc_abc_consolidado`, `fn_psgc_painel_executivo`, `fn_psgc_dfc_indireto`, `fn_psgc_analise_vertical_horizontal`, `fn_psgc_apuracao_tributaria`, `fn_psgc_narrativa_cfo`, `fn_psgc_raiox_1`, `fn_psgc_corrigir_mapeamento`, `fn_psgc_cadastrar_ln` |
| **consultor** | `fn_consultor_insights_grupo` |
| **sync** | `fn_sync_health_check`, `fn_sync_status_geral`, `fn_sync_ultimos`, `fn_sync_resumo_empresas`, `fn_sync_controle`, `fn_avaliar_promocao_write_back`, `fn_provider_promover_para_write_back`, `fn_provider_pausar_emergencia` |
| **bpo** | `fn_supervisor_dashboard`, `fn_operadores_stats`, `fn_bpo_admin_listar_operadores`, `fn_bpo_minhas_empresas`, `fn_inbox_operador` |
| **compliance/EPI** | `fn_compliance_enfileirar_consulta`, `fn_epi_registrar_entrega` |
| **conciliação** | `(nome a confirmar)` em `fn_*` (2 chamadas em api/conciliacao/match), inbox |
| **projeto admin** | `fn_projeto_panorama`, `fn_contexto_listar`, `fn_contexto_concluir`, `fn_catalogo_listar`, `fn_mudancas_listar`, `fn_mudanca_aprovar`, `fn_mudanca_rejeitar` |
| **batch operations** | `batch_baixa_titulos`, `batch_cancelar_titulos`, `batch_alterar_vencimento`, `next_cotacao_numero` |
| **dev** | `exec_sql`, `get_tables_info` |

### 4.5 RPCs órfãs (definidas no banco mas NÃO consumidas pela UI)

⚠️ **PR #89 (M.A.8.0) — backend órfão:**
- `fn_admin_executar_truth_auditor`
- `fn_admin_get_plano_detalhe`

⚠️ **Truth Auditor (PRs 4.5/4.6):**
- `fn_truth_audit_dre`, `fn_truth_audit_dre_despesa`, `fn_truth_audit_compras`
- `fn_truth_audit_executar_todas`
- (consumida apenas pela edge function `truth-auditor-cron`, não pela UI)

⚠️ **LGPD (PR M.A.5.1):**
- `fn_lgpd_registrar_consentimento`, `fn_lgpd_revogar_consentimento`
- `fn_lgpd_export_dados`, `fn_lgpd_anonimizar_dados`
- `fn_lgpd_listar_solicitacoes_pendentes`

⚠️ **DePara/staging (PR 4.3b/c):**
- `fn_replicar_depara_omie`, `fn_parsear_siga_path`, `fn_sugerir_mapeamento_texto_livre`

### 4.6 Tabelas com queries diretas (111 únicas)

Distribuição por área:
- **erp_*** (16): `erp_clientes`, `erp_contas_bancarias`, `erp_contratos`, `erp_extrato`, `erp_fornecedores`, `erp_lancamentos`, `erp_movimentacoes`, `erp_orcamento_historico`, `erp_orcamentos`, `erp_orcamentos_itens`, `erp_pagar`, `erp_pedidos`, `erp_plano_contas`, `erp_produtos`, `erp_receber`, `erp_score_historico`
- **bpo_*** (4): `bpo_alertas`, `bpo_classificacoes`, `bpo_contratos`, `bpo_inbox_items`
- **compliance_*** (5): `compliance_consultas`, `compliance_dispensas`, `compliance_documentos`, `compliance_funcionarios`, `compliance_prestadores`, `compliance_setores`, `compliance_tipos_documento`
- **epi_*** (7): `epi_alerta`, `epi_assinatura`, `epi_catalogo`, `epi_categoria`, `epi_estoque`, `epi_ficha`, `epi_movimentacao`
- **ind_*** (8): bovinos, lotes, kpis, qualidade, turnos, custos, alertas, unidades
- **fiscal_*** (4): apuracoes, calendario, configuracao, split_payment
- **contador/escritorios** (4)
- **assessoria/clientes_assessoria** (3)
- **dashboard_*** (3): atalhos, atalhos_default, grupos, grupos_empresas
- **conciliacao_*** (3) + bucket `conciliacao-arquivos`
- **psgc_*** (3): contas, fluxo_realizado, depara
- **lgpd_consentimentos**, **linhas_negocio_***, **planos_modulos**, etc.
- **infra:** `users`, `companies`, `company_groups`, `user_companies`, `profiles`, `permissoes_nivel`, `invites`, `api_integrations`, `data_source_call_logs`, `data_source_runs`, `omie_imports`, `omie_sync_log`, `operator_clients`, `relatorios`, `sessoes`, `audit_logs`

**Achado:** uso intenso de queries diretas (`from(...).select()`) no client. Muitas dessas queries deveriam ser RPCs ou views consolidadas para performance e segurança.

---

## 5. Features REALMENTE Funcionais vs Manual Vivo

### 5.1 Estatísticas globais do `feature_catalog`

| Status | Qtd | % |
|---:|---:|---:|
| **previsto** | 112 | 64.4% |
| **pronto** | 36 | 20.7% |
| **parcial** | 26 | 14.9% |
| **Total** | **174** | 100% |

### 5.2 Top módulos com features `pronto` (catalogadas)

| Módulo | Total | Prontas | Parciais | Previstas |
|---|---:|---:|---:|---:|
| `resultado_dre` | 6 | **4** | 1 | 1 |
| `anti_fraude` | 4 | **4** | 0 | 0 |
| `importar` | 4 | **4** | 0 | 0 |
| `drilldown` | 3 | **3** | 0 | 0 |
| `convidar_usuarios` | 3 | **2** | 0 | 1 |
| `financeiro` | 6 | **2** | 3 | 1 |
| `admin_painel` | 3 | **2** | 0 | 1 |
| `noc` | 3 | **2** | 1 | 0 |
| `operacional` | 2 | **2** | 0 | 0 |
| `painel_geral` | 3 | **2** | 1 | 0 |
| `visao_diaria` | 2 | **2** | 0 | 0 |
| `dev` | 1 | **1** | 0 | 0 |
| `precos` | 1 | **1** | 0 | 0 |
| `reforma_tributaria_2026` | 3 | **1** | 1 | 1 |
| `industrial` | 1 | **1** | 0 | 0 |
| `bpo` | 3 | **1** | 0 | 2 |

### 5.3 Manual Vivo MENTINDO — Features no código mas NÃO catalogadas / mal classificadas

⚠️ **Identificadas em auditoria rápida (não exaustivo):**

#### Features `previsto`/`parcial` no catálogo mas FUNCIONAIS no código:

| Possível ID no catálogo | Realidade no código | Evidência |
|---|---|---|
| `F.epi.entrega_assinatura` (catalogado `previsto`) | **EXISTE funcional** | `dashboard/compliance/epi/_components/ModalEntregarEPI.tsx` chama `fn_epi_registrar_entrega` |
| `F.compliance_epi.cadastro_epi` (catalogado `previsto`) | **EXISTE funcional** | `dashboard/compliance/epi/catalogo/page.tsx` |
| `F.compliance_epi.alerta_validade` (catalogado `previsto`) | **EXISTE funcional** | `dashboard/compliance/epi/alertas/page.tsx` + `v_epi_dashboard` |
| `F.compliance_epi.rastreabilidade_funcionario` (catalogado `previsto`) | **EXISTE funcional** | `dashboard/compliance/epi/ficha/[funcionario_id]` + `v_epi_funcionarios_consolidado` |
| Features de Industrial Bovinos | **EXISTEM** | `api/industrial/bovinos/*` + `dashboard/industrial/apontamento` + `ind_apontamentos_bovinos` |
| Features Wealth (Pluggy/OFX) | Ausente do catálogo? | `react-pluggy-connect` integrado + `dashboard/wealth/clientes/[id]` + `api/wealth/import/csv` |
| Features Contratos Recorrentes | Catalogado em M.A.7.1 como `previsto` | **EXISTEM** funcionais — `dashboard/contratos` + `v_contratos_*` (3 views) |
| Features Conciliação OFX | Não detectado no catálogo | **EXISTE** — `api/conciliacao/*` + `dashboard/conciliacao/[lote_id]` |
| Features Linhas de Negócio (DRE, budget, benchmark) | Catálogo confuso | **EXISTEM** funcionais — `api/linhas-negocio/{benchmark,budget,dre}` + 5 components |
| Features Compliance ESocial/Funcionários | Catalogado em M.A.7.1 como `previsto` | **EXISTEM parcial** — `dashboard/compliance/funcionarios/[id]` + `dashboard/compliance/matriz` |

**Implicação:** o `feature_catalog` está sub-reportando o sistema real. Estimativa rápida: **20-30 features adicionais funcionais** que precisam de update de status urgente.

### 5.4 Features sem catálogo (existem em código mas não aparecem no Manual Vivo)

- `dashboard/contaazul-callback/page.tsx` — OAuth ContaAzul (não catalogado)
- `dashboard/contador/empresa/[id]/reforma/page.tsx` — Reforma Tributária por empresa
- `dashboard/dev/page.tsx` — Painel Dev interno
- `dashboard/relatorio/page.tsx` — Relatório IA v19
- `dashboard/sugestoes/page.tsx` — Sugestões IA
- `dashboard/score/page.tsx` — Score (parcialmente catalogado?)
- `dashboard/admin/sync/payloads/page.tsx` — Payloads shadow
- `dashboard/bpo/foco`, `dashboard/bpo/meu-dia`, `dashboard/bpo/supervisao` — todos não catalogados
- `dashboard/projetos/{engenharia,insumos,mao-obra,visitas}` — Hub Construção sub-páginas
- `dashboard/cliente/[company_id]/[token]` — Acesso por token

### 5.5 Páginas placeholder / pouca lógica (a inspecionar visualmente)

Não classifiquei sem ler cada arquivo. Auditoria visual via Vercel preview pode confirmar:
- `dashboard/ajuda` — provavelmente parcial
- `dashboard/tutorial` — provavelmente placeholder
- `dashboard/dev` — uso interno
- `dashboard/contador/registrar` — fluxo de signup contador

---

## 6. Padrões e Convenções

### 6.1 TypeScript
- **Strict:** `true` (`tsconfig.json`)
- Path alias: `@/*` → `./src/*`
- Target: `ES2017`
- **Anti-padrão observado:** uso frequente de `any` em estados (`useState<any>(null)`)

### 6.2 Server vs Client Components
- **Quase 100% Client Components** (`'use client'` em todas páginas inspecionadas)
- Server Components apenas em `loading.tsx` e algumas raras (raíz)
- Razão: auth é client-side via `useAuth()` ou `loadAuth()` inline

### 6.3 Auth + Roles

**Padrão dominante:**
```typescript
const { data: { user } } = await supabase.auth.getUser();
const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
const isAdmin = profile?.role === 'adm';
// ou
if (up?.role === 'adm' || up?.role === 'acesso_total' || up?.role === 'adm_investimentos') { ... }
```

**Roles operacionais:** 17 documentados em `dashboard/admin/page.tsx` + 6 em `lib/planos.ts` (parcialmente sobrepostos).

**Helpers em `lib/`:**
- `AuthProvider.tsx` — Context API com `user`, `userId`, `role`, `isAdmin`, `companies`, `canAccess(companyId)`
- `auth.ts` — `getAuthorizedCompanies()` server-side
- `withAuth.ts` — HOF para API routes (Bearer token)
- `authGuard.ts` — `unauthorizedResponse()`, `forbiddenResponse()`
- `authFetch.ts` — fetch wrapper que injeta token
- `contadorAuth.ts` — auth específica do portal contador
- `checkPermission.ts` — verificação granular de permissões

**Inconsistência:** `dashboard/layout.tsx` (950 lin) **duplica** lógica do `AuthProvider`. Deveria reusar.

### 6.4 Estilização
- **Tailwind v4** via PostCSS (`@tailwindcss/postcss`)
- Sem `tailwind.config.ts` (config CSS-only)
- Tokens em `globals.css` mas **sub-utilizados** — páginas usam inline styles
- **Inconsistência:** `--gold #C6973F` (globals) vs `#C8941A` (Estrela Polar usado em admin)

### 6.5 Estado global
- **Zustand 5** instalado (`src/lib/stores/wealth-mode-store.ts` único uso confirmado)
- Context API: `AuthProvider`, `SelectedCompanyProvider` (referenciado mas não localizei o source)
- Uso amplo de `useState` local + URL state

### 6.6 Data fetching
- **Padrão:** `supabase.from(...).select(...)` direto via `useEffect`
- **Não usa:** SWR, React Query
- Sem cache cliente; refetch manual via state

### 6.7 Forms
- **Sem react-hook-form, sem zod**
- Validação manual com `useState` + `if (!campo) setError(...)`

### 6.8 Toasts/notificações
- **Sem biblioteca dedicada**
- Padrão: `useState<string>(msg)` + render condicional inline

### 6.9 Routing
- `next/link` `<Link>` (a maioria)
- `useRouter` do `next/navigation` para redirects programáticos
- `useSearchParams`, `usePathname` para state da URL

### 6.10 Charts
- **Recharts 3.8.1** — usado em RaioX*, WaterfallChart, HealthScore

### 6.11 Middleware
- `src/middleware.ts` (23 linhas) — apenas protege `/api/dev/deploy` com `DEPLOY_SECRET_TOKEN`
- ⚠️ **Deprecation Next 16:** "Please use 'proxy' instead" — fora de escopo deste PR, mas precisa ser endereçado

---

## 7. Gaps Identificados (Análise Crítica e Honesta)

### 7.1 Manual Vivo MENTINDO

Lista preliminar (Seção 5.3 detalhada):
- **EPI completo** (4 features) — catalogado `previsto`, mas **funciona em produção** com tabelas (`epi_*`), API (`api/compliance/...`) e UI (`dashboard/compliance/epi/*`)
- **Industrial Bovinos** — sub-área completa não catalogada
- **Wealth (Pluggy + OFX)** — backend e UI funcionais, catálogo desatualizado
- **Contratos recorrentes** — 3 views consumidas, UI funcional, mas catalogado `previsto`
- **Conciliação OFX** — funcional, sub-reportado
- **Linhas de Negócio** (DRE, budget, benchmark) — funcional, mal catalogado

**Estimativa:** 20–30 features precisam de update de `previsto`/`parcial` → `pronto` ou `parcial`. Recomendo **PR M.A.7.4 dedicado** para sincronizar.

### 7.2 Funcionalidades sem catálogo

11 rotas listadas em 5.4 que existem em código mas não estão no `feature_catalog`. Catalogar todas no M.A.7.4.

### 7.3 Backend órfão

- ⚠️ **Todo backend M.A.8.0 (PR #89)** está órfão — 5 views + 2 RPCs que **nunca foram chamadas**.
- ⚠️ **Truth Auditor RPCs** só são chamadas por edge function (cron), não pela UI.
- ⚠️ **LGPD RPCs** (5) órfãs aguardando UI (PR M.A.5.3).
- ⚠️ **DePara staging RPCs** (3) só chamadas em migration; não há UI de revisão.

### 7.4 Débito técnico visível

| Item | Severidade | Recomendação |
|---|---|---|
| `dashboard/layout.tsx` 950 linhas | Alta | Decompor em sub-componentes |
| Lógica de auth duplicada (`layout.tsx` vs `AuthProvider`) | Alta | Unificar em `AuthProvider` |
| Sem design system (`components/ui/`) | Alta | Criar primitives mínimos (Card, Badge, Button, Input) |
| Tokens de cor inconsistentes (`#C6973F` vs `#C8941A`) | Média | Unificar Estrela Polar como source of truth |
| `any` em useState | Média | Tipar progressivamente |
| Queries diretas no client (111 tabelas) | Média | Migrar para RPCs/views |
| Sem react-hook-form / zod | Média | Adotar para forms novos |
| `@supabase/auth-helpers-nextjs` deprecated | Baixa | Migrar para `@supabase/ssr` |
| `middleware.ts` deprecated em Next 16 | Baixa | Renomear para `proxy.ts` |
| `lucide-react@1.14.0` (versão antiga) | Baixa | Atualizar quando conveniente |

### 7.5 Arquitetura paralela (RD-26 anti-pattern)

**Detectado:**
- `/admin/*` (5 rotas legadas) **paralelas** a `/dashboard/admin` (6 tabs)
- `/wealth/*` (4 rotas) **paralelas** a `/dashboard/wealth/*` (2 rotas)
- Possível: `dashboard/orcamento` (singular) vs `dashboard/orcamentos` (plural)

**Recomendação:** auditoria dedicada para resolver duplicações.

---

## 8. Recomendações Estratégicas

### 8.1 Como integrar M.A.8 corretamente

#### Decisão arquitetural: extender `/dashboard/admin` (não criar `/admin/*`)

`/dashboard/admin/page.tsx` já tem o pattern de tabs implementado. **Adicionar 3-4 tabs novas** vs criar páginas paralelas:

| Tab atual | Status |
|---|---|
| Empresas | ✅ |
| Usuários & Níveis | ✅ |
| Convites | ✅ |
| Mapa de Permissões | ✅ |
| Horários & Segurança | ✅ |
| Sessões & Auditoria | ✅ |
| **Catálogo (Planos × Módulos × Features)** | 🆕 PR M.A.8.x |
| **Truth Auditor** | 🆕 PR M.A.8.x |
| **Roadmap** | 🆕 PR M.A.8.x |

**Vantagens:**
- Backend M.A.8.0 (já em produção) é finalmente consumido
- Único entry point admin para CEO
- Auth, layout, navegação herdados automaticamente
- Reusa estilos `--ps-*` já definidos

#### Componentes a resgatar do PR #90 revertido

```bash
# Comando de resgate
git show d0516aa^2:src/components/admin/colors.ts > src/components/admin/colors.ts
git show d0516aa^2:src/components/admin/StatusBadge.tsx > src/components/admin/StatusBadge.tsx
```

**Apenas 2 dos 7 componentes** valem ser resgatados imediatamente. Demais ficam para quando integrar tab Planos.

### 8.2 Manual Vivo — sincronização urgente

**PR M.A.7.4** sugerido:
1. Audit completo (não rápido) feature por feature
2. Update de status para 20–30 features
3. Catalogar 11 rotas órfãs
4. View `v_manual_vivo_divergencias_detectadas` (alerta automático futuro)

### 8.3 Quick wins de débito

| Quick win | Impacto | Esforço |
|---|---|---|
| Unificar tokens cor (`#C8941A` em globals.css) | Alto (visual consistente) | 1h |
| Decompor `dashboard/layout.tsx` | Alto (manutenibilidade) | 4h |
| Criar `components/ui/` mínimo (Card, Badge) | Alto (DRY futuro) | 2h |
| Migrar para `@supabase/ssr` (server) | Médio (Server Components) | 3h |
| Renomear `middleware.ts` → `proxy.ts` | Baixo (compliance Next 16) | 30min |

---

## 9. Resumo Executivo (TL;DR)

- **Sistema é GRANDE:** 122 páginas, 119 API routes, 111 tabelas únicas referenciadas, 6 áreas/planos, 17 roles operacionais.
- **Áreas mais maduras:** `dashboard/admin` (6 tabs ✅), DRE/Análises, Compliance/EPI, BPO, Industrial bovinos, Conciliação, Linhas de Negócio.
- **Áreas menos maduras:** Wealth (split entre `/wealth/*` e `/dashboard/wealth/*`), Hub Projetos sub-páginas, Tutorial, Sugestões IA.
- **Manual Vivo:** apenas **20.7% catalogado como `pronto`** no banco, mas em código a realidade é **~30–40% funcional**. **Sub-reporta o sistema.**
- **Backend órfão crítico:** PR #89 (M.A.8.0) — 5 views + 2 RPCs **nunca chamadas**. Aguardando integração via tabs em `/dashboard/admin`.
- **RD-26 evidente:** múltiplas duplicações `/admin/*` ↔ `/dashboard/admin`, `/wealth/*` ↔ `/dashboard/wealth/*`.
- **Débito visual:** 2 paletas de cor (`#C6973F` global vs `#C8941A` admin), `dashboard/layout.tsx` 950 linhas, sem design system formal.
- **Recomendação para M.A.8:** **NÃO criar `/admin/*` novo.** Adicionar 3 tabs em `/dashboard/admin/page.tsx` consumindo backend M.A.8.0 já em produção. Resgatar `colors.ts` e `StatusBadge.tsx` do PR #90 revertido.
- **Próximo passo proposto:** Engenheiro Chefe revisa este inventário, valida pontos cegos com CEO, e propõe replanejamento M.A.8.v2 integrado em `/dashboard/admin`.

---

## Apêndice A — Como atualizar este inventário

```bash
# Re-rodar discovery
find src/app -name "page.tsx" -o -name "layout.tsx" | sort
find src/app/api -name "route.ts" | sort
grep -rhn "\.from('[a-z_]" src/ | grep -oP "\.from\('[^']+'\)" | sort -u
grep -rhn "\.rpc(" src/ | grep -oP "rpc\('[^']+'" | sort -u

# Banco
SELECT status, COUNT(*) FROM feature_catalog GROUP BY status;
SELECT * FROM v_modulo_status_consolidado;
```

## Apêndice B — Comandos de resgate do PR #90

```bash
# Listar files do commit revertido
git show d0516aa^2 --stat

# Resgatar arquivo específico
git show d0516aa^2:src/components/admin/colors.ts
git show d0516aa^2:src/components/admin/StatusBadge.tsx
```

---

**Fim do INVENTORY.md v1.0**
