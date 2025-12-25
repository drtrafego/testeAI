import { db } from '@/lib/db';
import {
    agentStages,
    agentActions,
    sessions,
    agents,
} from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { anthropic } from '@ai-sdk/anthropic';
import { BrainService } from '@/lib/ai/brain';
import { GoogleCalendarService } from '@/server/integrations/google-calendar';
import { GoogleSheetsService } from '@/server/integrations/google-sheets';
import { formatContextWithXml, KNOWLEDGE_GUARDRAILS } from '@/server/services/knowledge-service';

const brain = new BrainService();
const calendar = new GoogleCalendarService();
const sheets = new GoogleSheetsService();

// LLM Provider factory
function getModel(provider: string, model: string) {
    switch (provider) {
        case 'google':
            return google(model);
        case 'anthropic':
            return anthropic(model);
        case 'openai':
        default:
            return openai(model);
    }
}

export class StageMachine {

    /**
     * Processa uma mensagem do usuário através da máquina de estados
     */
    async processMessage(userId: string, agentId: string, threadId: string, userMessage: string) {
        // 1. Carregar agente para pegar configurações
        const agent = await db.query.agents.findFirst({
            where: eq(agents.id, agentId)
        });

        if (!agent) throw new Error('Agente não encontrado');

        // 2. Carregar sessão ou criar nova
        let session = await db.query.sessions.findFirst({
            where: eq(sessions.threadId, threadId)
        });

        if (!session) {
            // Sessão nova: busca primeiro estágio
            let firstStage = await db.query.agentStages.findFirst({
                where: eq(agentStages.agentId, agentId),
                orderBy: asc(agentStages.order)
            });

            // Se não tem estágios, criar automaticamente
            if (!firstStage) {
                console.log(`[StageMachine] ⚠️ Agente ${agentId} sem estágios. Criando estágios padrão...`);

                const defaultStages = [
                    { name: 'Identificação', type: 'identify' as const, order: 0, instructions: 'Conhecer o lead. Pergunte nome e área de atuação. Se demonstrar interesse direto, pule para agendamento.', entryCondition: 'Início', requiredVariables: ['nome', 'area'] },
                    { name: 'Entendimento', type: 'diagnosis' as const, order: 1, instructions: 'Entender a dor. Pergunte o que fez ele buscar uma solução. Se demonstrar interesse, ofereça agendamento.', entryCondition: 'Lead identificado', requiredVariables: ['desafio'] },
                    { name: 'Qualificação', type: 'custom' as const, order: 2, instructions: 'Qualificar o lead. Pergunte UMA informação relevante sobre o contexto (volume de leads, equipe, etc).', entryCondition: 'Dor identificada', requiredVariables: [] },
                    { name: 'Apresentação', type: 'custom' as const, order: 3, instructions: 'Conectar dor com solução. Mostre 1-2 benefícios e ofereça uma demonstração prática.', entryCondition: 'Lead qualificado', requiredVariables: [] },
                    { name: 'Agendamento', type: 'schedule' as const, order: 4, instructions: 'Agendar reunião. Peça email e ofereça datas: dia DD/MM às HH:00. Nunca sábado ou domingo.', entryCondition: 'Lead interessado', requiredVariables: ['email', 'data_reuniao'] },
                    { name: 'Confirmação', type: 'handoff' as const, order: 5, instructions: 'Confirmar agendamento e encerrar. Agradeça pela conversa.', entryCondition: 'Reunião agendada', requiredVariables: [] },
                ];

                await db.insert(agentStages).values(
                    defaultStages.map(stage => ({
                        agentId,
                        name: stage.name,
                        type: stage.type,
                        order: stage.order,
                        instructions: stage.instructions,
                        entryCondition: stage.entryCondition,
                        requiredVariables: stage.requiredVariables,
                        isActive: true,
                    }))
                );

                // Buscar novamente o primeiro estágio
                firstStage = await db.query.agentStages.findFirst({
                    where: eq(agentStages.agentId, agentId),
                    orderBy: asc(agentStages.order)
                });

                console.log(`[StageMachine] ✅ Estágios criados para agente ${agentId}`);
            }

            if (!firstStage) throw new Error('Falha ao criar estágios padrão');

            const [newSession] = await db.insert(sessions).values({
                threadId,
                currentStageId: firstStage.id,
                stageHistory: [firstStage.id],
                variables: {}
            }).returning();
            session = newSession;
        }

        // 3. Carregar estágio atual
        const currentStage = await db.query.agentStages.findFirst({
            where: eq(agentStages.id, session.currentStageId!),
            with: { actions: true }
        });

        if (!currentStage) throw new Error('Estágio atual inválido');

        // 4. Carregar todos os estágios para transição inteligente
        const allStages = await db.query.agentStages.findMany({
            where: eq(agentStages.agentId, agentId),
            orderBy: asc(agentStages.order)
        });

        // 5. PRÉ-VERIFICAÇÃO: Checar se estágio atual está completo ANTES de responder
        let activeStage = currentStage;
        const existingVars = session.variables as Record<string, any> || {};
        const requiredVars = (currentStage.requiredVariables as string[]) || [];

        // 5a. DETECÇÃO DE INTENÇÃO DIRETA: Pular para agendamento se lead demonstrar interesse
        const lowerMessage = userMessage.toLowerCase();
        const buyingIntentKeywords = [
            // PALAVRAS ÚNICAS (mais flexíveis)
            'agendamento', 'agendar', 'marcar', 'reunião', 'reuniao',
            'agenda', 'demonstração', 'demonstracao', 'apresentação', 'apresentacao',

            // Frases de agendar/marcar
            'quero agendar', 'quero marcar', 'só marcar', 'só agendar',
            'queria marcar', 'queria agendar', 'gostaria de marcar', 'gostaria de agendar',
            'posso agendar', 'posso marcar', 'podemos marcar', 'vamos marcar',
            'marcar uma reunião', 'marcar uma chamada', 'marcar uma call',
            'agendar uma reunião', 'agendar uma chamada', 'agendar uma call',
            'marcar apresentação', 'marcar uma apresentação',
            'bora marcar', 'bora agendar', 'pode marcar', 'pode agendar',

            // Interesse direto
            'quero contratar', 'quero fazer', 'quero conhecer',
            'quero ver na prática', 'quero uma demonstração',
            'me interessou', 'tenho interesse', 'estou interessado', 'estou interessada',
            'fechado', 'fechou', 'vamos fechar', 'quero fechar',

            // Horários e disponibilidade
            'quando podemos', 'qual horário', 'tem horário', 'horário disponível',
            'qual dia', 'que dia', 'disponibilidade', 'disponível',

            // Preço/valores
            'quero saber mais sobre preço', 'quanto custa', 'qual o valor', 'qual valor',

            // Urgência
            'preciso urgente', 'o mais rápido possível', 'próxima semana',
            'essa semana', 'amanhã', 'hoje',
        ];

        const hasBuyingIntent = buyingIntentKeywords.some(kw => lowerMessage.includes(kw));

        // Flag para indicar que usuário quer agendar mas precisa de dados básicos
        let needsBasicInfo = false;
        const hasName = existingVars.nome && existingVars.nome.trim() !== '';

        if (hasBuyingIntent && currentStage.type !== 'schedule' && currentStage.type !== 'handoff') {
            // Se tem o nome, pula direto para agendamento
            if (hasName) {
                const scheduleStage = allStages.find(s => s.type === 'schedule');

                if (scheduleStage) {
                    console.log(`[StageMachine] 🎯 Intenção + Nome OK! Pulando para: ${scheduleStage.name}`);
                    activeStage = scheduleStage;

                    // Atualizar sessão direto para agendamento
                    await db.update(sessions)
                        .set({
                            currentStageId: scheduleStage.id,
                            previousStageId: currentStage.id,
                            stageHistory: [...(session.stageHistory as string[]), scheduleStage.id],
                            variables: { ...existingVars, buyingIntent: true }
                        })
                        .where(eq(sessions.id, session.id));
                }
            } else {
                // Não tem nome - marca flag para pedir antes de agendar
                console.log(`[StageMachine] 🎯 Intenção detectada, mas precisa do nome primeiro`);
                needsBasicInfo = true;
            }
        }

        // Extrair variáveis da mensagem atual de forma simples
        const extractedFromMessage: Record<string, any> = {};

        // ════════════════════════════════════════════════════════════════════
        // REFATORAÇÃO CRÍTICA: Ordem correta de extração
        // 1. DATA/HORA primeiro (prioridade máxima)
        // 2. Marcar mensagem como "consumida" se foi data/hora
        // 3. Só então tentar extrair NOME (se não foi consumida)
        // ════════════════════════════════════════════════════════════════════

        let messageConsumedAsDateTime = false; // Flag para prevenir extração dupla
        const now = new Date();

        // Normalizar mensagem para comparação (remove acentos)
        const normalizeText = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const normalizedMessage = normalizeText(lowerMessage);

        // ════════════════════════════════════════════════════════════════════
        // PASSO 1: EXTRAIR DATA (PRIMEIRO!)
        // ════════════════════════════════════════════════════════════════════

        // Lista de palavras que são datas/dias da semana
        const dayNames: Record<string, number> = {
            'domingo': 0, 'segunda': 1, 'segunda-feira': 1, 'terça': 2, 'terça-feira': 2, 'terca': 2,
            'quarta': 3, 'quarta-feira': 3, 'quinta': 4, 'quinta-feira': 4,
            'sexta': 5, 'sexta-feira': 5, 'sábado': 6, 'sabado': 6
        };

        // Detectar "amanhã", "hoje"
        if (lowerMessage.includes('amanhã') || lowerMessage.includes('amanha')) {
            const tomorrow = new Date(now);
            tomorrow.setDate(now.getDate() + 1);
            extractedFromMessage['data_reuniao'] = `${tomorrow.getDate().toString().padStart(2, '0')}/${(tomorrow.getMonth() + 1).toString().padStart(2, '0')}`;
            messageConsumedAsDateTime = true;
            console.log(`[StageMachine] 📅 Data 'amanhã' detectada: ${extractedFromMessage['data_reuniao']}`);
        } else if (lowerMessage.includes('hoje')) {
            extractedFromMessage['data_reuniao'] = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}`;
            messageConsumedAsDateTime = true;
            console.log(`[StageMachine] 📅 Data 'hoje' detectada: ${extractedFromMessage['data_reuniao']}`);
        } else {
            // Detectar dia da semana (segunda, terça, etc.)
            for (const [dayName, dayIndex] of Object.entries(dayNames)) {
                const normalizedDayName = normalizeText(dayName);
                if (normalizedMessage === normalizedDayName || normalizedMessage.includes(normalizedDayName)) {
                    const targetDate = new Date(now);
                    const currentDay = now.getDay();
                    let daysUntil = dayIndex - currentDay;
                    if (daysUntil <= 0) daysUntil += 7; // Próxima semana
                    targetDate.setDate(now.getDate() + daysUntil);
                    extractedFromMessage['data_reuniao'] = `${targetDate.getDate().toString().padStart(2, '0')}/${(targetDate.getMonth() + 1).toString().padStart(2, '0')}`;
                    messageConsumedAsDateTime = true; // CRÍTICO: Marcar como consumida
                    console.log(`[StageMachine] 📅 Data '${dayName}' detectada: ${extractedFromMessage['data_reuniao']} (mensagem consumida como data)`);
                    break;
                }
            }
        }

        // Se não detectou por palavras, tentar padrões numéricos de data
        const datePatterns = [
            /(\d{1,2})\s*[\/\-]\s*(\d{1,2})/,  // 22/12 ou 22-12
            /dia\s+(\d{1,2})(?:\s+de\s+(\w+))?/i,  // dia 22, dia 22 de dezembro
            /(\d{1,2})\s+de\s+(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/i,
        ];

        if (!extractedFromMessage['data_reuniao']) {
            for (const pattern of datePatterns) {
                const match = userMessage.match(pattern);
                if (match) {
                    const day = match[1];
                    let month = match[2];
                    if (month && isNaN(parseInt(month))) {
                        const monthNames: Record<string, string> = {
                            'janeiro': '01', 'fevereiro': '02', 'março': '03', 'abril': '04',
                            'maio': '05', 'junho': '06', 'julho': '07', 'agosto': '08',
                            'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12'
                        };
                        month = monthNames[month.toLowerCase()] || String(now.getMonth() + 1).padStart(2, '0');
                    }
                    extractedFromMessage['data_reuniao'] = `${day}/${month || String(now.getMonth() + 1).padStart(2, '0')}`;
                    messageConsumedAsDateTime = true;
                    console.log(`[StageMachine] 📅 Data extraída diretamente: ${extractedFromMessage['data_reuniao']}`);
                    break;
                }
            }
        }

        // ════════════════════════════════════════════════════════════════════
        // PASSO 2: EXTRAIR HORÁRIO
        // ════════════════════════════════════════════════════════════════════

        const timePatterns = [
            /(\d{1,2})[:h](\d{2})/i,  // 10:00, 10h30
            /(\d{1,2})\s*h(?:oras?)?/i,  // 10h, 10 horas
            /[aà]s?\s+(\d{1,2})(?:[:h](\d{2}))?/i,  // às 10, as 10:30, À 16
            /(\d{1,2})\s+(?:da\s+)?(manhã|manha|tarde|noite)/i,  // 10 da manhã
        ];

        // FALLBACK ESPECIAL: Se mensagem é "as XX" ou "às XX" 
        const asTimeMatch = userMessage.match(/^[aàá]s?\s*(\d{1,2})(?:[h:](\d{2}))?$/i);
        if (asTimeMatch && asTimeMatch[1]) {
            const hours = parseInt(asTimeMatch[1]);
            const minutes = asTimeMatch[2] || '00';
            if (hours >= 6 && hours <= 22) {
                extractedFromMessage['horario_reuniao'] = `${hours}:${minutes}`;
                messageConsumedAsDateTime = true;
                console.log(`[StageMachine] 🕐 Horário 'as XX' extraído: ${extractedFromMessage['horario_reuniao']}`);
            }
        }

        // Se não extraiu com fallback, tentar patterns normais
        if (!extractedFromMessage['horario_reuniao']) {
            for (const pattern of timePatterns) {
                const match = userMessage.match(pattern);
                if (match && match[1]) {
                    let hours = parseInt(match[1]);
                    const minutes = match[2] || '00';
                    // Ajustar para período (manhã/tarde/noite)
                    if (match[3]) {
                        const periodo = match[3].toLowerCase();
                        if ((periodo === 'tarde') && hours < 12) hours += 12;
                        if ((periodo === 'noite') && hours < 18) hours += 12;
                    }
                    // Validar horário comercial (6h-22h)
                    if (hours >= 6 && hours <= 22) {
                        extractedFromMessage['horario_reuniao'] = `${hours}:${minutes}`;
                        messageConsumedAsDateTime = true;
                        console.log(`[StageMachine] 🕐 Horário extraído: ${extractedFromMessage['horario_reuniao']}`);
                        break;
                    }
                }
            }
        }

        // FALLBACK: Se mensagem é APENAS um número (ex: "16", "23", "10")
        const pureNumberMatch = userMessage.trim().match(/^(\d{1,2})$/);
        if (pureNumberMatch) {
            const num = parseInt(pureNumberMatch[1]);
            // Se entre 6-22, provavelmente é horário
            if (num >= 6 && num <= 22 && !extractedFromMessage['horario_reuniao']) {
                extractedFromMessage['horario_reuniao'] = `${num}:00`;
                messageConsumedAsDateTime = true;
                console.log(`[StageMachine] 🕐 Número interpretado como horário: ${num}:00`);
            }
            // Se entre 1-31, pode ser dia do mês
            if (num >= 1 && num <= 31 && !extractedFromMessage['data_reuniao']) {
                const currentMonth = (now.getMonth() + 1).toString().padStart(2, '0');
                extractedFromMessage['data_reuniao'] = `${num.toString().padStart(2, '0')}/${currentMonth}`;
                messageConsumedAsDateTime = true;
                console.log(`[StageMachine] 📅 Número interpretado como dia: ${extractedFromMessage['data_reuniao']}`);
            }
        }

        // ════════════════════════════════════════════════════════════════════
        // PASSO 3: EXTRAIR ÁREA/NICHO (pode coexistir com data/hora)
        // ════════════════════════════════════════════════════════════════════

        const areaPatterns = [
            /(?:clínica|clinica|consultório|loja|empresa|negócio|trabalho com|área|nicho|segmento|setor)[:\s]+(.+)/i,
            /(?:sou|tenho|trabalho em|atuo com|meu negócio é)[:\s]*(?:uma?\s+)?(.+)/i,
        ];
        for (const pattern of areaPatterns) {
            const match = userMessage.match(pattern);
            if (match && match[1]) {
                extractedFromMessage['area'] = match[1].trim();
                break;
            }
        }

        // ════════════════════════════════════════════════════════════════════
        // PASSO 4: EXTRAIR NOME (SOMENTE SE MENSAGEM NÃO FOI CONSUMIDA)
        // ════════════════════════════════════════════════════════════════════

        // Lista de palavras que NÃO são nomes
        const blockedAsName = [
            // Saudações (CRÍTICO: não extrair como nome!)
            'olá', 'ola', 'oi', 'ei', 'hey', 'hello', 'hi',
            'bom dia', 'boa tarde', 'boa noite', 'boa', 'bom',
            // Dias da semana (com e sem acento)
            'segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta', 'sábado', 'sabado', 'domingo',
            'segunda-feira', 'terça-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira',
            // Horários e datas
            'hoje', 'amanhã', 'amanha', 'manhã', 'manha', 'tarde', 'noite',
            // Confirmações
            'sim', 'não', 'nao', 'ok', 'certo', 'beleza', 'blz', 'fechado', 'combinado', 'perfeito', 'ótimo', 'otimo',
            // Números/horas comuns
            'as', 'às', 'hora', 'horas', 'dia', 'dias',
            // Outras palavras comuns que não são nomes
            'pode', 'ser', 'que', 'para', 'com', 'está', 'esta', 'isso', 'isso mesmo',
            'queria', 'quero', 'gostaria', 'preciso', 'tenho', 'obrigado', 'obrigada', 'valeu', 'vlw',
        ];

        const normalizedBlocked = blockedAsName.map(w => normalizeText(w));
        const isEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i.test(userMessage);
        const isBlockedWord = normalizedBlocked.includes(normalizedMessage);
        const isNumber = /^\d+$/.test(userMessage.trim());
        const isTimeFormat = /^\d{1,2}[h:]?\d{0,2}$/.test(userMessage.trim());

        // DEBUG: Log para entender verificação de nome
        console.log(`[StageMachine] 🔍 Verificando nome: msg="${userMessage}", consumed=${messageConsumedAsDateTime}, isBlocked=${isBlockedWord}, isNumber=${isNumber}, isTime=${isTimeFormat}`);

        // REGRA DEFINITIVA: Só extrai como nome se:
        // 1. Mensagem NÃO foi consumida como data/hora
        // 2. NÃO já existe um nome válido
        // 3. NÃO é email
        // 4. NÃO é palavra bloqueada
        // 5. NÃO é número/horário
        // 6. É curto e sem espaço (provavelmente só o nome)
        const hasExistingName = existingVars.nome && String(existingVars.nome).trim() !== '';

        if (!messageConsumedAsDateTime && !hasExistingName && userMessage.length < 30 && !userMessage.includes('?') && !lowerMessage.includes(' ') && !isEmail && !isBlockedWord && !isNumber && !isTimeFormat) {
            extractedFromMessage['nome'] = userMessage.trim();
            console.log(`[StageMachine] 👤 Nome extraído: ${extractedFromMessage['nome']}`);
        } else if (messageConsumedAsDateTime) {
            console.log(`[StageMachine] 🚫 Mensagem consumida como data/hora, NÃO será extraída como nome`);
        } else if (isBlockedWord) {
            console.log(`[StageMachine] 🚫 Bloqueado como nome: "${userMessage}" (é palavra reservada)`);
        } else if (hasExistingName) {
            console.log(`[StageMachine] 🛡️ Nome existente protegido: "${existingVars.nome}"`);
        }

        // ════════════════════════════════════════════════════════════════════
        // PASSO 5: EXTRAIR EMAIL
        // ════════════════════════════════════════════════════════════════════

        const emailMatch = userMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
        if (emailMatch) {
            extractedFromMessage['email'] = emailMatch[0].toLowerCase();
            console.log(`[StageMachine] 📧 Email extraído diretamente: ${extractedFromMessage['email']}`);
        }

        // Combinar variáveis existentes + extraídas
        // CORREÇÃO: Proteger variáveis existentes - não sobrescrever com valores vazios ou quando já existe nome válido
        const allVars = { ...existingVars };
        for (const [key, value] of Object.entries(extractedFromMessage)) {
            const existingValue = existingVars[key];
            const hasValidExisting = existingValue !== undefined && existingValue !== null && existingValue !== '';
            const hasValidNew = value !== undefined && value !== null && value !== '';

            // REGRA ESPECIAL: Nunca sobrescrever 'nome' com email
            if (key === 'nome' && hasValidExisting) {
                // Não sobrescrever nome existente
                continue;
            }

            // Para outras variáveis: só atualiza se não tinha valor ou se o novo é válido
            if (!hasValidExisting || hasValidNew) {
                allVars[key] = value;
            }
        }

        // Verificar se todas as variáveis obrigatórias do estágio atual estão completas
        const hasAllRequired = requiredVars.length === 0 ||
            requiredVars.every(v => allVars[v] !== undefined && allVars[v] !== '');

        // Se estágio atual está completo, avançar para o próximo ANTES de responder
        if (hasAllRequired && requiredVars.length > 0) {
            const currentIndex = allStages.findIndex(s => s.id === currentStage.id);
            const nextStage = currentIndex < allStages.length - 1 ? allStages[currentIndex + 1] : null;

            if (nextStage) {
                console.log(`[StageMachine] 🚀 Pré-transição: ${currentStage.name} → ${nextStage.name}`);
                activeStage = nextStage;

                // Atualizar sessão para o novo estágio
                await db.update(sessions)
                    .set({
                        currentStageId: nextStage.id,
                        previousStageId: currentStage.id,
                        stageHistory: [...(session.stageHistory as string[]), nextStage.id],
                        variables: allVars
                    })
                    .where(eq(sessions.id, session.id));
            }
        }

        // 6. Buscar contexto (RAG)
        const context = await brain.retrieveContext(agentId, userMessage);

        // 7. Obter modelo configurado
        const modelConfig = agent.modelConfig as any || { provider: 'openai', model: 'gpt-4o-mini' };
        const model = getModel(modelConfig.provider || 'openai', modelConfig.model || 'gpt-4o-mini');

        // 8. Construir prompt avançado para resposta (usando estágio ATIVO, não o antigo)
        const systemPrompt = this.buildAdvancedPrompt(agent, activeStage, allStages, session, context, needsBasicInfo);

        // 8. Gerar resposta + análise de transição em uma chamada
        const { text: fullResponse } = await generateText({
            model,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
            temperature: modelConfig.temperature || 0.7,
            maxTokens: modelConfig.maxTokens || 1024,
        });

        // 9. Extrair variáveis e avaliar transição
        const analysisResult = await this.analyzeResponseAndTransition(
            model, userMessage, fullResponse, currentStage, allStages, session
        );

        // 10. Atualizar sessão se necessário
        // INCLUIR extractedFromMessage para garantir que data/hora via regex sejam salvas
        const allExtractedVars = { ...extractedFromMessage, ...analysisResult.extractedVars };

        if (analysisResult.shouldAdvance && analysisResult.nextStageId) {
            await db.update(sessions)
                .set({
                    currentStageId: analysisResult.nextStageId,
                    previousStageId: currentStage.id,
                    stageHistory: [...(session.stageHistory as string[]), analysisResult.nextStageId],
                    variables: { ...(session.variables as object), ...allExtractedVars }
                })
                .where(eq(sessions.id, session.id));
        } else if (Object.keys(allExtractedVars).length > 0) {
            // Só atualizar variáveis
            await db.update(sessions)
                .set({
                    variables: { ...(session.variables as object), ...allExtractedVars }
                })
                .where(eq(sessions.id, session.id));
        }

        // 11. AGENDAMENTO AUTOMÁTICO: Se estamos no estágio de schedule e temos os dados
        // CORREÇÃO CRÍTICA: Usar allExtractedVars que já foi salvo no banco, não session.variables que está desatualizado
        const updatedSessionVars = { ...(session?.variables as object || {}), ...allExtractedVars };
        const finalVars: Record<string, any> = {
            ...updatedSessionVars,
            ...extractedFromMessage,  // CRÍTICO: incluir extração direta
            ...analysisResult.extractedVars
        };

        // Mapear sinônimos de agendamento (caso IA tenha usado nomes diferentes)
        if (finalVars['data_agendamento'] && !finalVars['data_reuniao']) finalVars['data_reuniao'] = finalVars['data_agendamento'];
        if (finalVars['data'] && !finalVars['data_reuniao']) finalVars['data_reuniao'] = finalVars['data'];
        if (finalVars['hora_agendamento'] && !finalVars['horario_reuniao']) finalVars['horario_reuniao'] = finalVars['hora_agendamento'];
        if (finalVars['hora'] && !finalVars['horario_reuniao']) finalVars['horario_reuniao'] = finalVars['hora'];
        if (finalVars['horario'] && !finalVars['horario_reuniao']) finalVars['horario_reuniao'] = finalVars['horario'];
        // CORREÇÃO: Mapear hora_reuniao → horario_reuniao (sinônimo usado pela IA)
        if (finalVars['hora_reuniao'] && !finalVars['horario_reuniao']) finalVars['horario_reuniao'] = finalVars['hora_reuniao'];

        // DEBUG: Log todas as variáveis extraídas
        console.log('[DEBUG] extractedFromMessage:', JSON.stringify(extractedFromMessage));
        console.log('[DEBUG] analysisResult.extractedVars:', JSON.stringify(analysisResult.extractedVars));
        console.log('[DEBUG] finalVars:', JSON.stringify(finalVars));

        // CORREÇÃO CRÍTICA: Agendar quando DADOS COMPLETOS, independente do estágio
        const hasCompleteSchedulingData = finalVars.email && finalVars.data_reuniao && finalVars.horario_reuniao;
        const isScheduleStage = activeStage.type === 'schedule' || currentStage.type === 'schedule';

        console.log(`[StageMachine] 📊 Verificando agendamento: hasCompleteData=${hasCompleteSchedulingData}, isScheduleStage=${isScheduleStage}`);
        console.log(`[StageMachine] 📊 Dados: email=${finalVars.email}, data=${finalVars.data_reuniao}, hora=${finalVars.horario_reuniao}`);

        if ((hasCompleteSchedulingData || isScheduleStage) && !finalVars.meetingCreated) {
            const hasSchedulingData = finalVars.email && (finalVars.data_reuniao || finalVars.horario_reuniao);

            if (hasSchedulingData) {
                try {
                    console.log('[StageMachine] 📅 Tentando agendar reunião...', finalVars);

                    // Buscar usuário com integração Google (primeiro tenta agent.userId, depois busca qualquer um REAL)
                    const { integrations } = await import('@/db/schema');
                    let calendarUserId = agent.userId;

                    // Verificar se o agent.userId tem integração Google
                    console.log(`[StageMachine] 🔍 Buscando integração para agent.userId: ${agent.userId}, provider: google`);
                    const agentIntegration = await db.query.integrations.findFirst({
                        where: and(eq(integrations.userId, agent.userId), eq(integrations.provider, 'google'))
                    });

                    if (!agentIntegration) {
                        // SIMPLIFICADO: Buscar QUALQUER integração Google no sistema
                        // (O sistema tem apenas uma conta Google conectada)
                        const anyGoogleIntegration = await db.query.integrations.findFirst({
                            where: eq(integrations.provider, 'google')
                        });

                        if (anyGoogleIntegration) {
                            calendarUserId = anyGoogleIntegration.userId;
                            console.log(`[StageMachine] 📅 Usando integração Google encontrada: userId=${calendarUserId}`);
                        } else {
                            console.error('[StageMachine] ❌ NENHUMA integração Google existe no banco de dados!');
                            console.error('[StageMachine] 💡 Conecte o Google Calendar em: /dashboard/integrations');
                            throw new Error('CONFIG_ERROR_NO_INTEGRATION');
                        }
                    } else {
                        console.log(`[StageMachine] 📅 Integração Google do agente encontrada: userId=${agent.userId}`);
                    }

                    // Parse date from Brazilian format (DD/MM) - handles "terça-feira, 23/12" format
                    const dataStr = String(finalVars.data_reuniao || '');
                    const horarioStr = String(finalVars.horario_reuniao || '10:00');
                    const nome = String(finalVars.nome || 'Lead');
                    const attendeeEmail = String(finalVars.email || '');

                    // Extract day and month - more robust regex to handle "terça-feira, 23/12" or just "23/12"
                    const dateMatch = dataStr.match(/(\d{1,2})\s*[\/\-]\s*(\d{1,2})/);
                    if (dateMatch && attendeeEmail) {
                        const day = parseInt(dateMatch[1]);
                        const month = parseInt(dateMatch[2]) - 1; // JS months are 0-indexed
                        const year = new Date().getFullYear();

                        // Adjust year if month is before current month
                        const currentMonth = new Date().getMonth();
                        const adjustedYear = month < currentMonth ? year + 1 : year;

                        // Extract time
                        const timeMatch = horarioStr.match(/(\d{1,2})(?::(\d{2}))?/);
                        const hours = timeMatch ? parseInt(timeMatch[1]) : 10;
                        const minutes = timeMatch && timeMatch[2] ? parseInt(timeMatch[2]) : 0;

                        // Create Date objects
                        const startDate = new Date(adjustedYear, month, day, hours, minutes, 0);
                        const endDate = new Date(startDate.getTime() + 45 * 60 * 1000); // +45 min

                        // Create meeting
                        const meetingTitle = `IA Agent - ${agent.name} + ${nome}`;

                        // Construir descrição rica
                        const eventDescription = [
                            `📅 Reunião agendada via chat com IA`,
                            ``,
                            `👤 Nome: ${nome}`,
                            `📧 Email: ${attendeeEmail}`,
                            `🏢 Área: ${finalVars.area || 'Não informado'}`,
                            `🎯 Desafio: ${finalVars.desafio || 'Não informado'}`,
                            ``,
                            `---`,
                            `Agendado automaticamente pelo ${agent.name}`,
                        ].join('\n');

                        console.log(`[StageMachine] 📅 Criando evento:`, {
                            titulo: meetingTitle,
                            email: attendeeEmail,
                            inicio: startDate.toISOString(),
                            fim: endDate.toISOString()
                        });

                        const result = await calendar.createEvent(calendarUserId, {
                            summary: meetingTitle,
                            description: eventDescription,
                            start: startDate,
                            end: endDate,
                            attendeeEmail: attendeeEmail,
                        });

                        if (result.id) {
                            console.log('[StageMachine] ✅ Reunião criada com sucesso!', result.id);

                            // Avançar para estágio de Confirmação/Handoff
                            const confirmationStage = allStages.find(s => s.type === 'handoff' || s.name.toLowerCase().includes('confirmação'));

                            await db.update(sessions)
                                .set({
                                    currentStageId: confirmationStage?.id || currentStage.id,
                                    variables: { ...finalVars, meetingCreated: true, eventId: result.id, eventLink: result.link }
                                })
                                .where(eq(sessions.id, session!.id));

                            console.log('[StageMachine] 🎯 Sessão atualizada para estágio de confirmação');
                        } else {
                            console.error('[StageMachine] ❌ Falha ao criar reunião - sem ID retornado');
                        }
                    }
                } catch (calError: any) {
                    console.error('[StageMachine] ❌ Erro no agendamento:', calError);

                    // Graceful fallback: Inform user about the error
                    if (calError.message === 'CONFIG_ERROR_NO_INTEGRATION') {
                        fullResponse += "\n\n(⚠️ Nota do Sistema: Não encontrei uma agenda Google conectada para realizar o agendamento. Por favor, verifique a página de integrações.)";
                    } else {
                        fullResponse += "\n\n(⚠️ Nota do Sistema: Tive um problema técnico ao tentar acessar a agenda. Podemos tentar novamente em instantes?)";
                    }
                }
            }
        }

        return fullResponse;
    }

    /**
     * Constrói prompt avançado para resposta de alta qualidade
     * Estrutura: PROMPT BASE + CONTEXTO DINÂMICO + CONTEXTO FACTUAL
     */
    private buildAdvancedPrompt(agent: any, currentStage: any, allStages: any[], session: any, context: string[], needsBasicInfo: boolean = false) {
        const vars = session?.variables || {};
        const currentIndex = allStages.findIndex(s => s.id === currentStage.id);
        const totalStages = allStages.length;

        // Calcular próximos dias úteis
        const now = new Date();
        const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
        const proximosDias: string[] = [];
        for (let i = 1; i <= 7 && proximosDias.length < 3; i++) {
            const d = new Date(now);
            d.setDate(now.getDate() + i);
            if (d.getDay() !== 0 && d.getDay() !== 6) {
                proximosDias.push(`${diasSemana[d.getDay()]} ${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`);
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 1. PROMPT BASE (Personalidade + Regras de Conduta)
        // ═══════════════════════════════════════════════════════════════════════
        const basePrompt = `VOCÊ É: ${agent.displayName || agent.name}, um assistente brasileiro, ${agent.tone || 'informal'}, ${agent.personality || 'prestativo'} com o objetivo de qualificar leads para agendamento.
${agent.companyProfile ? `\nEMPRESA: ${agent.companyProfile}` : ''}

PERSONALIDADE: Use tom ${agent.tone || 'informal'} e ${agent.personality || 'amigável'}. ${agent.useEmojis ? 'Use emojis quando apropriado.' : 'Evite emojis.'}
Expressões permitidas: "Opa", "Show", "Massa", "Fechou", "Perfeito".

REGRAS DE CONDUTA CRÍTICAS:
1. NUNCA diga "Como posso ajudar?", "Sou uma IA", "Entendo perfeitamente" ou frases robóticas.
2. Respostas CURTAS e DIRETAS - foque em avançar o objetivo do estágio.
3. Se o usuário desviar, responda brevemente e RETORNE ao objetivo.
4. Se falta uma variável obrigatória, termine com UMA pergunta clara para coletá-la.
5. NUNCA pergunte algo que já está nas VARIÁVEIS COLETADAS.
6. Se já tem nome + email + data/hora, confirme o agendamento imediatamente.`;

        // ═══════════════════════════════════════════════════════════════════════
        // 2. CONTEXTO DINÂMICO (Estágio + Variáveis)
        // ═══════════════════════════════════════════════════════════════════════
        const requiredVars = currentStage.requiredVariables?.join(', ') || 'Nenhuma específica';
        const missingVars = (currentStage.requiredVariables || []).filter((v: string) => !vars[v]);

        const dynamicContext = `
--- CONTEXTO DE ESTADO ---
ESTÁGIO ATUAL: "${currentStage.name}" (${currentIndex + 1}/${totalStages})

OBJETIVO DO ESTÁGIO:
${currentStage.instructions}

VARIÁVEIS JÁ COLETADAS:
${Object.keys(vars).length > 0 ? JSON.stringify(vars, null, 2) : '(nenhuma ainda)'}

VARIÁVEIS NECESSÁRIAS PARA AVANÇAR: ${requiredVars}
${missingVars.length > 0 ? `⚠️ FALTANDO: ${missingVars.join(', ')}` : '✅ Todas as variáveis coletadas'}

DATA ATUAL: ${diasSemana[now.getDay()]}, ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}
HORÁRIO: ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}
PRÓXIMOS DIAS ÚTEIS: ${proximosDias.join(', ')}
(NUNCA ofereça sábado ou domingo)`;

        // ═══════════════════════════════════════════════════════════════════════
        // 3. CONTEXTO FACTUAL (RAG + Tools)
        // ═══════════════════════════════════════════════════════════════════════
        const factualContext = `
--- CONTEXTO FÁTICO (RAG) ---
<context>
${context.length > 0 ? formatContextWithXml(context) : 'Nenhum contexto adicional.'}
</context>

--- ESTADO ESPECIAL ---
${needsBasicInfo ? '⚠️ AÇÃO URGENTE: Pergunte o NOME antes de agendar!' : ''}
${vars.meetingCreated ? '✅ REUNIÃO AGENDADA! Apenas confirme e agradeça. NÃO ofereça agendar de novo.' : ''}
${vars.buyingIntent ? '🎯 Lead com INTENÇÃO DE COMPRA detectada - priorize agendamento!' : ''}`;

        // ═══════════════════════════════════════════════════════════════════════
        // MONTAGEM FINAL
        // ═══════════════════════════════════════════════════════════════════════
        return `${basePrompt}
${dynamicContext}
${factualContext}

--- GERAÇÃO DE RESPOSTA ---
Com base no contexto acima, gere uma resposta NATURAL, CURTA e focada no objetivo.
Se precisa de uma variável, faça UMA pergunta. Se tem tudo, avance.`;
    }

    /**
     * Analisa a conversa para extração de variáveis e decisão de transição
     */
    private async analyzeResponseAndTransition(
        model: any,
        userMessage: string,
        agentResponse: string,
        currentStage: any,
        allStages: any[],
        session: any
    ): Promise<{ shouldAdvance: boolean; nextStageId: string | null; extractedVars: Record<string, any> }> {

        const currentIndex = allStages.findIndex(s => s.id === currentStage.id);
        const nextStage = currentIndex < allStages.length - 1 ? allStages[currentIndex + 1] : null;

        // Procura por pedido de transbordo explícito
        const transferKeywords = ['falar com humano', 'atendente', 'pessoa real', 'transferir', 'suporte humano'];
        const wantsTransfer = transferKeywords.some(kw => userMessage.toLowerCase().includes(kw));

        if (wantsTransfer) {
            const transferStage = allStages.find(s => s.type === 'transfer');
            if (transferStage) {
                return {
                    shouldAdvance: true,
                    nextStageId: transferStage.id,
                    extractedVars: { motivo_transbordo: 'Solicitado pelo usuário' }
                };
            }
        }

        // Análise com IA para extração e transição
        const existingVars = session.variables || {};
        const requiredVars = currentStage.requiredVariables || [];

        try {
            // Construir lista dinâmica de variáveis a procurar
            const varsToExtract = [
                ...requiredVars,
                'nome', 'area', 'nicho', 'segmento', 'empresa', 'cargo',
                'desafio', 'dor', 'problema', 'tempo_problema',
                'faturamento', 'urgencia',
                'email', 'telefone', 'data_reuniao', 'horario_reuniao'
            ];

            const analysisPrompt = `Analise esta conversa e extraia informações:

MENSAGEM DO USUÁRIO: "${userMessage}"
RESPOSTA DO AGENTE: "${agentResponse}"
ESTÁGIO ATUAL: ${currentStage.name}
VARIÁVEIS JÁ COLETADAS: ${JSON.stringify(existingVars)}
VARIÁVEIS OBRIGATÓRIAS DO ESTÁGIO: ${JSON.stringify(requiredVars)}

IMPORTANTE: Extraia TODAS as informações que aparecem na mensagem do usuário.
Para área/nicho de atuação, use "area" como nome da variável.
Para desafios/problemas, use "desafio" como nome da variável.

Responda APENAS com JSON válido:
{
  "extracted": { "variavel": "valor" },
  "reason": "resumo do que foi coletado"
}`;

            const { text: analysisJson } = await generateText({
                model,
                prompt: analysisPrompt,
                temperature: 0.1,
            });

            // Parse JSON da resposta
            const jsonMatch = analysisJson.match(/\{[\s\S]*\}/);
            let extractedVars: Record<string, any> = {};

            if (jsonMatch) {
                try {
                    const analysis = JSON.parse(jsonMatch[0]);
                    extractedVars = analysis.extracted || {};
                } catch {
                    console.log('[StageMachine] Falha ao parsear JSON da análise');
                }
            }

            // Combinar variáveis existentes + novas
            const allVars = { ...existingVars, ...extractedVars };

            // Mapear sinônimos para variáveis obrigatórias
            if (allVars['nicho'] && !allVars['area']) allVars['area'] = allVars['nicho'];
            if (allVars['segmento'] && !allVars['area']) allVars['area'] = allVars['segmento'];
            if (allVars['dor'] && !allVars['desafio']) allVars['desafio'] = allVars['dor'];
            if (allVars['problema'] && !allVars['desafio']) allVars['desafio'] = allVars['problema'];
            // CRÍTICO: Mapear sinônimos de agendamento
            if (allVars['data_agendamento'] && !allVars['data_reuniao']) allVars['data_reuniao'] = allVars['data_agendamento'];
            if (allVars['data'] && !allVars['data_reuniao']) allVars['data_reuniao'] = allVars['data'];
            if (allVars['hora_agendamento'] && !allVars['horario_reuniao']) allVars['horario_reuniao'] = allVars['hora_agendamento'];
            if (allVars['hora'] && !allVars['horario_reuniao']) allVars['horario_reuniao'] = allVars['hora'];
            if (allVars['horario'] && !allVars['horario_reuniao']) allVars['horario_reuniao'] = allVars['horario'];

            // Verificar se todas as variáveis obrigatórias foram coletadas
            const hasAllRequired = requiredVars.length === 0 ||
                requiredVars.every((v: string) => allVars[v] !== undefined && allVars[v] !== '');

            // Decidir se avançar
            const shouldAdvance = hasAllRequired && nextStage !== null;

            if (shouldAdvance) {
                console.log(`[StageMachine] ✅ Avançando: ${currentStage.name} → ${nextStage?.name}. Vars: ${JSON.stringify(allVars)}`);
            }

            return {
                shouldAdvance,
                nextStageId: shouldAdvance && nextStage ? nextStage.id : null,
                extractedVars
            };
        } catch (error) {
            console.error('Erro na análise de transição:', error);
        }

        return { shouldAdvance: false, nextStageId: null, extractedVars: {} };
    }

    /**
     * Executa ações automáticas do estágio
     */
    private async executeStageActions(userId: string, stage: any, variables: any) {
        if (!stage.actions || stage.actions.length === 0) return;

        for (const action of stage.actions) {
            try {
                switch (action.type) {
                    case 'google_calendar_list':
                        break;
                    case 'google_sheets_append':
                        await sheets.appendRow(userId, variables, action.config as any);
                        break;
                }
            } catch (error) {
                console.error(`Erro na ação ${action.type}:`, error);
            }
        }
    }
}
