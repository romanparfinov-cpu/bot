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

// Категории с эмодзи
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

// Клавиатура "Добавить еще"
const addMoreKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Да, добавить еще', 'add_more')],
    [Markup.button.callback('🏠 Завершить', 'finish_add')]
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
        '📖 *Как добавить товар:*\n\n' +
        '1️⃣ Нажмите /add\n' +
        '2️⃣ Выберите категорию\n' +
        '3️⃣ Отправьте данные одной строкой в формате:\n\n' +
        '`Название | Описание | Цена | Количество`\n\n' +
        '📌 *Для жидкостей и снюса:*\n' +
        '`Название | Описание | Крепость | Цена | Количество`\n\n' +
        '📌 *Количество:* число (1-5) или 0 (нет) или "забронировано"\n\n' +
        '📌 *Пример:*\n' +
        '`ЗЛАЯ МОНАШКА | Арбуз | 70mg | 25.90 | 5`\n\n' +
        'После добавления сможете добавить еще товар или завершить.',
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
        userStates.set(ctx.from.id, { step: 'data', category: category.code, needsStrength: category.needsStrength, products: [] });
    } else {
        state.step = 'data';
        state.category = category.code;
        state.needsStrength = category.needsStrength;
    }
    
    let instruction = `📦 *Категория:* ${category.name}\n\n`;
    instruction += `📝 *Отправьте данные товара одной строкой в формате:*\n\n`;
    
    if (category.needsStrength) {
        instruction += '`Название | Описание | Крепость | Цена | Количество`\n\n';
        instruction += '📌 *Пример:*\n`ЗЛАЯ МОНАШКА | Арбуз | 70mg | 25.90 | 5`\n\n';
    } else {
        instruction += '`Название | Описание | Цена | Количество`\n\n';
        instruction += '📌 *Пример:*\n`XROS 5 | Vaporesso, 1000mAh | 89.90 | 3`\n\n';
    }
    
    instruction += '💡 *Количество:* число (1-5), 0 (нет в наличии) или "забронировано"\n\n';
    instruction += 'Или нажмите /cancel для отмены';
    
    ctx.reply(instruction, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

bot.action('add_more', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery();
    
    const state = userStates.get(ctx.from.id);
    if (state) {
        state.step = 'data';
        ctx.reply(
            '📦 *Добавляем следующий товар*\n\n' +
            'Отправьте данные в том же формате, что и предыдущий товар\n\n' +
            'Или /cancel для отмены',
            { parse_mode: 'Markdown' }
        );
    }
    ctx.answerCbQuery();
});

bot.action('finish_add', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery();
    
    const state = userStates.get(ctx.from.id);
    if (state && state.products && state.products.length > 0) {
        ctx.reply(
            `✅ *Готово!* Добавлено товаров: ${state.products.length}\n\n` +
            `Используйте /add для новых товаров или /stats для статистики`,
            { parse_mode: 'Markdown' }
        );
    } else {
        ctx.reply('ℹ️ Товары не были добавлены', { parse_mode: 'Markdown' });
    }
    
    userStates.delete(ctx.from.id);
    ctx.answerCbQuery();
});

bot.action('cancel_add', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery();
    userStates.delete(ctx.from.id);
    ctx.reply('❌ *Добавление отменено*', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

// ====================== ОБРАБОТКА ТЕКСТА (ДАННЫЕ ТОВАРА) ======================
bot.on('text', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    const state = userStates.get(ctx.from.id);
    if (!state || state.step !== 'data') return;
    
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    
    // Разделяем по |
    const parts = text.split('|').map(p => p.trim());
    
    let name, flavor, strength, price, quantity;
    
    if (state.needsStrength) {
        // Формат: Название | Описание | Крепость | Цена | Количество
        if (parts.length < 5) {
            return ctx.reply(
                '❌ *Неверный формат!*\n\n' +
                'Для жидкостей и снюса нужно:\n' +
                '`Название | Описание | Крепость | Цена | Количество`\n\n' +
                '📌 *Пример:*\n`ЗЛАЯ МОНАШКА | Арбуз | 70mg | 25.90 | 5`\n\n' +
                'Попробуйте снова или /cancel',
                { parse_mode: 'Markdown' }
            );
        }
        name = parts[0];
        flavor = parts[1];
        strength = parts[2];
        price = parts[3];
        quantity = parts[4];
    } else {
        // Формат: Название | Описание | Цена | Количество
        if (parts.length < 4) {
            return ctx.reply(
                '❌ *Неверный формат!*\n\n' +
                'Нужно:\n' +
                '`Название | Описание | Цена | Количество`\n\n' +
                '📌 *Пример:*\n`XROS 5 | Vaporesso, 1000mAh | 89.90 | 3`\n\n' +
                'Попробуйте снова или /cancel',
                { parse_mode: 'Markdown' }
            );
        }
        name = parts[0];
        flavor = parts[1];
        price = parts[2];
        quantity = parts[3];
        strength = null;
    }
    
    // Валидация
    if (!name || name.length < 2) {
        return ctx.reply('❌ *Название слишком короткое*', { parse_mode: 'Markdown' });
    }
    
    if (!flavor) {
        return ctx.reply('❌ *Введите описание*', { parse_mode: 'Markdown' });
    }
    
    let priceNum = parseFloat(price.replace(',', '.'));
    if (isNaN(priceNum) || priceNum < 0) {
        return ctx.reply('❌ *Неверная цена*', { parse_mode: 'Markdown' });
    }
    if (priceNum > 10000) {
        return ctx.reply('❌ *Цена не может превышать 10000 BYN*', { parse_mode: 'Markdown' });
    }
    
    let quantityValue;
    if (quantity.toLowerCase() === 'забронировано') {
        quantityValue = 'reserved';
    } else {
        let qty = parseInt(quantity);
        if (isNaN(qty) || qty < 0 || qty > 5) {
            return ctx.reply('❌ *Неверное количество*\n\nДопустимо: 0-5 или "забронировано"', { parse_mode: 'Markdown' });
        }
        quantityValue = qty;
    }
    
    // Сохраняем товар
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
        
        // Добавляем в список добавленных товаров
        if (!state.products) state.products = [];
        state.products.push({ name, price: priceNum });
        
        // Показываем успех и спрашиваем "добавить еще?"
        let successMsg = `✅ *Товар добавлен!*\n\n`;
        successMsg += `📦 ${name}\n`;
        successMsg += `💰 ${priceNum.toFixed(2)} BYN\n`;
        if (strength) successMsg += `💪 ${strength}\n`;
        successMsg += `📊 ${quantityValue === 'reserved' ? 'Забронировано' : quantityValue + ' шт'}\n`;
        successMsg += `🆔 \`${newRef.key.slice(-8)}\``;
        
        await ctx.reply(successMsg, { parse_mode: 'Markdown', ...addMoreKeyboard });
        
    } catch (error) {
        console.error('Ошибка сохранения:', error);
        ctx.reply('❌ *Ошибка сохранения товара*', { parse_mode: 'Markdown' });
    }
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
        const categories = { liquid: 0, pod: 0, snus: 0, other: 0 };
        
        productsArray.forEach(p => {
            const cat = p.category || 'other';
            if (categories.hasOwnProperty(cat)) categories[cat]++;
            
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
            `🍬 Жидкости: ${categories.liquid}\n` +
            `📱 Под-системы: ${categories.pod}\n` +
            `👃 Снюс: ${categories.snus}\n` +
            `🔧 Расходники: ${categories.other}`,
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