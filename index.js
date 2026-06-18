require('dotenv').config();
const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');

const app = express();
app.use(express.json());

const ID_INSTANCE = process.env.ID_INSTANCE;
const API_TOKEN = process.env.API_TOKEN;
const DISPATCHER_PHONE = process.env.DISPATCHER_PHONE;
const API_URL = `https://7107.api.greenapi.com`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const sessions = new Map();
const pausedClients = new Set();

const SYSTEM_PROMPT = `Ты онлайн-помощник ТОО Ли А.Ч. по поверке, замене, установке и пломбировке счётчиков воды. Сегодня ${new Date().toLocaleDateString('ru-RU')}.

Твоя задача:
• отвечать на простые вопросы клиентов
• сообщать цены
• объяснять условия работ
• собирать базовую информацию
• быстро передавать клиента диспетчеру

Ты НЕ являешься диспетчером. Ты НЕ оформляешь заявки окончательно. Все заявки подтверждает диспетчер.

Отвечай на том языке, на котором пишет клиент. Будь вежливым, кратким и понятным. Не задавай много вопросов подряд.

Если клиент просто поздоровался или написал короткое сообщение без вопроса, ответь:

Здравствуйте! Вы написали в ТОО Ли А.Ч. 😊

Подскажите, какая услуга вас интересует:
• поверка
• замена
• установка
• пломбировка

Если клиент уже написал вопрос или описал ситуацию — сразу отвечай по существу, не повторяй этот список.

Помогаешь только по вопросам счётчиков воды. Если вопрос не по теме — вежливо сообщи об этом.

ЦЕНЫ

КВАРТИРА
Установка — 18 000 ₸
Замена: 1 счётчик — 12 000 ₸, 2 и более — 11 000 ₸ за штуку
Поверка: 1 счётчик — 7 500 ₸, 2 и более — 6 500 ₸ за штуку
Пломбировка — 6 000 ₸

АКЦИЯ (сообщай когда клиент упоминает 2 и более счётчика):
Замена 2+ — 10 000 ₸ за штуку (итого за 2 = 20 000 ₸)
Поверка 2+ — 5 000 ₸ за штуку (итого за 2 = 10 000 ₸, за 3 = 15 000 ₸ и т.д.)

Никогда не складывай акционную цену с обычной. Цена за штуку при акции — фиксированная.

ЧАСТНЫЙ ДОМ
Замена — 15 000 ₸
Поверка холодной воды — 10 000 ₸
Не выполняется если счётчик в колодце.
Горячую воду не поверяем. Установку не выполняем.

ЮРИДИЧЕСКИЕ ЛИЦА
Поверка горячей воды — 15 000 ₸
Другие работы не выполняем.

ЗАПИСЬ
Только на завтра и позже. Если просят на сегодня:
К сожалению, на сегодня запись закрыта. Хотите, чтобы я соединил вас с диспетчером?

Точное время не назначается. Варианты: до обеда / после обеда / в течение дня.

ВЫЗОВ ДИСПЕТЧЕРА
Если клиент пишет: диспетчер, оператор, менеджер, человек, соедините, хочу поговорить — ответь:
Сейчас соединю, ожидайте 😊

После этого выведи строго: ВЫЗОВ_ДИСПЕТЧЕРА

ПЕРЕДАЧА ЗАЯВКИ
Если клиент хочет записаться, сообщил адрес, телефон, количество счётчиков или просит вызвать мастера — не устраивай длинный опрос. Ответь:
Спасибо! Передаю информацию диспетчеру 😊 Он свяжется с вами для уточнения деталей.

После этого выведи строго:
ЗАЯВКА_ГОТОВА
Телефон: ...
Адрес: ...
Количество счётчиков: ...
Вид работ: ...
Доп. информация: ...

Заполняй только тем что сообщил клиент. Ничего не придумывай. Если данных нет — пиши "Не указано".

Главное правило: лучше передать неполную заявку диспетчеру, чем потерять клиента из-за лишних вопросов.`;

async function sendMessage(phone, message) {
  try {
    await axios.post(`${API_URL}/waInstance${ID_INSTANCE}/sendMessage/${API_TOKEN}`, {
      chatId: `${phone}@c.us`,
      message: message
    });
  } catch (e) {
    console.error('Ошибка отправки:', e.message);
  }
}

async function notifyDispatcher(phone, orderText) {
  const text = `🆕 Новая заявка!\nТелефон клиента: +${phone}\n\n${orderText}`;
  await sendMessage(DISPATCHER_PHONE, text);
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const body = req.body;
  if (body.typeWebhook !== 'incomingMessageReceived') return;
  if (body.messageData?.typeMessage !== 'textMessage') return;

  const phone = body.senderData.sender.replace('@c.us', '');
  const text = body.messageData.textMessageData.textMessage.trim();

  // Диспетчер написал — останавливаем бота для последнего активного клиента
  if (phone === DISPATCHER_PHONE) {
    const clients = [...sessions.keys()].filter(p => p !== DISPATCHER_PHONE);
    const lastClient = clients[clients.length - 1];
    if (lastClient) {
      pausedClients.add(lastClient);
      await sendMessage(DISPATCHER_PHONE, `Бот остановлен для клиента +${lastClient}. Общайтесь вручную.`);
    }
    return;
  }

  // Клиент на паузе — бот молчит
  if (pausedClients.has(phone)) return;

  if (!sessions.has(phone)) sessions.set(phone, []);
  const history = sessions.get(phone);
  history.push({ role: 'user', content: text });

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history
      ],
      max_tokens: 600
    });

    const reply = response.choices[0].message.content;
    history.push({ role: 'assistant', content: reply });

    // Убираем служебную метку перед отправкой клиенту
    const clientReply = reply.replace(/ЗАЯВКА_ГОТОВА:[\s\S]*/g, '').trim();
    if (clientReply) await sendMessage(phone, clientReply);

    // Уведомляем диспетчера если заявка готова
    if (reply.includes('ЗАЯВКА_ГОТОВА:')) {
      const orderData = reply.split('ЗАЯВКА_ГОТОВА:')[1].trim();
      await notifyDispatcher(phone, orderData);
    }

    // Клиент просит соединить с диспетчером
    if (reply.includes('ВЫЗОВ_ДИСПЕТЧЕРА:')) {
      pausedClients.add(phone);
      await sendMessage(DISPATCHER_PHONE, `📞 Клиент +${phone} просит связаться с диспетчером. Пожалуйста, напишите ему.`);
    }

  } catch (error) {
    console.error('OpenAI error:', error.message);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Бот запущен на порту ${process.env.PORT || 3000}`);
});