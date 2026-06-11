require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Database = require('better-sqlite3');

const app = express();
app.use(express.json());

const db = new Database('orders.db');

// Создаём таблицу заявок
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    name TEXT,
    address TEXT,
    district TEXT,
    meters INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const ID_INSTANCE = process.env.ID_INSTANCE;
const API_TOKEN = process.env.API_TOKEN;
const DISPATCHER_PHONE = process.env.DISPATCHER_PHONE;
const API_URL = `https://7107.api.greenapi.com`;

// Состояния диалога
const sessions = {};

async function sendMessage(phone, message) {
  await axios.post(`${API_URL}/waInstance${ID_INSTANCE}/sendMessage/${API_TOKEN}`, {
    chatId: `${phone}@c.us`,
    message: message
  });
}

async function notifyDispatcher(order) {
  const text = `🆕 Новая заявка!\n\nИмя: ${order.name}\nАдрес: ${order.address}\nРайон: ${order.district}\nСчётчиков: ${order.meters}\nТелефон: ${order.phone}`;
  await sendMessage(DISPATCHER_PHONE, text);
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const body = req.body;
  if (body.typeWebhook !== 'incomingMessageReceived') return;
  if (body.messageData?.typeMessage !== 'textMessage') return;

  const phone = body.senderData.sender.replace('@c.us', '');
  const text = body.messageData.textMessageData.textMessage.trim();

  if (!sessions[phone]) sessions[phone] = { step: 0 };
  const session = sessions[phone];

  if (session.step === 0) {
    await sendMessage(phone, 'Здравствуйте! Я бот службы поверки счётчиков. Как вас зовут?');
    session.step = 1;
  } else if (session.step === 1) {
    session.name = text;
    await sendMessage(phone, 'Укажите ваш адрес (улица, дом, квартира):');
    session.step = 2;
  } else if (session.step === 2) {
    session.address = text;
    await sendMessage(phone, 'В каком районе?');
    session.step = 3;
  } else if (session.step === 3) {
    session.district = text;
    await sendMessage(phone, 'Сколько счётчиков нужно поверить?');
    session.step = 4;
  } else if (session.step === 4) {
    session.meters = text;

    // Сохраняем заявку
    db.prepare('INSERT INTO orders (phone, name, address, district, meters) VALUES (?, ?, ?, ?, ?)')
      .run(phone, session.name, session.address, session.district, session.meters);

    await sendMessage(phone, `Спасибо, ${session.name}! Ваша заявка принята. Наш диспетчер свяжется с вами в ближайшее время.`);

    // Уведомляем диспетчера
    await notifyDispatcher({ phone, ...session });

    delete sessions[phone];
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Бот запущен на порту ${process.env.PORT}`);
});