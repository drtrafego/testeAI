/**
 * Script de Simulação - Testa todas as funcionalidades do agente
 * 
 * Executa: npx ts-node src/scripts/simulate-agent.ts
 */

import {
    createInitialState,
    createMessage,
    mergeVariables,
    validateName,
    validateEmail,
    validateTime,
    validateDate,
    normalizeText,
    AgentState,
    AgentVariables,
} from '../lib/ai/agent-state';

import {
    createSummarizationMiddleware,
    createErrorHandlingMiddleware,
} from '../lib/ai/middleware';

// ════════════════════════════════════════════════════════════════════
// CORES PARA CONSOLE
// ════════════════════════════════════════════════════════════════════

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
};

function log(msg: string, color: keyof typeof colors = 'reset') {
    console.log(`${colors[color]}${msg}${colors.reset}`);
}

function pass(test: string) {
    log(`  ✅ ${test}`, 'green');
}

function fail(test: string, expected: any, got: any) {
    log(`  ❌ ${test}`, 'red');
    log(`     Esperado: ${JSON.stringify(expected)}`, 'yellow');
    log(`     Recebido: ${JSON.stringify(got)}`, 'yellow');
}

function section(title: string) {
    console.log('');
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'cyan');
    log(`  ${title}`, 'bold');
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'cyan');
}

// ════════════════════════════════════════════════════════════════════
// TESTES DE VALIDAÇÃO DE NOME
// ════════════════════════════════════════════════════════════════════

function testValidateName() {
    section('TESTE: validateName()');

    let passed = 0;
    let failed = 0;

    // Nomes válidos
    const validNames = ['Gastão', 'Maria', 'João', 'Carlos', 'Ana', 'Pedro', 'Lucas'];
    for (const name of validNames) {
        const result = validateName(name);
        if (result.valid) {
            pass(`"${name}" é um nome válido`);
            passed++;
        } else {
            fail(`"${name}" deveria ser válido`, true, result);
            failed++;
        }
    }

    // Nomes inválidos (dias da semana)
    const daysOfWeek = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
    for (const day of daysOfWeek) {
        const result = validateName(day);
        if (!result.valid) {
            pass(`"${day}" bloqueado como nome (é dia da semana)`);
            passed++;
        } else {
            fail(`"${day}" NÃO deveria ser válido como nome`, false, result);
            failed++;
        }
    }

    // Nomes inválidos (horários)
    const timeFormats = ['as 16', '10h', '14:30', 'às 10'];
    for (const time of timeFormats) {
        const result = validateName(time);
        if (!result.valid) {
            pass(`"${time}" bloqueado como nome (é horário)`);
            passed++;
        } else {
            fail(`"${time}" NÃO deveria ser válido como nome`, false, result);
            failed++;
        }
    }

    // Nomes inválidos (confirmações)
    const confirmations = ['sim', 'não', 'ok', 'certo', 'beleza'];
    for (const conf of confirmations) {
        const result = validateName(conf);
        if (!result.valid) {
            pass(`"${conf}" bloqueado como nome (é confirmação)`);
            passed++;
        } else {
            fail(`"${conf}" NÃO deveria ser válido como nome`, false, result);
            failed++;
        }
    }

    log(`\n  Resultado: ${passed} passou, ${failed} falhou`, passed === passed + failed ? 'green' : 'red');
    return { passed, failed };
}

// ════════════════════════════════════════════════════════════════════
// TESTES DE VALIDAÇÃO DE HORÁRIO
// ════════════════════════════════════════════════════════════════════

function testValidateTime() {
    section('TESTE: validateTime()');

    let passed = 0;
    let failed = 0;

    // Horários válidos
    const validTimes = [
        { input: 'as 16', expected: '16:00' },
        { input: 'às 10', expected: '10:00' },
        { input: '14h', expected: '14:00' },
        { input: '10:30', expected: '10:30' },
        { input: '16h30', expected: '16:30' },
    ];

    for (const { input, expected } of validTimes) {
        const result = validateTime(input);
        if (result.valid && result.normalized === expected) {
            pass(`"${input}" → "${expected}"`);
            passed++;
        } else {
            fail(`"${input}" deveria ser "${expected}"`, expected, result.normalized);
            failed++;
        }
    }

    // Horários inválidos (fora do comercial)
    const invalidTimes = ['3h', 'as 5', '23:00', 'às 2'];
    for (const time of invalidTimes) {
        const result = validateTime(time);
        if (!result.valid) {
            pass(`"${time}" rejeitado (fora do horário comercial)`);
            passed++;
        } else {
            fail(`"${time}" deveria ser rejeitado`, false, result);
            failed++;
        }
    }

    log(`\n  Resultado: ${passed} passou, ${failed} falhou`, failed === 0 ? 'green' : 'red');
    return { passed, failed };
}

// ════════════════════════════════════════════════════════════════════
// TESTES DE VALIDAÇÃO DE EMAIL
// ════════════════════════════════════════════════════════════════════

function testValidateEmail() {
    section('TESTE: validateEmail()');

    let passed = 0;
    let failed = 0;

    // Emails válidos
    const validEmails = ['test@example.com', 'user.name@domain.org', 'gastao@gmail.com'];
    for (const email of validEmails) {
        const result = validateEmail(email);
        if (result.valid) {
            pass(`"${email}" é um email válido`);
            passed++;
        } else {
            fail(`"${email}" deveria ser válido`, true, result);
            failed++;
        }
    }

    // Emails inválidos
    const invalidEmails = ['notanemail', 'missing@domain', '@nodomain.com', 'spaces in@email.com'];
    for (const email of invalidEmails) {
        const result = validateEmail(email);
        if (!result.valid) {
            pass(`"${email}" rejeitado (formato inválido)`);
            passed++;
        } else {
            fail(`"${email}" deveria ser rejeitado`, false, result);
            failed++;
        }
    }

    log(`\n  Resultado: ${passed} passou, ${failed} falhou`, failed === 0 ? 'green' : 'red');
    return { passed, failed };
}

// ════════════════════════════════════════════════════════════════════
// TESTES DE MERGE DE VARIÁVEIS
// ════════════════════════════════════════════════════════════════════

function testMergeVariables() {
    section('TESTE: mergeVariables()');

    let passed = 0;
    let failed = 0;

    // Teste 1: Merge simples
    const existing1: AgentVariables = { nome: null, email: null, telefone: null, area: null, desafio: null, data_reuniao: null, horario_reuniao: null };
    const extracted1 = { nome: 'Gastão', email: 'gastao@gmail.com' };
    const result1 = mergeVariables(existing1, extracted1);

    if (result1.nome === 'Gastão' && result1.email === 'gastao@gmail.com') {
        pass('Merge simples funciona');
        passed++;
    } else {
        fail('Merge simples', { nome: 'Gastão', email: 'gastao@gmail.com' }, result1);
        failed++;
    }

    // Teste 2: Proteger nome existente
    const existing2: AgentVariables = { nome: 'Gastão', email: null, telefone: null, area: null, desafio: null, data_reuniao: null, horario_reuniao: null };
    const extracted2 = { nome: 'segunda' }; // Tentativa de substituir
    const result2 = mergeVariables(existing2, extracted2, { protectExisting: true });

    if (result2.nome === 'Gastão') {
        pass('Nome existente protegido (não substituído por "segunda")');
        passed++;
    } else {
        fail('Nome existente deveria ser protegido', 'Gastão', result2.nome);
        failed++;
    }

    // Teste 3: Rejeitar nome inválido mesmo sem existente
    const existing3: AgentVariables = { nome: null, email: null, telefone: null, area: null, desafio: null, data_reuniao: null, horario_reuniao: null };
    const extracted3 = { nome: 'segunda' };
    const result3 = mergeVariables(existing3, extracted3, { validateBeforeMerge: true });

    if (result3.nome === null) {
        pass('"segunda" rejeitado como nome (validação falhou)');
        passed++;
    } else {
        fail('"segunda" deveria ser rejeitado', null, result3.nome);
        failed++;
    }

    log(`\n  Resultado: ${passed} passou, ${failed} falhou`, failed === 0 ? 'green' : 'red');
    return { passed, failed };
}

// ════════════════════════════════════════════════════════════════════
// SIMULAÇÃO DE CONVERSA COMPLETA
// ════════════════════════════════════════════════════════════════════

function simulateConversation() {
    section('SIMULAÇÃO: Conversa Completa');

    // Criar estado inicial
    const state = createInitialState('thread_123', 'agent_456', 'user_789');
    log('\n  Estado inicial criado', 'blue');

    // Simular mensagens
    const messages = [
        { user: 'Olá, meu nome é Gastão', expected: { nome: 'Gastão' } },
        { user: 'Tenho uma loja de sapatos', expected: { area: 'loja de sapatos' } },
        { user: 'Meu desafio é o tempo de atendimento', expected: { desafio: 'tempo de atendimento' } },
        { user: 'segunda', expected: { data_reuniao: '29/12' } }, // Não deve virar nome!
        { user: 'as 16', expected: { horario_reuniao: '16:00' } },
        { user: 'gastao@gmail.com', expected: { email: 'gastao@gmail.com' } },
    ];

    let currentVars: AgentVariables = state.variables;

    for (const { user, expected } of messages) {
        log(`\n  👤 Usuário: "${user}"`, 'cyan');

        // Simular extração (simplificada)
        const extracted: Partial<AgentVariables> = {};

        // Extrair dados da mensagem
        if (/^[a-zA-ZÀ-ú]+$/.test(user) && user.length < 20) {
            const nameValidation = validateName(user);
            if (nameValidation.valid && !currentVars.nome) {
                extracted.nome = user;
            }
        }

        if (user.includes('@')) {
            extracted.email = user.toLowerCase();
        }

        if (/^[aàá]s?\s*\d/i.test(user)) {
            const timeResult = validateTime(user);
            if (timeResult.valid) {
                extracted.horario_reuniao = timeResult.normalized;
            }
        }

        if (['segunda', 'terça', 'quarta', 'quinta', 'sexta'].includes(user.toLowerCase())) {
            extracted.data_reuniao = '29/12'; // Simplificado para teste
        }

        // Merge com validação
        currentVars = mergeVariables(currentVars, extracted, {
            protectExisting: true,
            validateBeforeMerge: true
        });

        log(`  📊 Variáveis atuais:`, 'yellow');
        log(`     nome: ${currentVars.nome || '(não definido)'}`, 'reset');
        log(`     email: ${currentVars.email || '(não definido)'}`, 'reset');
        log(`     data: ${currentVars.data_reuniao || '(não definido)'}`, 'reset');
        log(`     hora: ${currentVars.horario_reuniao || '(não definido)'}`, 'reset');
    }

    // Verificação final
    log('\n  🎯 Verificação Final:', 'bold');

    if (currentVars.nome === 'Gastão') {
        pass('Nome = "Gastão" (não foi substituído por "segunda")');
    } else {
        fail('Nome deveria ser "Gastão"', 'Gastão', currentVars.nome);
    }

    if (currentVars.data_reuniao === '29/12') {
        pass('Data = "29/12" (segunda-feira)');
    } else {
        fail('Data deveria ser "29/12"', '29/12', currentVars.data_reuniao);
    }

    if (currentVars.horario_reuniao === '16:00') {
        pass('Horário = "16:00"');
    } else {
        fail('Horário deveria ser "16:00"', '16:00', currentVars.horario_reuniao);
    }

    if (currentVars.email === 'gastao@gmail.com') {
        pass('Email = "gastao@gmail.com"');
    } else {
        fail('Email deveria ser "gastao@gmail.com"', 'gastao@gmail.com', currentVars.email);
    }
}

// ════════════════════════════════════════════════════════════════════
// EXECUÇÃO PRINCIPAL
// ════════════════════════════════════════════════════════════════════

async function main() {
    console.log('');
    log('╔══════════════════════════════════════════════════════════════╗', 'bold');
    log('║     SIMULAÇÃO DE TESTES - AGENTE IA                         ║', 'bold');
    log('╚══════════════════════════════════════════════════════════════╝', 'bold');

    const results = {
        name: testValidateName(),
        time: testValidateTime(),
        email: testValidateEmail(),
        merge: testMergeVariables(),
    };

    simulateConversation();

    // Resumo final
    section('RESUMO FINAL');

    const totalPassed = Object.values(results).reduce((acc, r) => acc + r.passed, 0);
    const totalFailed = Object.values(results).reduce((acc, r) => acc + r.failed, 0);

    log(`\n  Total: ${totalPassed} testes passaram, ${totalFailed} falharam`, totalFailed === 0 ? 'green' : 'red');

    if (totalFailed === 0) {
        log('\n  🎉 TODOS OS TESTES PASSARAM!', 'green');
    } else {
        log('\n  ⚠️ Alguns testes falharam. Verifique os detalhes acima.', 'yellow');
    }

    console.log('');
}

main().catch(console.error);
