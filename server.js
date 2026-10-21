const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { Telegraf } = require('telegraf');
require('dotenv').config();

const app = express();

// Configuración estricta de CORS para evitar cualquier bloqueo de preflight
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Conexión a Base de Datos PostgreSQL (Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Bot de Telegram
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '7636321016:AAGpn_mmwx4jwPwLUOg90fFfdkkikMGDuP4');
bot.launch().catch(err => console.log("Bot launch warning:", err.message));

// ==========================================
// 1. OBTENER DATOS DEL USUARIO
// ==========================================
app.get('/api/user/:telegramId', async (req, res) => {
  const { telegramId } = req.params;

  try {
    const cardsResult = await pool.query('SELECT * FROM cards WHERE telegram_id = $1', [telegramId]);
    const historyResult = await pool.query('SELECT * FROM transactions WHERE telegram_id = $1 ORDER BY id DESC LIMIT 15', [telegramId]);

    res.json({
      success: true,
      user: {
        cards: cardsResult.rows,
        history: historyResult.rows
      }
    });
  } catch (err) {
    console.error("Error en /api/user:", err);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ==========================================
// 2. EMITIR NUEVA TARJETA VIRTUAL
// ==========================================
app.post('/api/buy-card', async (req, res) => {
  const { telegramId, cardType } = req.body;

  try {
    if (!telegramId) {
      return res.status(400).json({ success: false, error: 'Telegram ID no proporcionado' });
    }

    const typeStr = cardType || 'Visa Standard';
    const cardNumber = '•••• ' + Math.floor(1000 + Math.random() * 9000);
    const gradient = typeStr.includes('Mastercard') 
      ? 'linear-gradient(135deg, #7f1d1d 0%, #0f172a 100%)' 
      : 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)';

    await pool.query(
      `INSERT INTO cards (telegram_id, type, card_number, balance, expiry, status, gradient) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [telegramId, typeStr.toUpperCase(), cardNumber, 0.00, '08/28', 'Activa', gradient]
    );

    await pool.query(
      `INSERT INTO transactions (telegram_id, title, description, amount, status) 
       VALUES ($1, $2, $3, $4, $5)`,
      [telegramId, `Emisión de Tarjeta`, typeStr, '$0.00', 'COMPLETED']
    );

    try {
      await bot.telegram.sendMessage(
        telegramId,
        `💳 *¡Tarjeta emitida con éxito!*\n\nTu nueva tarjeta *${typeStr}* ya está activa en tu cuenta.`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.log("Aviso de Telegram:", e.message);
    }

    res.json({ success: true, message: 'Tarjeta emitida correctamente' });
  } catch (err) {
    console.error("Error en /api/buy-card:", err);
    res.status(500).json({ success: false, error: 'Error al emitir tarjeta en base de datos' });
  }
});

// ==========================================
// 3. CREAR ORDEN DE RECARGA
// ==========================================
app.post('/api/recharge', async (req, res) => {
  const { telegramId, cardId, amount, crypto } = req.body;

  try {
    const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
    const depositAddress = crypto?.includes('TON') 
      ? 'UQAPEX...TON_SmartContract_Address...55a' 
      : 'TY7z...USDT_TRC20_Default_Address...99xQ';

    await pool.query(
      `INSERT INTO transactions (telegram_id, card_id, title, description, amount, status, order_id, address) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [telegramId, cardId, `Recarga ${crypto || 'USDT'}`, `Pendiente de pago`, `+$${amount}`, 'PENDING', orderId, depositAddress]
    );

    res.json({
      success: true,
      orderId,
      amount,
      crypto: crypto || 'USDT (TRC20)',
      address: depositAddress
    });
  } catch (err) {
    console.error("Error en /api/recharge:", err);
    res.status(500).json({ success: false, error: 'Error al procesar la orden de recarga' });
  }
});

// ==========================================
// 3.1 SOLICITAR PAGO WEB / AUTORIZAR CARGO
// ==========================================
app.post('/api/request-charge', async (req, res) => {
  const { telegramId, cardId, merchant, amount, crypto } = req.body;

  try {
    const orderId = 'PAY-' + Math.floor(100000 + Math.random() * 900000);
    const depositAddress = 'TY7z...USDT_TRC20_Default_Address...99xQ';

    await pool.query(
      `INSERT INTO transactions (telegram_id, card_id, title, description, amount, status, order_id, address) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [telegramId, cardId, `Pago en ${merchant}`, `Autorización web`, `-$${amount}`, 'PENDING', orderId, depositAddress]
    );

    try {
      await bot.telegram.sendMessage(
        telegramId,
        `🛒 *Solicitud de Pago Web*\n\nComercio: *${merchant}*\nMonto: \`$${amount} USD\`\nOrden: \`${orderId}\``,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.log("Aviso Telegram:", e.message);
    }

    res.json({
      success: true,
      orderId,
      amount,
      merchant,
      address: depositAddress
    });
  } catch (err) {
    console.error("Error en /api/request-charge:", err);
    res.status(500).json({ success: false, error: 'Error al solicitar el pago' });
  }
});

// ==========================================
// 4. CONFIRMAR PAGO
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
      return res.json({ success: false, error: 'Orden ya procesada' });
    }

    await pool.query('UPDATE transactions SET status = $1 WHERE order_id = $2', ['COMPLETED', orderId]);
    const numAmount = parseFloat(order.amount.replace(/[^0-9.-]/g, '')) || 0;

    if (order.card_id && order.amount.startsWith('+')) {
      await pool.query('UPDATE cards SET balance = balance + $1 WHERE id = $2', [numAmount, order.card_id]);
    }

    res.json({ success: true, message: 'Pago confirmado correctamente' });
  } catch (err) {
    console.error("Error en /api/confirm-payment:", err);
    res.status(500).json({ success: false, error: 'Error al confirmar pago' });
  }
});

// ==========================================
// 5. DETALLES DE TARJETA (PIN)
// ==========================================
app.post('/api/card-details', async (req, res) => {
  const { telegramId, cardId, pin } = req.body;

  try {
    if (pin !== "1234") {
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
    console.error("Error en /api/card-details:", err);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// ==========================================
// 6. TASA DE CAMBIO Y DIVISAS
// ==========================================
app.post('/api/exchange-rate', async (req, res) => {
  const { fromCurrency, toCurrency, amount } = req.body;

  try {
    const numAmount = parseFloat(amount) || 0;
    const rates = {
      'USDT': 1.0,
      'USD': 1.0,
      'TON': 5.50,
      'BTC': 68000.00,
      'EUR': 1.08,
      'RUB': 95.00,
      'CUP': 320.00
    };

    const rateFrom = rates[fromCurrency] || 1.0;
    const rateTo = rates[toCurrency] || 1.0;
    const valueInUSD = numAmount * rateFrom;
    const converted = valueInUSD / rateTo;

    res.json({
      success: true,
      from: fromCurrency,
      to: toCurrency,
      inputAmount: numAmount,
      result: Number(converted.toFixed(4)),
      exchangeRate: Number((rateFrom / rateTo).toFixed(6))
    });
  } catch (err) {
    console.error("Error en /api/exchange-rate:", err);
    res.status(500).json({ success: false, error: 'Error al calcular tasa' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
