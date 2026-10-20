const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { Telegraf } = require('telegraf');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de la Base de Datos PostgreSQL (Supabase / Render)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Inicialización del Bot de Telegram con tu Token
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '7636321016:AAGXKtaWIYgctWO-eF-Hjdxidm6NNITHBZY');

// Iniciar bot de manera segura
bot.launch().catch(err => console.log("Bot launch warning:", err.message));

// ==========================================
// 1. OBTENER DATOS DINÁMICOS DEL USUARIO REAL DE TELEGRAM
// ==========================================
app.get('/api/user/:telegramId', async (req, res) => {
  const { telegramId } = req.params;

  try {
    let cardsResult = await pool.query('SELECT * FROM cards WHERE telegram_id = $1', [telegramId]);
    let historyResult = await pool.query('SELECT * FROM transactions WHERE telegram_id = $1 ORDER BY id DESC LIMIT 15', [telegramId]);

    res.json({
      success: true,
      user: {
        cards: cardsResult.rows,
        history: historyResult.rows
      }
    });

  } catch (err) {
    console.error("Error al obtener datos del usuario:", err);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ==========================================
// 2. EMITIR NUEVA TARJETA
// ==========================================
app.post('/api/buy-card', async (req, res) => {
  const { telegramId, cardType } = req.body;

  try {
    const cardNumber = '•••• ' + Math.floor(1000 + Math.random() * 9000);
    const gradient = cardType.includes('Mastercard') 
      ? 'linear-gradient(135deg, #7f1d1d 0%, #0f172a 100%)' 
      : 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)';

    await pool.query(
      `INSERT INTO cards (telegram_id, type, card_number, balance, expiry, status, gradient) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [telegramId, cardType.toUpperCase(), cardNumber, 0.00, '08/28', 'Activa', gradient]
    );

    await pool.query(
      `INSERT INTO transactions (telegram_id, title, description, amount, status) 
       VALUES ($1, $2, $3, $4, $5)`,
      [telegramId, `Emisión de Tarjeta`, cardType, '$0.00', 'COMPLETED']
    );

    try {
      await bot.telegram.sendMessage(
        telegramId,
        `💳 *¡Tarjeta emitida con éxito!*\n\nTu nueva tarjeta *${cardType}* ya está activa y lista para usar.`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.log("No se pudo notificar por Telegram:", e.message);
    }

    res.json({ success: true, message: 'Tarjeta emitida correctamente' });

  } catch (err) {
    console.error("Error al emitir tarjeta:", err);
    res.status(500).json({ success: false, error: 'Error al emitir tarjeta' });
  }
});

// ==========================================
// 3. CREAR ORDEN DE RECARGA CRIPTO
// ==========================================
app.post('/api/recharge', async (req, res) => {
  const { telegramId, cardId, amount, crypto } = req.body;

  try {
    const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
    
    let depositAddress = 'TY7z...USDT_TRC20_Default_Address...99xQ';
    if (crypto.includes('TON')) {
      depositAddress = 'UQAPEX...TON_SmartContract_Address...55a';
    } else if (crypto.includes('BTC')) {
      depositAddress = 'bc1q...Bitcoin_Segwit_Address...88zz';
    }

    await pool.query(
      `INSERT INTO transactions (telegram_id, card_id, title, description, amount, status, order_id, address) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [telegramId, cardId, `Recarga ${crypto}`, `Pendiente de pago`, `+$${amount}`, 'PENDING', orderId, depositAddress]
    );

    try {
      await bot.telegram.sendMessage(
        telegramId,
        `🔔 *¡Nueva orden de recarga creada!*\n\n` +
        `🆔 Orden: \`${orderId}\`\n` +
        `💰 Monto: \`$${amount} USD\`\n` +
        `🪙 Red: \`${crypto}\`\n` +
        `📍 Dirección de depósito:\n\`${depositAddress}\`\n\n` +
        `_Tu saldo se acreditará automáticamente tras la confirmación._`,
        { parse_mode: 'Markdown' }
      );
    } catch (botErr) {
      console.log("Aviso bot Telegram:", botErr.message);
    }

    res.json({
      success: true,
      orderId,
      amount,
      crypto,
      address: depositAddress
    });

  } catch (err) {
    console.error("Error al crear recarga:", err);
    res.status(500).json({ success: false, error: 'Error al procesar la orden' });
  }
});

// ==========================================
// 4. CONFIRMAR Y ACREDITAR PAGO
// ==========================================
app.post('/api/confirm-payment', async (req, res) => {
  const { orderId } = req.body;

  try {
    const orderQuery = await pool.query('SELECT * FROM transactions WHERE order_id = $1', [orderId]);
    if (orderQuery.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Orden no encontrada' });
    }

    const order = orderQuery.rows[0];
    if (order.status === 'COMPLETED') {
      return res.json({ success: false, error: 'Esta orden ya fue pagada' });
    }

    await pool.query('UPDATE transactions SET status = $1 WHERE order_id = $2', ['COMPLETED', orderId]);

    const numericAmount = parseFloat(order.amount.replace(/[^0-9.]/g, '')) || 0;

    if (order.card_id) {
      await pool.query(
        'UPDATE cards SET balance = balance + $1 WHERE id = $2',
        [numericAmount, order.card_id]
      );
    }

    try {
      await bot.telegram.sendMessage(
        order.telegram_id,
        `✅ *¡Pago confirmado con éxito!*\n\nSe han acreditado \`$${numericAmount} USD\` a tu tarjeta virtual.\n🆔 Orden: \`${orderId}\``,
        { parse_mode: 'Markdown' }
      );
    } catch (botErr) {
      console.log("Aviso éxito Telegram:", botErr.message);
    }

    res.json({ success: true, message: 'Pago acreditado correctamente' });

  } catch (err) {
    console.error("Error al confirmar pago:", err);
    res.status(500).json({ success: false, error: 'Error al confirmar el pago' });
  }
});

// ==========================================
// 5. OBTENER DATOS SENSIBLES DE LA TARJETA (PIN)
// ==========================================
app.post('/api/card-details', async (req, res) => {
  const { telegramId, cardId, pin } = req.body;

  try {
    if (pin && pin !== "1234") {
      return res.status(401).json({ success: false, error: 'PIN incorrecto' });
    }

    const cardQuery = await pool.query('SELECT * FROM cards WHERE id = $1 AND telegram_id = $2', [cardId, telegramId]);
    if (cardQuery.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Tarjeta no encontrada' });
    }

    const card = cardQuery.rows[0];

    res.json({
      success: true,
      cardNumber: card.type.includes('MASTER') ? '5412 8821 9934 1134' : '4314 7024 5669 9014',
      expiry: card.expiry || '08/28',
      cvv: '489',
      holder: 'APEX USER'
    });

  } catch (err) {
    console.error("Error al obtener detalles de tarjeta:", err);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ==========================================
// 6. CONVERSIÓN DE DIVISAS Y TASAS EN VIVO (Incluye RUB)
// ==========================================
app.post('/api/exchange-rate', async (req, res) => {
  const { fromCurrency, toCurrency, amount } = req.body;

  try {
    const numAmount = parseFloat(amount) || 0;
    
    let rates = {
      'USDT': 1.0,
      'USD': 1.0,
      'TON': 5.50,
      'BTC': 68000.00,
      'EUR': 1.08,
      'RUB': 100.00,
      'CUP': 820.00
    };

    let rateFrom = rates[fromCurrency] || 1.0;
    let rateTo = rates[toCurrency] || 1.0;

    let valueInUSD = numAmount * rateFrom;
    let convertedAmount = valueInUSD / rateTo;

    res.json({
      success: true,
      from: fromCurrency,
      to: toCurrency,
      inputAmount: numAmount,
      result: Number(convertedAmount.toFixed(4)),
      exchangeRate: Number((rateFrom / rateTo).toFixed(6))
    });

  } catch (err) {
    console.error("Error en conversión de divisas:", err);
    res.status(500).json({ success: false, error: 'Error al calcular tasa de cambio' });
  }
});

// Puerto de escucha en Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
