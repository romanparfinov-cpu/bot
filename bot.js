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
    [Markup.button.callback('🔧 Расходник', 'cat_4')],
    [Markup.button.callback('❌ Отмена', 'cancel_add')]
]);

// ====================== КОМАНДЫ ======================
bot.start((ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply('⛔ Нет доступа');
    
    ctx.reply(
        '👋 *Добро пожаловать в админ-бота ISSTERIKA!*\n\n' +
        '📦 *Управление товарами*\n\n' +
        '/add — ➕ Добавить товар\n' +
        '/stats — 📊 Статистика\n' +
        '/list — 📋 Список товаров\n' +
        '/cancel — ❌ Отменить\n' +
        '/help — ❓ Помощь',
        { parse_mode: 'Markdown' }
    );
});

bot.help((ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply(
        '📖 *Как добавить товары:*\n\n' +
        '1️⃣ Нажмите /add\n' +
        '2️⃣ Выберите категорию\n' +
        '3️⃣ Отправьте товары одной строкой или несколькими строками\n\n' +
        '*Формат для жидкостей и снюса:*\n' +
        '`Название | Описание | Крепость | Цена | Количество`\n\n' +
        '*Формат для под-систем и расходников:*\n' +
        '`Название | Описание | Цена | Количество`\n\n' +
        '*Пример (3 товара сразу):*\n' +
        '`ЗЛАЯ МОНАШКА | Арбуз | 70mg | 25.90 | 5\nЗЛАЯ МОНАШКА | Текила | 70mg | 25.90 | 3\nГРЕХ | Манго | 60mg | 22.90 | 4`\n\n' +
        'Количество: 0-5 или "забронировано"\n\n' +
        'Можете отправлять сколько угодно партий. /cancel — завершить.',
        { parse_mode: 'Markdown' }
    );
});

bot.command('add', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    userStates.set(ctx.from.id, { step: 'category', products: [] });
    ctx.reply(
        '📦 *Выберите категорию товара:*',
        { parse_mode: 'Markdown', ...categoryKeyboard }
    );
});

bot.command('cancel', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    const state = userStates.get(ctx.from.id);
    if (state) {
        const count = state.products?.length || 0;
        userStates.delete(ctx.from.id);
        ctx.reply(`❌ *Добавление отменено*\n\nДобавлено товаров: ${count}`, { parse_mode: 'Markdown' });
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
        userStates.set(ctx.from.id, { step: 'data', category: category.code, needsStrength: category.needsStrength, products: [] });
    } else {
        state.step = 'data';
        state.category = category.code;
        state.needsStrength = category.needsStrength;
    }
    
    let instruction = `📦 *Категория:* ${category.name}\n\n`;
    instruction += `📝 *Отправьте товары* (можно несколько, каждый с новой строки):\n\n`;
    
    if (category.needsStrength) {
        instruction += '*Формат:*\n`Название | Описание | Крепость | Цена | Количество`\n\n';
        instruction += '*Пример:*\n`ЗЛАЯ МОНАШКА | Арбуз | 70mg | 25.90 | 5`\n`ГРЕХ | Манго | 60mg | 22.90 | 3`\n\n';
    } else {
        instruction += '*Формат:*\n`Название | Описание | Цена | Количество`\n\n';
        instruction += '*Пример:*\n`XROS 5 | Vaporesso, 1000mAh | 89.90 | 3`\n\n';
    }
    
    instruction += '💡 *Количество:* 0-5 или "забронировано"\n\n';
    instruction += '📌 Можете отправлять несколько партий. /cancel — завершить.';
    
    ctx.reply(instruction, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

bot.action('cancel_add', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery();
    userStates.delete(ctx.from.id);
    ctx.reply('❌ *Добавление отменено*', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

// ====================== ОБРАБОТКА ТЕКСТА (МНОГО ТОВАРОВ) ======================
bot.on('text', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    const state = userStates.get(ctx.from.id);
    if (!state || state.step !== 'data') return;
    
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    
    // Разделяем на строки
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
                errors.push(`❌ Строка ${i+1}: нужно 5 полей (Название | Описание | Крепость | Цена | Количество)`);
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
                errors.push(`❌ Строка ${i+1}: нужно 4 поля (Название | Описание | Цена | Количество)`);
                continue;
            }
            name = parts[0];
            flavor = parts[1];
            price = parts[2];
            quantity = parts[3];
            strength = null;
        }
        
        // Валидация
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
            errors.push(`❌ Строка ${i+1}: неверная цена "${price}"`);
            continue;
        }
        if (priceNum > 10000) {
            errorCount++;
            errors.push(`❌ Строка ${i+1}: цена не может превышать 10000 BYN`);
            continue;
        }
        
        let quantityValue;
        if (quantity.toLowerCase() === 'забронировано') {
            quantityValue = 'reserved';
        } else {
            let qty = parseInt(quantity);
            if (isNaN(qty) || qty < 0 || qty > 5) {
                errorCount++;
                errors.push(`❌ Строка ${i+1}: неверное количество "${quantity}" (0-5 или "забронировано")`);
                continue;
            }
            quantityValue = qty;
        }
        
        // Сохраняем
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
            addedProducts.push({ name, price: priceNum, id: newRef.key.slice(-8), strength, flavor });
        } catch (error) {
            errorCount++;
            errors.push(`❌ Строка ${i+1}: ошибка базы данных`);
        }
    }
    
    // Сохраняем в историю
    if (!state.products) state.products = [];
    state.products.push(...addedProducts);
    
    // Ответ
    let resultMsg = '';
    
    if (successCount > 0) {
        resultMsg += `✅ *Добавлено: ${successCount}*\n\n`;
        const showCount = Math.min(5, addedProducts.length);
        for (let i = 0; i < showCount; i++) {
            const p = addedProducts[i];
            resultMsg += `📦 ${p.name}\n💰 ${p.price.toFixed(2)} BYN`;
            if (p.strength) resultMsg += ` | 💪 ${p.strength}`;
            resultMsg += `\n🆔 \`${p.id}\`\n\n`;
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

// ====================== СТАТИСТИКА ======================
bot.command('stats', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    await ctx.reply('📊 *Загрузка...*', { parse_mode: 'Markdown' });
    
    try {
        const snapshot = await db.ref('products').once('value');
        const products = snapshot.val();
        
        if (!products) {
            return ctx.reply('📊 *Нет товаров*\nДобавьте через /add', { parse_mode: 'Markdown' });
        }
        
        const productsArray = Object.values(products);
        const total = productsArray.length;
        
        let inStock = 0, reserved = 0, outOfStock = 0;
        let totalValue = 0;
        const cats = { liquid: 0, pod: 0, snus: 0, other: 0 };
        
        productsArray.forEach(p => {
            const cat = p.category || 'other';
            if (cats.hasOwnProperty(cat)) cats[cat]++;
            
            if (p.quantity === 'reserved') reserved++;
            else if (p.quantity === 0 || p.quantity === '0') outOfStock++;
            else inStock++;
            
            const price = parseFloat(p.price) || 0;
            let qty = 0;
            if (p.quantity !== 'reserved' && p.quantity !== 0 && p.quantity !== '0') {
                qty = parseInt(p.quantity) || 0;
            }
            totalValue += price * qty;
        });
        
        ctx.reply(
            `📊 *СТАТИСТИКА*\n\n` +
            `📦 Всего: ${total}\n` +
            `✅ В наличии: ${inStock}\n` +
            `🔸 Забронировано: ${reserved}\n` +
            `❌ Нет: ${outOfStock}\n` +
            `💰 Стоимость: ${totalValue.toFixed(2)} BYN\n\n` +
            `🍬 Жидкости: ${cats.liquid}\n` +
            `📱 Под-системы: ${cats.pod}\n` +
            `👃 Снюс: ${cats.snus}\n` +
            `🔧 Расходники: ${cats.other}`,
            { parse_mode: 'Markdown' }
        );
        
    } catch (error) {
        ctx.reply('❌ Ошибка', { parse_mode: 'Markdown' });
    }
});

// ====================== СПИСОК ТОВАРОВ ======================
bot.command('list', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    try {
        const snapshot = await db.ref('products').once('value');
        const products = snapshot.val();
        
        if (!products) {
            return ctx.reply('📋 *Нет товаров*', { parse_mode: 'Markdown' });
        }
        
        const productsArray = Object.entries(products).slice(-15).reverse();
        let message = `📋 *Последние 15 товаров:*\n\n`;
        
        for (const [id, p] of productsArray) {
            const status = p.quantity === 'reserved' ? '🔸' : (p.quantity === 0 || p.quantity === '0' ? '❌' : '✅');
            message += `${status} *${p.name}*\n   💰 ${p.price} BYN\n   🆔 \`${id.slice(-8)}\`\n\n`;
            if (message.length > 3500) break;
        }
        
        ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
        ctx.reply('❌ Ошибка', { parse_mode: 'Markdown' });
    }
});

// ====================== ЗАПУСК ======================
bot.launch().then(() => {
    console.log('🤖 Бот запущен!');
    console.log(`👑 Админ ID: ${ADMIN_ID}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));