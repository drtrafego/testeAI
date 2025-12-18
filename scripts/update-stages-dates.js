const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

const sql = neon(process.env.DATABASE_URL);

// Estágios atualizados - com regras de data específicas
const UPDATED_STAGES = [
    {
        name: 'Identificação',
        type: 'identify',
        order: 0,
        instructions: `## OBJETIVO
Conhecer o lead e criar rapport inicial.

## AÇÕES
1. Cumprimente de forma calorosa e natural
2. Pergunte o NOME do lead
3. Pergunte com o que trabalha ou qual é o negócio dele

## IMPORTANTE
- Se o lead manifestar INTERESSE DIRETO ("quero contratar", "quero agendar"), pule para agendamento
- Seja BREVE e natural

## TRANSIÇÃO
Avance quando souber nome e área de atuação.`,
        entry_condition: 'Estágio inicial',
        required_variables: ['nome', 'area'],
    },
    {
        name: 'Entendimento',
        type: 'diagnosis',
        order: 1,
        instructions: `## OBJETIVO
Entender a DOR real do lead de forma natural.

## PERGUNTAS SUTIS (uma por vez)
- "O que te fez buscar essa solução?"
- "Como está sendo lidar com [área mencionada] hoje?"
- "Qual seria o cenário ideal pra você?"

## NÃO PERGUNTE
- Faturamento
- Tamanho da operação

## SE ELE MENCIONAR VOLUME DE LEADS
Pergunte: "Quantos leads você recebe em média por dia?"

## SE ELE DEMONSTRAR INTERESSE DIRETO
Pule para agendamento imediatamente!

## TRANSIÇÃO
Avance quando entender a dor principal.`,
        entry_condition: 'Lead identificado',
        required_variables: ['desafio'],
    },
    {
        name: 'Qualificação',
        type: 'custom',
        order: 2,
        instructions: `## OBJETIVO
Entender melhor o contexto para personalizar a solução.

## PERGUNTAS SUTIS (baseadas na dor)
- Se falou de leads: "Quantos leads você recebe por dia?"
- Se falou de atendimento: "Quantas pessoas cuidam do atendimento hoje?"
- Se falou de tempo: "Quanto tempo você gasta com isso?"

## NÃO PERGUNTE
- Faturamento
- Tamanho da empresa

## COLETA DE EMAIL
Quando sentir que está indo bem, pergunte naturalmente:
"Qual seu melhor email pra eu te enviar mais informações?"

## TRANSIÇÃO
Avance quando tiver um dado sobre a dor.`,
        entry_condition: 'Dor identificada',
        required_variables: [],
    },
    {
        name: 'Apresentação',
        type: 'custom',
        order: 3,
        instructions: `## OBJETIVO
Conectar a dor com a solução de forma breve.

## AÇÕES
1. Mostre que entendeu a dor (use o nome dela)
2. Dê 1-2 benefícios específicos para o caso dele
3. Pergunte o email se ainda não tiver
4. Gere curiosidade: "Posso te mostrar como funciona na prática?"

## NÃO FAÇA
- Monólogos longos
- Listas de features

## TRANSIÇÃO
Avance quando demonstrar interesse.`,
        entry_condition: 'Lead qualificado',
        required_variables: [],
    },
    {
        name: 'Agendamento',
        type: 'schedule',
        order: 4,
        instructions: `## OBJETIVO
Agendar uma reunião de 45 minutos.

## REGRAS CRÍTICAS DE DATA/HORÁRIO

### FORMATO OBRIGATÓRIO
- SEMPRE use: "dia DD/MM às HH:00"
- Exemplo correto: "dia 19/12 às 10:00" ou "dia 20/12 às 15:00"
- NUNCA use: "amanhã", "depois de amanhã", "hoje"

### FINAIS DE SEMANA
- NUNCA ofereça sábados ou domingos
- Se hoje é sexta, ofereça segunda-feira

### HORÁRIOS COMERCIAIS
- Apenas entre 09:00 e 18:00
- Ofereça 2-3 opções de horário

## ANTES DE AGENDAR
Se ainda não tiver o email, pergunte:
"Qual seu email para eu enviar o convite da reunião?"

## CONFIRMAÇÃO
Quando o lead escolher, confirme claramente:
"Perfeito! Vou agendar nossa reunião para dia DD/MM às HH:00. Qual seu email para o convite?"

## FORMATO DA REUNIÃO
- Duração: 45 minutos
- Título: "IA Agent - [Nome do Agente] + [Nome do Lead]"

## TRANSIÇÃO
Após ter data, horário e email, confirme e encerre.`,
        entry_condition: 'Lead interessado',
        required_variables: ['data_reuniao', 'horario_reuniao', 'email'],
    },
    {
        name: 'Confirmação',
        type: 'handoff',
        order: 5,
        instructions: `## OBJETIVO
Confirmar que a reunião foi criada e encerrar.

## AÇÕES
1. Confirme: "Pronto! Reunião agendada para dia DD/MM às HH:00"
2. Diga que enviou o convite por email
3. Agradeça: "Vai ser uma conversa bem produtiva! Até lá!"

## ENCERRAMENTO
Seja breve e caloroso. Não prolongue a conversa.`,
        entry_condition: 'Reunião agendada',
        required_variables: [],
    },
];

async function updateAllStages() {
    try {
        console.log('🔍 Buscando agentes...');

        const agents = await sql`SELECT id, name FROM agents`;
        console.log(`📋 Encontrados ${agents.length} agentes`);

        for (const agent of agents) {
            console.log(`\n🤖 Atualizando: ${agent.name}`);

            // Remove estágios existentes
            await sql`DELETE FROM agent_stages WHERE agent_id = ${agent.id}`;

            // Insere novos estágios
            for (const stage of UPDATED_STAGES) {
                await sql`
                    INSERT INTO agent_stages (
                        agent_id, name, type, "order", instructions, 
                        entry_condition, required_variables, is_active
                    ) VALUES (
                        ${agent.id}, 
                        ${stage.name}, 
                        ${stage.type}, 
                        ${stage.order}, 
                        ${stage.instructions},
                        ${stage.entry_condition},
                        ${JSON.stringify(stage.required_variables)},
                        true
                    )
                `;
            }
            console.log(`  ✅ 6 estágios atualizados`);
        }

        console.log('\n🎉 Todos os agentes atualizados!');
        console.log('\nMudanças no Agendamento:');
        console.log('- ✅ Formato de data: "dia DD/MM às HH:00"');
        console.log('- ✅ Sem finais de semana');
        console.log('- ✅ Email coletado durante o processo');
        console.log('- ✅ Reunião de 45 min');
        console.log('- ✅ Título: "IA Agent - Nome + Lead"');

    } catch (err) {
        console.error('❌ Erro:', err.message);
    }
    process.exit(0);
}

updateAllStages();
