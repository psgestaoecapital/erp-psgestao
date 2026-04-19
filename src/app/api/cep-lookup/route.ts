import { NextRequest, NextResponse } from 'next/server';

// Consulta CEP via ViaCEP (gratuita, oficial dos Correios)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const cep = (searchParams.get('cep') || '').replace(/\D/g, '');
  
  if (cep.length !== 8) {
    return NextResponse.json({ error: 'CEP inválido. Informe 8 dígitos.' }, { status: 400 });
  }
  
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      next: { revalidate: 86400 },
    });
    
    if (!r.ok) {
      return NextResponse.json({ error: 'CEP não encontrado.' }, { status: 404 });
    }
    
    const d = await r.json();
    
    if (d.erro) {
      return NextResponse.json({ error: 'CEP não encontrado.' }, { status: 404 });
    }
    
    return NextResponse.json({
      cep: d.cep || '',
      logradouro: d.logradouro || '',
      complemento: d.complemento || '',
      bairro: d.bairro || '',
      cidade: d.localidade || '',
      uf: d.uf || '',
      ibge: d.ibge || '',
      ddd: d.ddd || '',
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Erro ao consultar: ' + e.message }, { status: 500 });
  }
}
