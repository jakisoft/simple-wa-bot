import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import chalk from 'chalk';
import fs from 'fs';

const logger = pino({ level: 'silent' }); 

const displayCLI = (version, user = null, isBusiness = false) => {
    console.clear();
    console.log(chalk.bold.cyan('JKSoft WhatsApp Bot CLI'));
    console.log(chalk.cyan('‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾'));
    console.log(chalk.white('Library  : ') + chalk.green('@whiskeysockets/baileys'));
    console.log(chalk.white('Version  : ') + chalk.green(`WA v${version.join('.')}`));
    console.log(chalk.white('Method   : ') + chalk.green('Pairing Code'));
    console.log(chalk.white('Session  : ') + chalk.green('./sessions'));

    if (user) {
        const number = user.id.split(':')[0].split('@')[0];
        console.log(chalk.white('Status   : ') + chalk.bold.green('Connected'));
        console.log(chalk.white('Number   : ') + chalk.green(number));
        console.log(chalk.white('Name     : ') + chalk.green(user.name || 'Unknown'));
        console.log(chalk.white('Type     : ') + chalk.green(isBusiness ? 'WhatsApp Business' : 'WhatsApp Regular'));
    } else {
        console.log(chalk.white('Status   : ') + chalk.yellow('Connecting...'));
    }
    console.log('\n');
};

const question = (text) => {
    return new Promise((resolve) => {
        console.log(text);
        process.stdout.write(chalk.bold.green('> '));
        process.stdin.resume();
        process.stdin.once('data', (data) => {
            process.stdin.pause();
            resolve(data.toString().trim());
        });
    });
};

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./sessions');
    const { version } = await fetchLatestBaileysVersion();

    displayCLI(version);

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        generateHighQualityLinkPreview: true,
    });

    if (!sock.authState.creds.registered) {
        let cleanNumber = '';
        
        while (!cleanNumber) {
            const phoneNumber = await question(chalk.bold.white('Masukkan nomor WhatsApp:'));
            const parsedNumber = phoneNumber.replace(/[^0-9]/g, '');
            
            if (parsedNumber && parsedNumber.length >= 10) {
                cleanNumber = parsedNumber;
            } else {
                console.log(chalk.bold.red('\n[ERROR] Nomor tidak valid! Harap masukkan angka yang benar.\n'));
            }
        }
        
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(cleanNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(chalk.bold.yellow(`\nKode Pairing Anda: ${formattedCode}`));
            } catch (error) {
                console.error(chalk.bold.red('\n[ERROR] Gagal mendapatkan kode pairing:'), error);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            
            const fatalErrors = [
                DisconnectReason.loggedOut, 
                DisconnectReason.badSession
            ];

            if (fatalErrors.includes(statusCode)) {
                console.log(chalk.bold.red('\n[SYSTEM] Kendala serius terdeteksi (Sesi tidak valid/Logout).'));
                console.log(chalk.bold.red('[SYSTEM] Menghapus folder sessions dan memulai ulang...'));
                if (fs.existsSync('./sessions')) {
                    fs.rmSync('./sessions', { recursive: true, force: true });
                }
                setTimeout(connectToWhatsApp, 3000);
            } else {
                console.log(chalk.yellow('\n[SYSTEM] Koneksi terputus. Menghubungkan ulang...'));
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            let isBusiness = false;
            try {
                const biz = await sock.getBusinessProfile(sock.user.id);
                if (biz) isBusiness = true;
            } catch (err) {}
            
            displayCLI(version, sock.user, isBusiness);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const messageType = Object.keys(msg.message)[0];
        const textMessage = messageType === 'conversation' ? msg.message.conversation 
                          : messageType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text 
                          : '';

        if (textMessage) {
            console.log(chalk.cyan(`[PESAN] ${sender.split('@')[0]}: ${textMessage}`));
        }

        if (textMessage.toLowerCase() === 'ping') {
            await sock.sendMessage(sender, { text: 'Pong!' }, { quoted: msg });
        }
    });
}

connectToWhatsApp();
