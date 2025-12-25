/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MESSAGE MANAGER - Sistema de mensagens estruturado estilo LangChain
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * Gerencia o histórico de mensagens com:
 * - Tipos estruturados (System, Human, AI, Tool)
 * - Limite de mensagens
 * - Sumarização automática
 * - Formatação para LLM
 */

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS DE MENSAGEM
// ═══════════════════════════════════════════════════════════════════════════

export type MessageRole = 'system' | 'human' | 'ai' | 'tool';

export interface BaseMessage {
    id?: string;
    role: MessageRole;
    content: string;
    timestamp?: Date;
    metadata?: Record<string, unknown>;
}

export interface SystemMessage extends BaseMessage {
    role: 'system';
}

export interface HumanMessage extends BaseMessage {
    role: 'human';
}

export interface AIMessage extends BaseMessage {
    role: 'ai';
    toolCalls?: ToolCall[];
}

export interface ToolMessage extends BaseMessage {
    role: 'tool';
    toolCallId: string;
    toolName: string;
}

export interface ToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
}

export type Message = SystemMessage | HumanMessage | AIMessage | ToolMessage;

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE MANAGER CLASS
// ═══════════════════════════════════════════════════════════════════════════

export interface MessageManagerConfig {
    maxMessages?: number;           // Limite de mensagens antes de sumarizar
    maxTokens?: number;             // Limite de tokens estimado
    summarizationModel?: string;    // Modelo para sumarização
    keepSystemMessage?: boolean;    // Manter system message sempre
}

const DEFAULT_CONFIG: MessageManagerConfig = {
    maxMessages: 20,
    maxTokens: 8000,
    summarizationModel: 'gpt-4o-mini',
    keepSystemMessage: true,
};

export class MessageManager {
    private messages: Message[] = [];
    private summary: string | null = null;
    private config: MessageManagerConfig;

    constructor(config: Partial<MessageManagerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MÉTODOS PÚBLICOS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Adiciona uma mensagem ao histórico
     */
    addMessage(message: Message): void {
        message.id = message.id || this.generateId();
        message.timestamp = message.timestamp || new Date();
        this.messages.push(message);
    }

    /**
     * Adiciona mensagem do usuário (Human)
     */
    addHumanMessage(content: string, metadata?: Record<string, unknown>): void {
        this.addMessage({
            role: 'human',
            content,
            metadata,
        });
    }

    /**
     * Adiciona mensagem da IA
     */
    addAIMessage(content: string, toolCalls?: ToolCall[], metadata?: Record<string, unknown>): void {
        this.addMessage({
            role: 'ai',
            content,
            toolCalls,
            metadata,
        });
    }

    /**
     * Adiciona mensagem de resultado de tool
     */
    addToolMessage(content: string, toolCallId: string, toolName: string): void {
        this.addMessage({
            role: 'tool',
            content,
            toolCallId,
            toolName,
        });
    }

    /**
     * Define a mensagem de sistema
     */
    setSystemMessage(content: string): void {
        // Remove system message anterior se existir
        this.messages = this.messages.filter(m => m.role !== 'system');

        // Adiciona nova no início
        this.messages.unshift({
            role: 'system',
            content,
            timestamp: new Date(),
        });
    }

    /**
     * Retorna todas as mensagens
     */
    getMessages(): Message[] {
        return [...this.messages];
    }

    /**
     * Retorna mensagens formatadas para a API do OpenAI/Vercel AI
     */
    getFormattedMessages(): Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> {
        const formatted: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [];

        // Se tem summary, adiciona primeiro como contexto
        if (this.summary) {
            formatted.push({
                role: 'system',
                content: `[RESUMO DA CONVERSA ANTERIOR]\n${this.summary}\n[FIM DO RESUMO]`,
            });
        }

        for (const msg of this.messages) {
            switch (msg.role) {
                case 'system':
                    formatted.push({ role: 'system', content: msg.content });
                    break;
                case 'human':
                    formatted.push({ role: 'user', content: msg.content });
                    break;
                case 'ai':
                    formatted.push({ role: 'assistant', content: msg.content });
                    break;
                case 'tool':
                    formatted.push({
                        role: 'tool',
                        content: `[Tool: ${(msg as ToolMessage).toolName}]\n${msg.content}`,
                    });
                    break;
            }
        }

        return formatted;
    }

    /**
     * Estima o número de tokens no histórico
     */
    estimateTokens(): number {
        // Estimativa simples: 1 token ≈ 4 caracteres
        const totalChars = this.messages.reduce((sum, m) => sum + m.content.length, 0);
        return Math.ceil(totalChars / 4);
    }

    /**
     * Verifica se precisa sumarizar
     */
    needsSummarization(): boolean {
        const maxMessages = this.config.maxMessages || 20;
        const maxTokens = this.config.maxTokens || 8000;

        return this.messages.length > maxMessages || this.estimateTokens() > maxTokens;
    }

    /**
     * Sumariza mensagens antigas e mantém as recentes
     */
    async summarize(keepRecent: number = 5): Promise<void> {
        if (this.messages.length <= keepRecent) return;

        const systemMessage = this.messages.find(m => m.role === 'system');
        const messagesToSummarize = this.messages.filter(m => m.role !== 'system').slice(0, -keepRecent);
        const recentMessages = this.messages.filter(m => m.role !== 'system').slice(-keepRecent);

        if (messagesToSummarize.length === 0) return;

        // Formatar mensagens para sumarização
        const conversationText = messagesToSummarize
            .map(m => {
                const role = m.role === 'human' ? 'Usuário' : m.role === 'ai' ? 'Assistente' : 'Tool';
                return `${role}: ${m.content}`;
            })
            .join('\n');

        try {
            const { text: newSummary } = await generateText({
                model: openai(this.config.summarizationModel || 'gpt-4o-mini'),
                prompt: `Resuma a conversa abaixo em 2-3 frases, mantendo as informações importantes como nome do usuário, objetivos, e qualquer dado coletado (email, data, etc):

${this.summary ? `[Resumo anterior: ${this.summary}]\n` : ''}
${conversationText}

Resumo conciso:`,
                temperature: 0.3,
                maxTokens: 200,
            });

            this.summary = newSummary;

            // Reconstruir mensagens: system + recentes
            this.messages = [];
            if (systemMessage) {
                this.messages.push(systemMessage);
            }
            this.messages.push(...recentMessages);

            console.log('[MessageManager] ✅ Conversa sumarizada:', newSummary);
        } catch (error) {
            console.error('[MessageManager] ❌ Erro ao sumarizar:', error);
        }
    }

    /**
     * Limpa todas as mensagens
     */
    clear(): void {
        this.messages = [];
        this.summary = null;
    }

    /**
     * Carrega estado de um objeto serializado
     */
    loadFromState(state: { messages?: Message[]; summary?: string }): void {
        if (state.messages) {
            this.messages = state.messages;
        }
        if (state.summary) {
            this.summary = state.summary;
        }
    }

    /**
     * Exporta estado para serialização
     */
    toState(): { messages: Message[]; summary: string | null } {
        return {
            messages: this.messages,
            summary: this.summary,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MÉTODOS PRIVADOS
    // ─────────────────────────────────────────────────────────────────────────

    private generateId(): string {
        return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export function createSystemMessage(content: string): SystemMessage {
    return { role: 'system', content, timestamp: new Date() };
}

export function createHumanMessage(content: string): HumanMessage {
    return { role: 'human', content, timestamp: new Date() };
}

export function createAIMessage(content: string, toolCalls?: ToolCall[]): AIMessage {
    return { role: 'ai', content, toolCalls, timestamp: new Date() };
}

export function createToolMessage(content: string, toolCallId: string, toolName: string): ToolMessage {
    return { role: 'tool', content, toolCallId, toolName, timestamp: new Date() };
}
