/**
 * ─────────────────────────────────────────────────────────────────────────────
 * KNOWLEDGE SERVICE - Processamento avançado do Cérebro
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * Funcionalidades:
 * - Chunking por H2 headers
 * - Formatação XML para context injection
 * - Guardrails anti-invenção
 * - Geração de resumos por arquivo
 */

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface KnowledgeChunk {
    topic: string;
    content: string;
    order: number;
}

export interface KnowledgeFileSummary {
    topic: string;
    summary: string;
    keywords: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHUNKING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Divide texto Markdown por headers H2 (##)
 * 
 * @param text - Texto bruto em Markdown
 * @returns Array de chunks com topic e content
 * 
 * @example
 * const text = `
 * ## Preços
 * Nossos preços variam...
 * 
 * ## Sobre
 * Somos uma empresa...
 * `;
 * 
 * splitMarkdownByHeaders(text);
 * // [{ topic: "Preços", content: "Nossos preços variam...", order: 0 }, ...]
 */
export function splitMarkdownByHeaders(text: string): KnowledgeChunk[] {
    // Normalizar quebras de linha
    const normalizedText = text.replace(/\r\n/g, '\n');

    // Dividir por H2 (procurando linhas que começam com ##)
    const sections = normalizedText.split(/(?=^## )/gm);
    const chunks: KnowledgeChunk[] = [];

    sections.forEach((section, index) => {
        const trimmed = section.trim();
        if (!trimmed) return;

        // Extrair título do H2
        const headerMatch = trimmed.match(/^## (.+)$/m);
        const topic = headerMatch?.[1]?.trim() ?? `Seção ${index + 1}`;

        // Remover o header do conteúdo
        const content = trimmed.replace(/^## .+$/m, '').trim();

        if (content) {
            chunks.push({ topic, content, order: index });
        }
    });

    return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT FORMATTING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formata contexto RAG com tags XML para clara delimitação
 * 
 * @param chunks - Array de strings de contexto
 * @returns String formatada com XML tags
 */
export function formatContextWithXml(chunks: string[]): string {
    if (chunks.length === 0) return '';

    const formattedChunks = chunks.map(chunk =>
        `<knowledge>\n${chunk}\n</knowledge>`
    ).join('\n\n');

    return `<context>\n${formattedChunks}\n</context>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARDRAILS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Instruções de segurança para o System Prompt
 * Previne que o agente invente informações fora do contexto
 */
export const KNOWLEDGE_GUARDRAILS = `
# GUARDRAILS DE CONHECIMENTO

⚠️ REGRA CRÍTICA DE VERACIDADE:

1. Você SOMENTE pode afirmar informações que estejam DENTRO das tags <context>.

2. Se uma informação NÃO estiver no <context>, você DEVE responder:
   "Não tenho essa informação na minha base de conhecimento. Posso conectar você com um especialista."

3. NUNCA invente:
   - Preços ou valores
   - Prazos ou datas
   - Funcionalidades ou benefícios não mencionados
   - Estatísticas ou números

4. Quando em dúvida:
   - Pergunte para esclarecer
   - Ofereça conectar com um humano
   - Admita que não sabe

5. É MELHOR dizer "não sei" do que inventar uma resposta errada.
`;

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gera resumo de um item de conhecimento usando IA
 * 
 * @param topic - Título/tópico do conhecimento
 * @param content - Conteúdo completo
 * @returns Resumo curto (1-2 linhas)
 */
export async function generateKnowledgeSummary(
    topic: string,
    content: string
): Promise<string> {
    try {
        const { text } = await generateText({
            model: openai('gpt-4o-mini'),
            prompt: `Resuma em 1-2 linhas curtas o seguinte conteúdo de base de conhecimento.

TÓPICO: ${topic}

CONTEÚDO:
${content.substring(0, 2000)}

Seu resumo deve:
- Dizer O QUE contém (ex: "Tabela de preços, formas de pagamento")
- Indicar QUANDO consultar (ex: "→ Use quando o lead perguntar sobre valores")

Responda APENAS com o resumo, sem títulos ou formatação extra.`,
            maxTokens: 100,
            temperature: 0.3,
        });

        return text.trim();
    } catch (error) {
        console.error('[KnowledgeService] Error generating summary:', error);
        return `Contém informações sobre ${topic}.`;
    }
}

/**
 * Gera overview de toda a base de conhecimento para injeção no prompt
 * 
 * @param items - Array de itens de conhecimento
 * @returns String formatada com resumos de cada arquivo
 */
export async function generateKnowledgeOverview(
    items: Array<{ topic: string; content: string }>
): Promise<string> {
    if (items.length === 0) {
        return 'Nenhuma base de conhecimento configurada.';
    }

    const summaries = await Promise.all(
        items.map(async (item) => ({
            topic: item.topic,
            summary: await generateKnowledgeSummary(item.topic, item.content),
        }))
    );

    const formattedOverview = summaries
        .map((s) => `📁 **${s.topic}**\n${s.summary}`)
        .join('\n\n');

    return `## BASE DE CONHECIMENTO DISPONÍVEL

${formattedOverview}

---
Use a sintaxe @nome-do-topico para consultar conteúdo específico durante a conversa.`;
}

/**
 * Extrai keywords de um texto para busca
 */
export function extractKeywords(text: string): string[] {
    // Remove markdown syntax
    const cleanText = text
        .replace(/[#*_`~\[\](){}]/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase();

    // Portuguese stopwords
    const stopwords = new Set([
        'de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'é',
        'com', 'não', 'uma', 'os', 'no', 'se', 'na', 'por', 'mais', 'as',
        'dos', 'como', 'mas', 'foi', 'ao', 'ele', 'das', 'tem', 'à', 'seu',
        'sua', 'ou', 'ser', 'quando', 'muito', 'há', 'nos', 'já', 'está',
        'eu', 'também', 'só', 'pelo', 'pela', 'até', 'isso', 'ela', 'entre',
    ]);

    // Extract words with 3+ characters that aren't stopwords
    const words = cleanText
        .split(' ')
        .filter((word) => word.length >= 3 && !stopwords.has(word));

    // Return unique keywords (up to 20)
    return [...new Set(words)].slice(0, 20);
}
