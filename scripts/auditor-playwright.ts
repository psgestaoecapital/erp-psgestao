// Auditor Camada 1 · Playwright DOM real (CEO 26/05/2026)
// Roda 4x/dia via GitHub Actions · enumera DOM React após render e
// detecta links que levam a 404. Persiste em gold_dom_enumerations e
// dispara erp_truth_alerts crítico se houver links_404 > 0.

import { chromium, Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

interface LinkEncontrado {
  href: string;
  texto: string;
  status: number;
  tag: string;
}

interface EnumeracaoResult {
  rota: string;
  links_encontrados_dom: LinkEncontrado[];
  links_total: number;
  links_200: number;
  links_404: number;
  links_outros: number;
  executado_em: string;
  duracao_ms: number;
}

const BASE_URL = process.env.PROD_BASE_URL || 'https://erp-psgestao.vercel.app';
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  process.exit(1);
}

async function enumerarRota(browser: Browser, rota: string): Promise<EnumeracaoResult> {
  const inicio = Date.now();
  const page = await browser.newPage();

  try {
    await page.goto(BASE_URL + rota, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(2000);

    const links = await page.evaluate(() => {
      const result: Array<{ href: string; texto: string; tag: string }> = [];
      document.querySelectorAll('a[href]').forEach((el) => {
        const href = el.getAttribute('href');
        if (href && href.startsWith('/dashboard/')) {
          result.push({
            href,
            texto: (el.textContent ?? '').trim().substring(0, 100),
            tag: 'a',
          });
        }
      });
      return result;
    });

    const linksComStatus: LinkEncontrado[] = [];
    const seen = new Set<string>();

    for (const link of links) {
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      try {
        const resp = await fetch(BASE_URL + link.href, { method: 'HEAD', redirect: 'manual' });
        linksComStatus.push({ ...link, status: resp.status });
      } catch {
        linksComStatus.push({ ...link, status: 0 });
      }
    }

    const links_200 = linksComStatus.filter((l) => l.status === 200).length;
    const links_404 = linksComStatus.filter((l) => l.status === 404).length;
    const links_outros = linksComStatus.length - links_200 - links_404;

    return {
      rota,
      links_encontrados_dom: linksComStatus,
      links_total: linksComStatus.length,
      links_200,
      links_404,
      links_outros,
      executado_em: new Date().toISOString(),
      duracao_ms: Date.now() - inicio,
    };
  } finally {
    await page.close();
  }
}

async function salvarSupabase(result: EnumeracaoResult): Promise<void> {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/gold_dom_enumerations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      rota: result.rota,
      links_total: result.links_total,
      links_200: result.links_200,
      links_404: result.links_404,
      enumeracao_json: result,
      fonte: 'github_actions',
      executado_em: result.executado_em,
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error(`    ⚠ insert gold_dom_enumerations falhou: ${resp.status} ${txt.slice(0, 200)}`);
  }

  if (result.links_404 > 0) {
    const links404 = result.links_encontrados_dom.filter((l) => l.status === 404);
    const lista = links404.map((l) => l.href).join(', ');

    const alertResp = await fetch(`${SUPABASE_URL}/rest/v1/erp_truth_alerts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        area: 'gestao_empresarial',
        severity: 'critical',
        tipo_divergencia: 'camada1_links_404_dom_real',
        mensagem: `Rota ${result.rota} tem ${result.links_404} botões que levam a 404 (Playwright DOM): ${lista}`,
        valor_esperado: '0',
        valor_encontrado: String(result.links_404),
        recomendacao: 'Corrigir hrefs no código frontend',
        status: 'novo',
        detected_at: result.executado_em,
      }),
    });

    if (!alertResp.ok) {
      const txt = await alertResp.text();
      console.error(`    ⚠ insert erp_truth_alerts falhou: ${alertResp.status} ${txt.slice(0, 200)}`);
    }
  }
}

async function main(): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const rotasJson = fs.readFileSync(path.join(__dirname, 'auditor-rotas.json'), 'utf-8');
  const rotas: string[] = JSON.parse(rotasJson);

  console.log(`Auditor Playwright iniciando · ${rotas.length} rotas · base=${BASE_URL}`);

  const browser = await chromium.launch({ headless: true });
  let totalLinks404 = 0;

  for (const rota of rotas) {
    try {
      console.log(`  Enumerando ${rota}...`);
      const result = await enumerarRota(browser, rota);
      await salvarSupabase(result);
      console.log(`    OK ${result.links_total} links · ${result.links_200} 200 · ${result.links_404} 404 · ${result.duracao_ms}ms`);
      totalLinks404 += result.links_404;
    } catch (e) {
      console.error(`    ERR ${rota}: ${String(e).slice(0, 300)}`);
    }
  }

  await browser.close();

  console.log(`\nAuditor concluido · ${totalLinks404} links 404 detectados no total`);
  if (totalLinks404 > 0) {
    console.log('Alertas critical inseridos em erp_truth_alerts');
  }
}

main().catch((err) => {
  console.error('Auditor falhou:', err);
  process.exit(1);
});
