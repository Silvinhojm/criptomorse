type LearnArticle = {
  title: string
  summary: string
  url: string
  category: string
}

class JumperLearn {
  private articles: LearnArticle[] = []
  private lastFetch = 0
  private fetching = false
  private readonly TTL = 3600000

  private async fetchArticles(): Promise<LearnArticle[]> {
    try {
      const res = await fetch("/api/narrator/learn", {
        signal: AbortSignal.timeout(8000),
      })
      const body = await res.json()
      if (body.articles && body.articles.length > 0) {
        return body.articles as LearnArticle[]
      }
      return this.getDefaultArticles()
    } catch {
      return this.getDefaultArticles()
    }
  }

  private parseHtml(html: string): LearnArticle[] {
    const articles: LearnArticle[] = []
    const titleRegex = /<h[23][^>]*>([^<]+)<\/h[23]/gi
    const pRegex = /<p[^>]*>([^<]+)<\/p>/gi
    const linkRegex = /<a[^>]*href="(\/[^"]*learn\/[^"]*)"[^>]*>/gi

    const titles: string[] = []
    let m: RegExpExecArray | null
    while ((m = titleRegex.exec(html)) !== null) {
      titles.push(m[1].trim())
    }

    const links: string[] = []
    while ((m = linkRegex.exec(html)) !== null) {
      links.push(`https://jumper.xyz${m[1]}`)
    }

    const paragraphs: string[] = []
    while ((m = pRegex.exec(html)) !== null) {
      const t = m[1].trim()
      if (t.length > 30 && t.length < 300) paragraphs.push(t)
    }

    const categories = ["DeFi", "Cross-chain", "Bridges", "Segurança", "Tokens", "Gas", "Trading"]
    for (let i = 0; i < Math.min(titles.length, 15); i++) {
      const cat = categories.find(c => titles[i].toLowerCase().includes(c.toLowerCase())) ?? "Geral"
      articles.push({
        title: titles[i],
        summary: paragraphs[i] ?? `Aprenda sobre ${titles[i].toLowerCase()}.`,
        url: links[i] ?? "https://jumper.xyz/pt/learn",
        category: cat,
      })
    }
    return articles.length > 0 ? articles : this.getDefaultArticles()
  }

  private getDefaultArticles(): LearnArticle[] {
    return [
      { title: "O que são bridges?", summary: "Bridges conectam blockchains diferentes, permitindo transferir tokens entre redes como Polygon e Ethereum.", url: "https://jumper.xyz/pt/learn", category: "Bridges" },
      { title: "Cross-chain swaps", summary: "Swaps cross-chain permitem trocar tokens entre diferentes blockchains sem sair de uma interface.", url: "https://jumper.xyz/pt/learn", category: "Cross-chain" },
      { title: "Gas e taxas", summary: "Cada blockchain tem sua própria moeda para taxas (gas). Entenda como otimizar custos de transação.", url: "https://jumper.xyz/pt/learn", category: "Gas" },
      { title: "O que é DeFi?", summary: "Finanças descentralizadas (DeFi) são serviços financeiros sem intermediários, rodando em blockchains.", url: "https://jumper.xyz/pt/learn", category: "DeFi" },
      { title: "Stablecoins", summary: "Stablecoins são moedas digitais atreladas a ativos estáveis como o dólar (USDC, USDT, DAI).", url: "https://jumper.xyz/pt/learn", category: "Tokens" },
    ]
  }

  async refresh(): Promise<LearnArticle[]> {
    if (this.fetching) return this.articles
    this.fetching = true
    try {
      this.articles = await this.fetchArticles()
      this.lastFetch = Date.now()
    } finally {
      this.fetching = false
    }
    return this.articles
  }

  async getArticles(): Promise<LearnArticle[]> {
    if (Date.now() - this.lastFetch > this.TTL) {
      await this.refresh()
    }
    return this.articles
  }

  getCachedArticles(): LearnArticle[] {
    return this.articles
  }

  search(query: string): LearnArticle[] {
    const q = query.toLowerCase()
    return this.articles.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q)
    )
  }

  getKnowledge(limit = 3): string {
    const articles = this.articles.slice(0, limit)
    if (articles.length === 0) return "Nenhum conhecimento carregado ainda."
    return articles.map((a, i) =>
      `${i + 1}. ${a.title} (${a.category}): ${a.summary}`
    ).join("\n")
  }
}

export const jumperLearn = new JumperLearn()
export type { LearnArticle }
