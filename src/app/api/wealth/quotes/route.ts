import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withAuth } from "@/lib/withAuth";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const supabase = supabaseAdmin;

// Yahoo Finance quote URL
const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

interface QuoteResult {
  ticker: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  name: string | null;
  error?: string;
}

async function fetchYahooQuote(ticker: string): Promise<QuoteResult> {
  try {
    // Brazilian tickers need .SA suffix for Yahoo Finance
    const yahooTicker = ticker.includes(".") ? ticker : `${ticker}.SA`;
    const url = `${YAHOO_URL}${yahooTicker}?interval=1d&range=2d`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { ticker, price: null, previousClose: null, change: null, changePercent: null, volume: null, marketCap: null, name: null, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      return { ticker, price: null, previousClose: null, change: null, changePercent: null, volume: null, marketCap: null, name: null, error: "No data" };
    }

    const meta = result.meta;
    const price = meta?.regularMarketPrice || null;
    const previousClose = meta?.chartPreviousClose || meta?.previousClose || null;
    const change = price && previousClose ? price - previousClose : null;
    const changePercent = price && previousClose ? ((price / previousClose) - 1) * 100 : null;
    const volume = meta?.regularMarketVolume || null;

    return {
      ticker,
      price,
      previousClose,
      change,
      changePercent,
      volume,
      marketCap: null,
      name: meta?.shortName || meta?.longName || null,
    };
  } catch (e: any) {
    return { ticker, price: null, previousClose: null, change: null, changePercent: null, volume: null, marketCap: null, name: null, error: e.message };
  }
}

async function handlerPost(req: NextRequest, _user: { userId: string; userEmail?: string }) {
  try {
    const body = await req.json();
    const { tickers, update_db } = body;

    // If no tickers provided, fetch all assets with active positions
    let tickerList: string[] = tickers || [];

    if (tickerList.length === 0) {
      const { data: assets } = await supabase
        .from("wealth_assets")
        .select("ticker")
        .eq("ativo", true);
      tickerList = (assets || []).map((a: any) => a.ticker);
    }

    if (tickerList.length === 0) {
      return NextResponse.json({ success: true, data: [], message: "No tickers to quote" });
    }

    // Fetch quotes in parallel (batches of 10)
    const results: QuoteResult[] = [];
    for (let i = 0; i < tickerList.length; i += 10) {
      const batch = tickerList.slice(i, i + 10);
      const batchResults = await Promise.all(batch.map(fetchYahooQuote));
      results.push(...batchResults);
    }

    // Update database if requested
    if (update_db !== false) {
      const now = new Date().toISOString();
      for (const q of results) {
        if (q.price !== null) {
          await supabase
            .from("wealth_assets")
            .update({
              cotacao_anterior: q.previousClose,
              cotacao_atual: q.price,
              variacao_dia: q.changePercent,
              volume_dia: q.volume,
              cotacao_atualizada_em: now,
            })
            .eq("ticker", q.ticker);
        }
      }

      // Recalculate positions
      const { data: positions } = await supabase
        .from("wealth_positions")
        .select("id, quantidade, preco_medio, asset_id, wealth_assets(cotacao_atual)")
        .gt("quantidade", 0);

      if (positions) {
        for (const pos of positions) {
          const asset = (pos as any).wealth_assets;
          const cotacao = asset?.cotacao_atual;
          if (cotacao && cotacao > 0) {
            const valorAtual = pos.quantidade * cotacao;
            const custo = pos.quantidade * pos.preco_medio;
            const retornoRS = valorAtual - custo;
            const retornoP = custo > 0 ? ((valorAtual / custo) - 1) * 100 : 0;

            await supabase
              .from("wealth_positions")
              .update({
                valor_atual: valorAtual,
                retorno_financeiro: retornoRS,
                retorno_percentual: retornoP,
                updated_at: now,
              })
              .eq("id", pos.id);
          }
        }
      }
    }

    const successCount = results.filter(r => r.price !== null).length;
    const errorCount = results.filter(r => r.price === null).length;

    return NextResponse.json({
      success: true,
      data: results,
      summary: {
        total: results.length,
        success: successCount,
        errors: errorCount,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET: Simple quote for specific tickers via query param
async function handlerGet(req: NextRequest, _user: { userId: string; userEmail?: string }) {
  const url = new URL(req.url);
  const tickers = url.searchParams.get("tickers")?.split(",").map(t => t.trim().toUpperCase()) || [];

  if (tickers.length === 0) {
    return NextResponse.json({ error: "Provide ?tickers=PETR4,VALE3,HGLG11" }, { status: 400 });
  }

  const results = await Promise.all(tickers.map(fetchYahooQuote));

  return NextResponse.json({ success: true, data: results });
}

export const GET = withAuth(handlerGet);
export const POST = withAuth(handlerPost);
