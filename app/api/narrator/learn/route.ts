import { NextResponse } from "next/server"

type LearnArticle = {
  title: string
  summary: string
  url: string
  category: string
}

let cached: { articles: LearnArticle[]; fetchedAt: number } | null = null
const CACHE_TTL = 3600000 // 1 hour

export async function GET() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return NextResponse.json({ articles: cached.articles, cached: true })
  }

  try {
    const res = await fetch("https://jumper.xyz/pt/learn?tab=all", {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Arcflow/1.0" },
    })
    const html = await res.text()

    const articles: LearnArticle[] = []
    const titleRegex = /<h[23][^>]*>([^<]+)<\/h[23]>/gi
    const linkRegex = /<a[^>]*href="(\/[^"]*)"[^>]*>([^<]+)<\/a>/gi
    const pRegex = /<p[^>]*>([^<]+)<\/p>/gi

    const titles: string[] = []
    let m: RegExpExecArray | null
    while ((m = titleRegex.exec(html)) !== null) {
      titles.push(m[1].trim())
    }

    const links: { url: string; text: string }[] = []
    while ((m = linkRegex.exec(html)) !== null) {
      const url = m[1].startsWith("/") ? `https://jumper.xyz${m[1]}` : m[1]
      if (url.includes("/learn/")) links.push({ url, text: m[2].trim() })
    }

    const paragraphs: string[] = []
    while ((m = pRegex.exec(html)) !== null) {
      const text = m[1].trim()
      if (text.length > 30 && text.length < 300) paragraphs.push(text)
    }

    const categories = ["DeFi", "Cross-chain", "Bridges", "Segurança", "Tokens", "NFTs", "Gas", "Trading"]
    for (let i = 0; i < Math.min(titles.length, 10); i++) {
      const matchedLink = links.find(l => l.text.includes(titles[i].slice(0, 20)) || titles[i].includes(l.text.slice(0, 20)))
      const cat = categories.find(c => titles[i].toLowerCase().includes(c.toLowerCase())) ?? "Geral"
      articles.push({
        title: titles[i],
        summary: paragraphs[i] ?? `Artigo sobre ${titles[i].toLowerCase()}.`,
        url: matchedLink?.url ?? `https://jumper.xyz/pt/learn?q=${encodeURIComponent(titles[i])}`,
        category: cat,
      })
    }

    if (articles.length === 0) {
      articles.push({
        title: "Guia Jumper Learn",
        summary: "Acesse jumper.xyz/pt/learn para guias completos sobre bridges cross-chain, DeFi e trading.",
        url: "https://jumper.xyz/pt/learn",
        category: "Geral",
      })
    }

    cached = { articles, fetchedAt: Date.now() }
    return NextResponse.json({ articles, cached: false })
  } catch (e) {
    if (cached) return NextResponse.json({ articles: cached.articles, cached: true, error: "usaodo cache" })
    return NextResponse.json({
      articles: [
        {
          title: "Jumper Learn",
          summary: "Plataforma de aprendizado sobre bridges, DeFi e cross-chain. Acesse jumper.xyz/pt/learn.",
          url: "https://jumper.xyz/pt/learn",
          category: "Geral",
        },
      ],
      error: e instanceof Error ? e.message : "erro ao buscar",
    })
  }
}
