const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN || '7636321016:AAGXKtaWIYgctWO-eF-Hjdxidm6NNITHBZY');
const app = express();

app.use(express.json());
app.use(cors());

// Configuración de la Base de Datos PostgreSQL (Supabase / Render)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Almacén temporal de órdenes de recarga pendientes
let rechargeOrders = {};

// Función para obtener o crear usuario y sus tarjetas en PostgreSQL
async function getOrCreateUser(telegramId, firstName = "Usuario") {
  let userResult = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  
  if (userResult.rows.length === 0) {
    // 1. Crear usuario si no existe
    await pool.query('INSERT INTO users (telegram_id, name) VALUES ($1, $2)', [telegramId, firstName]);
    
    // 2. Crear tarjetas por defecto
    await pool.query(
      `INSERT INTO cards (telegram_id, type, card_number, balance, expiry, status, gradient) 
       VALUES ($1, 'VISA', '4532 •••• •••• 8821', 145.50, '08/28', 'Activa', 'linear-gradient(135deg, #1d4ed8 0%, #1e1b4b 100%)'),
              ($1, 'MASTERCARD', '5412 •••• •••• 9934', 420.00, '12/27', 'Activa', 'linear-gradient(135deg, #dc2626 0%, #18181b 100%)'`,
      [telegramId]
    );

    // 3. Crear registro inicial en historial
    await pool.query(
      `INSERT INTO history (telegram_id, title, description, amount, date, type) 
       VALUES ($1, 'Recarga USDT (TRC20)', 'Visa •••• 8821', '+$50.00', 'Hace 2 horas', 'success')`,
      [telegramId]
    );

    userResult = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  }

  // Obtener tarjetas e historial actualizados de la BD
  const cardsResult = await pool.query('SELECT * FROM cards WHERE telegram_id = $1 ORDER BY id ASC', [telegramId]);
  const historyResult = await pool.query('SELECT * FROM history WHERE telegram_id = $1 ORDER BY id DESC', [telegramId]);

  return {
    name: userResult.rows[0].name,
    cards: cardsResult.rows,
    history: historyResult.rows
  };
}

// --- ENDPOINTS DE LA API ---

// 1. Obtener datos del usuario
app.get('/api/user/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const user = await getOrCreateUser(telegramId);
    res.json({ success: true, user });
  } catch (err) {
    console.error("Error al obtener usuario:", err);
    res.status(500).json({ success: false, message: "Error en el servidor" });
  }
});

// 2. Crear orden de recarga cripto
app.post('/api/recharge', (req, res) => {
  const { telegramId, cardId, amount, crypto } = req.body;
  const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
  
  const wallets = {
    "USDT (TRC20)": "TRX_sample_wallet_address_99812",
    "USDT (TON)": "UQ_ton_sample_address_77431",
    "TON (Toncoin)": "EQ_toncoin_sample_address_55210",
    "BTC (Bitcoin)": "bc1_bitcoin_sample_address_33421"
  };

  rechargeOrders[orderId] = {
    telegramId,
    cardId,
    amount: parseFloat(amount),
    crypto,
    status: 'PENDING'
  };

  res.json({
    success: true,
    orderId,
    address: wallets[crypto] || "EQ_default_wallet_address",
    message: "Orden generada. Realiza el envío para acreditar el saldo."
  });
});

// 3. Confirmar pago y actualizar saldo en PostgreSQL
app.post('/api/confirm-payment', async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = rechargeOrders[orderId];

    if (!order || order.status === 'COMPLETED') {
      return res.status(400).json({ success: false, message: "Orden inválida o ya procesada." });
    }

    order.status = 'COMPLETED';

    // Actualizar saldo de la tarjeta en PostgreSQL
    await pool.query(
      'UPDATE cards SET balance = balance + $1 WHERE id = $2 AND telegram_id = $3',
      [order.amount, order.cardId, order.telegramId]
    );

    // Obtener tipo de tarjeta para el historial
    const cardRes = await pool.query('SELECT type FROM cards WHERE id = $1', [order.cardId]);
    const cardType = cardRes.rows.length > 0 ? cardRes.rows[0].type : 'Tarjeta';

    // Insertar movimiento en la tabla history de PostgreSQL
    await pool.query(
      `INSERT INTO history (telegram_id, title, description, amount, date, type) 
       VALUES ($1, $2, $3, $4, 'Justo ahora', 'success')`,
      [order.telegramId, `Recarga ${order.crypto}`, `${cardType} ••••`, `+$${order.amount.toFixed(2)}`]
    );

    // Enviar notificación automática por Telegram
    try {
      await bot.telegram.sendMessage(
        order.telegramId,
        `✅ *¡Recarga Acreditada con Éxito!*\n\nSe han sumado *$${order.amount.toFixed(2)} USD* a tu tarjeta mediante ${order.crypto}.\n\n💳 Tu saldo ya está actualizado.`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.log("No se pudo enviar la notificación de Telegram:", err.message);
    }

    res.json({ success: true, message: "Pago confirmado y guardado en la base de datos." });
  } catch (err) {
    console.error("Error al confirmar pago:", err);
    res.status(500).json({ success: false, message: "Error interno del servidor" });
  }
});

// 4. Adquirir y guardar nueva tarjeta en PostgreSQL
app.post('/api/buy-card', async (req, res) => {
  try {
    const { telegramId, cardType } = req.body;

    const lastDigits = Math.floor(1000 + Math.random() * 9000);
    const isVisa = cardType.toLowerCase().includes('visa');
    const typeName = isVisa ? 'VISA' : 'MASTERCARD';
    const cardNumber = `${isVisa ? '4532' : '5412'} •••• •••• ${lastDigits}`;
    const gradient = isVisa ? 'linear-gradient(135deg, #1d4ed8 0%, #1e1b4b 100%)' : 'linear-gradient(135deg, #dc2626 0%, #18181b 100%)';

    // Insertar nueva tarjeta en la base de datos
    const newCardResult = await pool.query(
      `INSERT INTO cards (telegram_id, type, card_number, balance, expiry, status, gradient) 
       VALUES ($1, $2, $3, 0.00, '12/29', 'Activa', $4) RETURNING *`,
      [telegramId, typeName, cardNumber, gradient]
    );

    // Registrar en el historial de PostgreSQL
    await pool.query(
      `INSERT INTO history (telegram_id, title, description, amount, date, type) 
       VALUES ($1, $2, 'Nueva tarjeta virtual', '-$0.00', 'Justo ahora', 'info')`,
      [telegramId, `Emisión de ${typeName}`]
    );

    // Notificar al usuario por Telegram
    try {
      await bot.telegram.sendMessage(
        telegramId,
        `🎉 *¡Nueva Tarjeta ${typeName} Emitida!*\n\nTu tarjeta virtual ha sido creada y guardada con éxito en tu cuenta.`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {}

    res.json({ success: true, message: "Tarjeta emitida y guardada en BD", card: newCardResult.rows[0] });
  } catch (err) {
    console.error("Error al emitir tarjeta:", err);
    res.status(500).json({ success: false, message: "Error al guardar tarjeta" });
  }
});

// --- COMANDO /START DEL BOT ---
bot.start((ctx) => {
  const userName = ctx.from.first_name || 'Usuario';
  getOrCreateUser(ctx.from.id, userName);
  const webAppUrl = process.env.WEB_APP_URL || 'https://tu-mini-app.vercel.app';

  ctx.reply(
    `¡Hola, *${userName}*! 💳⚡\n\nTu cuenta está conectada de forma segura a nuestra base de datos en la nube. Abre tu panel para gestionar tus tarjetas:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Abrir Panel Cripto', webAppUrl)]
      ])
    }
  );
});

bot.launch();
console.log('🤖 Bot y Base de Datos PostgreSQL sincronizados correctamente...');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
