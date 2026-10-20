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
// 1. OBTENER DATOS DEL USUARIO (Tarjetas e Historial)
// ==========================================
app.get('/api/user/:telegramId', async (req, res) => {
  const { telegramId } = req.params;

  try {
    // Buscar o inicializar usuario si no existe
    let cardsResult = await pool.query('SELECT * FROM cards WHERE telegram_id = $1', [telegramId]);
    let historyResult = await pool.query('SELECT * FROM transactions WHERE telegram_id = $1 ORDER BY id DESC LIMIT 10', [telegramId]);

    // Si el usuario no tiene tarjetas registradas, le creamos unas por defecto de prueba
    if (cardsResult.rows.length === 0) {
      await pool.query(
        `INSERT INTO cards (telegram_id, type, card_number, balance, expiry, status, gradient) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [telegramId, 'VISA', '•••• 7024', 12460.75, '04/26', 'Activa', 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)']
      );
      await pool.query(
        `INSERT INTO cards (telegram_id, type, card_number, balance, expiry, status, gradient) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [telegramId, 'MASTERCARD', '•••• 8821', 420.00, '12/27', 'Activa', 'linear-gradient(135deg, #7f1d1d 0%, #0f172a 100%)']
      );
      cardsResult = await pool.query('SELECT * FROM cards WHERE telegram_id = $1', [telegramId]);
    }

    res.json({
      success: true,
      user: {
        cards: cardsResult.rows,
        history: historyResult.rows.length > 0 ? historyResult.rows : [
          { id: 1, title: 'Depósito Cripto', description: 'USDT • TRC20', amount: '+$5,000', date: 'Justo ahora' },
          { id: 2, title: 'Compra Online', description: 'Amazon', amount: '-$149.50', date: 'Ayer' }
        ]
      }
    });

  } catch (err) {
    console.error("Error al obtener usuario:", err);
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

    // Registrar transacción de emisión
    await pool.query(
      `INSERT INTO transactions (telegram_id, title, description, amount, status) 
       VALUES ($1, $2, $3, $4, $5)`,
      [telegramId, `Emisión de Tarjeta`, cardType, '$0.00', 'COMPLETED']
    );

    // Notificar por Telegram
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

    // Guardar orden pendiente en DB
    await pool.query(
      `INSERT INTO transactions (telegram_id, card_id, title, description, amount, status, order_id, address) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [telegramId, cardId, `Recarga ${crypto}`, `Pendiente de pago`, `+$${amount}`, 'PENDING', orderId, depositAddress]
    );

    // Notificación automática al chat de Telegram
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

    // Actualizar transacción a completada
    await pool.query('UPDATE transactions SET status = $1 WHERE order_id = $2', ['COMPLETED', orderId]);

    const numericAmount = parseFloat(order.amount.replace(/[^0-9.]/g, '')) || 0;

    // Acreditar saldo a la tarjeta
    if (order.card_id) {
      await pool.query(
        'UPDATE cards SET balance = balance + $1 WHERE id = $2',
        [numericAmount, order.card_id]
      );
    }

    // Notificar éxito en Telegram
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

// Puerto de escucha en Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
