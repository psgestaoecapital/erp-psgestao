# PS EHS — Desenho curto das ondas E4 (saúde ocupacional) e E5 (eSocial SST)

Code: gilberto-desenv · Fonte: erp_documento_vertical compliance V6 (M6, M15, D.2, D.4, D.7) · **Só desenho, sem código. Atualizado com as decisões do CEO de 08/10. Para revisão do Eng. Chefe.**
Via revisada (`revisao-eng-chefe`) em todas as PRs: dado de saúde, LGPD e eSocial.

## 0. Estado real (RD-26, conferido em 08/10)
- Banco: **não existe** nenhuma tabela de ASO, PCMSO, exame, vacina, atestado, S-22xx, procuração. Existe só `erp_certificados_a1` (certificado A1 da NF-e, reaproveitável), `compliance_funcionarios`, setores, EPI, pausas NR-36.
- Tela `/dashboard/compliance/esocial` é `ModuloEmConstrucao` (sem dado) — pode ser substituída sem regressão.
- Dependências do blueprint: E4 depende de E1 (estrutura única: setor/GHE/função CBO); E5 depende de E2 (riscos/PGR → S-2240) e E4 (→ S-2220). **Hoje E1/E2 não estão no ar**: E4 só começa com o cadastro de função/setor atual (`compliance_funcionarios` + setores) e é ligado ao GHE quando E1 entrar.

## 0.1 Princípio obrigatório — LEGISLAÇÃO COMO DADO (Parte E.1 do documento vivo compliance, CEO 08/10)
Nada de lei fixo no código. Tudo que depende de norma vem de **base legal versionada**:
- `ehs_base_legal` (norma, fonte, artigo, país, vigência início/fim, versão, status rascunho→prévia→ativa→revogada) e `ehs_base_legal_item` (NR-07: exames e periodicidades por risco; NR-15: limites; Anexo IV; prazos legais; tabelas e leiautes do eSocial, versionados por versão do leiaute).
- Cada cálculo/emissão (convocação, periodicidade de exame, ASO, evento eSocial) **grava a versão da base legal usada** (`base_legal_versao_id`), para auditoria e reprodução.
- Mudança de lei = **nova versão**, com **prévia de impacto** (quantos funcionários/convocações/eventos mudam) antes de ativar; ativação com aprovação registrada; versão anterior preservada.
- Fonte citada em cada item (RD-72); leiautes do eSocial (S-1.3/NT vigente) entram como dado versionado, não como constante.
- Gate novo exige que as tabelas de cálculo referenciem a versão da base legal.
**E4.0 (primeira PR da onda) = base legal versionada** (sem depender de setor/função).

## 0.2 Decisões do CEO (08/10) incorporadas
1. **Médico RT do parceiro em definição:** RT é cadastro configurável (`ehs_saude_rt`: nome, CRM/UF, assinatura eletrônica, vigência, ativo). **Assinatura de PCMSO/ASO fica BLOQUEADA**, com mensagem clara ("Cadastre o médico responsável técnico para assinar"), enquanto não houver RT ativo. Rascunho e conferência continuam liberados.
2. **IA de leitura de laudo** = o provedor de IA já usado pela plataforma, com contrato de proteção de dados (DPA, sem retenção/treino) e **SEMPRE com conferência humana** (nada grava como resultado sem conferência).
3. **Ordem:** E1 (estrutura, gilberto-chamados) antes do código da E4. Pode-se codificar já só o que **não depende de setor/função**: base legal, RT, prontuário/sigilo (+ log de acesso, papéis).
4. **eSocial:** primeiro só em **produção restrita**.
5. **Guarda de 20 anos**; **DPO a definir** → campo configurável (`ehs_config_dpo`), sem nome fixo.
6. **Testes** com cópia anonimizada da Frioeste (nunca dado real em teste).
Meta de produto (CEO): resultado épico e ultra premium, fácil de usar e 100% conforme a lei.

## 1. E4 — Saúde ocupacional
Princípios: papel zero (D.4); sigilo médico por **coluna/RPC**, nunca por view aberta; `security_invoker=true` em toda view; RLS por empresa; REVOKE anon; agregados com mínimo de 5 pessoas.

### Tabelas novas (aditivas, prefixo `ehs_saude_`)
| Tabela | Conteúdo | Observação |
|---|---|---|
| `ehs_saude_pcmso` / `_pcmso_matriz` | PCMSO por empresa/estabelecimento; matriz risco→exame→periodicidade por função | assinatura do médico coordenador (CRM) |
| `ehs_saude_convocacao` | periódico, admissional, retorno, mudança de função, demissional; gerada por gatilho | alimenta agenda |
| `ehs_saude_aso` | tipo, data, validade, apto/inapto/apto c/ restrição, médico, assinatura eletrônica, hash/QR | **RH vê só apto/inapto + validade** |
| `ehs_saude_exame` | exame, laudo (arquivo), resultado estruturado, `alterado bool`, origem (IA/manual), conferido_por | resultado clínico só papel médico |
| `ehs_saude_exame_ia` | fila de leitura do laudo (extração, confiança, campos), conferência humana obrigatória | IA nunca grava direto: sempre "pendente de conferência" |
| `ehs_saude_agenda` | agendamento (WhatsApp), clínica, status, lembretes | reutiliza canal WhatsApp existente |
| `ehs_saude_prontuario` | evolução clínica, CID, atestados, nexo | acesso só `medico_trabalho`/`enfermagem`; log de leitura; guarda 20 anos |
| `ehs_saude_vacina`, `ehs_saude_atmb` (fases 30/90/180), `ehs_saude_atendimento_enf` | conforme M6 | |
| `ehs_saude_acesso_log` | quem leu prontuário/exame e quando | append-only |

### Papéis (D.4 "papel zero" = ninguém herda acesso por padrão)
Novos papéis de dado de saúde: `ehs_medico`, `ehs_enfermagem`, `ehs_sst_tecnico`, `ehs_rh_saude` (só apto/inapto). Admin/sócio **não** leem prontuário por herança (precisa de grant explícito). Parceiro de SST entra como prestador por empresa (modelo `prestadores` já existente).

### RPCs (SECURITY DEFINER, search_path fixo, guarda `auth.uid()` + empresa + papel)
`ehs_pcmso_gerar`, `ehs_convocacoes_gerar(empresa)`, `ehs_aso_emitir/assinar`, `ehs_exame_registrar`, `ehs_exame_ia_conferir`, `ehs_agenda_marcar/confirmar_whatsapp`, `ehs_saude_painel_rh` (só apto/inapto + vencimentos), `ehs_saude_agregado(setor|ghe)` (retorna vazio se n<5), `ehs_prontuario_ler` (grava log).

### Telas (rota nova `/dashboard/compliance/saude/*`, nada existente é movido)
Painel de vencimentos · Tela única de exames (upload→IA→conferência→resultado alterado gera alerta NR-07 ao médico) · ASO · Agenda · Prontuário (só papéis médicos) · Vacinas · ATMB · Enfermagem · PCMSO.

### Fatiamento em PRs (uma por vez, via revisada)
E4.0 base legal versionada + RT configurável + DPO configurável (sem dependência de setor/função) · E4.1 base: papéis + tabelas PCMSO/matriz/convocação/ASO + painel RH apto/inapto · E4.2 exames + IA + alerta resultado alterado · E4.3 agenda WhatsApp · E4.4 prontuário + sigilo + log + nexo (pode antecipar: não depende de setor/função) · E4.5 vacinas/ATMB/enfermagem · E4.6 agregados (n≥5).

## 2. E5 — eSocial SST
### Tabelas
`ehs_esocial_evento` (tipo S-2210/2220/2221/2240, payload XML, status rascunho→validado→enviado→aceito/erro, recibo, lote), `ehs_esocial_validacao` (regras e mensagens em linguagem simples), `ehs_esocial_procuracao`, uso de `erp_certificados_a1` para assinatura (cofre já existente; sem expor a chave).
### Geração
- S-2220 ← `ehs_saude_aso`/`exame` (E4) · S-2240 ← inventário de riscos por função/GHE (E2) · S-2210 ← CAT/incidentes (E7; até lá, cadastro manual de CAT) · S-2221 ← toxicológico.
- **Auditoria pré-envio**: cada regra do leiaute vira checagem com texto simples ("Falta o CBO da função do João"), com link para corrigir. Painel de pendências com prazo legal.
- Envio ao ambiente de **produção restrita** primeiro; produção só após homologação com cliente piloto. Retificação/exclusão.
### Fiscal/legal (RD-59/RD-72/RD-92 por analogia)
Leiaute e tabelas oficiais (S-1.3 / NT vigente) precisam ser citados e versionados; **nenhum envio real sem aprovação do CEO e do RT**. Conciliação com S-2200 depende de a folha/admissão já enviar S-2200 (não há hoje — a tela diz "em construção").
### PRs
E5.0 leiautes/tabelas eSocial como dado versionado (base legal) · E5.1 modelo + validador + S-2220 (rascunho, sem envio) · E5.2 S-2240 · E5.3 S-2210/S-2221 · E5.4 assinatura/envio restrita + recibo · E5.5 procurações/certificados + painel de prazos · E5.6 retificação.

## 3. Regras D.2 / D.4 (como serão cumpridas)
- **Não regressão:** nada em uso é removido/renomeado; só tabelas/rotas novas. Antes de cada PR: regressão das pausas NR-36 e telas EPI/funcionários/setores/prestadores com usuário real da Frioeste (e Tryo/R.R) — teste de aceitação em spec nova.
- **Papel zero:** assinatura eletrônica com evidência; ASO/PCMSO gerados pelo sistema com QR; upload de papel legado só via fila de IA + conferência.
- Dois testes (RD-83) por PR, rodados 2×; gate novo em `scripts/gates/` exigindo `security_invoker=true` e REVOKE anon nas tabelas `ehs_saude_*`.

## 4. Tamanho (estimativa)
E4 ≈ 7 PRs (3–4 semanas de Code) · E5 ≈ 6 PRs (3 semanas), depois de DRE e Canal PS.

## 5. Decisões — status (1 a 6 respondidas pelo CEO em 08/10, ver 0.2)
Ainda em aberto: nome/CRM do médico RT e do DPO (cadastro, não bloqueia o código); procuração/certificado por cliente (E5.5).

### Pendências originais (histórico)
1. Parceiro de SST/médico coordenador: nome, CRM, quem assina PCMSO/ASO no sistema.
2. Provedor de IA para leitura de laudo (dado de saúde → LGPD art. 11: base legal, contrato/DPA, sem retenção pelo provedor).
3. E4 antes de E1/E2? Proposta: sim, usando setor/função atuais, com migração para GHE quando E1 entrar.
4. eSocial: quem detém procuração/certificado por cliente; liberar envio real só em produção restrita até aceite.
5. Retenção/guarda de 20 anos e política de anonimização (aprovação do DPO).
6. Dados reais da Frioeste (201 func.) como prova: autorização para uso do ambiente de testes com cópia anonimizada.
