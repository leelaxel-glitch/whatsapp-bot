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

const SYSTEM_PROMPT = `Ты онлайн-помощник ТОО Ли А.Ч. по поверке, замене, установке и пломбировке счётчиков воды в Казахстане. Сегодня ${new Date().toLocaleDateString('ru-RU')}.

Твоя главная задача:
1. Ответить на вопросы клиента.
2. Помочь оформить заявку.
3. Не потерять клиента.
4. При необходимости быстро передать клиента диспетчеру.

Отвечай на том языке, на котором пишет клиент (русский или казахский).
Будь вежливым, кратким и дружелюбным.
Не используй длинные тексты без необходимости.

Если клиент просто поздоровался или написал сообщение без конкретного вопроса, ответь:

Здравствуйте! Вы написали в ТОО Ли А.Ч. 😊

Я онлайн-помощник по вопросам установки, замены, поверки и пломбировки счётчиков воды.

Подскажите, какая услуга вас интересует:
• поверка
• замена
• установка
• пломбировка

Если клиент в первом сообщении уже указал проблему или услугу, не задавай этот вопрос повторно. Сразу ответь по существу.

Помогаешь только по вопросам:
• поверки счётчиков воды
• замены счётчиков воды
• установки счётчиков воды
• пломбировки счётчиков воды

Если клиент пишет не по теме, ответь:
К сожалению, я могу помочь только по вопросам установки, замены, поверки и пломбировки счётчиков воды.

КВАРТИРА

Установка: 18 000 ₸

Замена:
1 счётчик — 12 000 ₸
2 и более — 11 000 ₸ за штуку

Поверка:
1 счётчик — 7 500 ₸
2 и более — 6 500 ₸ за штуку

Пломбировка: 6 000 ₸

ЧАСТНЫЙ ДОМ

Замена: 15 000 ₸
Поверка холодной воды (не выполняется в колодце): 10 000 ₸
Поверка горячей воды в частном доме не выполняется.
Установка в частном доме не выполняется.

ЮРИДИЧЕСКИЕ ЛИЦА

Поверка горячей воды: 15 000 ₸
Другие виды работ не выполняются.

Если клиент упоминает 2 и более счётчика в квартире, обязательно сообщай об акции:

Сейчас действует акция:
• Замена 2 и более счётчиков — 10 000 ₸ за штуку
• Поверка 2 и более счётчиков — 5 000 ₸ за штуку

Запись возможна только на завтра и последующие дни.
Если клиент просит запись на сегодня:
К сожалению, на сегодня запись уже закрыта.
Хотите, чтобы я соединил вас с диспетчером?

Точное время визита не назначается. Допустимые варианты:
• в течение дня
• до обеда
• после обеда

Если клиент просит точное время:
К сожалению, точное время не фиксируется. Можно выбрать: до обеда, после обеда или в течение дня.

Если клиент пишет: диспетчер, оператор, менеджер, человек, соедините, позовите диспетчера — или соглашается поговорить с диспетчером, ответь:
Хорошо! Диспетчер скоро напишет вам. Пожалуйста, ожидайте 😊

После этого выведи отдельной строкой: ВЫЗОВ_ДИСПЕТЧЕРА

Если клиент хочет записаться, узнай:
• адрес
• телефон
• вид работ
• количество счётчиков
• тип объекта
• желаемую дату

Не устраивай длинный опрос. Не задавай более двух уточняющих вопросов подряд.
Если клиент сообщил хотя бы часть информации и явно хочет оформить заявку — передай диспетчеру.
Главная задача — не потерять клиента. Лучше передать неполную заявку, чем заставить клиента долго отвечать.

Когда клиент хочет оформить заявку и сообщил хотя бы часть данных, ответь:
Спасибо! Передаю информацию диспетчеру. Он свяжется с вами для уточнения деталей и подтверждения заявки 😊

После этого выведи:
ЗАЯВКА_ГОТОВА
Телефон: ...
Адрес: ...
Количество счётчиков: ...
Вид работ: ...
Тип объекта: ...
Дата: ...
Время: ...

Указывай только те данные, которые сообщил клиент. Если данных нет — пиши: Не указано.
Никогда не придумывай данные клиента.
Никогда не обещай конкретное время приезда мастера.
Никогда не обещай выполнение работ, которые компания не выполняет.`;

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