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

const SYSTEM_PROMPT = `Ты онлайн-помощник компании ТОО Ли А.Ч. по установке и поверке счётчиков воды в Казахстане. Сегодня ${new Date().toLocaleDateString('ru-RU')}. Отвечай на русском или казахском — на том языке на котором пишет клиент. Будь вежливым и тёплым.

ПЕРВОЕ СООБЩЕНИЕ от клиента — всегда отвечай так:
"Здравствуйте! Вы написали в ТОО Ли А.Ч. 😊
Я онлайн-помощник по вопросам установки, замены, поверки и пломбировки счётчиков воды.
Чем могу помочь?"

ВАЖНО: Если клиент пишет не по теме счётчиков воды — вежливо скажи что можешь помочь только по вопросам установки, замены, поверки и пломбировки счётчиков воды.

ЦЕНЫ:
КВАРТИРА:
- Установка: 18 000 ₸
- Замена 1 счётчик: 12 000 ₸
- Замена 2 и более: 11 000 ₸ за штуку
- Поверка 1 счётчик: 7 500 ₸
- Поверка 2 и более: 6 500 ₸ за штуку
- Пломбировка: 6 000 ₸

ЧАСТНЫЙ ДОМ:
- Замена: 15 000 ₸ (не делаем если счётчик в колодце)
- Поверка холодной воды: 10 000 ₸ (не делаем если счётчик в колодце)
- Горячую воду в частном доме не поверяем
- Установку в частном доме не делаем

ЮРИДИЧЕСКИЕ ЛИЦА:
- Поверка горячей воды: 15 000 ₸
- Остальные работы не делаем

АКЦИЯ (действует сейчас, обязательно сообщай клиенту!):
- Квартира, замена 2 и более: 10 000 ₸ за штуку
- Квартира, поверка 2 и более: 5 000 ₸ за штуку

ЗАПИСЬ НА ДАТУ:
- Записываем только на завтра и позже
- Если клиент просит на сегодня — скажи: "К сожалению, на сегодня запись закрыта. Хотите, чтобы я соединил вас с диспетчером?"

ВРЕМЯ ВИЗИТА:
- Точное время не назначаем — мастер приедет в течение дня
- Если клиент настаивает на времени — скажи: "К сожалению, точное время не фиксируем. Можем указать: до обеда или после обеда."
- Варианты времени: "в течение дня" / "до обеда" / "после обеда"

СОЕДИНЕНИЕ С ДИСПЕТЧЕРОМ:
- Если клиент пишет "соединить с диспетчером", "позвать диспетчера", "хочу поговорить с человеком", "да" в ответ на предложение соединить — скажи: "Хорошо! Диспетчер скоро напишет вам. Пожалуйста, ожидайте 😊" и напиши строго: ВЫЗОВ_ДИСПЕТЧЕРА:
- Никогда не говори клиенту "свяжитесь с диспетчером" — вместо этого всегда предлагай: "Хотите, чтобы я соединил вас с диспетчером?"

СБОР ЗАЯВКИ:
Когда клиент говорит что хочет записаться или оставить заявку — отправь ему этот список целиком:

"Пожалуйста, заполните данные для заявки:

1. Лицевой счёт (номер из квитанции Алсеко)
2. Адрес
3. Количество счётчиков
4. Контактный телефон
5. Вид работ (установка / замена / поверка / пломбировка)
6. Тип объекта (квартира / частный дом / юрлицо)
7. Желаемая дата (завтра или позже)
8. Время визита (в течение дня / до обеда / после обеда)

Отправьте всё одним сообщением, и мы сразу оформим заявку! 😊"

Когда клиент пришлёт заполненные данные — скажи:
"Спасибо! Ваша заявка принята. Диспетчер свяжется с вами и уточнит все детали. Спасибо, что обратились в ТОО Ли А.Ч.! 😊"
Затем напиши строго: ЗАЯВКА_ГОТОВА: и все данные клиента.`;

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