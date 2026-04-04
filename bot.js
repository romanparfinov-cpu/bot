const { Telegraf, Markup } = require('telegraf');
const admin = require('firebase-admin');

// ====================== ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ======================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

if (!BOT_TOKEN) {
    console.error('❌ Ошибка: BOT_TOKEN не найден!');
    process.exit(1);
}

if (!ADMIN_ID) {
    console.error('❌ Ошибка: ADMIN_ID не найден!');
    process.exit(1);
}

// ====================== FIREBASE ======================
const serviceAccount = {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI || "https://accounts.google.com/o/oauth2/auth",
    token_uri: process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL || "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
};

const databaseURL = process.env.FIREBASE_DATABASE_URL;

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: databaseURL
    });
    console.log('✅ Firebase инициализирован');
} catch (error) {
    console.error('❌ Ошибка Firebase:', error.message);
    process.exit(1);
}

const db = admin.database();
const bot = new Telegraf(BOT_TOKEN);

// Состояния пользователей
const userStates = new Map();

// Категории
const categories = {
    '1': { name: '🍬 Жидкость', code: 'liquid', needsStrength: true },
    '2': { name: '📱 Под-система', code: 'pod', needsStrength: false },
    '3': { name: '👃 Снюс', code: 'snus', needsStrength: true },
    '4': { name: '🔧 Расходник', code: 'other', needsStrength: false }
};

// Клавиатура с категориями
const categoryKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🍬 Жидкость', 'cat_1')],
    [Markup.button.callback('📱 Под-система', 'cat_2')],
    [Markup.button.callback('👃 Снюс', 'cat_3')],
    [Markup.button.callback('🔧 Расходник', 'cat_4')]
]);

// ====================== КОМАНДЫ ======================
bot.start((ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply('⛔ Нет доступа');
    
    ctx.reply(
        '👋 *Добро пожаловать в бот ISSTERIKA!*\n\n' +
        '📦 *Добавление товаров*\n\n' +
        '/add — ➕ Добавить товар\n' +
        '/cancel — ❌ Отменить',
        { parse_mode: 'Markdown' }
    );
});

bot.command('add', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    userStates.set(ctx.from.id, { step: 'category' });
    ctx.reply(
        '📦 *Выберите категорию товара:*',
        { parse_mode: 'Markdown', ...categoryKeyboard }
    );
});

bot.command('cancel', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    if (userStates.has(ctx.from.id)) {
        userStates.delete(ctx.from.id);
        ctx.reply('❌ *Добавление отменено*', { parse_mode: 'Markdown' });
    } else {
        ctx.reply('ℹ️ Нет активного процесса', { parse_mode: 'Markdown' });
    }
});

// ====================== ОБРАБОТКА КНОПОК ======================
bot.action(/cat_(\d)/, (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery();
    
    const catNum = ctx.match[1];
    const category = categories[catNum];
    
    if (!category) return ctx.answerCbQuery('Ошибка');
    
    const state = userStates.get(ctx.from.id);
    if (!state) {
        userStates.set(ctx.from.id, { step: 'data', category: category.code, needsStrength: category.needsStrength });
    } else {
        state.step = 'data';
        state.category = category.code;
        state.needsStrength = category.needsStrength;
    }
    
    let instruction = `📦 *Категория:* ${category.name}\n\n`;
    instruction += `📝 *Отправьте товары* (можно несколько, каждый с новой строки):\n\n`;
    
    if (category.needsStrength) {
        instruction += '*Формат:*\n`Название | Описание | Крепость | Цена | Количество`\n\n';
        instruction += '*Пример:*\n`ЗЛАЯ МОНАШКА | Арбуз | 70mg | 25.90 | 5`\n`ГРЕХ | Манго | 60mg | 22.90 | 12`\n\n';
    } else {
        instruction += '*Формат:*\n`Название | Описание | Цена | Количество`\n\n';
        instruction += '*Пример:*\n`XROS 5 | Vaporesso, 1000mAh | 89.90 | 3`\n\n';
    }
    
    instruction += '*Количество:*\n';
    instruction += '• число от 1 до 20 — в наличии\n';
    instruction += '• 0 — нет в наличии\n';
    instruction += '• - или "забронировано" — забронировано\n\n';
    instruction += 'Можете отправлять несколько партий. /cancel — завершить.';
    
    ctx.reply(instruction, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

// ====================== ФУНКЦИЯ ПАРСИНГА КОЛИЧЕСТВА ======================
function parseQuantity(value) {
    const str = String(value).toLowerCase().trim();
    
    if (str === '-' || str === 'забронировано' || str === 'reserved') {
        return 'reserved';
    }
    
    const num = parseInt(str);
    if (isNaN(num)) return null;
    
    if (num === 0) return 0;
    if (num >= 1 && num <= 20) return num;
    
    return null;
}

// ====================== ОБРАБОТКА ТЕКСТА (ДОБАВЛЕНИЕ) ======================
bot.on('text', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    const state = userStates.get(ctx.from.id);
    if (!state || state.step !== 'data') return;
    
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    
    if (lines.length === 0) {
        return ctx.reply('❌ *Нет данных*', { parse_mode: 'Markdown' });
    }
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    const addedProducts = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.split('|').map(p => p.trim());
        
        let name, flavor, strength, price, quantity;
        
        if (state.needsStrength) {
            if (parts.length < 5) {
                errorCount++;
                errors.push(`❌ Строка ${i+1}: нужно 5 полей`);
                continue;
            }
            name = parts[0];
            flavor = parts[1];
            strength = parts[2];
            price = parts[3];
            quantity = parts[4];
        } else {
            if (parts.length < 4) {
                errorCount++;
                errors.push(`❌ Строка ${i+1}: нужно 4 поля`);
                continue;
            }
            name = parts[0];
            flavor = parts[1];
            price = parts[2];
            quantity = parts[3];
            strength = null;
        }
        
        if (!name || name.length < 2) {
            errorCount++;
            errors.push(`❌ Строка ${i+1}: название слишком короткое`);
            continue;
        }
        
        if (!flavor) {
            errorCount++;
            errors.push(`❌ Строка ${i+1}: описание не может быть пустым`);
            continue;
        }
        
        let priceNum = parseFloat(price.replace(',', '.'));
        if (isNaN(priceNum) || priceNum < 0) {
            errorCount++;
            errors.push(`❌ Строка ${i+1}: неверная цена`);
            continue;
        }
        if (priceNum > 10000) {
            errorCount++;
            errors.push(`❌ Строка ${i+1}: цена > 10000 BYN`);
            continue;
        }
        
        const quantityValue = parseQuantity(quantity);
        if (quantityValue === null) {
            errorCount++;
            errors.push(`❌ Строка ${i+1}: неверное количество (1-20, 0, - или "забронировано")`);
            continue;
        }
        
        const product = {
            name: name,
            flavor: flavor,
            category: state.category,
            price: priceNum.toFixed(2),
            quantity: quantityValue,
            createdAt: Date.now()
        };
        
        if (strength) {
            product.strength = strength;
        }
        
        try {
            const newRef = await db.ref('products').push(product);
            successCount++;
            addedProducts.push({ name, price: priceNum, id: newRef.key.slice(-8), strength, quantity: quantityValue });
        } catch (error) {
            errorCount++;
            errors.push(`❌ Строка ${i+1}: ошибка БД`);
        }
    }
    
    let resultMsg = '';
    
    if (successCount > 0) {
        resultMsg += `✅ *Добавлено: ${successCount}*\n\n`;
        const showCount = Math.min(5, addedProducts.length);
        for (let i = 0; i < showCount; i++) {
            const p = addedProducts[i];
            let qtyText = '';
            if (p.quantity === 'reserved') qtyText = 'Забронировано';
            else if (p.quantity === 0) qtyText = 'Нет';
            else qtyText = `${p.quantity} шт`;
            
            resultMsg += `📦 ${p.name}\n💰 ${p.price.toFixed(2)} BYN`;
            if (p.strength) resultMsg += ` | 💪 ${p.strength}`;
            resultMsg += ` | 📊 ${qtyText}\n🆔 \`${p.id}\`\n\n`;
        }
        if (addedProducts.length > 5) {
            resultMsg += `... и ещё ${addedProducts.length - 5}\n\n`;
        }
    }
    
    if (errorCount > 0) {
        resultMsg += `⚠️ *Ошибок: ${errorCount}*\n`;
        for (let i = 0; i < Math.min(3, errors.length); i++) {
            resultMsg += `${errors[i]}\n`;
        }
        if (errors.length > 3) resultMsg += `... и ещё ${errors.length - 3}\n`;
    }
    
    resultMsg += `\n📝 *Отправьте еще товары* или /cancel для завершения`;
    
    await ctx.reply(resultMsg, { parse_mode: 'Markdown' });
});

// ====================== ЗАПУСК ======================
bot.launch().then(() => {
    console.log('🤖 Бот ISSTERIKA запущен!');
    console.log(`👑 Админ ID: ${ADMIN_ID}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));