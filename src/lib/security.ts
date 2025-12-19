import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const RAW_KEY = process.env.ENCRYPTION_KEY || 'default-encryption-key-for-dev';
// Derivar chave de 32 bytes de qualquer tamanho de input usando SHA-256
const SECRET_KEY = crypto.createHash('sha256').update(RAW_KEY).digest();

export function encryptCredential(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Retorna: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decryptCredential(text: string): string {
    const parts = text.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted string format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}
