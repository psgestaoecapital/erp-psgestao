# Sprint C1 — Setup do Worker de Validação Automática

Worker assíncrono que processa a fila de consultas (`compliance_consultas`) chamando os portais governamentais.

## 1. Gerar token

```bash
openssl rand -hex 32
```

Guarde o resultado — vai ser usado nos passos 2 e 3.

## 2. Cadastrar no Vercel

Vercel Dashboard → `erp-psgestao` → Settings → Environment Variables

- **Name:** `COMPLIANCE_WORKER_TOKEN`
- **Value:** `<token gerado>`
- **Environments:** Production, Preview, Development

Faça redeploy depois (`vercel deploy --prod` ou push em main).

## 3. Configurar cron-job.org

- **URL:** `https://erp-psgestao.vercel.app/api/compliance/worker`
- **Method:** `POST`
- **Headers:**
  - `Authorization: Bearer <token>`
- **Schedule:** a cada 5 minutos
- **Request timeout:** 60s
- **Notification on failure:** habilitado

> O worker autentica via header `Authorization: Bearer <token>` (compatível com o `withAuth` simples da rota). Caso o cron exija outro formato (`x-worker-token`), ajuste a rota.

## 4. Teste manual

```bash
curl -X POST https://erp-psgestao.vercel.app/api/compliance/worker \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"
```

Resposta esperada (fila vazia):

```json
{ "ok": true, "processados": 0, "resultados": [] }
```

Resposta com fila:

```json
{
  "ok": true,
  "processados": 1,
  "resultados": [
    { "id": "uuid", "status_final": "sucesso", "erro_mensagem": null }
  ]
}
```

## 5. Status atual dos provedores

| Provedor | Status | Observação |
|---|---|---|
| `cndt_tst` | **Funcional** | Scrape do portal TST com extração de número, emissão e validade |
| `negativa_federal` (RFB) | `captcha_required` | reCAPTCHA bloqueia scrape direto |
| `negativa_fgts` (Caixa) | `captcha_required` | CAPTCHA imagem bloqueia scrape direto |

RFB e FGTS aguardam integração via API licenciada (Serpro / Serasa / gov.br Conecta+) — Sprint C1.5. A arquitetura é polimórfica: novos provedores entram via `INSERT` em `compliance_provedores_consulta` + branch no `switch` do worker.

## 6. Troubleshooting

- **HTTP 401 do worker** → token diferente do `COMPLIANCE_WORKER_TOKEN` no Vercel.
- **HTTP 500 com `COMPLIANCE_WORKER_TOKEN não configurado`** → env var ausente; faça passos 2 e redeploy.
- **Fila não diminui** → confira `compliance_consultas WHERE status='pendente'`. Se há linhas mas o cron não está rodando, o cron-job.org provavelmente está pausado.
- **CNDT volta `unknown_layout`** → o TST mudou o HTML. `raw_html` está salvo (truncado 64KB) — abrir um issue para ajustar o parser.
