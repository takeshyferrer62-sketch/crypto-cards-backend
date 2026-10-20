const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Inicializar Bot y Servidor Express
const bot = new Telegraf(process.env.BOT_TOKEN || 'TU_BOT_TOKEN_AQUI');
const app = express();

app.use(express.json());
app.use(cors());

// Base de datos simulada en memoria (puedes conectarla luego a MongoDB o PostgreSQL)
let usersDatabase = {
  // Ejemplo de usuario por su Telegram ID
  "123456789": {
    name: "Yunier",
    cards: [
      { id: 1, type: 'VISA', number: '4532 •••• •••• 8821', balance: 145.50, expiry: '08/28', status: 'Activa' },
      { id: 2, type: 'MASTERCARD', number: '5412 •••• •••• 9934', balance: 420.00, expiry: '12/27', status: 'Activa' }
    ],
    history: [
      { id: 1, type: 'Recarga USDT', amount: '+$50.00', date: 'Hace 2 horas' }
    ]
  }
};

// --- RUTA API PARA EL FRONTEND (Vercel) ---
// La Mini App consultará aquí para obtener las tarjetas reales del usuario de Telegram
app.get('/api/user/:telegramId', (req, res) => {
  const { telegramId } = req.params;
  
  // Si el usuario no existe en la BD simulada, le creamos una cuenta por defecto
  if (!usersDatabase[telegramId]) {
    usersDatabase[telegramId] = {
      name: "Usuario",
      cards: [
        { id: 1, type: 'VISA', number: '4532 •••• •••• 1001', balance: 10.00, expiry: '12/29', status: 'Activa' }
      ],
      history: []
    };
  }
  
  res.json(usersDatabase[telegramId]);
});

// Endpoint para procesar una orden de recarga cripto
app.post('/api/recharge', (req, res) => {
  const { telegramId, cardId, amount, crypto } = req.body;
  
  // Aquí validarías la transacción en la blockchain o generarías la pasarela
  console.log(`Orden de recarga recibida: $${amount} USD en ${crypto} para la tarjeta ID ${cardId}`);
  
  res.json({ success: true, message: "Orden generada correctamente. Esperando confirmación de red." });
});

// --- CONFIGURACIÓN DEL BOT DE TELEGRAM ---
bot.start((ctx) => {
  const userName = ctx.from.first_name || 'Usuario';
  const webAppUrl = process.env.WEB_APP_URL || 'https://tu-mini-app.vercel.app';

  ctx.reply(
    `¡Bienvenido de nuevo, *${userName}*! 💳⚡\n\nGestiona tus tarjetas virtuales Visa y MasterCard y recárgalas al instante con criptomonedas de forma segura.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Abrir Panel Cripto', webAppUrl)]
      ])
    }
  );
});

// Iniciar Bot
bot.launch();
console.log('🤖 Bot de Telegram y Backend iniciados correctamente...');

// Iniciar servidor Express en el puerto 3000 (o el que asigne la nube)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Servidor API corriendo en el puerto ${PORT}`);
});
// Almacén temporal de órdenes de recarga pendientes
let rechargeOrders = [];

// Endpoint para crear una nueva orden de recarga
app.post('/api/create-recharge', (req, res) => {
  const { telegramId, cardId, amount, crypto } = req.body;
  
  const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
  
  // Direcciones de ejemplo según la cripto seleccionada
  const walletAddresses = {
    "USDT (TRC20)": "TRX_sample_wallet_address_99812",
    "USDT (TON)": "UQ_ton_sample_address_77431",
    "TON (Toncoin)": "EQ_toncoin_sample_address_55210",
    "BTC (Bitcoin)": "bc1_bitcoin_sample_address_33421"
  };

  const newOrder = {
    orderId,
    telegramId,
    cardId,
    amount,
    crypto,
    address: walletAddresses[crypto] || "EQ_default_address",
    status: "PENDING",
    createdAt: new Date()
  };

  rechargeOrders.push(newOrder);

  res.json({
    success: true,
    message: "Orden de pago creada correctamente",
    order: newOrder
  });
});

// Endpoint para consultar el estado de una orden (El frontend puede consultarlo cada pocos segundos)
app.get('/api/check-order/:orderId', (req, res) => {
  const { orderId } = req.params;
  const order = rechargeOrders.find(o => o.orderId === orderId);
  
  if (!order) {
    return res.status(404).json({ success: false, message: "Orden no encontrada" });
  }

  res.json({ success: true, status: order.status });
});