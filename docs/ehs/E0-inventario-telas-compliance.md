# PS EHS · E0 — inventário das telas de Compliance (regressão)

Fonte: leitura do código em 08/10/2026 (`src/app/dashboard/compliance/**` e `src/app/sign/epi/[token]`).
Regra: nenhuma rota/tabela abaixo pode ser removida ou renomeada; tela nova só substitui com redirecionamento depois de aprovada.
A spec `e2e/jornadas/aceitacao/ehs-e0-regressao-telas.spec.ts` abre cada rota (demo SST) e é obrigatória em toda PR da vertical.

| Rota | O que faz hoje | Dados (tabela/view/RPC) |
|---|---|---|
| `/dashboard/compliance` | Painel: indicadores de conformidade e atalhos | compliance_funcionarios, v_compliance_matriz_funcionarios |
| `/calendario` | Calendário de obrigações; gera de documentos/recorrentes, marca concluída | v_compliance_calendar_dashboard, fn_compliance_calendar_* |
| `/empresa` | Documentos da empresa | compliance_documentos, compliance_tipos_documento |
| `/documentos-exigidos` | Lista de documentos exigidos por empresa (custom) | compliance_tipos_documento |
| `/funcionarios` | Cadastro; projeta de ind_ponto | compliance_funcionarios, fn_compliance_projetar_de_ind_ponto |
| `/funcionarios/[id]` | Ficha: Dados + aba Documentos | compliance_funcionarios, documentos |
| `/matriz` | Matriz de conformidade | v_compliance_matriz_funcionarios |
| `/setores` | Setores por empresa | compliance_setores |
| `/sst` | Importa setores do ponto | fn_compliance_setores_do_ponto_preview / _importar_do_ponto |
| `/treinamentos` | Tipos de treinamento NR, turmas/presença | compliance_tipos_documento, nr_turma_presenca |
| `/treinamentos-por-setor` | Treinamentos exigidos por setor (#42) | — |
| `/pausas-tecnicas` | Pausas NR-36: configuração, importação de ponto, apuração, conferência, ciência | ind_ponto_pausa, nr_*, fn_nr_* |
| `/prestadores` e `/[id]` | Prestadores de serviço e documentos | compliance_prestadores |
| `/epi` | Gestão de EPI (painel) | v_epi_dashboard |
| `/epi/alertas` | Alertas de EPI | epi_alerta |
| `/epi/catalogo` | Catálogo, importa do estoque | epi_catalogo, epi_categoria, fn_epi_* |
| `/epi/estoque` | Estoque de EPI | epi_estoque |
| `/epi/fichas` | Fichas consolidadas | v_epi_funcionarios_consolidado |
| `/epi/ficha/[funcionario_id]` | Ficha de EPI da pessoa | epi_ficha, epi_movimentacao |
| `/whatsapp-epi` | Bot WhatsApp: gera link de assinatura | compliance_epi_assinatura_tokens, fn_compliance_epi_gerar_link_whatsapp |
| `/validacao-automatica` | Provedores de validação automática | — |
| `/esocial`, `/auditorias`, `/lgpd`, `/ponto` | Telas curtas (placeholder/redirecionamento) | — |
| `/sign/epi/[token]` (pública) | Assinatura de entrega de EPI por token | fn_compliance_epi_marcar_visualizado / _confirmar_assinatura |

## Pendente (não feito nesta PR)
Números e documentos iguais antes/depois para FRIOESTE, Tryo Acabamentos, Tryo Gesso e R. R exigem usuário real dessas
empresas (credenciais/snapshots) — o robô de aceitação só opera na demonstração. Precisa de decisão do Eng. Chefe/CEO.
