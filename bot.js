const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');

// ====================== ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ======================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

// Проверка наличия токена
if (!BOT_TOKEN) {
    console.error('❌ Ошибка: BOT_TOKEN не найден в переменных окружения!');
    process.exit(1);
}

if (!ADMIN_ID) {
    console.error('❌ Ошибка: ADMIN_ID не найден в переменных окружения!');
    process.exit(1);
}

// ====================== ИНИЦИАЛИЗАЦИЯ FIREBASE ======================
const serviceAccount = {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI || "https://accounts.google.com/o/oauth2/auth",
    token_uri: process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL || "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
};

const databaseURL = process.env.FIREBASE_DATABASE_URL;

// Проверка наличия необходимых Firebase переменных
if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
    console.error('❌ Ошибка: Не все Firebase переменные окружения заданы!');
    console.error('Требуются: FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL');
    process.exit(1);
}

if (!databaseURL) {
    console.error('❌ Ошибка: FIREBASE_DATABASE_URL не найден!');
    process.exit(1);
}

// Инициализация Firebase Admin
try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: databaseURL
    });
    console.log('✅ Firebase инициализирован');
} catch (error) {
    console.error('❌ Ошибка инициализации Firebase:', error.message);
    process.exit(1);
}

const db = admin.database();

// ====================== СОЗДАНИЕ БОТА ======================
const bot = new Telegraf(BOT_TOKEN);

// Состояния пользователей (для пошагового добавления товара)
const userStates = new Map();

// ====================== КОМАНДЫ ======================

// Команда /start
bot.start((ctx) => {
    if (ctx.from.id !== ADMIN_ID) {
        return ctx.reply('⛔ У вас нет доступа к этому боту.');
    }
    
    ctx.reply(
        '👋 *Добро пожаловать в админ-бота ISSTERIKA!*\n\n' +
        '📦 Управляйте товарами прямо из Telegram\n\n' +
        '*Доступные команды:*\n' +
        '/add — ➕ Добавить новый товар\n' +
        '/stats — 📊 Статистика магазина\n' +
        '/list — 📋 Список товаров\n' +
        '/cancel — ❌ Отменить добавление\n' +
        '/help — ❓ Помощь',
        { parse_mode: 'Markdown' }
    );
});

// Команда /help
bot.help((ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    ctx.reply(
        '🤖 *Помощь по боту ISSTERIKA*\n\n' +
        '*Добавление товара:*\n' +
        '1. Нажмите /add\n' +
        '2. Следуйте инструкциям\n' +
        '3. В любой момент нажмите /cancel для отмены\n\n' +
        '*Категории:*\n' +
        '1 — Жидкость\n' +
        '2 — Под-система\n' +
        '3 — Снюс\n' +
        '4 — Расходник\n\n' +
        '*Пример:*\n' +
        'Категория: 1\n' +
        'Название: ЗЛАЯ МОНАШКА\n' +
        'Вкус: Арбуз\n' +
        'Цена: 25.90\n' +
        'Скидка: 0\n' +
        'Количество: 5\n' +
        'Крепость: 70mg',
        { parse_mode: 'Markdown' }
    );
});

// Команда /add — начало добавления товара
bot.command('add', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    userStates.set(ctx.from.id, { step: 'category' });
    ctx.reply(
        '📦 *Добавление нового товара*\n\n' +
        '*Выберите категорию:*\n' +
        '1️⃣ Жидкость\n' +
        '2️⃣ Под-система\n' +
        '3️⃣ Снюс\n' +
        '4️⃣ Расходник\n\n' +
        'Отправьте номер категории (1-4)\n\n' +
        'Или нажмите /cancel для отмены',
        { parse_mode: 'Markdown' }
    );
});

// Команда /stats — статистика
bot.command('stats', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    await ctx.reply('📊 *Загрузка статистики...*', { parse_mode: 'Markdown' });
    
    try {
        const snapshot = await db.ref('products').once('value');
        const products = snapshot.val();
        
        if (!products) {
            return ctx.reply('📊 *Нет товаров для статистики*\n\nДобавьте первый товар через /add', { parse_mode: 'Markdown' });
        }
        
        const productsArray = Object.values(products);
        const total = productsArray.length;
        
        let inStock = 0;
        let reserved = 0;
        let outOfStock = 0;
        let withDiscount = 0;
        let withoutDiscount = 0;
        let totalValue = 0;
        
        const categories = {
            liquid: 0,
            pod: 0,
            snus: 0,
            other: 0
        };
        
        productsArray.forEach(p => {
            // Категории
            const cat = p.category || 'other';
            if (categories.hasOwnProperty(cat)) categories[cat]++;
            
            // Наличие
            if (p.quantity === 'reserved') {
                reserved++;
            } else if (p.quantity === 0 || p.quantity === '0') {
                outOfStock++;
            } else {
                inStock++;
            }
            
            // Скидки
            if (p.discount && p.discount > 0) {
                withDiscount++;
            } else {
                withoutDiscount++;
            }
            
            // Общая стоимость
            const price = parseFloat(p.price) || 0;
            let qty = 0;
            if (p.quantity !== 'reserved' && p.quantity !== 0 && p.quantity !== '0') {
                qty = parseInt(p.quantity) || 0;
            }
            totalValue += price * qty;
        });
        
        const categoryText = 
            `🍬 Жидкости: ${categories.liquid}\n` +
            `📱 Под-системы: ${categories.pod}\n` +
            `👃 Снюс: ${categories.snus}\n` +
            `🔧 Расходники: ${categories.other}`;
        
        await ctx.reply(
            `📊 *СТАТИСТИКА МАГАЗИНА ISSTERIKA*\n\n` +
            `📦 *Всего товаров:* ${total}\n` +
            `✅ *В наличии:* ${inStock}\n` +
            `🔸 *Забронировано:* ${reserved}\n` +
            `❌ *Нет в наличии:* ${outOfStock}\n` +
            `🏷️ *Со скидкой:* ${withDiscount}\n` +
            `💰 *Без скидки:* ${withoutDiscount}\n\n` +
            `💎 *Общая стоимость:* ${totalValue.toFixed(2)} BYN\n\n` +
            `*По категориям:*\n${categoryText}`,
            { parse_mode: 'Markdown' }
        );
        
    } catch (error) {
        console.error('Ошибка статистики:', error);
        ctx.reply('❌ *Ошибка загрузки статистики*\nПопробуйте позже', { parse_mode: 'Markdown' });
    }
});

// Команда /list — список товаров
bot.command('list', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    await ctx.reply('📋 *Загрузка списка товаров...*', { parse_mode: 'Markdown' });
    
    try {
        const snapshot = await db.ref('products').once('value');
        const products = snapshot.val();
        
        if (!products) {
            return ctx.reply('📋 *Нет товаров*\n\nДобавьте первый товар через /add', { parse_mode: 'Markdown' });
        }
        
        const productsArray = Object.entries(products);
        const total = productsArray.length;
        
        // Показываем последние 15 товаров
        const lastProducts = productsArray.slice(-15).reverse();
        
        let message = `📋 *Список товаров* (последние ${lastProducts.length} из ${total})\n\n`;
        
        for (const [id, p] of lastProducts) {
            const status = p.quantity === 'reserved' ? '🔸' : (p.quantity === 0 || p.quantity === '0' ? '❌' : '✅');
            const priceWithDiscount = p.discount && p.discount > 0 
                ? `${(parseFloat(p.price) - p.discount).toFixed(2)} BYN (было ${p.price})`
                : `${p.price} BYN`;
            
            message += `${status} *${p.name || 'Без названия'}*\n`;
            message += `   🏷️ ${priceWithDiscount}\n`;
            if (p.flavor) message += `   🍬 ${p.flavor}\n`;
            message += `   🆔 \`${id.slice(-8)}\`\n\n`;
            
            if (message.length > 3500) {
                message += `\n... и ещё ${productsArray.length - lastProducts.length} товаров`;
                break;
            }
        }
        
        await ctx.reply(message, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('Ошибка списка:', error);
        ctx.reply('❌ *Ошибка загрузки списка*', { parse_mode: 'Markdown' });
    }
});

// Команда /cancel — отмена добавления
bot.command('cancel', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    if (userStates.has(ctx.from.id)) {
        userStates.delete(ctx.from.id);
        ctx.reply('❌ *Добавление товара отменено*', { parse_mode: 'Markdown' });
    } else {
        ctx.reply('ℹ️ Нет активного процесса добавления', { parse_mode: 'Markdown' });
    }
});

// Команда /id — показать свой ID (для настройки)
bot.command('id', (ctx) => {
    ctx.reply(`🆔 *Ваш Telegram ID:* \`${ctx.from.id}\`\n\nЕсли это администратор, добавьте этот ID в переменную ADMIN_ID в Railway`, { parse_mode: 'Markdown' });
});

// ====================== ОБРАБОТКА ШАГОВ ДОБАВЛЕНИЯ ======================
bot.on('text', async (ctx) => {
    // Проверяем, что это админ
    if (ctx.from.id !== ADMIN_ID) return;
    
    // Проверяем, есть ли активный процесс
    const state = userStates.get(ctx.from.id);
    if (!state) return;
    
    const text = ctx.message.text.trim();
    
    // Пропускаем команды
    if (text.startsWith('/')) return;
    
    try {
        switch (state.step) {
            case 'category': {
                const categoryMap = {
                    '1': 'liquid',
                    '2': 'pod',
                    '3': 'snus',
                    '4': 'other'
                };
                
                const category = categoryMap[text];
                if (!category) {
                    return ctx.reply('❌ *Неверный выбор*\n\nОтправьте число от 1 до 4\n\n1 — Жидкость\n2 — Под-система\n3 — Снюс\n4 — Расходник', { parse_mode: 'Markdown' });
                }
                
                state.category = category;
                state.step = 'name';
                
                let prompt = '📝 *Введите название товара:*\n\n';
                if (category === 'liquid') prompt += 'Пример: ЗЛАЯ МОНАШКА, ГРЕХ, XROS 5';
                else if (category === 'pod') prompt += 'Пример: XROS 5, XROS MINI, BRUSKO';
                else if (category === 'snus') prompt += 'Пример: PODONKI SLICK, ICEBERG, FAFF';
                else prompt += 'Пример: Испарители, Спирали, Батареи';
                
                await ctx.reply(prompt + '\n\nИли /cancel для отмены', { parse_mode: 'Markdown' });
                break;
            }
            
            case 'name': {
                if (text.length < 2) {
                    return ctx.reply('❌ *Название слишком короткое*\nВведите минимум 2 символа', { parse_mode: 'Markdown' });
                }
                if (text.length > 100) {
                    return ctx.reply('❌ *Название слишком длинное*\nМаксимум 100 символов', { parse_mode: 'Markdown' });
                }
                
                state.name = text;
                state.step = 'flavor';
                
                let flavorPrompt = '';
                if (state.category === 'pod') {
                    flavorPrompt = '📱 *Введите описание/бренд:*\n\nПример: Vaporesso, 2ml, 1000mAh';
                } else if (state.category === 'other') {
                    flavorPrompt = '🔧 *Введите тип расходника:*\n\nПример: Испарители 0.8 Ом, Силиконовые уплотнители';
                } else {
                    flavorPrompt = '🍬 *Введите вкус/описание:*\n\nПример: Арбуз, Манго, Табачный, Кола';
                }
                
                await ctx.reply(flavorPrompt + '\n\nИли /cancel для отмены', { parse_mode: 'Markdown' });
                break;
            }
            
            case 'flavor': {
                if (text.length < 1) {
                    return ctx.reply('❌ *Введите описание*', { parse_mode: 'Markdown' });
                }
                
                state.flavor = text;
                state.step = 'price';
                await ctx.reply('💰 *Введите цену (BYN)*\n\nПример: 25.90 или 30\n\nИли /cancel для отмены', { parse_mode: 'Markdown' });
                break;
            }
            
            case 'price': {
                let price = parseFloat(text.replace(',', '.'));
                if (isNaN(price) || price < 0) {
                    return ctx.reply('❌ *Неверная цена*\n\nВведите число, например: 25.90\n\nИли /cancel для отмены', { parse_mode: 'Markdown' });
                }
                if (price > 10000) {
                    return ctx.reply('❌ *Цена слишком высокая*\n\nМаксимум 10000 BYN\n\nИли /cancel для отмены', { parse_mode: 'Markdown' });
                }
                
                state.price = price.toFixed(2);
                state.step = 'discount';
                await ctx.reply('🎯 *Введите скидку в BYN*\n\nВведите 0 если скидки нет\n\nПример: 5 или 0\n\nИли /cancel для отмены', { parse_mode: 'Markdown' });
                break;
            }
            
            case 'discount': {
                let discount = parseFloat(text.replace(',', '.'));
                if (isNaN(discount)) discount = 0;
                if (discount < 0) discount = 0;
                
                const priceNum = parseFloat(state.price);
                if (discount >= priceNum) {
                    return ctx.reply(`❌ *Скидка не может быть больше или равна цене*\n\nЦена: ${state.price} BYN\nСкидка должна быть меньше ${state.price}\n\nВведите другую сумму или /cancel`, { parse_mode: 'Markdown' });
                }
                
                state.discount = discount;
                state.step = 'quantity';
                await ctx.reply(
                    '📦 *Выберите количество*\n\n' +
                    '1️⃣ — 1 шт\n' +
                    '2️⃣ — 2 шт\n' +
                    '3️⃣ — 3 шт\n' +
                    '4️⃣ — 4 шт\n' +
                    '5️⃣ — 5 шт\n' +
                    '0️⃣ — Нет в наличии\n' +
                    '🔸 — Забронировано\n\n' +
                    'Отправьте число (0-5) или слово "забронировано"\n\nИли /cancel для отмены',
                    { parse_mode: 'Markdown' }
                );
                break;
            }
            
            case 'quantity': {
                let quantity;
                if (text.toLowerCase() === 'забронировано') {
                    quantity = 'reserved';
                } else {
                    const qty = parseInt(text);
                    if (isNaN(qty) || qty < 0 || qty > 5) {
                        return ctx.reply('❌ *Неверное количество*\n\nОтправьте число от 0 до 5 или слово "забронировано"\n\nИли /cancel для отмены', { parse_mode: 'Markdown' });
                    }
                    quantity = qty;
                }
                state.quantity = quantity;
                
                // Проверяем, нужно ли запрашивать крепость
                if (state.category === 'liquid' || state.category === 'snus') {
                    state.step = 'strength';
                    await ctx.reply('💪 *Введите крепость*\n\nПример: 60mg, 70mg\n\nИли отправьте "нет" если не нужно\n\nИли /cancel для отмены', { parse_mode: 'Markdown' });
                } else {
                    // Сохраняем товар
                    await saveProduct(ctx, state);
                }
                break;
            }
            
            case 'strength': {
                if (text.toLowerCase() !== 'нет' && text.length > 0) {
                    state.strength = text;
                }
                await saveProduct(ctx, state);
                break;
            }
        }
    } catch (error) {
        console.error('Ошибка обработки:', error);
        ctx.reply('❌ *Произошла ошибка*\nПопробуйте снова через /add', { parse_mode: 'Markdown' });
        userStates.delete(ctx.from.id);
    }
});

// Функция сохранения товара в Firebase
async function saveProduct(ctx, state) {
    const product = {
        name: state.name,
        flavor: state.flavor,
        category: state.category,
        price: state.price,
        quantity: state.quantity,
        createdAt: Date.now()
    };
    
    if (state.strength) {
        product.strength = state.strength;
    }
    
    if (state.discount > 0) {
        product.discount = state.discount;
    }
    
    try {
        const newRef = db.ref('products').push();
        await newRef.set(product);
        
        // Формируем сообщение об успехе
        let successMessage = `✅ *Товар успешно добавлен!*\n\n`;
        successMessage += `📦 *Название:* ${state.name}\n`;
        successMessage += `🍬 *Описание:* ${state.flavor}\n`;
        successMessage += `💰 *Цена:* ${state.price} BYN`;
        
        if (state.discount > 0) {
            const finalPrice = (parseFloat(state.price) - state.discount).toFixed(2);
            successMessage += `\n🎯 *Скидка:* ${state.discount} BYN (→ ${finalPrice} BYN)`;
        }
        
        if (state.strength) {
            successMessage += `\n💪 *Крепость:* ${state.strength}`;
        }
        
        let quantityText = '';
        if (state.quantity === 'reserved') quantityText = 'Забронировано 🔸';
        else if (state.quantity === 0) quantityText = 'Нет в наличии ❌';
        else quantityText = `${state.quantity} шт ✅`;
        successMessage += `\n📦 *Наличие:* ${quantityText}`;
        
        successMessage += `\n\n🆔 ID: \`${newRef.key.slice(-8)}\``;
        
        await ctx.reply(successMessage, { parse_mode: 'Markdown' });
        
        // Очищаем состояние
        userStates.delete(ctx.from.id);
        
    } catch (error) {
        console.error('Ошибка сохранения:', error);
        await ctx.reply('❌ *Ошибка сохранения товара в Firebase*\nПроверьте подключение к базе данных', { parse_mode: 'Markdown' });
        userStates.delete(ctx.from.id);
    }
}

// ====================== ЗАПУСК БОТА ======================
bot.launch().then(() => {
    console.log('🤖 Бот ISSTERIKA успешно запущен!');
    console.log(`📱 Бот: @${bot.botInfo?.username || 'unknown'}`);
    console.log(`👑 Админ ID: ${ADMIN_ID}`);
    console.log('✅ Ожидание команд...');
}).catch((error) => {
    console.error('❌ Ошибка запуска бота:', error);
    process.exit(1);
});

// Graceful stop
process.once('SIGINT', () => {
    console.log('🛑 Остановка бота (SIGINT)...');
    bot.stop('SIGINT');
    process.exit(0);
});
process.once('SIGTERM', () => {
    console.log('🛑 Остановка бота (SIGTERM)...');
    bot.stop('SIGTERM');
    process.exit(0);
});