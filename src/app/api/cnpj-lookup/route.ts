import { NextRequest, NextResponse } from 'next/server';

// Consulta CNPJ via BrasilAPI (gratuita, sem limite)
// Fallback: ReceitaWS (3 consultas/minuto sem chave)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const cnpj = (searchParams.get('cnpj') || '').replace(/\D/g, '');
  
  if (cnpj.length !== 14) {
    return NextResponse.json({ error: 'CNPJ inválido. Informe 14 dígitos.' }, { status: 400 });
  }
  
  try {
    // Tentativa 1: BrasilAPI
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { 'User-Agent': 'PS-Gestao-ERP/1.0' },
      next: { revalidate: 3600 },
    });
    
    if (r.ok) {
      const d = await r.json();
      return NextResponse.json({
        cnpj: d.cnpj,
        razao_social: d.razao_social || '',
        nome_fantasia: d.nome_fantasia || d.razao_social || '',
        situacao_cadastral: d.descricao_situacao_cadastral || '',
        data_abertura: d.data_inicio_atividade || null,
        capital_social: d.capital_social ? parseFloat(d.capital_social) : 0,
        porte: d.porte || '',
        natureza_juridica: d.natureza_juridica || '',
        atividade_principal: d.cnae_fiscal_descricao || '',
        cnae: d.cnae_fiscal ? String(d.cnae_fiscal) : '',
        logradouro: [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' '),
        numero: d.numero || '',
        complemento: d.complemento || '',
        bairro: d.bairro || '',
        cidade: d.municipio || '',
        uf: d.uf || '',
        cep: d.cep ? String(d.cep).padStart(8, '0').replace(/(\d{5})(\d{3})/, '$1-$2') : '',
        telefone: d.ddd_telefone_1 ? `(${String(d.ddd_telefone_1).slice(0, 2)}) ${String(d.ddd_telefone_1).slice(2)}` : '',
        email: d.email || '',
        source: 'brasilapi',
      });
    }
    
    // Tentativa 2: ReceitaWS fallback
    const r2 = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`, {
      headers: { 'User-Agent': 'PS-Gestao-ERP/1.0' },
    });
    
    if (r2.ok) {
      const d = await r2.json();
      if (d.status === 'ERROR') {
        return NextResponse.json({ error: d.message || 'CNPJ não encontrado.' }, { status: 404 });
      }
      return NextResponse.json({
        cnpj: d.cnpj,
        razao_social: d.nome || '',
        nome_fantasia: d.fantasia || d.nome || '',
        situacao_cadastral: d.situacao || '',
        data_abertura: d.abertura ? d.abertura.split('/').reverse().join('-') : null,
        capital_social: d.capital_social ? parseFloat(d.capital_social) : 0,
        porte: d.porte || '',
        natureza_juridica: d.natureza_juridica || '',
        atividade_principal: d.atividade_principal?.[0]?.text || '',
        cnae: d.atividade_principal?.[0]?.code || '',
        logradouro: d.logradouro || '',
        numero: d.numero || '',
        complemento: d.complemento || '',
        bairro: d.bairro || '',
        cidade: d.municipio || '',
        uf: d.uf || '',
        cep: d.cep || '',
        telefone: d.telefone || '',
        email: d.email || '',
        source: 'receitaws',
      });
    }
    
    return NextResponse.json({ error: 'CNPJ não encontrado nos serviços.' }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ error: 'Erro ao consultar: ' + e.message }, { status: 500 });
  }
}
