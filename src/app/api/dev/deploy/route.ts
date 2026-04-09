import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const OWNER = "psgestaoecapital";
const REPO = "erp-psgestao";
const BRANCH = "main";

async function githubAPI(path: string, method: string = "GET", body?: any) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN não configurado no Vercel");
  
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  const data = await res.json();
  if (!res.ok && res.status !== 404) throw new Error(data.message || `GitHub API error ${res.status}`);
  return { data, status: res.status };
}

// GET: test connection
export async function GET() {
  try {
    const { data } = await githubAPI("");
    return NextResponse.json({ 
      success: true, 
      repo: data.full_name, 
      default_branch: data.default_branch,
      private: data.private,
      message: "GitHub connection OK" 
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST: create or update file(s)
export async function POST(req: NextRequest) {
  try {
    const { files, commit_message } = await req.json();
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "Envie { files: [{ path, content }], commit_message }" }, { status: 400 });
    }

    const results: { path: string; status: string; error?: string }[] = [];

    for (const file of files) {
      const { path, content } = file;
      if (!path || !content) {
        results.push({ path: path || "unknown", status: "erro", error: "path e content obrigatórios" });
        continue;
      }

      try {
        // Get current file SHA (needed for updates)
        let sha: string | undefined;
        const { data: existing, status } = await githubAPI(`contents/${path}?ref=${BRANCH}`);
        if (status === 200 && existing.sha) {
          sha = existing.sha;
        }

        // Create or update file
        const { data: result } = await githubAPI(`contents/${path}`, "PUT", {
          message: commit_message || `deploy: ${path}`,
          content: Buffer.from(content).toString("base64"),
          branch: BRANCH,
          ...(sha ? { sha } : {}),
        });

        results.push({ path, status: sha ? "atualizado" : "criado" });
      } catch (e: any) {
        results.push({ path, status: "erro", error: e.message });
      }
    }

    const ok = results.filter(r => r.status !== "erro").length;
    const errors = results.filter(r => r.status === "erro").length;

    return NextResponse.json({
      success: errors === 0,
      message: `${ok} arquivo(s) deployado(s), ${errors} erro(s)`,
      results,
      deploy: "Vercel irá rebuildar automaticamente em ~1-2 minutos",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
